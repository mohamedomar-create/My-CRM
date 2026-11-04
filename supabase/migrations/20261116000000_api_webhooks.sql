-- The public API and webhooks.
-- API keys: an admin makes one in the app (Connections). The key itself is made by their browser and shown once; only
-- its SHA-256 hash is stored here. A key acts as the admin who made it (their rights, their name in the audit trail),
-- read-only or read and write, until it is revoked; it stops working if that person leaves the company.
-- Webhooks: addresses (https only) that are told what happens in the company. Each has a secret the receiver uses to
-- check the signature; deliveries are kept, tried again when they fail, and given up after a day.

create table public.api_keys (
  id text primary key check (id ~ '^key_[a-z0-9]{6,40}$'),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  name text not null check (length(name) between 2 and 60),
  prefix text not null check (prefix ~ '^nq_(live|test)_[A-Za-z0-9]{4,8}$'),
  hash text not null unique check (hash ~ '^[a-f0-9]{64}$'),
  scope text not null check (scope in ('read', 'write')),
  member_email text not null,
  member_uid uuid not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_workspace_idx on public.api_keys (workspace_id);
alter table public.api_keys enable row level security;

create table public.api_calls (
  key_id text not null references public.api_keys (id) on delete cascade,
  at timestamptz not null default now()
);
create index api_calls_key_at_idx on public.api_calls (key_id, at desc);
alter table public.api_calls enable row level security;

create table public.webhooks (
  id text primary key check (id ~ '^wh_[a-z0-9]{6,40}$'),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  url text not null check (url ~ '^https://[^\s/]+' and length(url) <= 500),
  events text[] not null check (cardinality(events) between 1 and 40),
  secret text not null check (secret ~ '^whsec_[A-Za-z0-9]{32,64}$'),
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  last_status integer,
  last_at timestamptz,
  failures integer not null default 0
);
create index webhooks_workspace_idx on public.webhooks (workspace_id);
alter table public.webhooks enable row level security;

create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  webhook_id text not null references public.webhooks (id) on delete cascade,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  next_at timestamptz not null default now(),
  last_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_at) where status = 'pending';
create index webhook_deliveries_ws_idx on public.webhook_deliveries (workspace_id, created_at desc);
alter table public.webhook_deliveries enable row level security;

-- Nobody reads or writes these tables directly: admins go through the functions below, the server through its own.
revoke all on public.api_keys, public.api_calls, public.webhooks, public.webhook_deliveries from anon, authenticated;

/* ---------------- for admins, from the app ---------------- */

create function public.api_keys_list(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can see the API keys' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'prefix', prefix, 'scope', scope, 'member_email', member_email,
    'created_at', created_at, 'last_used_at', last_used_at, 'revoked_at', revoked_at) order by created_at desc)
    from public.api_keys where workspace_id = p_id), '[]');
end
$$;

create function public.api_key_create(p_id text, p_key_id text, p_name text, p_scope text, p_hash text, p_prefix text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can make API keys' using errcode = '42501'; end if;
  if (select count(*) from public.api_keys where workspace_id = p_id and revoked_at is null) >= 20 then
    raise exception 'A company can have up to 20 API keys: revoke one you no longer use' using errcode = '22023';
  end if;
  insert into public.api_keys (id, workspace_id, name, prefix, hash, scope, member_email, member_uid)
    values (p_key_id, p_id, trim(p_name), p_prefix, p_hash, p_scope, private.auth_email(), auth.uid());
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'api.keyCreate', 'Made the API key ' || trim(p_name) || ' (' || p_scope || ')', true);
  return public.api_keys_list(p_id);
end
$$;

create function public.api_key_revoke(p_id text, p_key_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can revoke API keys' using errcode = '42501'; end if;
  update public.api_keys set revoked_at = now() where id = p_key_id and workspace_id = p_id and revoked_at is null;
  if not found then raise exception 'That API key no longer exists' using errcode = '22023'; end if;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'api.keyRevoke', 'Revoked the API key ' || (select name from public.api_keys where id = p_key_id), true);
  return public.api_keys_list(p_id);
end
$$;

create function public.webhooks_list(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can see the webhooks' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'url', url, 'events', events, 'active', active, 'secret_hint', right(secret, 4),
    'created_at', created_at, 'last_status', last_status, 'last_at', last_at, 'failures', failures) order by created_at)
    from public.webhooks where workspace_id = p_id), '[]');
end
$$;

-- p_secret: only when making one (the browser makes it and shows it once); a change keeps the secret.
create function public.webhook_save(p_id text, p_hook_id text, p_url text, p_events text[], p_secret text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can change webhooks' using errcode = '42501'; end if;
  if exists (select 1 from public.webhooks where id = p_hook_id and workspace_id = p_id) then
    update public.webhooks set url = p_url, events = p_events, active = p_active, failures = case when p_active then 0 else failures end where id = p_hook_id;
  else
    if (select count(*) from public.webhooks where workspace_id = p_id) >= 10 then raise exception 'A company can have up to 10 webhooks' using errcode = '22023'; end if;
    insert into public.webhooks (id, workspace_id, url, events, secret, active, created_by) values (p_hook_id, p_id, p_url, p_events, p_secret, p_active, private.auth_email());
  end if;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'api.webhookSave', 'Saved the webhook to ' || p_url, true);
  return public.webhooks_list(p_id);
