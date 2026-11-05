-- The launch period (owner's request, 5 Nov 2026): Nasq360 is free while it spreads. Nothing is charged and nothing
-- locks: no trial end, no read-only, no seat limit, every company has every feature. Plans, trials, seats and Paymob all
-- stay in place for later; this one switch turns them back on for every company:
--   update public.billing_settings set charging = true;
-- (before turning it on, give the companies made during the launch a fresh trial, or they go read-only at once:
--   update public.subscriptions set trial_ends_at = now() + interval '14 days' where status = 'trial';)
alter table public.billing_settings add column if not exists charging boolean not null default false;

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
  -- the launch period: nothing is charged, so every company has everything, for as many people as it needs
  -- (a company being deleted still goes read-only below)
  if not cfg.charging and gone is null then
    select count(*) into members from public.workspace_members where workspace_id = p_id;
    select count(*) into invites from public.invitations where workspace_id = p_id and accepted_at is null and declined_at is null and revoked_at is null and expires_at > now();
    return jsonb_build_object(
      'plan', 'pro', 'state', 'launch', 'reason', null, 'writable', true,
      'features', to_jsonb(coalesce((select features from public.plans where id = 'pro'), '{}')),
      'seat_limit', 1000, 'members', members, 'invites', invites, 'seats', 0, 'cycle', null,
      'trial_ends_at', null, 'paid_until', null, 'days_left', null, 'vat_rate', cfg.vat_rate, 'delete_after', null);
  end if;
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
