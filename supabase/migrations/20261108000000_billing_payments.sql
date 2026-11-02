-- Phase 6.1b: paying the subscription online (Paymob).
-- The server works out the amount from the plans table (never from the browser), records the payment as pending,
-- and opens Paymob's checkout. Only Paymob's signed notification, with the same amount, marks it paid and extends
-- the subscription; a notification sent twice changes nothing the second time.

create table public.billing_payments (
  id text primary key check (id ~ '^bp_[a-z0-9]{10,40}$'),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  -- period: a month or a year of the plan for the seats; seats: more seats until the current period ends
  kind text not null check (kind in ('period', 'seats')),
  plan text not null references public.plans (id),
  cycle text not null check (cycle in ('month', 'year')),
  seats integer not null check (seats between 1 and 200),
  net numeric(12, 2) not null,
  vat numeric(12, 2) not null,
  total numeric(12, 2) not null,
  amount_cents integer not null check (amount_cents >= 100),
  currency text not null default 'EGP',
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  provider text not null default 'paymob',
  provider_order text,
  provider_txn text unique,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  period_to timestamptz,
  note text
);
create index billing_payments_ws_idx on public.billing_payments (workspace_id, created_at desc);
create index billing_payments_order_idx on public.billing_payments (provider_order);
alter table public.billing_payments enable row level security;
revoke all on public.billing_payments from anon, authenticated;

-- The payment server: an admin asks to pay for a plan, cycle and seats. Returns what to charge.
create function public.billing_prepare_payment(p_id text, p_plan text, p_cycle text, p_seats integer, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  p public.plans;
  s public.subscriptions;
  cfg public.billing_settings;
  members integer;
  each numeric;
  period_days integer := case p_cycle when 'year' then 365 else 30 end;
  k text := 'period';
  days_left integer;
  n numeric;
  v numeric;
  pay_id text := 'bp_' || replace(gen_random_uuid()::text, '-', '');
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_id and email = e and is_admin) then
    raise exception 'Only an admin can pay for the company' using errcode = '42501';
  end if;
  select * into p from public.plans where id = p_plan and active and price_month > 0;
  if p.id is null then raise exception 'Choose Growth or Pro' using errcode = '22023'; end if;
  if p_cycle not in ('month', 'year') then raise exception 'Choose monthly or yearly' using errcode = '22023'; end if;
  select count(*) into members from public.workspace_members where workspace_id = p_id;
  if p_seats is null or p_seats < members then
    raise exception 'Choose at least % seats: everyone in the team takes one.', members using errcode = '22023';
  end if;
  if p_seats > 200 then raise exception 'A company can have up to 200 people' using errcode = '22023'; end if;
  select * into cfg from public.billing_settings;
  select * into s from public.subscriptions where workspace_id = p_id;
  each := case p_cycle when 'year' then p.price_year else p.price_month end;
  n := each * p_seats;
  if s.status = 'paid' and s.paid_until > now() then
    if s.plan <> p_plan or s.cycle <> p_cycle then
      raise exception 'The current period runs until %. Renew the same plan now, or change the plan or period when it ends.', to_char(s.paid_until, 'YYYY-MM-DD') using errcode = '22023';
    end if;
    if p_seats > s.seats then
      -- more seats: only the days left in the period
      k := 'seats';
      days_left := least(period_days, greatest(0, ceil(extract(epoch from s.paid_until - now()) / 86400)::integer));
      n := round(each * (p_seats - s.seats) * days_left / period_days, 2);
    end if;
  end if;
  n := round(n, 2);
  v := round(n * cfg.vat_rate / 100, 2);
  if round((n + v) * 100) < 100 then raise exception 'There is nothing to pay' using errcode = '22023'; end if;
  insert into public.billing_payments (id, workspace_id, kind, plan, cycle, seats, net, vat, total, amount_cents, created_by_email)
  values (pay_id, p_id, k, p_plan, p_cycle, p_seats, n, v, n + v, round((n + v) * 100)::integer, e);
  return jsonb_build_object('id', pay_id, 'kind', k, 'plan', p_plan, 'name', p.name, 'cycle', p_cycle, 'seats', p_seats,
    'net', n, 'vat', v, 'total', n + v, 'amount_cents', round((n + v) * 100)::integer);
