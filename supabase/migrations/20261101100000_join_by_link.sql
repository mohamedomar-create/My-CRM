-- Phase 1.3a, follow-up: joining from an invitation link needs no confirmation e-mail.
-- Opening a valid invitation proves the person received it, so the "join" server function creates their login already
-- confirmed and accepts the invitation by its link (accept_invitation_token, server only). Accepting inside the app
-- (respond_invitation) and by link share one helper, so both make the same membership.

-- Makes the invited person a member; admin or not follows the role their profile has now.
create function private.accept_invitation(i public.invitations) returns void
language plpgsql security definer set search_path = '' as $$
declare
  admin boolean;
begin
  select coalesce((select (r ->> 'admin')::boolean
                     from public.workspaces w, jsonb_array_elements(w.doc -> 'users') u,
                          jsonb_array_elements(coalesce(w.doc #> '{published,roles}', w.doc #> '{draft,roles}', '[]')) r
                    where w.id = i.workspace_id and lower(u ->> 'email') = i.email and r ->> 'id' = u ->> 'roleId' limit 1), i.is_admin)
    into admin;
  insert into public.workspace_members (workspace_id, email, is_admin) values (i.workspace_id, i.email, admin)
  on conflict (workspace_id, email) do nothing;
  update public.invitations set accepted_at = now() where id = i.id;
end
$$;

-- An invitation that is still open, or an exception saying why not.
create function private.open_invitation(i public.invitations) returns void
language plpgsql set search_path = '' as $$
begin
  if i.accepted_at is not null or i.declined_at is not null or i.revoked_at is not null then
    raise exception 'This invitation was already used or cancelled. Ask your admin for a new one.' using errcode = '22023';
  end if;
  if i.expires_at < now() then raise exception 'This invitation has expired. Ask your admin for a new one.' using errcode = '22023'; end if;
end
$$;

create or replace function public.respond_invitation(p_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
  i public.invitations;
begin
  select * into i from public.invitations where id = p_id for update;
  if not found or me = '' or i.email <> me then
    raise exception 'This invitation is for another e-mail. Sign in with the e-mail it was sent to.' using errcode = '42501';
  end if;
  perform private.open_invitation(i);
  if p_accept then
    perform private.accept_invitation(i);
  else
    update public.invitations set declined_at = now() where id = i.id;
  end if;
  return i.workspace_id;
end
$$;

-- The join server function accepts by the link's secret, right after creating the person's login.
create function public.accept_invitation_token(p_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  i public.invitations;
begin
  select * into i from public.invitations where token_hash = private.hash_token(p_token) for update;
  if not found then raise exception 'This invitation link is not valid' using errcode = '22023'; end if;
  perform private.open_invitation(i);
  perform private.accept_invitation(i);
  return i.workspace_id;
end
$$;
revoke execute on function public.accept_invitation_token(text) from public, anon, authenticated;
grant execute on function public.accept_invitation_token(text) to service_role;

-- For the join server function: the login that already uses an e-mail, and whether it was ever confirmed.
create function public.login_for_email(p_email text) returns table (id uuid, confirmed boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email_confirmed_at is not null from auth.users u where lower(u.email) = lower(p_email) limit 1
$$;
revoke execute on function public.login_for_email(text) from public, anon, authenticated;
grant execute on function public.login_for_email(text) to service_role;
grant execute on function public.invitation_by_token(text) to service_role;

grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;
revoke execute on function private.move_workspace_data(text), private.table_data(text), private.viewer(text, text), private.workspace_view(text, text),
  private.cost_keys(jsonb), private.accept_invitation(public.invitations) from authenticated;
