-- Dry run of 20261024100000_lock_down.sql plus attack tests. Starts a transaction and never commits.
-- When the editor finishes it should close the open transaction without saving; run  rollback;  afterwards to be sure.
begin;
-- Phase 0.1: lock the database door.
-- * Workspaces are created only through create_workspace(); id, owner and creation date can never change.
-- * Each workspace has exactly one owner; the owner can't be removed or demoted, only hand over ownership.
-- * The server sets the version and who saved, and keeps snapshots so a bad save can be undone.
-- * Only admins can change the setup, roles or team, and nobody can edit or delete posted journal,
--   stock or payment lines, or turn a document counter back.
-- * Anonymous logins never count as members; member e-mails must look like e-mails.

-- Members: owner flag, valid e-mails, one owner per workspace.
alter table public.workspace_members add column is_owner boolean not null default false;
alter table public.workspace_members add constraint workspace_members_email_valid check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
create unique index workspace_members_one_owner on public.workspace_members (workspace_id) where is_owner;

-- The creator becomes owner where they are still a member; otherwise the earliest admin.
update public.workspace_members m set is_owner = true, is_admin = true
from public.workspaces w join auth.users u on u.id = w.created_by
where m.workspace_id = w.id and m.email = lower(u.email);
update public.workspace_members m set is_owner = true
where m.workspace_id not in (select workspace_id from public.workspace_members where is_owner)
  and (m.workspace_id, m.added_at) in (select workspace_id, min(added_at) from public.workspace_members where is_admin group by workspace_id);

-- Workspaces: deleting a login must never delete a company; version is server-owned.
alter table public.workspaces drop constraint workspaces_created_by_fkey;
alter table public.workspaces add constraint workspaces_created_by_fkey foreign key (created_by) references auth.users (id) on delete restrict;
alter table public.workspaces alter column version type bigint;
alter table public.workspaces add column updated_by uuid;

-- Helpers. Anonymous sign-ins never match any member.
create or replace function private.auth_email() returns text
language sql stable set search_path = '' as $$
  select case when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then ''
              else lower(coalesce(auth.jwt() ->> 'email', '')) end
$$;

create function private.is_ws_owner(ws text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.email = private.auth_email() and m.is_owner)
$$;

/** Number of entries in old_arr that are missing or changed in new_arr (sample entries may be removed). */
create function private.changed_entries(old_arr jsonb, new_arr jsonb) returns bigint
language sql immutable set search_path = '' as $$
  select count(*)
  from jsonb_array_elements(coalesce(old_arr, '[]')) o
  left join jsonb_array_elements(coalesce(new_arr, '[]')) n on n ->> 'id' = o ->> 'id'
  where not coalesce((o ->> 'sample')::boolean, false) and (n is null or n <> o)
$$;


-- Snapshots of earlier versions (at most one every 10 minutes per workspace, kept 90 days).
create table public.workspace_versions (
  workspace_id text not null references public.workspaces (id) on delete cascade,
  version bigint not null,
  doc jsonb not null,
  saved_by uuid,
  saved_at timestamptz not null default now(),
  primary key (workspace_id, version)
);
alter table public.workspace_versions enable row level security;
create policy "owners read snapshots" on public.workspace_versions
  for select to authenticated using (private.is_ws_owner(workspace_id));


