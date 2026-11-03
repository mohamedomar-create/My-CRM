-- The product is called Nasq360 now (it was Bonyan). The messages people can see from the database ("… was updated.
-- Refresh the page", "Only …'s own team can do this") say the new name: every function whose text names the old one
-- is created again from its own definition with the name changed, so nothing else about it (arguments, rights,
-- security settings) changes. Internal setting names such as bonyan.maintenance stay as they are.
do $$
declare
  f record;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prosrc like '%Bonyan%'
  loop
    execute replace(pg_get_functiondef(f.oid), 'Bonyan', 'Nasq360');
  end loop;
end
$$;
