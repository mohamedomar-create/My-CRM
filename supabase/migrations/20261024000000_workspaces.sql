-- Bonyan cloud save: one row per company workspace, plus who may open it.
-- The whole workspace (schema, records, books) is stored as one JSON document, the same shape the app uses.

create schema if not exists private;

create table public.workspaces (
  id text primary key,
  name text not null default '',
  doc jsonb not null,
  version integer not null default 1,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id text not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email)),
  is_admin boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (workspace_id, email)
);
create index workspace_members_email_idx on public.workspace_members (email);
create index workspaces_created_by_idx on public.workspaces (created_by);

-- Helpers live in a schema the API doesn't expose, so they can't be called directly.
create function private.auth_email() returns text
language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create function private.is_member(ws text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.email = private.auth_email())
$$;

create function private.is_ws_admin(ws text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.email = private.auth_email() and m.is_admin)
$$;

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger workspaces_touch before update on public.workspaces
for each row execute function private.touch_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "members read their workspace" on public.workspaces
  for select to authenticated
  using (private.is_member(id) or created_by = (select auth.uid()));

create policy "signed-in users create their own workspace" on public.workspaces
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "members save their workspace" on public.workspaces
  for update to authenticated
  using (private.is_member(id))
  with check (private.is_member(id));

create policy "see your memberships and your team" on public.workspace_members
  for select to authenticated
  using (email = (select private.auth_email()) or private.is_member(workspace_id));

-- An admin adds people; the creator of a workspace may add themselves as its first admin.
create policy "admins add members" on public.workspace_members
  for insert to authenticated
  with check (
    private.is_ws_admin(workspace_id)
    or (
      email = (select private.auth_email())
      and is_admin
      and exists (select 1 from public.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid()))
    )
  );

create policy "admins change members" on public.workspace_members
  for update to authenticated
  using (private.is_ws_admin(workspace_id))
  with check (private.is_ws_admin(workspace_id));

create policy "admins remove members" on public.workspace_members
  for delete to authenticated
  using (private.is_ws_admin(workspace_id));
