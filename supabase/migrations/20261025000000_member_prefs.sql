-- Per-person settings that don't belong in the shared company file: which notifications you've read and your saved views.
-- Keeping them here means opening the bell or saving a view never collides with a colleague's save.
create table public.member_prefs (
  workspace_id text not null references public.workspaces (id) on delete cascade,
  email text not null,
  prefs jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (workspace_id, email)
);
alter table public.member_prefs enable row level security;

create policy "read your own prefs" on public.member_prefs
  for select to authenticated using (email = (select private.auth_email()) and private.is_member(workspace_id));
create policy "create your own prefs" on public.member_prefs
  for insert to authenticated with check (email = (select private.auth_email()) and private.is_member(workspace_id));
create policy "change your own prefs" on public.member_prefs
  for update to authenticated
  using (email = (select private.auth_email()) and private.is_member(workspace_id))
  with check (email = (select private.auth_email()) and private.is_member(workspace_id));
