-- Phase 6.1a (STRA-11): plans, the trial, seats and read-only.
-- Every company gets a 14-day trial with everything. After it, or when a paid period plus 7 grace days is over, the
-- company is read-only: everyone can still sign in, see and export everything, but nothing can be saved until it pays.
-- Data is never deleted. The Free plan is 2 people and the CRM only. The database is the judge: saves, new members and
-- the nightly run all check it, whatever the browser says.

create table public.plans (
  id text primary key check (id ~ '^[a-z]{2,20}$'),
  name text not null,
  name_ar text not null,
  -- EGP per user, before VAT
  price_month numeric(12, 2) not null default 0 check (price_month >= 0),
  price_year numeric(12, 2) not null default 0 check (price_year >= 0),
  -- a fixed number of people (Free), or null: as many as are paid for
  max_users integer check (max_users is null or max_users > 0),
  features text[] not null default '{}',
  sort integer not null default 0,
  active boolean not null default true
);
insert into public.plans (id, name, name_ar, price_month, price_year, max_users, features, sort) values
  ('free', 'Free', 'مجاني', 0, 0, 2, '{crm}', 1),
  ('growth', 'Growth', 'النمو', 400, 4000, null, '{crm,books,stock,eta}', 2),
  ('pro', 'Pro', 'الاحترافي', 650, 6500, null, '{crm,books,stock,eta,ai,whatsapp,approvals_multi}', 3);

-- One row of settings: VAT on the subscription, trial and grace days.
create table public.billing_settings (
  id boolean primary key default true check (id),
  vat_rate numeric(5, 2) not null default 14,
  trial_days integer not null default 14,
  grace_days integer not null default 7
);
insert into public.billing_settings default values;

alter table public.plans enable row level security;
alter table public.billing_settings enable row level security;
-- The pricing page reads them without signing in.
create policy "anyone reads the active plans" on public.plans for select to anon, authenticated using (active);
create policy "anyone reads the billing settings" on public.billing_settings for select to anon, authenticated using (true);
grant select on public.plans, public.billing_settings to anon, authenticated;

