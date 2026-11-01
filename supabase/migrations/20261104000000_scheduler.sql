-- Phase 1.4b: the server runs date-based automations every night (SECU-17 base), and drafts stay with admins (BUIL-M1).
-- * automation_runs: one row per scheduled run per workspace (how many automations ran, or what went wrong). Admins
--   read it on the Audit page. Rows are only ever added.
-- * The "scheduler" server function is called by a nightly database job (supabase/setup/schedule.sql). It proves who it
--   is with a key that only the database holds (private.scheduler_key); scheduler_key_ok() checks it.
-- * People who aren't admins no longer receive the setup draft or earlier setup versions: they only need the live setup.

create table public.automation_runs (
  id bigint generated always as identity primary key,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  at timestamptz not null default now(),
  ok boolean not null,
  ran integer not null default 0,
  error text
);
create index automation_runs_workspace_at_idx on public.automation_runs (workspace_id, at desc);
alter table public.automation_runs enable row level security;
revoke all on public.automation_runs from anon, authenticated;
grant select on public.automation_runs to authenticated;
create policy "admins read the automation runs" on public.automation_runs
  for select to authenticated using (private.is_ws_admin(workspace_id));
create trigger automation_runs_append_only before update or delete on public.automation_runs
for each row execute function private.audit_append_only();

create table private.scheduler_key (key text not null);
insert into private.scheduler_key (key) values (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
revoke all on private.scheduler_key from public, anon, authenticated;

create function public.scheduler_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.scheduler_key k where length(coalesce(p_key, '')) >= 32 and k.key = p_key)
$$;

-- The workspaces the nightly run works on: published and moved to the record tables.
create function public.scheduled_workspaces() returns setof text
language sql stable security definer set search_path = '' as $$
  select id from public.workspaces where data_in_tables and jsonb_typeof(doc -> 'published') = 'object' order by id
$$;

-- The owner's e-mail: scheduled automations run in the owner's name (and are labelled as scheduled in the audit trail).
create function public.workspace_owner_email(p_id text) returns text
language sql stable security definer set search_path = '' as $$
  select email from public.workspace_members where workspace_id = p_id and is_owner
$$;

revoke execute on function public.scheduler_key_ok(text), public.scheduled_workspaces(), public.workspace_owner_email(text) from public, anon, authenticated;
grant execute on function public.scheduler_key_ok(text), public.scheduled_workspaces(), public.workspace_owner_email(text) to service_role;
grant insert on public.automation_runs to service_role;

-- Drafts and earlier setup versions are for admins only.
create or replace function private.workspace_view(p_id text, p_email text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
  w public.workspaces;
  visible jsonb;
  secret text[];
begin
  select * into w from public.workspaces where id = p_id;
  if not found then return null; end if;
  select * into v from private.viewer(p_id, p_email);
  if v.user_id is null then return null; end if;
  if v.is_admin then
    return jsonb_set(w.doc, '{data}', coalesce(w.doc -> 'data', '{}') || private.table_data(p_id));
  end if;

  secret := private.cost_keys(w.doc);
  visible := jsonb_build_object(
    'records', coalesce((select jsonb_object_agg(module, recs) from (
        select module, jsonb_agg(case when v.costs or not (data ? 'values') then data else jsonb_set(data, '{values}', (data -> 'values') - secret) end order by ord desc) recs
          from public.records where workspace_id = p_id and module = any (v.viewable) group by module) x), '{}'),
    'journal', case when v.finance then coalesce((select jsonb_agg(data order by ord desc) from public.journal_entries where workspace_id = p_id), '[]') else '[]' end,
    'stock', coalesce((select jsonb_agg(case when v.costs then data else data - 'cost' - 'value' end order by ord desc) from public.stock_moves where workspace_id = p_id), '[]'),
    'payments', coalesce((select jsonb_agg(data order by ord desc) from public.payments where workspace_id = p_id and (v.finance or module = any (v.viewable))), '[]'),
    'approvals', coalesce((select jsonb_agg(data order by ord desc) from public.approvals where workspace_id = p_id and data ->> 'module' = any (v.viewable)), '[]'),
    'comments', coalesce((select jsonb_agg(c.data order by c.ord desc) from public.comments c
        join public.records r on r.workspace_id = c.workspace_id and r.id = c.record
       where c.workspace_id = p_id and r.module = any (v.viewable)), '[]'),
    'notes', coalesce((select jsonb_agg(data order by ord desc) from public.notes where workspace_id = p_id and
        case when data ->> 'user' is not null then data ->> 'user' = v.user_id
             else data ->> 'role' is null or data ->> 'role' = v.role_id or (data ->> 'role' = 'finance' and v.finance) end), '[]'),
    'activity', coalesce((select jsonb_agg(data order by ord desc) from public.activity where workspace_id = p_id and
        (data ->> 'module' is null or data ->> 'module' = any (v.viewable))), '[]'));
  return jsonb_set(w.doc || jsonb_build_object('draft', null, 'history', '[]'::jsonb), '{data}', coalesce(w.doc -> 'data', '{}') || visible);
end
$$;

grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;
revoke execute on function private.move_workspace_data(text), private.table_data(text), private.viewer(text, text), private.workspace_view(text, text),
  private.cost_keys(jsonb), private.accept_invitation(public.invitations), private.second_factor_problem(text, uuid, text, text) from authenticated;
