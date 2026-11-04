-- WhatsApp Business (Meta's WhatsApp Cloud API). A company connects its own number: the admin enters the number's ID,
-- an access token and the app secret, which stay here and are never sent back to the app. Messages live in their own
-- table, read by the people who may see customers, contacts or leads (the inbox), never edited.

create table public.whatsapp_accounts (
  workspace_id text primary key references public.workspaces (id) on delete cascade,
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{6,30}$'),
  display_phone text not null check (length(display_phone) between 6 and 30),
  access_token text not null check (length(access_token) between 20 and 1000),
  app_secret text not null check (app_secret ~ '^[a-f0-9]{32}$'),
  verify_token text not null,
  connected_by text not null,
  connected_at timestamptz not null default now()
);
alter table public.whatsapp_accounts enable row level security;

create table public.whatsapp_messages (
  id bigint generated always as identity primary key,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  wa_id text not null check (wa_id ~ '^[0-9]{8,15}$'),
  name text,
  direction text not null check (direction in ('in', 'out')),
  kind text not null,
  body text not null,
  wa_message_id text not null unique,
  status text not null,
  error text,
  record_id text,
  by_email text,
  at timestamptz not null default now(),
  read_at timestamptz
);
create index whatsapp_messages_thread_idx on public.whatsapp_messages (workspace_id, wa_id, at desc);
create index whatsapp_messages_unread_idx on public.whatsapp_messages (workspace_id) where direction = 'in' and read_at is null;
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_accounts, public.whatsapp_messages from anon, authenticated;

-- Who may use the inbox: admins, and roles that may see customers, contacts or leads.
create function private.can_inbox(p_id text, p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members mm where mm.workspace_id = p_id and mm.email = p_email and mm.is_admin)
      or coalesce((select exists (
      select 1 from public.workspaces w, jsonb_array_elements(coalesce(w.doc #> '{published,modules}', '[]')) m
       where w.id = p_id and m ->> 'role' in ('accounts', 'contacts', 'leads') and (m ->> 'id') = any (v.viewable))
    from private.viewer(p_id, p_email) v
   where v.user_id is not null and exists (select 1 from public.workspace_members mm where mm.workspace_id = p_id and mm.email = p_email)), false)
$$;

/* ---------------- for the app ---------------- */

create function public.whatsapp_status(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.whatsapp_accounts;
begin
  if not private.is_member(p_id) then raise exception 'Not a member' using errcode = '42501'; end if;
  select * into a from public.whatsapp_accounts where workspace_id = p_id;
  if not found then return jsonb_build_object('connected', false); end if;
  return jsonb_build_object('connected', true, 'display_phone', a.display_phone, 'phone_number_id', a.phone_number_id, 'connected_at', a.connected_at)
    || case when private.is_ws_admin(p_id) then jsonb_build_object('verify_token', a.verify_token) else '{}' end;
end
$$;

create function public.whatsapp_connect(p_id text, p_phone_number_id text, p_display_phone text, p_token text, p_app_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can connect WhatsApp' using errcode = '42501'; end if;
  insert into public.whatsapp_accounts (workspace_id, phone_number_id, display_phone, access_token, app_secret, verify_token, connected_by)
    values (p_id, trim(p_phone_number_id), trim(p_display_phone), trim(p_token), lower(trim(p_app_secret)), replace(gen_random_uuid()::text, '-', ''), private.auth_email())
  on conflict (workspace_id) do update set phone_number_id = excluded.phone_number_id, display_phone = excluded.display_phone,
    access_token = excluded.access_token, app_secret = excluded.app_secret, connected_by = excluded.connected_by, connected_at = now();
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'whatsapp.connect', 'Connected WhatsApp ' || trim(p_display_phone), true);
  return public.whatsapp_status(p_id);
end
$$;

create function public.whatsapp_disconnect(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can disconnect WhatsApp' using errcode = '42501'; end if;
  delete from public.whatsapp_accounts where workspace_id = p_id;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'whatsapp.disconnect', 'Disconnected WhatsApp', true);
  return jsonb_build_object('connected', false);
end
$$;

-- The conversations, newest first: the last message, how many are unread, and the record they belong to.
create function public.whatsapp_threads(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_inbox(p_id, private.auth_email()) then raise exception 'Your role can’t see the WhatsApp inbox' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(t order by t.at desc) from (
    select distinct on (m.wa_id) m.wa_id, m.body, m.direction, m.at, m.status,
           (select max(x.name) from public.whatsapp_messages x where x.workspace_id = p_id and x.wa_id = m.wa_id and x.name is not null) as name,
           (select x.record_id from public.whatsapp_messages x where x.workspace_id = p_id and x.wa_id = m.wa_id and x.record_id is not null order by x.at desc limit 1) as record_id,
           (select count(*) from public.whatsapp_messages x where x.workspace_id = p_id and x.wa_id = m.wa_id and x.direction = 'in' and x.read_at is null) as unread,
           (select max(x.at) from public.whatsapp_messages x where x.workspace_id = p_id and x.wa_id = m.wa_id and x.direction = 'in') as last_in
      from public.whatsapp_messages m where m.workspace_id = p_id order by m.wa_id, m.at desc) t), '[]');
end
$$;

-- One conversation (the latest 300 messages); opening it marks what came in as read.
create function public.whatsapp_thread(p_id text, p_wa_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_inbox(p_id, private.auth_email()) then raise exception 'Your role can’t see the WhatsApp inbox' using errcode = '42501'; end if;
  update public.whatsapp_messages set read_at = now() where workspace_id = p_id and wa_id = p_wa_id and direction = 'in' and read_at is null;
  return coalesce((select jsonb_agg(x order by x.at) from (
    select id, direction, kind, body, status, error, by_email, at, record_id from public.whatsapp_messages
     where workspace_id = p_id and wa_id = p_wa_id order by at desc limit 300) x), '[]');
end
$$;

create function public.whatsapp_unread(p_id text) returns integer
language sql stable security definer set search_path = '' as $$
  select case when private.can_inbox(p_id, private.auth_email())
    then (select count(*)::int from public.whatsapp_messages where workspace_id = p_id and direction = 'in' and read_at is null) else 0 end
$$;

-- Links a conversation to a customer, contact or lead (when the number wasn't on file).
create function public.whatsapp_link(p_id text, p_wa_id text, p_record text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_inbox(p_id, private.auth_email()) then raise exception 'Your role can’t see the WhatsApp inbox' using errcode = '42501'; end if;
  update public.whatsapp_messages set record_id = p_record where workspace_id = p_id and wa_id = p_wa_id;
end
$$;

revoke execute on function public.whatsapp_status(text), public.whatsapp_connect(text, text, text, text, text), public.whatsapp_disconnect(text),
  public.whatsapp_threads(text), public.whatsapp_thread(text, text), public.whatsapp_unread(text), public.whatsapp_link(text, text, text) from public, anon;
grant execute on function public.whatsapp_status(text), public.whatsapp_connect(text, text, text, text, text), public.whatsapp_disconnect(text),
  public.whatsapp_threads(text), public.whatsapp_thread(text, text), public.whatsapp_unread(text), public.whatsapp_link(text, text, text) to authenticated;

/* ---------------- for the server only ---------------- */

create function public.whatsapp_account_for(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('workspace', workspace_id, 'phoneNumberId', phone_number_id, 'token', access_token, 'appSecret', app_secret, 'verifyToken', verify_token)
    from public.whatsapp_accounts where workspace_id = p_id
$$;

create function public.whatsapp_store(p_rows jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.whatsapp_messages (workspace_id, wa_id, name, direction, kind, body, wa_message_id, status, record_id, by_email, at)
  select r ->> 'workspace', r ->> 'waId', r ->> 'name', r ->> 'direction', r ->> 'kind', r ->> 'body', r ->> 'waMessageId', r ->> 'status', r ->> 'record', r ->> 'by', coalesce((r ->> 'at')::timestamptz, now())
    from jsonb_array_elements(p_rows) r
  on conflict (wa_message_id) do nothing
$$;

create function public.whatsapp_set_status(p_wa_message_id text, p_status text, p_error text) returns void
language sql security definer set search_path = '' as $$
  -- receipts can arrive out of order: never step back (read stays read)
  update public.whatsapp_messages set status = p_status, error = coalesce(p_error, error)
   where wa_message_id = p_wa_message_id and direction = 'out'
     and array_position(array['sent', 'delivered', 'read'], p_status) is distinct from null
     and coalesce(array_position(array['sent', 'delivered', 'read'], status), 0) < array_position(array['sent', 'delivered', 'read'], p_status)
  ;
  update public.whatsapp_messages set status = 'failed', error = p_error where wa_message_id = p_wa_message_id and direction = 'out' and p_status = 'failed';
$$;

create function public.whatsapp_last_in(p_id text, p_wa_id text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(at) from public.whatsapp_messages where workspace_id = p_id and wa_id = p_wa_id and direction = 'in'
$$;

create function public.whatsapp_can_send(p_id text, p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_inbox(p_id, lower(p_email))
$$;

revoke execute on function public.whatsapp_account_for(text), public.whatsapp_store(jsonb), public.whatsapp_set_status(text, text, text), public.whatsapp_last_in(text, text), public.whatsapp_can_send(text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_account_for(text), public.whatsapp_store(jsonb), public.whatsapp_set_status(text, text, text), public.whatsapp_last_in(text, text), public.whatsapp_can_send(text, text) to service_role;
grant select, insert, update, delete on public.whatsapp_accounts, public.whatsapp_messages to service_role;
