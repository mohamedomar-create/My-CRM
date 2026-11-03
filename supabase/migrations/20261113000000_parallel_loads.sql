-- Loading a company took a row lock on it every time, for a move (its records into their own tables) that happens
-- only once, on its first open. The lock was held for the whole load, so everyone working in the same company had to
-- load one after the other, and saves waited behind them: with 20 people at once and 5,000 customers, a save could
-- take 15 seconds (src/lib/dbsim.test.ts). A company already moved now skips the lock, so loads run side by side;
-- the move itself still happens under the lock. Only this one line of the function changes.
do $$
declare
  def text := pg_get_functiondef('private.move_workspace_data(text)'::regprocedure);
  old text := '  select * into w from public.workspaces where id = p_id for update;';
begin
  if position(old in def) = 0 then raise exception 'private.move_workspace_data is not as expected; nothing was changed'; end if;
  execute replace(def, old,
    E'  -- already moved (every company after its first open): nothing to do, and no lock that makes the others wait\n'
    || E'  if exists (select 1 from public.workspaces where id = p_id and data_in_tables) then return; end if;\n' || old);
  if position('no lock that makes the others wait' in pg_get_functiondef('private.move_workspace_data(text)'::regprocedure)) = 0 then
    raise exception 'private.move_workspace_data was not changed';
  end if;
end
$$;
