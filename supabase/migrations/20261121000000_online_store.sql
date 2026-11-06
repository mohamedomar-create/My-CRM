-- The online store (Shopify). An admin connects the company's store with its address, an Admin API access token and the
-- app's API secret (which signs the store's webhooks). Both stay here and are never sent back to the app. The server
-- reads them to check each webhook and to call the store (products, stock); orders are brought in as the admin who
-- connected the store, with their rights, through the command server.

create table public.shop_connections (
  workspace_id text primary key references public.workspaces (id) on delete cascade,
  provider text not null default 'shopify' check (provider = 'shopify'),
  domain text not null unique check (domain ~ '^[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com$'),
  access_token text not null check (length(access_token) between 20 and 300),
  api_secret text not null check (length(api_secret) between 16 and 300),
  -- post orders at once, the account paid orders go into, the store location kept in step with the books' stock
  settings jsonb not null default '{"post": true}'::jsonb check (jsonb_typeof(settings) = 'object'),
  connected_by text not null,
  connected_uid uuid not null,
  connected_at timestamptz not null default now(),
  last_order_at timestamptz,
  last_error text
);
alter table public.shop_connections enable row level security;
revoke all on public.shop_connections from anon, authenticated;

/* ---------------- for the app ---------------- */

create function public.shop_status(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.shop_connections;
begin
  if not private.is_member(p_id) then raise exception 'Not a member' using errcode = '42501'; end if;
  select * into c from public.shop_connections where workspace_id = p_id;
  if not found then return jsonb_build_object('connected', false); end if;
  return jsonb_build_object('connected', true, 'provider', c.provider, 'domain', c.domain, 'settings', c.settings,
    'connected_by', c.connected_by, 'connected_at', c.connected_at, 'last_order_at', c.last_order_at, 'last_error', c.last_error);
end
$$;

create function public.shop_connect(p_id text, p_domain text, p_token text, p_secret text, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can connect the online store' using errcode = '42501'; end if;
  insert into public.shop_connections (workspace_id, domain, access_token, api_secret, settings, connected_by, connected_uid)
    values (p_id, lower(trim(p_domain)), trim(p_token), trim(p_secret), coalesce(p_settings, '{"post": true}'::jsonb), private.auth_email(), auth.uid())
  on conflict (workspace_id) do update set domain = excluded.domain, access_token = excluded.access_token, api_secret = excluded.api_secret,
    settings = excluded.settings, connected_by = excluded.connected_by, connected_uid = excluded.connected_uid, connected_at = now(), last_error = null;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'shop.connect', 'Connected the online store ' || lower(trim(p_domain)), true);
  return public.shop_status(p_id);
end
$$;

create function public.shop_settings(p_id text, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can change the online store' using errcode = '42501'; end if;
  if jsonb_typeof(p_settings) <> 'object' then raise exception 'Bad settings' using errcode = '22023'; end if;
  update public.shop_connections set settings = p_settings where workspace_id = p_id;
  return public.shop_status(p_id);
end
$$;

create function public.shop_disconnect(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_ws_admin(p_id) then raise exception 'Only an admin can disconnect the online store' using errcode = '42501'; end if;
  delete from public.shop_connections where workspace_id = p_id;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), private.auth_email(), 'shop.disconnect', 'Disconnected the online store', true);
  return jsonb_build_object('connected', false);
end
$$;

revoke execute on function public.shop_status(text), public.shop_connect(text, text, text, text, jsonb), public.shop_settings(text, jsonb), public.shop_disconnect(text) from public, anon;
grant execute on function public.shop_status(text), public.shop_connect(text, text, text, text, jsonb), public.shop_settings(text, jsonb), public.shop_disconnect(text) to authenticated;

/* ---------------- for the server only ---------------- */

create function public.shop_account_for(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('workspace', workspace_id, 'domain', domain, 'token', access_token, 'secret', api_secret, 'settings', settings,
    'email', connected_by, 'uid', connected_uid)
    from public.shop_connections where workspace_id = p_id
$$;

create function public.shop_mark(p_id text, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.shop_connections set last_order_at = case when p_error is null then now() else last_order_at end, last_error = p_error where workspace_id = p_id
$$;

revoke execute on function public.shop_account_for(text), public.shop_mark(text, text) from public, anon, authenticated;
grant execute on function public.shop_account_for(text), public.shop_mark(text, text) to service_role;
grant select, insert, update, delete on public.shop_connections to service_role;
