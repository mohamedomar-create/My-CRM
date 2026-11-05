-- Customising the system (the builder: lists, fields, pipelines, automations, rules, roles) is kept closed once a
-- company is live, so nobody changes how the company works by accident. An owner or admin asks for it, with the reason;
-- Nasq360's own team (the inventors, private.platform_staff) approves it for a set time or until taken back. The
-- dashboard, reports and the look stay open to the company's admins inside the app.

create table public.builder_access (
  workspace_id text primary key references public.workspaces (id) on delete cascade,
  until timestamptz,
  granted_by text not null,
  granted_at timestamptz not null default now(),
  note text
);
alter table public.builder_access enable row level security;

create table public.builder_requests (
  workspace_id text primary key references public.workspaces (id) on delete cascade,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  reason text not null check (length(reason) between 5 and 500),
  status text not null default 'open' check (status in ('open', 'approved', 'declined')),
  decided_by text,
  decided_at timestamptz,
  answer text
);
alter table public.builder_requests enable row level security;
revoke all on public.builder_access, public.builder_requests from anon, authenticated;

-- Open for this person: an inventor always; anyone else while the company has access that hasn't run out.
create function private.builder_open(p_id text, p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_staff where email = lower(p_email))
      or exists (select 1 from public.builder_access a where a.workspace_id = p_id and (a.until is null or a.until > now()))
$$;

/* ---------------- for the company ---------------- */

create function public.builder_status(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.builder_access;
  r public.builder_requests;
begin
  if not private.is_member(p_id) then raise exception 'Not a member' using errcode = '42501'; end if;
  select * into a from public.builder_access where workspace_id = p_id;
  select * into r from public.builder_requests where workspace_id = p_id;
  return jsonb_build_object(
    'open', private.builder_open(p_id, private.auth_email()),
    'staff', private.is_staff(),
    'until', case when a.workspace_id is not null and (a.until is null or a.until > now()) then to_jsonb(a.until) else null end,
    'granted', a.workspace_id is not null and (a.until is null or a.until > now()),
    'request', case when r.workspace_id is null then null else jsonb_build_object('status', r.status, 'at', r.requested_at, 'reason', r.reason, 'answer', r.answer) end)
    || case when a.workspace_id is not null and a.until is not null and a.until <= now() then jsonb_build_object('expired', a.until) else '{}' end;
end
$$;

create function public.builder_request(p_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only the owner or an admin can ask for this' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Say what you want to change' using errcode = '22023'; end if;
  insert into public.builder_requests (workspace_id, requested_by, reason)
    values (p_id, private.auth_email(), left(trim(p_reason), 500))
  on conflict (workspace_id) do update set requested_by = excluded.requested_by, requested_at = now(), reason = excluded.reason,
    status = 'open', decided_by = null, decided_at = null, answer = null;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'builder.request', 'Asked Nasq360 to open customising the system: ' || left(trim(p_reason), 200), true);
  return public.builder_status(p_id);
end
$$;

revoke execute on function public.builder_status(text), public.builder_request(text, text) from public, anon;
grant execute on function public.builder_status(text), public.builder_request(text, text) to authenticated;

/* ---------------- for Nasq360's own team ---------------- */

-- Every request, newest first, with the company and whether it is open now.
create function public.staff_builder_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_staff() then raise exception 'Only Nasq360''s own team can see this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.requested_at desc) from (
    select r.workspace_id, w.name as company, r.requested_by, r.requested_at, r.reason, r.status, r.decided_by, r.decided_at, r.answer,
           a.until, (a.workspace_id is not null and (a.until is null or a.until > now())) as open
      from public.builder_requests r join public.workspaces w on w.id = r.workspace_id
      left join public.builder_access a on a.workspace_id = r.workspace_id) x), '[]');
end
$$;

-- Opens customising for a company: for p_days days, or until taken back (null).
create function public.staff_builder_grant(p_id text, p_days integer, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then raise exception 'Only Nasq360''s own team can do this' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspaces where id = p_id) then raise exception 'That company doesn''t exist' using errcode = '22023'; end if;
  if p_days is not null and (p_days < 1 or p_days > 365) then raise exception 'Open it for 1 to 365 days' using errcode = '22023'; end if;
  insert into public.builder_access (workspace_id, until, granted_by, note)
    values (p_id, case when p_days is null then null else now() + make_interval(days => p_days) end, private.auth_email(), nullif(left(trim(coalesce(p_note, '')), 300), ''))
  on conflict (workspace_id) do update set until = excluded.until, granted_by = excluded.granted_by, granted_at = now(), note = excluded.note;
  update public.builder_requests set status = 'approved', decided_by = private.auth_email(), decided_at = now(), answer = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where workspace_id = p_id and status = 'open';
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'builder.grant', case when p_days is null then 'Nasq360 opened customising the system until taken back' else format('Nasq360 opened customising the system for %s days', p_days) end, true);
  return public.staff_builder_requests();
end
$$;

-- Declines a request, with the answer the company sees.
create function public.staff_builder_decline(p_id text, p_answer text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then raise exception 'Only Nasq360''s own team can do this' using errcode = '42501'; end if;
  update public.builder_requests set status = 'declined', decided_by = private.auth_email(), decided_at = now(), answer = nullif(left(trim(coalesce(p_answer, '')), 300), '')
   where workspace_id = p_id and status = 'open';
  if not found then raise exception 'There is no open request from that company' using errcode = '22023'; end if;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'builder.decline', 'Nasq360 declined opening customising the system', true);
  return public.staff_builder_requests();
end
$$;

-- Closes customising again.
create function public.staff_builder_revoke(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then raise exception 'Only Nasq360''s own team can do this' using errcode = '42501'; end if;
  delete from public.builder_access where workspace_id = p_id;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'builder.revoke', 'Nasq360 closed customising the system', true);
  return public.staff_builder_requests();
end
$$;

revoke execute on function public.staff_builder_requests(), public.staff_builder_grant(text, integer, text), public.staff_builder_decline(text, text), public.staff_builder_revoke(text) from public, anon;
grant execute on function public.staff_builder_requests(), public.staff_builder_grant(text, integer, text), public.staff_builder_decline(text, text), public.staff_builder_revoke(text) to authenticated;

/* ---------------- for the server ---------------- */

-- The command server asks before a change to the system's design (it runs as the service, so it names the person).
create function public.builder_open_for(p_id text, p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.builder_open(p_id, p_email)
$$;
revoke execute on function public.builder_open_for(text, text) from public, anon, authenticated;
grant execute on function public.builder_open_for(text, text) to service_role;
grant select, insert, update, delete on public.builder_access, public.builder_requests to service_role;
