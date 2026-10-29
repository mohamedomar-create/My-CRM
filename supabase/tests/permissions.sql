-- Database permission tests: every attack the expert review found must be refused by the database itself,
-- and normal work must still go through. Fails (non-zero exit) on the first surprise.
\set ON_ERROR_STOP on
create function pg_temp.blocked(step text, q text) returns void language plpgsql as $f$
begin
  begin
    execute q;
  exception when others then
    raise notice 'ok   blocked: %  (%)', step, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % was allowed', step;
end $f$;
create function pg_temp.allowed(step text, q text) returns void language plpgsql as $f$
begin
  execute q;
  raise notice 'ok   allowed: %', step;
end $f$;
create function pg_temp.check(step text, ok boolean) returns void language plpgsql as $f$
begin
  if not ok then raise exception 'FAIL: %', step; end if;
  raise notice 'ok   %', step;
end $f$;
grant execute on all functions in schema pg_temp to anon, authenticated;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a', 'owner@test.dev'),
 ('00000000-0000-0000-0000-00000000000b', 'staff@test.dev'),
 ('00000000-0000-0000-0000-00000000000c', 'stranger@test.dev');

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.allowed('owner creates a workspace through create_workspace()', $q$select public.create_workspace('ws_test123456','T','{"id":"ws_test123456","users":[],"draft":null,"data":{"journal":[{"id":"j1","x":1}],"stock":[],"payments":[],"sequences":{"INV":3}}}')$q$);
select pg_temp.blocked('inserting a workspace directly', $q$insert into public.workspaces(id,name,doc) values ('ws_direct00001','x','{"id":"ws_direct00001","users":[],"data":{}}')$q$);
select pg_temp.allowed('owner adds a staff member', $q$insert into public.workspace_members(workspace_id,email,is_admin) values ('ws_test123456','staff@test.dev',false)$q$);
select pg_temp.blocked('removing the owner', $q$delete from public.workspace_members where workspace_id='ws_test123456' and email='owner@test.dev'$q$);
select pg_temp.blocked('demoting the owner', $q$update public.workspace_members set is_admin=false where workspace_id='ws_test123456' and email='owner@test.dev'$q$);
select pg_temp.blocked('adding a second owner', $q$insert into public.workspace_members(workspace_id,email,is_admin,is_owner) values ('ws_test123456','x@test.dev',true,true)$q$);
select pg_temp.blocked('a member e-mail that is not an e-mail', $q$insert into public.workspace_members(workspace_id,email) values ('ws_test123456','')$q$);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"staff@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('staff takes over created_by (SECU-02)', $q$update public.workspaces set created_by='00000000-0000-0000-0000-00000000000b' where id='ws_test123456'$q$);
select pg_temp.blocked('staff rewrites the users list (SECU-01)', $q$update public.workspaces set doc=jsonb_set(doc,'{users}','[{"id":"u","roleId":"role_admin"}]') where id='ws_test123456'$q$);
select pg_temp.allowed('staff adds a journal entry (normal work)', $q$update public.workspaces set version=999, doc=jsonb_set(doc,'{data,journal}','[{"id":"j2","x":2},{"id":"j1","x":1}]') where id='ws_test123456'$q$);
select pg_temp.check('the server, not the client, sets the version', (select version = 2 from public.workspaces where id='ws_test123456'));
select pg_temp.blocked('deleting a journal entry', $q$update public.workspaces set doc=jsonb_set(doc,'{data,journal}','[{"id":"j2","x":2}]') where id='ws_test123456'$q$);
select pg_temp.blocked('editing a journal entry', $q$update public.workspaces set doc=jsonb_set(doc,'{data,journal}','[{"id":"j2","x":2},{"id":"j1","x":99}]') where id='ws_test123456'$q$);
select pg_temp.blocked('turning the invoice counter back', $q$update public.workspaces set doc=jsonb_set(doc,'{data,sequences,INV}','1') where id='ws_test123456'$q$);
select pg_temp.blocked('saving a broken workspace', $q$update public.workspaces set doc='{}' where id='ws_test123456'$q$);
select pg_temp.blocked('staff transfers ownership to themselves', $q$select public.transfer_ownership('ws_test123456','staff@test.dev')$q$);
update public.workspace_members set is_admin = true where email = 'staff@test.dev';
select pg_temp.check('staff cannot make themselves admin', (select not is_admin from public.workspace_members where email='staff@test.dev'));
select pg_temp.allowed('staff saves their own preferences', $q$insert into public.member_prefs(workspace_id,email,prefs) values ('ws_test123456','staff@test.dev','{"readNotes":["n1"]}')$q$);
select pg_temp.blocked('staff writes someone else''s preferences', $q$insert into public.member_prefs(workspace_id,email,prefs) values ('ws_test123456','owner@test.dev','{}')$q$);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('transferring ownership to a non-admin', $q$select public.transfer_ownership('ws_test123456','staff@test.dev')$q$);
select pg_temp.allowed('owner promotes staff to admin', $q$update public.workspace_members set is_admin=true where email='staff@test.dev'$q$);
select pg_temp.allowed('owner transfers ownership to an admin', $q$select public.transfer_ownership('ws_test123456','staff@test.dev')$q$);
select pg_temp.check('exactly one owner afterwards', (select count(*) = 1 and bool_and(email = 'staff@test.dev') from public.workspace_members where workspace_id='ws_test123456' and is_owner));
select pg_temp.check('owner cannot read another person''s preferences', (select count(*) = 0 from public.member_prefs where email = 'staff@test.dev'));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated","is_anonymous":true}', false);
select pg_temp.check('an anonymous login sees no workspace', (select count(*) = 0 from public.workspaces));
select pg_temp.blocked('an anonymous login creates a workspace', $q$select public.create_workspace('ws_anon000001','A','{"id":"ws_anon000001","users":[],"data":{}}')$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.check('a stranger sees no workspace', (select count(*) = 0 from public.workspaces));
select pg_temp.check('a stranger sees no members', (select count(*) = 0 from public.workspace_members));
select pg_temp.blocked('a stranger creates a workspace with a mismatched id', $q$select public.create_workspace('ws_strange0001','S','{"id":"ws_other","users":[],"data":{}}')$q$);
update public.workspaces set doc = '{"id":"ws_test123456","users":[],"data":{"hacked":true}}' where id = 'ws_test123456';
reset role;
select pg_temp.check('a stranger''s update changed nothing', (select not (doc #> '{data}' ? 'hacked') from public.workspaces where id='ws_test123456'));

set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.check('the public (not signed in) sees no workspace', (select count(*) = 0 from public.workspaces));
reset role;
select pg_temp.check('snapshots of earlier versions are kept', (select count(*) >= 1 from public.workspace_versions where workspace_id='ws_test123456'));

-- Phase 1.1: the server is the writer, the audit trail is append-only.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"staff@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('a person calls the server''s save function', $q$select public.save_workspace('ws_test123456', 1, '{}'::jsonb, '00000000-0000-0000-0000-00000000000b')$q$);
select pg_temp.blocked('a person writes into the audit trail', $q$insert into public.audit_events(workspace_id, actor_email, command, ok) values ('ws_test123456','staff@test.dev','fake',true)$q$);
reset role;
select set_config('request.jwt.claims', '', false);
set role service_role;
select pg_temp.blocked('the server deletes a journal line', $q$select public.save_workspace('ws_test123456', (select version from public.workspaces where id='ws_test123456'), (select jsonb_set(doc,'{data,journal}','[]') from public.workspaces where id='ws_test123456'), '00000000-0000-0000-0000-00000000000b')$q$);
select pg_temp.allowed('the server saves normal work for a person', $q$select public.save_workspace('ws_test123456', (select version from public.workspaces where id='ws_test123456'), (select jsonb_set(doc,'{data,journal}', (doc #> '{data,journal}') || '[{"id":"j3","x":3}]') from public.workspaces where id='ws_test123456'), '00000000-0000-0000-0000-00000000000b')$q$);
select pg_temp.check('the save is attributed to that person', (select updated_by = '00000000-0000-0000-0000-00000000000b' from public.workspaces where id='ws_test123456'));
select pg_temp.check('a save based on an old version does nothing', (select public.save_workspace('ws_test123456', 1, (select doc from public.workspaces where id='ws_test123456'), '00000000-0000-0000-0000-00000000000b') is null));
select pg_temp.allowed('the server records an audit event', $q$insert into public.audit_events(workspace_id, actor, actor_email, command, ok) values ('ws_test123456','00000000-0000-0000-0000-00000000000b','staff@test.dev','record.create',true)$q$);
select pg_temp.blocked('the server edits an audit event', $q$update public.audit_events set ok = false$q$);
select pg_temp.blocked('the server deletes an audit event', $q$delete from public.audit_events$q$);
reset role;
select pg_temp.blocked('even the database owner edits an audit event', $q$update public.audit_events set command = 'x'$q$);
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"staff@test.dev","role":"authenticated"}', false);
select pg_temp.check('an admin reads their workspace''s audit trail', (select count(*) = 1 from public.audit_events));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.check('a stranger reads no audit events', (select count(*) = 0 from public.audit_events));
reset role;

select 'ALL DATABASE PERMISSION TESTS PASSED' as result;
