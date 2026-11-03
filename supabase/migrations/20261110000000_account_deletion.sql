-- Deleting a login and deleting a company (PDPL right to erasure; the Terms already promise how a closed company is
-- handled).
-- - A person deletes their own login: they leave every company at once and the login is gone. An owner first hands
--   the company to another admin, or deletes the company.
-- - The owner deletes the company: for 30 days it is read-only for everyone and the owner can restore it; then the
--   nightly run erases it with everything in it. Bonyan keeps only what the law requires it to keep itself: the
--   record of what the company paid for its subscription.

-- A company row no longer holds on to the login that created it (that login can be deleted after handing it over).
alter table public.workspaces alter column created_by drop not null;
alter table public.workspaces drop constraint if exists workspaces_created_by_fkey;
alter table public.workspaces add constraint workspaces_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

-- Bonyan's own sales records outlive the company they were for.
alter table public.billing_payments drop constraint if exists billing_payments_workspace_id_fkey;

-- The audit trail and the run log stay append-only, except while the nightly run erases a company asked to be deleted.
create or replace function private.audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('bonyan.purge', true), '') = 'on' then return old; end if;
  raise exception 'The audit trail can''t be changed or deleted' using errcode = '42501';
end
$$;

create table public.workspace_deletions (
  workspace_id text primary key references public.workspaces (id) on delete cascade,
  delete_after timestamptz not null,
  requested_by text not null,
  requested_at timestamptz not null default now()
);
alter table public.workspace_deletions enable row level security;
revoke all on public.workspace_deletions from anon, authenticated;

-- The owner asks to delete the company, typing its name to confirm. Read-only from now on; erased after 30 days.
create function public.request_company_deletion(p_id text, p_confirm text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
  nm text := (select name from public.workspaces where id = p_id);
  until timestamptz := now() + interval '30 days';
begin
  if not private.is_ws_owner(p_id) then raise exception 'Only the owner can delete the company' using errcode = '42501'; end if;
  if lower(trim(coalesce(p_confirm, ''))) is distinct from lower(trim(coalesce(nullif(trim(nm), ''), 'delete'))) then
    raise exception 'Type the company name exactly to confirm' using errcode = '22023';
  end if;
  insert into public.workspace_deletions (workspace_id, delete_after, requested_by) values (p_id, until, me)
  on conflict (workspace_id) do nothing;
  update public.invitations set revoked_at = now()
   where workspace_id = p_id and accepted_at is null and declined_at is null and revoked_at is null;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), me, 'company.delete', format('Asked to delete the company; it will be erased on %s', to_char(until, 'YYYY-MM-DD')), true);
  return (select delete_after from public.workspace_deletions where workspace_id = p_id);
end
$$;

-- The owner changes their mind within the 30 days.
create function public.cancel_company_deletion(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_owner(p_id) then raise exception 'Only the owner can restore the company' using errcode = '42501'; end if;
  delete from public.workspace_deletions where workspace_id = p_id;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'company.restore', 'Kept the company (deletion cancelled)', true);
end
$$;

-- The nightly run: erases the companies whose 30 days are over, with everything in them. Returns how many.
create function public.purge_deleted_companies() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  w text;
  t text;
  n integer := 0;
begin
  perform set_config('bonyan.maintenance', 'on', true);
  perform set_config('bonyan.purge', 'on', true);
  for w in select workspace_id from public.workspace_deletions where delete_after <= now() order by delete_after loop
    foreach t in array array['records', 'journal_entries', 'stock_moves', 'payments', 'approvals', 'comments', 'notes', 'activity'] loop
      execute format('delete from public.%I where workspace_id = $1', t) using w;
    end loop;
    delete from public.record_history where workspace_id = w;
    delete from public.history_docs where workspace_id = w;
    delete from public.automation_runs where workspace_id = w;
    delete from public.audit_events where workspace_id = w;
    delete from public.workspace_versions where workspace_id = w;
    -- members, preferences, invitations, the subscription and this request go with the company
    delete from public.workspaces where id = w;
    n := n + 1;
  end loop;
  return n;
end
$$;