end
$$;

-- The payment server keeps Paymob's order number for the payment.
create function public.billing_payment_set_order(p_payment text, p_order text) returns void
language sql security definer set search_path = '' as $$
  update public.billing_payments set provider_order = left(p_order, 80) where id = p_payment and status = 'pending'
$$;

-- The payment a Paymob notification is about: by Bonyan's reference, else by Paymob's order number.
create function public.billing_payment_find(p_ref text, p_order text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(x) from (
    select id, workspace_id, amount_cents, currency, status from public.billing_payments
     where (p_ref is not null and id = p_ref) or (p_order is not null and provider_order = p_order)
     order by (id = p_ref) desc limit 1
  ) x
$$;

-- A notification checked by the payment server: paid extends the subscription, declined marks it failed.
create function public.billing_payment_settle(p_payment text, p_paid boolean, p_txn text, p_order text, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  pay public.billing_payments;
  s public.subscriptions;
  start timestamptz;
  until timestamptz;
begin
  select * into pay from public.billing_payments where id = p_payment for update;
  if pay.id is null then raise exception 'No such payment' using errcode = '22023'; end if;
  if pay.status = 'paid' then return 'already paid'; end if;
  if not p_paid then
    update public.billing_payments set status = 'failed', provider_txn = coalesce(left(p_txn, 80), provider_txn), note = left(p_note, 300) where id = pay.id;
    return 'failed';
  end if;
  select * into s from public.subscriptions where workspace_id = pay.workspace_id for update;
  if pay.kind = 'seats' then
    update public.subscriptions set seats = greatest(seats, pay.seats), updated_at = now() where workspace_id = pay.workspace_id;
    until := s.paid_until;
  else
    -- a renewal of the same plan and period continues from the end of the one paid for; otherwise it starts now
    start := case when s.status = 'paid' and s.plan = pay.plan and s.cycle = pay.cycle and s.paid_until > now() then s.paid_until else now() end;
    until := start + case pay.cycle when 'year' then interval '1 year' else interval '1 month' end;
    update public.subscriptions set plan = pay.plan, status = 'paid', cycle = pay.cycle, seats = pay.seats, paid_until = until, updated_at = now()
     where workspace_id = pay.workspace_id;
  end if;
  update public.billing_payments set status = 'paid', paid_at = now(), provider_txn = left(p_txn, 80), provider_order = coalesce(left(p_order, 80), provider_order),
         period_to = until, note = left(p_note, 300)
   where id = pay.id;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (pay.workspace_id, null, 'paymob', 'billing.paid',
            format('Paid EGP %s: %s, %s people, until %s', pay.total, pay.plan, pay.seats, to_char(until, 'YYYY-MM-DD')), true);
  return 'paid';
end
$$;

-- For admins: the company's payments, newest first.
create function public.billing_payments_list(p_id text)
returns table (id text, kind text, plan text, cycle text, seats integer, total numeric, status text, created_at timestamptz, paid_at timestamptz, period_to timestamptz, created_by_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can see the payments' using errcode = '42501'; end if;
  return query select b.id, b.kind, b.plan, b.cycle, b.seats, b.total, b.status, b.created_at, b.paid_at, b.period_to, b.created_by_email
    from public.billing_payments b where b.workspace_id = p_id order by b.created_at desc limit 50;
end
$$;

revoke execute on function public.billing_prepare_payment(text, text, text, integer, text), public.billing_payment_set_order(text, text),
  public.billing_payment_find(text, text), public.billing_payment_settle(text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_prepare_payment(text, text, text, integer, text), public.billing_payment_set_order(text, text),
  public.billing_payment_find(text, text), public.billing_payment_settle(text, boolean, text, text, text) to service_role;
revoke execute on function public.billing_payments_list(text) from public, anon;
grant execute on function public.billing_payments_list(text) to authenticated;