-- Every save goes through this check.
create or replace function private.guard_workspace_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  last_snapshot timestamptz;
begin
  if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'This change is not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(new.doc -> 'users') is distinct from 'array' or jsonb_typeof(new.doc -> 'data') is distinct from 'object' or new.doc ->> 'id' is distinct from old.id then
    raise exception 'This workspace data is damaged; the save was refused' using errcode = '22023';
  end if;
  if pg_column_size(new.doc) > 50000000 then
    raise exception 'This workspace is too large to save' using errcode = '54000';
  end if;
  new.version := old.version + 1;
  new.updated_by := auth.uid();

  -- Saves by signed-in people (not maintenance by the service itself) must respect the books.
  if auth.uid() is not null then
    if not private.is_ws_admin(old.id) and (new.doc - 'data') is distinct from (old.doc - 'data') then
      raise exception 'Only an admin can change the setup, roles or team' using errcode = '42501';
    end if;
    if private.changed_entries(old.doc #> '{data,journal}', new.doc #> '{data,journal}') > 0
       or private.changed_entries(old.doc #> '{data,stock}', new.doc #> '{data,stock}') > 0
       or private.changed_entries(old.doc #> '{data,payments}', new.doc #> '{data,payments}') > 0 then
      raise exception 'Posted journal, stock and payment lines can''t be changed or deleted. Void the document instead.' using errcode = '42501';
    end if;
    if exists (
      select 1 from jsonb_each_text(coalesce(old.doc #> '{data,sequences}', '{}')) o
      where o.key not like 'sample:%'
        and coalesce((new.doc #>> array['data', 'sequences', o.key])::numeric, -1) < o.value::numeric
    ) then
      raise exception 'Document numbers can''t go backwards' using errcode = '42501';
    end if;
  end if;

  select max(saved_at) into last_snapshot from public.workspace_versions where workspace_id = old.id;
  if last_snapshot is null or last_snapshot < now() - interval '10 minutes' then
    insert into public.workspace_versions (workspace_id, version, doc, saved_by) values (old.id, old.version, old.doc, old.updated_by)
    on conflict do nothing;
    delete from public.workspace_versions where workspace_id = old.id and saved_at < now() - interval '90 days';
  end if;
  return new;
end
$$;
create trigger workspaces_guard before update on public.workspaces
for each row execute function private.guard_workspace_update();

-- Owners can't be removed or demoted; ownership moves only through transfer_ownership().
create function private.guard_members() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Only people signed in to the app are limited; create_workspace() and transfer_ownership() run as the owner role.
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.is_owner then raise exception 'The owner can''t be removed. Transfer ownership first.' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' and new.is_owner then
    raise exception 'Use transfer ownership to change the owner' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.is_owner <> old.is_owner or new.email <> old.email or new.workspace_id <> old.workspace_id then
      raise exception 'Use transfer ownership to change the owner' using errcode = '42501';
    end if;
    if old.is_owner and not new.is_admin then
      raise exception 'The owner is always an admin' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger workspace_members_guard before insert or update or delete on public.workspace_members
for each row execute function private.guard_members();

-- Policies: no creator back door, workspaces are created by the function below.
drop policy "members read their workspace" on public.workspaces;
create policy "members read their workspace" on public.workspaces
  for select to authenticated using (private.is_member(id));
drop policy "signed-in users create their own workspace" on public.workspaces;

drop policy "admins add members" on public.workspace_members;
create policy "admins add members" on public.workspace_members
  for insert to authenticated with check (private.is_ws_admin(workspace_id));

-- Create a workspace with the caller as its owner, in one step.
create function public.create_workspace(p_id text, p_name text, p_doc jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
begin
  if auth.uid() is null or me = '' then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_id !~ '^ws_[a-z0-9]{6,40}$' then raise exception 'Invalid workspace id' using errcode = '22023'; end if;
  if (select count(*) from public.workspaces where created_by = auth.uid()) >= 5 then
    raise exception 'You can own up to 5 workspaces' using errcode = '42501';
  end if;
  if p_doc ->> 'id' is distinct from p_id or jsonb_typeof(p_doc -> 'users') is distinct from 'array' or jsonb_typeof(p_doc -> 'data') is distinct from 'object' then
    raise exception 'Invalid workspace data' using errcode = '22023';
  end if;
  insert into public.workspaces (id, name, doc, created_by) values (p_id, left(coalesce(p_name, ''), 120), p_doc, auth.uid());
  insert into public.workspace_members (workspace_id, email, is_admin, is_owner) values (p_id, me, true, true);
end
$$;

-- Hand the workspace to another admin. Only the current owner can do this.
create function public.transfer_ownership(p_workspace text, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_owner(p_workspace) then raise exception 'Only the owner can transfer ownership' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace and email = lower(p_email) and is_admin) then
    raise exception 'The new owner must be an admin of this workspace' using errcode = '22023';
  end if;
  update public.workspace_members set is_owner = false where workspace_id = p_workspace and is_owner;
  update public.workspace_members set is_owner = true, is_admin = true where workspace_id = p_workspace and email = lower(p_email);
end
$$;

revoke execute on function public.create_workspace(text, text, jsonb) from anon, public;
revoke execute on function public.transfer_ownership(text, text) from anon, public;
grant execute on function public.create_workspace(text, text, jsonb) to authenticated;
grant execute on function public.transfer_ownership(text, text) to authenticated;

grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;
insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-00000000000a','owner@test.dev','authenticated','authenticated'),
 ('00000000-0000-0000-0000-00000000000b','staff@test.dev','authenticated','authenticated'),
 ('00000000-0000-0000-0000-00000000000c','stranger@test.dev','authenticated','authenticated');
create temp table r(n serial, step text, outcome text);
grant all on r to authenticated, anon; grant usage on all sequences in schema pg_temp to authenticated, anon;
create function pg_temp.try(step text, q text) returns void language plpgsql as $f$
begin
  begin execute q; insert into r(step,outcome) values (step,'ALLOWED');
  exception when others then insert into r(step,outcome) values (step,'blocked: '||sqlerrm); end;
end $f$;
grant execute on function pg_temp.try(text,text) to authenticated, anon;
insert into r(step,outcome) select 'existing ws owner backfilled', string_agg(email||' owner='||is_owner,',') from public.workspace_members;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}',true);
select pg_temp.try('owner creates ws via rpc', $q$select public.create_workspace('ws_test123456','T','{"id":"ws_test123456","users":[],"draft":null,"data":{"journal":[{"id":"j1","x":1}],"stock":[],"payments":[],"sequences":{"INV":3}}}')$q$);
select pg_temp.try('direct insert into workspaces', $q$insert into public.workspaces(id,name,doc) values ('ws_direct00001','x','{"id":"ws_direct00001","users":[],"data":{}}')$q$);
select pg_temp.try('owner adds staff', $q$insert into public.workspace_members(workspace_id,email,is_admin) values ('ws_test123456','staff@test.dev',false)$q$);
select pg_temp.try('owner deletes own owner row', $q$delete from public.workspace_members where workspace_id='ws_test123456' and email='owner@test.dev'$q$);
insert into r(step,outcome) select '  -> owner row still there', count(*)::text from public.workspace_members where workspace_id='ws_test123456' and is_owner;
select pg_temp.try('owner demotes self', $q$update public.workspace_members set is_admin=false where workspace_id='ws_test123456' and email='owner@test.dev'$q$);
select pg_temp.try('admin inserts a 2nd owner', $q$insert into public.workspace_members(workspace_id,email,is_admin,is_owner) values ('ws_test123456','x@test.dev',true,true)$q$);

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b","email":"staff@test.dev","role":"authenticated"}',true);
select pg_temp.try('staff rewrites created_by', $q$update public.workspaces set created_by='00000000-0000-0000-0000-00000000000b' where id='ws_test123456'$q$);
select pg_temp.try('staff changes users list', $q$update public.workspaces set doc=jsonb_set(doc,'{users}','[{"id":"u","roleId":"role_admin"}]') where id='ws_test123456'$q$);
select pg_temp.try('staff appends journal entry (normal work), sends version 999', $q$update public.workspaces set version=999, doc=jsonb_set(doc,'{data,journal}','[{"id":"j2","x":2},{"id":"j1","x":1}]') where id='ws_test123456'$q$);
insert into r(step,outcome) select '  -> version after save', version::text from public.workspaces where id='ws_test123456';
select pg_temp.try('staff deletes journal entry', $q$update public.workspaces set doc=jsonb_set(doc,'{data,journal}','[{"id":"j2","x":2}]') where id='ws_test123456'$q$);
select pg_temp.try('staff edits journal entry', $q$update public.workspaces set doc=jsonb_set(doc,'{data,journal}','[{"id":"j2","x":2},{"id":"j1","x":99}]') where id='ws_test123456'$q$);
select pg_temp.try('staff turns INV counter back', $q$update public.workspaces set doc=jsonb_set(doc,'{data,sequences,INV}','1') where id='ws_test123456'$q$);
select pg_temp.try('staff breaks doc shape', $q$update public.workspaces set doc='{}' where id='ws_test123456'$q$);
select pg_temp.try('staff transfers ownership to self', $q$select public.transfer_ownership('ws_test123456','staff@test.dev')$q$);
select pg_temp.try('staff makes self admin', $q$update public.workspace_members set is_admin=true where email='staff@test.dev'$q$);
insert into r(step,outcome) select '  -> staff is_admin', is_admin::text from public.workspace_members where email='staff@test.dev';

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}',true);
select pg_temp.try('owner transfers to non-admin', $q$select public.transfer_ownership('ws_test123456','staff@test.dev')$q$);
select pg_temp.try('owner promotes staff to admin', $q$update public.workspace_members set is_admin=true where email='staff@test.dev'$q$);
select pg_temp.try('owner transfers to admin staff', $q$select public.transfer_ownership('ws_test123456','staff@test.dev')$q$);
insert into r(step,outcome) select '  -> owners now', string_agg(email,',') from public.workspace_members where workspace_id='ws_test123456' and is_owner;
select pg_temp.try('ex-owner (still admin) changes setup', $q$update public.workspaces set doc=jsonb_set(doc,'{draft}','{"a":1}') where id='ws_test123456'$q$);

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated","is_anonymous":true}',true);
insert into r(step,outcome) select 'anonymous stranger sees ws', count(*)::text from public.workspaces;
select pg_temp.try('anonymous creates ws', $q$select public.create_workspace('ws_anon000001','A','{"id":"ws_anon000001","users":[],"data":{}}')$q$);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}',true);
select pg_temp.try('stranger creates ws with mismatched doc id', $q$select public.create_workspace('ws_strange0001','S','{"id":"ws_other","users":[],"data":{}}')$q$);
insert into r(step,outcome) select 'stranger sees test ws', count(*)::text from public.workspaces where id='ws_test123456';
reset role;
insert into r(step,outcome) select 'snapshots kept', count(*)::text from public.workspace_versions where workspace_id='ws_test123456';
select step, outcome from r order by n;
