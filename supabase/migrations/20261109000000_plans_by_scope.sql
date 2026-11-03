-- CRM, ERP or both: plans priced by what a company uses (owner's decision, 3 Nov 2026).
-- Free: the CRM for 2 people. CRM EGP 250, ERP EGP 350, CRM + ERP EGP 400 (was "Growth", same id so subscriptions and
-- payments keep working), Pro EGP 650; per person per month before VAT, yearly = 10 months. Customers, products,
-- quotations, tasks and the company's own lists come with every plan.
-- A company can move to a dearer plan of the same period during a paid period: it pays the difference for the days
-- left (and any extra seats at the new price) and the period stays.

insert into public.plans (id, name, name_ar, price_month, price_year, max_users, features, sort) values
  ('crm', 'CRM', 'إدارة العملاء', 250, 2500, null, '{crm}', 2),
  ('erp', 'ERP', 'تخطيط الموارد', 350, 3500, null, '{books,stock,eta}', 3)
on conflict (id) do nothing;
update public.plans set name = 'CRM + ERP', name_ar = 'إدارة العملاء + تخطيط الموارد', sort = 4 where id = 'growth';
update public.plans set sort = 5 where id = 'pro';

alter table public.billing_payments drop constraint if exists billing_payments_kind_check;
alter table public.billing_payments add constraint billing_payments_kind_check check (kind in ('period', 'seats', 'upgrade'));

create or replace function public.billing_prepare_payment(p_id text, p_plan text, p_cycle text, p_seats integer, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  p public.plans;
  cur public.plans;
  s public.subscriptions;
  cfg public.billing_settings;
  members integer;
  each numeric;
  each_now numeric;
  period_days integer := case p_cycle when 'year' then 365 else 30 end;
  k text := 'period';
  days_left integer;
  seats integer := p_seats;
  n numeric;
  v numeric;
  pay_id text := 'bp_' || replace(gen_random_uuid()::text, '-', '');
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_id and email = e and is_admin) then
    raise exception 'Only an admin can pay for the company' using errcode = '42501';
  end if;
  select * into p from public.plans where id = p_plan and active and price_month > 0;
  if p.id is null then raise exception 'Choose a paid plan' using errcode = '22023'; end if;
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
    days_left := least(period_days, greatest(0, ceil(extract(epoch from s.paid_until - now()) / 86400)::integer));
    if s.plan <> p_plan then
      select * into cur from public.plans where id = s.plan;
      each_now := case p_cycle when 'year' then cur.price_year else cur.price_month end;
      if s.cycle <> p_cycle or each <= each_now then
        raise exception 'The current period runs until %. You can move to a dearer plan of the same period now; any other change when the period ends.', to_char(s.paid_until, 'YYYY-MM-DD') using errcode = '22023';
      end if;
      -- a dearer plan now: the difference for the days left, and any extra seats at the new price
      k := 'upgrade';
      seats := greatest(p_seats, s.seats);
      n := round(((each - each_now) * s.seats + each * (seats - s.seats)) * days_left / period_days, 2);
    elsif s.cycle <> p_cycle then
      raise exception 'The current period runs until %. Renew the same plan now, or change the plan or period when it ends.', to_char(s.paid_until, 'YYYY-MM-DD') using errcode = '22023';
    elsif p_seats > s.seats then
      -- more seats: only the days left in the period
      k := 'seats';
      n := round(each * (p_seats - s.seats) * days_left / period_days, 2);
    end if;
  end if;
  n := round(n, 2);
  v := round(n * cfg.vat_rate / 100, 2);
  if round((n + v) * 100) < 100 then raise exception 'There is nothing to pay' using errcode = '22023'; end if;
  insert into public.billing_payments (id, workspace_id, kind, plan, cycle, seats, net, vat, total, amount_cents, created_by_email)
  values (pay_id, p_id, k, p_plan, p_cycle, seats, n, v, n + v, round((n + v) * 100)::integer, e);
  return jsonb_build_object('id', pay_id, 'kind', k, 'plan', p_plan, 'name', p.name, 'cycle', p_cycle, 'seats', seats,
    'net', n, 'vat', v, 'total', n + v, 'amount_cents', round((n + v) * 100)::integer);
end
$$;

create or replace function public.billing_payment_settle(p_payment text, p_paid boolean, p_txn text, p_order text, p_note text default null) returns text
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
  elsif pay.kind = 'upgrade' then
    -- the dearer plan from now, the same period end
    update public.subscriptions set plan = pay.plan, seats = greatest(seats, pay.seats), updated_at = now() where workspace_id = pay.workspace_id;
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

revoke execute on function public.billing_prepare_payment(text, text, text, integer, text), public.billing_payment_settle(text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_prepare_payment(text, text, text, integer, text), public.billing_payment_settle(text, boolean, text, text, text) to service_role;
