-- Inventor mode (owner's request, 3 Nov 2026): the people who build Bonyan can make as many companies as they like,
-- are never locked by the trial or by payments, can put any of their companies into any billing state to try it,
-- and can erase a test company at once. Kept in the database for these e-mails only; nobody can add themselves.

create table private.platform_staff (email text primary key check (email = lower(email)), added_at timestamptz not null default now());
revoke all on private.platform_staff from public, anon, authenticated;
insert into private.platform_staff (email) values
  ('profomar@hotmail.com'), ('info@totalcareegypt.com'), ('mohamed.omar@totalcareegypt.com')
on conflict do nothing;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_staff where email = private.auth_email())
$$;

-- For the app: whether to show the inventor tools.
create function public.am_i_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff()
$$;
revoke execute on function public.am_i_staff() from public, anon;
grant execute on function public.am_i_staff() to authenticated;

-- A company of an inventor: everything, as many people as needed, never locked (until they choose a test state).
create function private.make_internal(p_id text) returns void
language sql security definer set search_path = '' as $$
  insert into public.subscriptions (workspace_id, plan, status, cycle, seats, paid_until, note, updated_at)
  values (p_id, 'pro', 'paid', 'year', 200, '2100-01-01', 'inventor', now())
  on conflict (workspace_id) do update set plan = 'pro', status = 'paid', cycle = 'year', seats = 200, paid_until = '2100-01-01',
    trial_ends_at = null, note = 'inventor', updated_at = now()
$$;