create table public.subscriptions (
  workspace_id text primary key references public.workspaces (id) on delete cascade,
  plan text not null references public.plans (id),
  -- trial: the free trial; free: the Free plan; paid: a paid plan until paid_until
  status text not null check (status in ('trial', 'free', 'paid')),
  cycle text check (cycle in ('month', 'year')),
  seats integer not null default 0 check (seats >= 0),
  trial_ends_at timestamptz,
  paid_until timestamptz,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
-- No policies: read through billing_status(), written only by the functions below and the payment server.
revoke all on public.subscriptions from anon, authenticated;

-- Every new company starts its trial (the owner's first save is part of it).
create function private.start_trial() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.subscriptions (workspace_id, plan, status, trial_ends_at)
  values (new.id, 'pro', 'trial', now() + make_interval(days => (select trial_days from public.billing_settings)))
  on conflict (workspace_id) do nothing;
  return new;
end
$$;
create trigger workspaces_start_trial after insert on public.workspaces for each row execute function private.start_trial();

-- Companies made before billing get a fresh trial from today.
insert into public.subscriptions (workspace_id, plan, status, trial_ends_at)
select id, 'pro', 'trial', now() + make_interval(days => (select trial_days from public.billing_settings)) from public.workspaces
on conflict (workspace_id) do nothing;

-- What the subscription allows now, from its dates.
create function private.billing_state(p_id text) returns jsonb
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
  if s.status = 'trial' then
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
    'trial_ends_at', s.trial_ends_at, 'paid_until', s.paid_until, 'days_left', days, 'vat_rate', cfg.vat_rate);
end
$$;
revoke execute on function private.billing_state(text) from public, anon, authenticated;

-- For the app: the company's subscription, to every member (read-only and seats concern everyone).
create function public.billing_status(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(p_id) then raise exception 'You are not a member of this workspace' using errcode = '42501'; end if;
  return private.billing_state(p_id);
end
$$;
revoke execute on function public.billing_status(text) from public, anon;
grant execute on function public.billing_status(text) to authenticated, service_role;

-- For the command server (it has checked the membership itself).
create function public.billing_status_for(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.billing_state(p_id)
$$;
revoke execute on function public.billing_status_for(text) from public, anon, authenticated;
grant execute on function public.billing_status_for(text) to service_role;

-- The owner moves the company to the Free plan (2 people, the CRM only), for example after the trial.
create function public.billing_choose_free(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  lim integer := coalesce((select max_users from public.plans where id = 'free'), 2);
begin
  if not private.is_ws_owner(p_id) then raise exception 'Only the owner can change the plan' using errcode = '42501'; end if;
  if (select status from public.subscriptions where workspace_id = p_id) = 'paid'
     and (select paid_until from public.subscriptions where workspace_id = p_id) > now() then
    raise exception 'The paid period isn''t over yet. You can move to Free when it ends.' using errcode = '22023';
  end if;
  if (select count(*) from public.workspace_members where workspace_id = p_id) > lim then
    raise exception 'The Free plan is for up to % people. Remove members on the Team page first.', lim using errcode = '22023';
  end if;
  update public.subscriptions set plan = 'free', status = 'free', cycle = null, seats = 0, updated_at = now() where workspace_id = p_id;
  update public.invitations set revoked_at = now()
   where workspace_id = p_id and accepted_at is null and declined_at is null and revoked_at is null;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'billing.free', 'Moved to the Free plan', true);
  return private.billing_state(p_id);
end
$$;
revoke execute on function public.billing_choose_free(text) from public, anon;
grant execute on function public.billing_choose_free(text) to authenticated;

-- For Bonyan's own staff only (SQL editor or the payment server): set a company's plan by hand, e.g. a bank transfer
-- or a pilot customer. Never callable from the app.
create function public.billing_grant(p_id text, p_plan text, p_seats integer, p_until timestamptz, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.workspaces where id = p_id) then raise exception 'No such company' using errcode = '22023'; end if;
  if not exists (select 1 from public.plans where id = p_plan and id <> 'free') then raise exception 'Choose a paid plan' using errcode = '22023'; end if;
  insert into public.subscriptions (workspace_id, plan, status, cycle, seats, paid_until, note, updated_at)
  values (p_id, p_plan, 'paid', 'month', greatest(1, p_seats), p_until, p_note, now())
  on conflict (workspace_id) do update set plan = excluded.plan, status = 'paid', seats = excluded.seats, paid_until = excluded.paid_until,
    note = excluded.note, updated_at = now(), cycle = coalesce(public.subscriptions.cycle, 'month');
  return private.billing_state(p_id);
end
$$;
revoke execute on function public.billing_grant(text, text, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.billing_grant(text, text, integer, timestamptz, text) to service_role;

-- Seats: a new member only while there is a free seat (joining by invitation goes through here too).
create function private.guard_seats() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb := private.billing_state(new.workspace_id);
begin
  if (b ->> 'members')::integer >= (b ->> 'seat_limit')::integer then
    if not (b ->> 'writable')::boolean then
      raise exception 'This company is read-only until its subscription is paid, so nobody new can join. Ask the owner to open the Billing page.' using errcode = '54000';
    end if;
    raise exception 'All % seats of this company are in use. The owner can add seats on the Billing page.', b ->> 'seat_limit' using errcode = '54000';
  end if;
  return new;
end
$$;
create trigger workspace_members_seats before insert on public.workspace_members for each row execute function private.guard_seats();

-- Saves: refused while read-only (the command server says so first, this is the lock).
create or replace function public.save_workspace_changes(p_id text, p_base bigint, p_setup jsonb, p_changes jsonb, p_actor uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v bigint;
  t text;
begin
  if not (private.billing_state(p_id) ->> 'writable')::boolean then
    raise exception 'This company is read-only until its subscription is paid. Everything can still be seen and exported.' using errcode = '42501', hint = 'billing';
  end if;
  perform set_config('bonyan.actor', p_actor::text, true);
  if exists (select 1 from jsonb_object_keys(coalesce(p_setup -> 'data', '{}')) k
              where k in ('records', 'journal', 'stock', 'payments', 'approvals', 'comments', 'notes', 'activity')) then
    raise exception 'Records belong in their own tables' using errcode = '22023';
  end if;
  update public.workspaces
     set doc = p_setup, name = left(coalesce(p_setup #>> '{answers,companyName}', ''), 120)
   where id = p_id and version = p_base and data_in_tables
  returning version into v;
  if v is null then return null; end if;

  foreach t in array array['records', 'journal_entries', 'stock_moves', 'payments', 'approvals', 'comments', 'notes', 'activity'] loop
    execute format('delete from public.%I where workspace_id = $1 and id in (select jsonb_array_elements_text($2))', t)
      using p_id, coalesce(p_changes #> array[t, 'delete'], '[]');
    execute format('insert into public.%I as x (workspace_id, id, ord, data)
                    select $1, r ->> ''id'', (r ->> ''ord'')::bigint, r -> ''data'' from jsonb_array_elements($2) r
                    on conflict (workspace_id, id) do update set data = excluded.data, updated_at = now()
                    where x.data is distinct from excluded.data', t)
      using p_id, coalesce(p_changes #> array[t, 'upsert'], '[]');
  end loop;
  -- limit: records per workspace (counted only when records were added or changed)
  if jsonb_array_length(coalesce(p_changes #> '{records,upsert}', '[]')) > 0
     and (select count(*) from public.records where workspace_id = p_id) > 200000 then
    raise exception 'This workspace has reached 200,000 records. Contact support to raise the limit.' using errcode = '54000';
  end if;
  delete from public.record_history where workspace_id = p_id and changed_at < now() - interval '90 days';
  return v;
end
$$;
revoke execute on function public.save_workspace_changes(text, bigint, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_workspace_changes(text, bigint, jsonb, jsonb, uuid) to service_role;

-- Invitations: only while a seat is free (members and open invitations count).
create or replace function public.create_invitation(p_workspace text, p_email text, p_is_admin boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
  e text := lower(trim(coalesce(p_email, '')));
  token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  b jsonb;
begin
  if me = '' or not private.is_ws_admin(p_workspace) then raise exception 'Only an admin can invite people' using errcode = '42501'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid e-mail' using errcode = '22023'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = p_workspace and email = e) then
    raise exception 'This person is already in the team' using errcode = '23505';
  end if;
  b := private.billing_state(p_workspace);
  if not (b ->> 'writable')::boolean then
    raise exception 'This company is read-only until its subscription is paid, so nobody new can be invited.' using errcode = '54000';
  end if;
  -- a new invitation for the same person replaces the open one, so it takes no extra seat
  if (b ->> 'members')::integer + (b ->> 'invites')::integer
     - (select count(*) from public.invitations where workspace_id = p_workspace and email = e and accepted_at is null and declined_at is null and revoked_at is null and expires_at > now())
     >= (b ->> 'seat_limit')::integer then
    raise exception 'All % seats are in use or invited. Add seats on the Billing page, or cancel an open invitation.', b ->> 'seat_limit' using errcode = '54000';
  end if;
  if (select count(*) from public.workspace_members where workspace_id = p_workspace)
     + (select count(*) from public.invitations where workspace_id = p_workspace and accepted_at is null and declined_at is null
          and revoked_at is null and expires_at > now()) >= 200 then
    raise exception 'A workspace can have up to 200 people (members and open invitations)' using errcode = '54000';
  end if;
  if (select count(*) from public.invitations where workspace_id = p_workspace and created_at > now() - interval '1 day') >= 50 then
    raise exception 'You can send up to 50 invitations a day' using errcode = '54000';
  end if;
  update public.invitations set revoked_at = now()
   where workspace_id = p_workspace and email = e and accepted_at is null and declined_at is null and revoked_at is null;
  insert into public.invitations (workspace_id, email, is_admin, token_hash, invited_by, invited_by_email)
  values (p_workspace, e, coalesce(p_is_admin, false), private.hash_token(token), auth.uid(), me);
  return token;
end
$$;

-- The nightly run skips read-only companies (their automations wait until they pay).
create or replace function public.scheduled_workspaces() returns setof text
language sql stable security definer set search_path = '' as $$
  select id from public.workspaces
   where data_in_tables and jsonb_typeof(doc -> 'published') = 'object' and (private.billing_state(id) ->> 'writable')::boolean
   order by id
$$;
revoke execute on function public.scheduled_workspaces() from public, anon, authenticated;
grant execute on function public.scheduled_workspaces() to service_role;

-- Past documents are part of the books: not brought in while read-only, nor on the Free plan.
create or replace function public.history_add(p_id text, p_batch text, p_file text, p_docs jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer;
  b jsonb := private.billing_state(p_id);
begin
  select * into r from private.history_rights(p_id);
  if not r.writer then raise exception 'Only Admin and finance roles can bring in past documents' using errcode = '42501'; end if;
  if not (b ->> 'writable')::boolean then raise exception 'This company is read-only until its subscription is paid.' using errcode = '42501', hint = 'billing'; end if;
  if not (b -> 'features') ? 'books' then raise exception 'The Free plan includes the CRM only. Past invoices and bills come with Growth or Pro (Billing page).' using errcode = '42501', hint = 'billing'; end if;
  if p_batch is null or p_batch !~ '^imp_[A-Za-z0-9_-]{1,60}$' then raise exception 'That setup is not valid' using errcode = '22023'; end if;
  if jsonb_typeof(p_docs) <> 'array' or jsonb_array_length(p_docs) > 1000 then raise exception 'Send up to 1,000 documents at a time' using errcode = '22023'; end if;
  if exists (select 1 from public.history_docs where workspace_id = p_id and batch = p_batch and added_by <> r.email) then
    raise exception 'That import is closed. Start a new one.' using errcode = '42501';
  end if;
  insert into public.history_docs (workspace_id, id, side, kind, number, date, party, party_name, rep, subtotal, tax, total, lines, open_doc, batch, file, added_by)
  select p_id, d ->> 'id', d ->> 'side', d ->> 'kind', coalesce(d ->> 'number', ''), (d ->> 'date')::date, d ->> 'party', coalesce(d ->> 'partyName', ''),
         nullif(d ->> 'rep', ''), coalesce((d ->> 'subtotal')::numeric, 0), coalesce((d ->> 'tax')::numeric, 0), coalesce((d ->> 'total')::numeric, 0),
         coalesce(d -> 'lines', '[]'), nullif(d ->> 'openDoc', ''), p_batch, left(coalesce(p_file, ''), 120), r.email
    from jsonb_array_elements(p_docs) d
  on conflict (workspace_id, id) do nothing;
  get diagnostics n = row_count;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), r.email, 'history.add', format('%s documents from %s', n, left(coalesce(p_file, ''), 120)), true);
  return n;
end
$$;

create or replace function public.history_undo(p_id text, p_batch text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer;
begin
  select * into r from private.history_rights(p_id);
  if not r.writer then raise exception 'Only Admin and finance roles can bring in past documents' using errcode = '42501'; end if;
  if not (private.billing_state(p_id) ->> 'writable')::boolean then raise exception 'This company is read-only until its subscription is paid.' using errcode = '42501', hint = 'billing'; end if;
  if not private.is_ws_admin(p_id) and exists (select 1 from public.history_docs where workspace_id = p_id and batch = p_batch and added_by <> r.email) then
    raise exception 'Only the person who imported the file, or an admin, can undo it' using errcode = '42501';
  end if;
  delete from public.history_docs where workspace_id = p_id and batch = p_batch;
  get diagnostics n = row_count;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), r.email, 'history.undo', format('%s documents', n), true);
  return n;
end
$$;

grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;
revoke execute on function private.move_workspace_data(text), private.table_data(text), private.viewer(text, text), private.workspace_view(text, text),
  private.cost_keys(jsonb), private.accept_invitation(public.invitations), private.second_factor_problem(text, uuid, text, text),
  private.history_rights(text), private.billing_state(text), private.start_trial(), private.guard_seats() from authenticated;
