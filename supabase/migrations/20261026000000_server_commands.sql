-- Phase 1.1: the server becomes the only writer.
-- * audit_events: one row per change, with the real person, server time and the outcome. Rows can only be added;
--   nobody (not even the service itself) can edit or delete them.
-- * save_workspace(): how the server function saves, recording who made the change. Only the service can call it.
-- * The ledger rules (posted journal, stock and payment lines never change, numbers never go back) now apply to every
--   save, including the server's, not only to saves made by people from the browser.

create table public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id text not null references public.workspaces (id),
  at timestamptz not null default now(),
  actor uuid,
  actor_email text not null,
  command text not null,
  label text,
  ok boolean not null,
  error text,
  record_ids text[] not null default '{}'
);
create index audit_events_workspace_at_idx on public.audit_events (workspace_id, at desc);
alter table public.audit_events enable row level security;
create policy "admins read the audit trail" on public.audit_events
  for select to authenticated using (private.is_ws_admin(workspace_id));

create function private.audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The audit trail can''t be changed or deleted' using errcode = '42501';
end
$$;
create trigger audit_events_append_only before update or delete on public.audit_events
for each row execute function private.audit_append_only();

-- The server function saves through this, so the save is attributed to the person who asked for it.
create function public.save_workspace(p_id text, p_base bigint, p_doc jsonb, p_actor uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v bigint;
begin
  perform set_config('bonyan.actor', p_actor::text, true);
  update public.workspaces
     set doc = p_doc, name = left(coalesce(p_doc #>> '{answers,companyName}', ''), 120)
   where id = p_id and version = p_base
  returning version into v;
  return v;
end
$$;
revoke execute on function public.save_workspace(text, bigint, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_workspace(text, bigint, jsonb, uuid) to service_role;

-- Same checks as before, but the ledger rules no longer depend on who is saving.
create or replace function private.guard_workspace_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  last_snapshot timestamptz;
  maintenance boolean := coalesce(current_setting('bonyan.maintenance', true), '') = 'on';
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
  new.updated_by := coalesce(auth.uid(), nullif(current_setting('bonyan.actor', true), '')::uuid);

  -- People saving straight from the browser: only admins may touch the setup, roles or team.
  if auth.uid() is not null and not private.is_ws_admin(old.id) and (new.doc - 'data') is distinct from (old.doc - 'data') then
    raise exception 'Only an admin can change the setup, roles or team' using errcode = '42501';
  end if;

  -- Everyone, the server included (unless a database administrator switches on maintenance for a restore).
  if not maintenance then
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

grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;
