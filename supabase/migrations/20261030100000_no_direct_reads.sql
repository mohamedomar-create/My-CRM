-- Phase 1.2, second step (applied once the app opens workspaces through open_workspace()): people no longer read the
-- company file directly. It holds only the setup by now, but open_workspace() is the one way in.
drop policy if exists "members save their workspace" on public.workspaces;
drop policy if exists "members read their workspace" on public.workspaces;
revoke select on public.workspaces from anon, authenticated;
