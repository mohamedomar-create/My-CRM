-- Phase 1.1 (last step): only the server writes the company file.
-- The app now sends every change as a command to the "command" server function, which checks the person's role
-- in the database, runs the business rules and saves through save_workspace(). Nobody can edit the file directly
-- from the browser any more, whatever their role.
drop policy if exists "members save their workspace" on public.workspaces;
revoke update on public.workspaces from authenticated, anon;