end
$$;

create function public.webhook_delete(p_id text, p_hook_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can remove webhooks' using errcode = '42501'; end if;
  delete from public.webhooks where id = p_hook_id and workspace_id = p_id;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'api.webhookDelete', 'Removed a webhook', true);
  return public.webhooks_list(p_id);
end
$$;

create function public.webhook_deliveries_recent(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can see the webhook deliveries' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select d.id, d.webhook_id, w.url, d.event, d.status, d.attempts, d.last_status, d.last_error, d.created_at, d.delivered_at, d.next_at
      from public.webhook_deliveries d join public.webhooks w on w.id = d.webhook_id
     where d.workspace_id = p_id order by d.created_at desc limit 50) x), '[]');
end
$$;

revoke execute on function public.api_keys_list(text), public.api_key_create(text, text, text, text, text, text), public.api_key_revoke(text, text),
  public.webhooks_list(text), public.webhook_save(text, text, text, text[], text, boolean), public.webhook_delete(text, text), public.webhook_deliveries_recent(text) from public, anon;
grant execute on function public.api_keys_list(text), public.api_key_create(text, text, text, text, text, text), public.api_key_revoke(text, text),
  public.webhooks_list(text), public.webhook_save(text, text, text, text[], text, boolean), public.webhook_delete(text, text), public.webhook_deliveries_recent(text) to authenticated;

/* ---------------- for the server only ---------------- */

-- The key with this hash, if it is live and its person is still in the company; counts the call.
create function public.api_key_use(p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.api_keys;
begin
  select * into k from public.api_keys where hash = p_hash and revoked_at is null;
  if not found or not exists (select 1 from public.workspace_members m where m.workspace_id = k.workspace_id and m.email = k.member_email) then return null; end if;
  update public.api_keys set last_used_at = now() where id = k.id;
  insert into public.api_calls (key_id) values (k.id);
  -- the count only needs the last minute
  if random() < 0.02 then delete from public.api_calls where at < now() - interval '1 hour'; end if;
  return jsonb_build_object('id', k.id, 'workspace', k.workspace_id, 'email', k.member_email, 'uid', k.member_uid, 'name', k.name, 'scope', k.scope,
    'calls', (select count(*) from public.api_calls where key_id = k.id and at > now() - interval '1 minute'));
end
$$;

create function public.webhooks_for(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'url', url, 'events', events, 'secret', secret)), '[]')
    from public.webhooks where workspace_id = p_id and active
$$;

create function public.webhook_enqueue(p_rows jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  with ins as (
    insert into public.webhook_deliveries (webhook_id, workspace_id, event, payload)
    select r ->> 'webhook', r ->> 'workspace', r ->> 'event', r -> 'payload' from jsonb_array_elements(p_rows) with ordinality as t(r, n) order by n
    returning id, webhook_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'webhook', webhook_id) order by id), '[]') from ins
$$;

create function public.webhook_mark(p_id bigint, p_ok boolean, p_status integer, p_attempts integer, p_next timestamptz, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  hook text;
begin
  update public.webhook_deliveries
     set status = case when p_ok then 'delivered' when p_next is null then 'failed' else 'pending' end,
         attempts = p_attempts, last_status = p_status, last_error = case when p_ok then null else left(p_error, 200) end,
         next_at = coalesce(p_next, next_at), delivered_at = case when p_ok then now() else null end
   where id = p_id returning webhook_id into hook;
  -- a webhook that keeps failing (100 in a row) is turned off; the admin sees why and turns it back on
  update public.webhooks set last_status = p_status, last_at = now(),
         failures = case when p_ok then 0 else failures + 1 end,
         active = case when not p_ok and failures + 1 >= 100 then false else active end
   where id = hook;
end
$$;

-- What is due to be tried again (the scheduler, every few minutes); delivered ones older than 30 days are cleared.
create function public.webhook_due(p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.webhook_deliveries where status <> 'pending' and created_at < now() - interval '30 days';
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'webhook', d.webhook_id, 'url', w.url, 'secret', w.secret, 'event', d.event, 'payload', d.payload, 'attempts', d.attempts))
    from (select * from public.webhook_deliveries where status = 'pending' and next_at <= now() order by next_at limit greatest(1, least(p_limit, 500))) d
    join public.webhooks w on w.id = d.webhook_id and w.active), '[]');
end
$$;

revoke execute on function public.api_key_use(text), public.webhooks_for(text), public.webhook_enqueue(jsonb), public.webhook_mark(bigint, boolean, integer, integer, timestamptz, text), public.webhook_due(integer) from public, anon, authenticated;
grant execute on function public.api_key_use(text), public.webhooks_for(text), public.webhook_enqueue(jsonb), public.webhook_mark(bigint, boolean, integer, integer, timestamptz, text), public.webhook_due(integer) to service_role;
grant select, insert, update, delete on public.api_keys, public.api_calls, public.webhooks, public.webhook_deliveries to service_role;
