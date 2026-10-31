-- Phase 1.3a: invitations and the company switcher.
-- * People join a workspace by accepting an invitation, not because an admin typed their e-mail: an admin creates an
--   invitation (a private link, valid 7 days), the invited person signs in with that e-mail and accepts or declines.
--   Admins see who is invited and can cancel an invitation. Only a hash of the link's secret is stored.
-- * my_workspaces() lists the companies a person belongs to, for the company switcher.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_admin boolean not null default false,
  token_hash text not null unique,
  invited_by uuid,
  invited_by_email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  declined_at timestamptz,
  revoked_at timestamptz
);
create index invitations_workspace_idx on public.invitations (workspace_id, created_at desc);
create index invitations_email_idx on public.invitations (email);
-- one open invitation per person and workspace
create unique index invitations_one_open on public.invitations (workspace_id, email)
  where accepted_at is null and declined_at is null and revoked_at is null;
alter table public.invitations enable row level security;
revoke all on public.invitations from anon, authenticated;
grant select (id, workspace_id, email, is_admin, invited_by_email, created_at, expires_at, accepted_at, declined_at, revoked_at)
  on public.invitations to authenticated;
create policy "admins see their workspace's invitations" on public.invitations
  for select to authenticated using (private.is_ws_admin(workspace_id));
create policy "people see invitations sent to them" on public.invitations
  for select to authenticated using (email = (select private.auth_email()));

-- Membership now comes only from an accepted invitation (or creating the workspace).
drop policy if exists "admins add members" on public.workspace_members;

create function private.hash_token(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- An admin invites someone. Returns the secret for the link; it is shown once and stored only as a hash.
create function public.create_invitation(p_workspace text, p_email text, p_is_admin boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
  e text := lower(trim(coalesce(p_email, '')));
  token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if me = '' or not private.is_ws_admin(p_workspace) then raise exception 'Only an admin can invite people' using errcode = '42501'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid e-mail' using errcode = '22023'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = p_workspace and email = e) then
    raise exception 'This person is already in the team' using errcode = '23505';
  end if;
  if (select count(*) from public.invitations where workspace_id = p_workspace and created_at > now() - interval '1 day') >= 50 then
    raise exception 'You can send up to 50 invitations a day' using errcode = '54000';
  end if;
  -- a new invitation replaces an open one for the same person
  update public.invitations set revoked_at = now()
   where workspace_id = p_workspace and email = e and accepted_at is null and declined_at is null and revoked_at is null;
  insert into public.invitations (workspace_id, email, is_admin, token_hash, invited_by, invited_by_email)
  values (p_workspace, e, coalesce(p_is_admin, false), private.hash_token(token), auth.uid(), me);
  return token;
end
$$;

create function public.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.invitations set revoked_at = now()
   where id = p_id and accepted_at is null and declined_at is null and revoked_at is null and private.is_ws_admin(workspace_id);
  if not found then raise exception 'This invitation is no longer open' using errcode = '22023'; end if;
end
$$;

-- What an invitation link is for, so the join page can say "You're invited to …". Works before signing in.
create function public.invitation_by_token(p_token text)
returns table (id uuid, company text, email text, status text)
language sql stable security definer set search_path = '' as $$
  select i.id, w.name, i.email,
         case when i.accepted_at is not null then 'accepted' when i.declined_at is not null then 'declined'
              when i.revoked_at is not null then 'cancelled' when i.expires_at < now() then 'expired' else 'open' end
    from public.invitations i join public.workspaces w on w.id = i.workspace_id
   where i.token_hash = private.hash_token(p_token)
$$;

-- The invited person, signed in with the invited e-mail, accepts or declines. Accepting makes them a member.
create function public.respond_invitation(p_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
  i public.invitations;
begin
  select * into i from public.invitations where id = p_id for update;
  if not found or me = '' or i.email <> me then
    raise exception 'This invitation is for another e-mail. Sign in with the e-mail it was sent to.' using errcode = '42501';
  end if;
  if i.accepted_at is not null or i.declined_at is not null or i.revoked_at is not null then
    raise exception 'This invitation was already used or cancelled. Ask your admin for a new one.' using errcode = '22023';
  end if;
  if i.expires_at < now() then raise exception 'This invitation has expired. Ask your admin for a new one.' using errcode = '22023'; end if;
  if p_accept then
    -- admin or not follows the role their profile has now (it may have changed since the invitation was sent)
    select coalesce((select (r ->> 'admin')::boolean
                       from public.workspaces w, jsonb_array_elements(w.doc -> 'users') u,
                            jsonb_array_elements(coalesce(w.doc #> '{published,roles}', w.doc #> '{draft,roles}', '[]')) r
                      where w.id = i.workspace_id and lower(u ->> 'email') = i.email and r ->> 'id' = u ->> 'roleId' limit 1), i.is_admin)
      into i.is_admin;
    insert into public.workspace_members (workspace_id, email, is_admin) values (i.workspace_id, i.email, i.is_admin)
    on conflict (workspace_id, email) do nothing;
    update public.invitations set accepted_at = now() where id = i.id;
  else
    update public.invitations set declined_at = now() where id = i.id;
  end if;
  return i.workspace_id;
end
$$;

-- The companies this person belongs to (for the company switcher), and invitations waiting for them.
create function public.my_workspaces()
returns table (id text, name text, is_admin boolean, is_owner boolean)
language sql stable security definer set search_path = '' as $$
  select w.id, w.name, m.is_admin, m.is_owner
    from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
   where m.email = private.auth_email() and private.auth_email() <> ''
   order by m.added_at
$$;

create function public.my_invitations()
returns table (id uuid, company text, invited_by text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, w.name, i.invited_by_email, i.expires_at
    from public.invitations i join public.workspaces w on w.id = i.workspace_id
   where i.email = private.auth_email() and private.auth_email() <> ''
     and i.accepted_at is null and i.declined_at is null and i.revoked_at is null and i.expires_at > now()
   order by i.created_at
$$;

revoke execute on function public.create_invitation(text, text, boolean), public.revoke_invitation(uuid), public.respond_invitation(uuid, boolean),
  public.my_workspaces(), public.my_invitations() from public, anon;
grant execute on function public.create_invitation(text, text, boolean), public.revoke_invitation(uuid), public.respond_invitation(uuid, boolean),
  public.my_workspaces(), public.my_invitations() to authenticated;
revoke execute on function public.invitation_by_token(text) from public;
grant execute on function public.invitation_by_token(text) to anon, authenticated;

grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;
revoke execute on function private.move_workspace_data(text), private.table_data(text), private.viewer(text, text), private.workspace_view(text, text),
  private.cost_keys(jsonb) from authenticated;