-- A person deletes their own login, typing their e-mail to confirm.
create function public.delete_my_account(p_confirm_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
  uid uuid := auth.uid();
  owned text;
begin
  if uid is null or me = '' then raise exception 'Sign in first' using errcode = '42501'; end if;
  if lower(trim(coalesce(p_confirm_email, ''))) <> me then raise exception 'Type your e-mail exactly to confirm' using errcode = '22023'; end if;
  select string_agg(coalesce(nullif(w.name, ''), w.id), ', ') into owned
    from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
   where m.email = me and m.is_owner and not exists (select 1 from public.workspace_deletions d where d.workspace_id = m.workspace_id);
  if owned is not null then
    raise exception 'You own %. Hand it to another admin on the Team page, or delete the company, before deleting your login.', owned using errcode = '22023';
  end if;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    select m.workspace_id, uid, me, 'account.delete', 'Deleted their login and left the company', true
      from public.workspace_members m where m.email = me;
  delete from public.member_prefs where email = me;
  delete from public.workspace_members where email = me;
  update public.invitations set revoked_at = now() where email = me and accepted_at is null and declined_at is null and revoked_at is null;
  delete from auth.users where id = uid;
end
$$;

-- While a company waits to be erased it is read-only, says so, and takes nobody new (the same lock as unpaid).
create or replace function private.billing_state(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.subscriptions;
  p public.plans;
  cfg public.billing_settings;
  members integer;
  invites integer;
  st text;
  why text;
  lim integer;
  days integer;
  feats text[];
  gone timestamptz := (select delete_after from public.workspace_deletions where workspace_id = p_id);
begin
  select * into cfg from public.billing_settings;
  select * into s from public.subscriptions where workspace_id = p_id;
  if s.workspace_id is null then
    -- not yet started (being created): a trial
    s.plan := 'pro'; s.status := 'trial'; s.trial_ends_at := now() + make_interval(days => cfg.trial_days);
  end if;
  select * into p from public.plans where id = s.plan;
  select count(*) into members from public.workspace_members where workspace_id = p_id;
  select count(*) into invites from public.invitations where workspace_id = p_id and accepted_at is null and declined_at is null and revoked_at is null and expires_at > now();
  feats := p.features;
  if gone is not null then
    st := 'read_only'; why := 'deleting'; days := greatest(0, ceil(extract(epoch from gone - now()) / 86400));
  elsif s.status = 'trial' then
    if now() < s.trial_ends_at then st := 'trial'; lim := 200; days := ceil(extract(epoch from s.trial_ends_at - now()) / 86400);
    else st := 'read_only'; why := 'trial_ended'; days := 0; end if;
  elsif s.status = 'free' then
    st := 'free'; lim := coalesce((select max_users from public.plans where id = 'free'), 2);
    feats := coalesce((select features from public.plans where id = 'free'), '{crm}');
  elsif s.paid_until is not null and now() < s.paid_until then
    st := 'active'; lim := s.seats; days := ceil(extract(epoch from s.paid_until - now()) / 86400);
  elsif s.paid_until is not null and now() < s.paid_until + make_interval(days => cfg.grace_days) then
    st := 'past_due'; lim := s.seats; days := ceil(extract(epoch from s.paid_until + make_interval(days => cfg.grace_days) - now()) / 86400);
  else
    st := 'read_only'; why := 'unpaid'; days := 0;
  end if;
  -- read-only: no new members either
  if st = 'read_only' then lim := members; end if;
  return jsonb_build_object(
    'plan', s.plan, 'state', st, 'reason', why, 'writable', st <> 'read_only', 'features', to_jsonb(coalesce(feats, '{}')),
    'seat_limit', lim, 'members', members, 'invites', invites, 'seats', s.seats, 'cycle', s.cycle,
    'trial_ends_at', s.trial_ends_at, 'paid_until', s.paid_until, 'days_left', days, 'vat_rate', cfg.vat_rate, 'delete_after', gone);
end
$$;

revoke execute on function public.request_company_deletion(text, text), public.cancel_company_deletion(text), public.delete_my_account(text) from public, anon;
grant execute on function public.request_company_deletion(text, text), public.cancel_company_deletion(text), public.delete_my_account(text) to authenticated;
revoke execute on function public.purge_deleted_companies() from public, anon, authenticated;
grant execute on function public.purge_deleted_companies() to service_role;
revoke execute on function private.billing_state(text), private.audit_append_only() from public, anon, authenticated;