-- Creating a company: up to 5 owned, except for inventors (no limit; their companies start unlocked).
create or replace function public.create_workspace(p_id text, p_name text, p_doc jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
begin
  if auth.uid() is null or me = '' then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_id !~ '^ws_[a-z0-9]{6,40}$' then raise exception 'Invalid workspace id' using errcode = '22023'; end if;
  if not private.is_staff() and (select count(*) from public.workspaces where created_by = auth.uid()) >= 5 then
    raise exception 'You can own up to 5 workspaces' using errcode = '42501';
  end if;
  if p_doc ->> 'id' is distinct from p_id or jsonb_typeof(p_doc -> 'users') is distinct from 'array' or jsonb_typeof(p_doc -> 'data') is distinct from 'object' then
    raise exception 'Invalid workspace data' using errcode = '22023';
  end if;
  insert into public.workspaces (id, name, doc, created_by) values (p_id, left(coalesce(p_name, ''), 120), p_doc, auth.uid());
  insert into public.workspace_members (workspace_id, email, is_admin, is_owner) values (p_id, me, true, true);
  if private.is_staff() then perform private.make_internal(p_id); end if;
end
$$;
revoke execute on function public.create_workspace(text, text, jsonb) from anon, public;
grant execute on function public.create_workspace(text, text, jsonb) to authenticated;

-- An inventor puts one of their companies into a billing state to try it (no payment).
create function public.staff_set_billing(p_id text, p_scenario text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n_seats integer := greatest(3, (select count(*) from public.workspace_members where workspace_id = p_id)::integer);
  cur text := coalesce((select plan from public.subscriptions where workspace_id = p_id and plan <> 'free'), 'growth');
begin
  if not private.is_staff() then raise exception 'Only Bonyan''s own team can do this' using errcode = '42501'; end if;
  if not private.is_ws_admin(p_id) then raise exception 'You are not an admin of this company' using errcode = '42501'; end if;
  delete from public.workspace_deletions where workspace_id = p_id;
  case p_scenario
    when 'internal' then perform private.make_internal(p_id);
    when 'trial' then update public.subscriptions set plan = 'pro', status = 'trial', trial_ends_at = now() + interval '14 days', paid_until = null, cycle = null, seats = 0, note = 'test', updated_at = now() where workspace_id = p_id;
    when 'trial_ending' then update public.subscriptions set plan = 'pro', status = 'trial', trial_ends_at = now() + interval '2 days', paid_until = null, cycle = null, seats = 0, note = 'test', updated_at = now() where workspace_id = p_id;
    when 'trial_ended' then update public.subscriptions set plan = 'pro', status = 'trial', trial_ends_at = now() - interval '1 minute', paid_until = null, cycle = null, seats = 0, note = 'test', updated_at = now() where workspace_id = p_id;
    when 'free' then update public.subscriptions set plan = 'free', status = 'free', cycle = null, seats = 0, paid_until = null, note = 'test', updated_at = now() where workspace_id = p_id;
    when 'crm', 'erp', 'growth', 'pro' then update public.subscriptions set plan = p_scenario, status = 'paid', cycle = 'month', seats = n_seats, paid_until = now() + interval '30 days', note = 'test', updated_at = now() where workspace_id = p_id;
    when 'past_due' then update public.subscriptions set plan = cur, status = 'paid', cycle = 'month', seats = n_seats, paid_until = now() - interval '2 days', note = 'test', updated_at = now() where workspace_id = p_id;
    when 'unpaid' then update public.subscriptions set plan = cur, status = 'paid', cycle = 'month', seats = n_seats, paid_until = now() - interval '8 days', note = 'test', updated_at = now() where workspace_id = p_id;
    else raise exception 'Unknown test state' using errcode = '22023';
  end case;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'billing.test', format('Inventor test state: %s', p_scenario), true);
  return private.billing_state(p_id);
end
$$;
revoke execute on function public.staff_set_billing(text, text) from public, anon;
grant execute on function public.staff_set_billing(text, text) to authenticated;

-- Erasing one company with everything in it (the nightly run after 30 days, or an inventor at once).
create function private.erase_company(w text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t text;
begin
  perform set_config('bonyan.maintenance', 'on', true);
  perform set_config('bonyan.purge', 'on', true);
  foreach t in array array['records', 'journal_entries', 'stock_moves', 'payments', 'approvals', 'comments', 'notes', 'activity'] loop
    execute format('delete from public.%I where workspace_id = $1', t) using w;
  end loop;
  delete from public.record_history where workspace_id = w;
  delete from public.history_docs where workspace_id = w;
  delete from public.automation_runs where workspace_id = w;
  delete from public.audit_events where workspace_id = w;
  delete from public.workspace_versions where workspace_id = w;
  delete from public.workspaces where id = w;
  perform set_config('bonyan.purge', '', true);
  perform set_config('bonyan.maintenance', '', true);
end
$$;

create or replace function public.purge_deleted_companies() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  w text;
  n integer := 0;
begin
  for w in select workspace_id from public.workspace_deletions where delete_after <= now() order by delete_after loop
    perform private.erase_company(w);
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke execute on function public.purge_deleted_companies() from public, anon, authenticated;
grant execute on function public.purge_deleted_companies() to service_role;

-- An inventor erases a test company they own at once (typing its name).
create function public.staff_erase_company(p_id text, p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  nm text := (select name from public.workspaces where id = p_id);
begin
  if not private.is_staff() then raise exception 'Only Bonyan''s own team can do this' using errcode = '42501'; end if;
  if not private.is_ws_owner(p_id) then raise exception 'Only the owner can delete the company' using errcode = '42501'; end if;
  if lower(trim(coalesce(p_confirm, ''))) is distinct from lower(trim(coalesce(nullif(trim(nm), ''), 'delete'))) then
    raise exception 'Type the company name exactly to confirm' using errcode = '22023';
  end if;
  perform private.erase_company(p_id);
end
$$;
revoke execute on function public.staff_erase_company(text, text) from public, anon;
grant execute on function public.staff_erase_company(text, text) to authenticated;

-- The companies the inventors already own are unlocked now.
select private.make_internal(m.workspace_id)
  from public.workspace_members m where m.is_owner and m.email in (select email from private.platform_staff);

revoke execute on function private.is_staff(), private.make_internal(text), private.erase_company(text) from public, anon, authenticated;
