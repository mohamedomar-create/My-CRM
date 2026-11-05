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
select pg_temp.blocked('an admin adds a member directly (people join by accepting an invitation)', $q$insert into public.workspace_members(workspace_id,email,is_admin) values ('ws_test123456','staff@test.dev',false)$q$);
create temp table inv as select public.create_invitation('ws_test123456', 'Staff@Test.dev', false) as token;
reset role;
select pg_temp.check('the invitation link''s secret is stored only as a hash', (select count(*) = 1 from public.invitations i, inv where i.token_hash = encode(sha256(convert_to(inv.token, 'UTF8')), 'hex') and i.token_hash <> inv.token and i.email = 'staff@test.dev'));
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('someone else accepts the invitation', $q$select public.respond_invitation((select id from public.invitation_by_token((select token from inv))), true)$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"staff@test.dev","role":"authenticated"}', false);
select pg_temp.check('the invited person sees their invitation', (select count(*) = 1 from public.my_invitations()));
select pg_temp.allowed('the invited person accepts and becomes a member', $q$select public.respond_invitation((select id from public.invitation_by_token((select token from inv))), true)$q$);
select pg_temp.blocked('an invitation is used twice', $q$select public.respond_invitation((select id from public.invitation_by_token((select token from inv))), true)$q$);
select pg_temp.check('the new member lists the workspace in the company switcher', (select array_agg(id) = array['ws_test123456'] from public.my_workspaces()));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('removing the owner', $q$delete from public.workspace_members where workspace_id='ws_test123456' and email='owner@test.dev'$q$);
select pg_temp.blocked('demoting the owner', $q$update public.workspace_members set is_admin=false where workspace_id='ws_test123456' and email='owner@test.dev'$q$);
select pg_temp.blocked('adding a second owner', $q$insert into public.workspace_members(workspace_id,email,is_admin,is_owner) values ('ws_test123456','x@test.dev',true,true)$q$);
select pg_temp.blocked('a member e-mail that is not an e-mail', $q$insert into public.workspace_members(workspace_id,email) values ('ws_test123456','')$q$);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"staff@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('staff takes over created_by (SECU-02)', $q$update public.workspaces set created_by='00000000-0000-0000-0000-00000000000b' where id='ws_test123456'$q$);
select pg_temp.blocked('staff rewrites the users list (SECU-01)', $q$update public.workspaces set doc=jsonb_set(doc,'{users}','[{"id":"u","roleId":"role_admin"}]') where id='ws_test123456'$q$);
select pg_temp.blocked('a member edits the company file straight from the browser (all changes go through the server)', $q$update public.workspaces set version=999, doc=jsonb_set(doc,'{data,journal}','[{"id":"j2","x":2},{"id":"j1","x":1}]') where id='ws_test123456'$q$);
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
select pg_temp.blocked('an anonymous login reads a workspace', $q$select public.open_workspace('ws_test123456')$q$);
select pg_temp.blocked('an anonymous login creates a workspace', $q$select public.create_workspace('ws_anon000001','A','{"id":"ws_anon000001","users":[],"data":{}}')$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('a stranger opens a workspace', $q$select public.open_workspace('ws_test123456')$q$);
select pg_temp.blocked('a stranger reads the company file directly', $q$select count(*) from public.workspaces$q$);
select pg_temp.check('a stranger sees no members', (select count(*) = 0 from public.workspace_members));
select pg_temp.blocked('a stranger creates a workspace with a mismatched id', $q$select public.create_workspace('ws_strange0001','S','{"id":"ws_other","users":[],"data":{}}')$q$);
select pg_temp.blocked('a stranger edits the company file', $q$update public.workspaces set doc = '{"id":"ws_test123456","users":[],"data":{"hacked":true}}' where id = 'ws_test123456'$q$);
reset role;
select pg_temp.check('a stranger''s update changed nothing', (select not (doc #> '{data}' ? 'hacked') from public.workspaces where id='ws_test123456'));

set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.blocked('the public (not signed in) reads a workspace', $q$select count(*) from public.workspaces$q$);
reset role;

-- Phase 1.1: the server is the writer, the audit trail is append-only.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"staff@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('a person calls the server''s save function', $q$select public.save_workspace('ws_test123456', 1, '{}'::jsonb, '00000000-0000-0000-0000-00000000000b')$q$);
select pg_temp.blocked('a person writes into the audit trail', $q$insert into public.audit_events(workspace_id, actor_email, command, ok) values ('ws_test123456','staff@test.dev','fake',true)$q$);
reset role;
select set_config('request.jwt.claims', '', false);
set role service_role;
select pg_temp.blocked('the server deletes a journal line', $q$select public.save_workspace('ws_test123456', (select version from public.workspaces where id='ws_test123456'), (select jsonb_set(doc,'{data,journal}','[]') from public.workspaces where id='ws_test123456'), '00000000-0000-0000-0000-00000000000b')$q$);
select pg_temp.blocked('the server turns the invoice counter back', $q$select public.save_workspace('ws_test123456', (select version from public.workspaces where id='ws_test123456'), (select jsonb_set(doc,'{data,sequences,INV}','1') from public.workspaces where id='ws_test123456'), '00000000-0000-0000-0000-00000000000b')$q$);
select pg_temp.blocked('the server saves a broken workspace', $q$select public.save_workspace('ws_test123456', (select version from public.workspaces where id='ws_test123456'), '{}'::jsonb, '00000000-0000-0000-0000-00000000000b')$q$);
create temp table v_before as select version from public.workspaces where id='ws_test123456';
select pg_temp.allowed('the server saves normal work for a person', $q$select public.save_workspace('ws_test123456', (select version from public.workspaces where id='ws_test123456'), (select jsonb_set(doc,'{data,journal}', (doc #> '{data,journal}') || '[{"id":"j3","x":3}]') from public.workspaces where id='ws_test123456'), '00000000-0000-0000-0000-00000000000b')$q$);
select pg_temp.check('the database sets the next version itself', (select w.version = b.version + 1 from public.workspaces w, v_before b where w.id='ws_test123456'));
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

-- Phase 1.2: records and books in their own tables; each person reads only what their role allows.
insert into public.workspaces (id, name, doc, created_by) values ('ws_books000001', 'Books', $j${
  "id": "ws_books000001", "users": [
    {"id": "u_own", "email": "owner@test.dev", "roleId": "role_admin"},
    {"id": "u_sales", "email": "sales@test.dev", "roleId": "role_sales"},
    {"id": "u_fin", "email": "fin@test.dev", "roleId": "role_fin"}],
  "published": {"roles": [
    {"id": "role_admin", "admin": true, "access": {}},
    {"id": "role_sales", "access": {"m_prod": ["view"], "m_inv": ["view", "create"], "m_secret": ["create"]}},
    {"id": "role_fin", "finance": true, "access": {"m_inv": ["view"]}}]},
  "draft": null,
  "books": {"lockDate": "2026-01-31", "vatReturns": [{"month": "2026-01", "due": 14}], "reconciliations": [{"account": "1110", "balance": 500}]},
  "data": {
    "sequences": {"INV": 1},
    "records": {
      "m_prod": [{"id": "r_prod", "module": "m_prod", "values": {"name": "Rice", "price": 50, "cost": 30, "stock_value": 300}}],
      "m_inv": [{"id": "r_inv", "module": "m_inv", "number": "INV-0001", "status": "posted", "values": {"customer": "x"}}],
      "m_secret": [{"id": "r_hr", "module": "m_secret", "values": {"name": "Salary list"}}],
      "m_empty": []},
    "journal": [{"id": "j_s", "ref": "SAMPLE", "sample": true, "lines": [{"account": "1100", "debit": 5, "credit": 0}, {"account": "4000", "debit": 0, "credit": 5}]},
                {"id": "j_1", "ref": "INV-0001", "doc": "r_inv", "lines": [{"account": "1200", "debit": 114, "credit": 0}, {"account": "4000", "debit": 0, "credit": 100}, {"account": "2200", "debit": 0, "credit": 14}]}],
    "stock": [{"id": "s_1", "product": "r_prod", "qty": -1, "cost": 30, "value": -30, "doc": "r_inv", "ref": "INV-0001"}],
    "payments": [{"id": "p_in", "doc": "r_inv", "module": "m_inv", "amount": 10}, {"id": "p_out", "doc": "r_bill", "module": "m_bills", "amount": 7}],
    "notes": [{"id": "n_all", "message": "all"}, {"id": "n_sales", "role": "role_sales", "message": "s"}, {"id": "n_fin", "user": "u_fin", "message": "f"}],
    "activity": [{"id": "a_hr", "module": "m_secret", "record": "r_hr", "text": "hr"}, {"id": "a_inv", "module": "m_inv", "record": "r_inv", "text": "inv"}],
    "comments": [{"id": "c_hr", "record": "r_hr", "text": "secret"}, {"id": "c_inv", "record": "r_inv", "text": "ok"}],
    "approvals": [{"id": "ap_hr", "module": "m_secret", "record": "r_hr", "status": "pending"}]
  }}$j$, '00000000-0000-0000-0000-00000000000a');
insert into public.workspace_members (workspace_id, email, is_admin, is_owner) values
  ('ws_books000001', 'owner@test.dev', true, true), ('ws_books000001', 'sales@test.dev', false, false), ('ws_books000001', 'fin@test.dev', false, false);
-- A workspace whose file is damaged (two records share an id) must stay exactly as it was.
insert into public.workspaces (id, name, doc, created_by) values ('ws_broken00001', 'Broken',
  '{"id":"ws_broken00001","users":[{"id":"u_own","email":"owner@test.dev","roleId":"role_admin"}],"data":{"records":{"m":[{"id":"r_1","module":"m"},{"id":"r_1","module":"m"}]}}}',
  '00000000-0000-0000-0000-00000000000a');
insert into public.workspace_members (workspace_id, email, is_admin, is_owner) values ('ws_broken00001', 'owner@test.dev', true, true);
create temp table original as select doc from public.workspaces where id = 'ws_books000001';
grant select on original to authenticated, service_role;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"sales@test.dev","role":"authenticated"}', false);
create temp table sales as select public.open_workspace('ws_books000001') -> 'doc' as doc;
select pg_temp.check('sales sees the modules their role may view', (select (doc #> '{data,records}') ?& array['m_prod','m_inv'] from sales));
select pg_temp.check('sales does not see a module they can only create in', (select not ((doc #> '{data,records}') ? 'm_secret') from sales));
select pg_temp.check('sales does not receive product cost or stock value', (select not (doc #> '{data,records,m_prod,0,values}' ?| array['cost','stock_value']) and doc #>> '{data,records,m_prod,0,values,price}' = '50' from sales));
select pg_temp.check('sales does not receive the books', (select doc #> '{data,journal}' = '[]' from sales));
select pg_temp.check('sales gets only the lock date of the books, not VAT returns or bank reconciliations', (select doc -> 'books' = '{"lockDate": "2026-01-31"}' from sales));
select pg_temp.check('sales sees stock quantities without their cost', (select doc #> '{data,stock,0}' = '{"id":"s_1","product":"r_prod","qty":-1,"doc":"r_inv","ref":"INV-0001"}' from sales));
select pg_temp.check('sales sees payments of invoices only', (select doc #> '{data,payments}' = '[{"id":"p_in","doc":"r_inv","module":"m_inv","amount":10}]' from sales));
select pg_temp.check('sales gets the notes meant for everyone and for sales', (select array(select x ->> 'id' from jsonb_array_elements(doc #> '{data,notes}') x) = array['n_all','n_sales'] from sales));
select pg_temp.check('activity, comments and approvals of hidden records stay hidden', (select doc #> '{data,activity}' = '[{"id":"a_inv","module":"m_inv","record":"r_inv","text":"inv"}]' and doc #> '{data,comments}' = '[{"id":"c_inv","record":"r_inv","text":"ok"}]' and doc #> '{data,approvals}' = '[]' from sales));
select pg_temp.check('everyone still gets the setup and the team', (select jsonb_array_length(doc -> 'users') = 3 and doc #> '{data,sequences,INV}' = '1' from sales));
select pg_temp.blocked('a member reads the records table directly', $q$select count(*) from public.records$q$);
select pg_temp.blocked('a member reads the journal table directly', $q$select count(*) from public.journal_entries$q$);
select pg_temp.blocked('a member loads the whole workspace like the server', $q$select public.load_workspace('ws_books000001')$q$);
select pg_temp.blocked('a member asks for someone else''s view', $q$select public.workspace_view_for('ws_books000001', 'owner@test.dev')$q$);
select pg_temp.blocked('a member saves rows like the server', $q$select public.save_workspace_changes('ws_books000001', 1, '{}', '{}', null)$q$);
select pg_temp.blocked('a member loads the whole workspace the fast way', $q$select public.load_workspace_fast('ws_books000001')$q$);
select pg_temp.blocked('a member asks for someone else''s view the fast way', $q$select public.workspace_view_fast('ws_books000001', 'owner@test.dev')$q$);
select pg_temp.blocked('a member reads all rows as text', $q$select private.tables_text('ws_books000001')$q$);
select pg_temp.blocked('a member takes a save turn', $q$select public.take_save_turn('ws_books000001', gen_random_uuid())$q$);
select pg_temp.blocked('a member ends someone''s save turn', $q$select public.end_save_turn('ws_books000001', gen_random_uuid())$q$);
select pg_temp.blocked('a member reads the save queue', $q$select count(*) from private.save_turns$q$);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","email":"fin@test.dev","role":"authenticated"}', false);
create temp table fin as select public.open_workspace('ws_books000001') -> 'doc' as doc;
select pg_temp.check('finance gets the books', (select jsonb_array_length(doc #> '{data,journal}') = 2 from fin));
select pg_temp.check('finance gets the VAT returns and bank reconciliations', (select jsonb_array_length(doc #> '{books,vatReturns}') = 1 and jsonb_array_length(doc #> '{books,reconciliations}') = 1 from fin));
select pg_temp.check('finance gets every payment, and only their own personal notes', (select jsonb_array_length(doc #> '{data,payments}') = 2 and array(select x ->> 'id' from jsonb_array_elements(doc #> '{data,notes}') x) = array['n_all','n_fin'] from fin));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
create temp table own as select public.open_workspace('ws_books000001') as r;
select pg_temp.check('an admin gets everything, exactly as it was in the file', (select (r #> '{doc,data}') - 'records' = (o.doc -> 'data') - 'records' and r #> '{doc,data,records}' = (o.doc #> '{data,records}') - 'm_empty' from own, original o));
select pg_temp.blocked('opening a damaged workspace', $q$select public.open_workspace('ws_broken00001')$q$);
reset role;
select pg_temp.check('the damaged workspace was left exactly as it was', (select not data_in_tables and doc #> '{data,records,m}' is not null from public.workspaces where id = 'ws_broken00001'));
select pg_temp.check('the moved workspace''s file keeps only the setup', (select data_in_tables and not (doc -> 'data' ?| array['records','journal','stock','payments','notes','activity','comments','approvals']) from public.workspaces where id = 'ws_books000001'));
select pg_temp.check('the full file was kept as a snapshot before moving', (select count(*) = 1 from public.workspace_versions v, original o where v.workspace_id = 'ws_books000001' and v.doc = o.doc));

set role service_role;
select pg_temp.check('the server loads exactly what was moved', (select (public.load_workspace('ws_books000001') #> '{doc,data,journal}') = (doc #> '{data,journal}') from original));
-- The fast load and view give exactly what the jsonb ones give.
create function pg_temp.joined(j json) returns jsonb language sql as $f$
  select jsonb_set(j::jsonb -> 'doc', '{data}', coalesce(j::jsonb #> '{doc,data}', '{}') || (j::jsonb -> 'tables'))
$f$;
grant execute on function pg_temp.joined(json) to service_role;
select pg_temp.check('the fast load gives the same workspace, version and list places', (
  select a -> 'doc' = pg_temp.joined(b) and a -> 'version' = b::jsonb -> 'version' and a -> 'max_ord' = b::jsonb -> 'max_ord'
    from (select public.load_workspace('ws_books000001') a, public.load_workspace_fast('ws_books000001') b) x));
select pg_temp.check('the fast view gives an admin the same as before', (
  select public.workspace_view_for('ws_books000001', 'owner@test.dev') = pg_temp.joined(public.workspace_view_fast('ws_books000001', 'owner@test.dev'))));
select pg_temp.check('the fast view gives others exactly their own view (hidden records stay hidden)', (
  select bool_and(public.workspace_view_for('ws_books000001', p) = v -> 'view' and not v ? 'tables')
    from unnest(array['sales@test.dev', 'fin@test.dev']) p, lateral (select public.workspace_view_fast('ws_books000001', p)::jsonb v) x));
select pg_temp.check('the fast view gives a stranger nothing', (select public.workspace_view_fast('ws_books000001', 'stranger@test.dev') is null));
-- Save turns: in the order asked; given back, the next one's turn; someone who stopped asking is not waited for.
select pg_temp.check('the first to ask has the turn', (select public.take_save_turn('ws_books000001', '00000000-0000-0000-0000-0000000000a1') = 0));
select pg_temp.check('the second waits behind one person', (select public.take_save_turn('ws_books000001', '00000000-0000-0000-0000-0000000000a2') = 1));
select pg_temp.check('asking again keeps the same place', (select public.take_save_turn('ws_books000001', '00000000-0000-0000-0000-0000000000a2') = 1));
select pg_temp.check('another company has its own queue', (select public.take_save_turn('ws_other000001', '00000000-0000-0000-0000-0000000000a3') = 0));
select public.end_save_turn('ws_books000001', '00000000-0000-0000-0000-0000000000a1');
select pg_temp.check('given back: the next one has the turn', (select public.take_save_turn('ws_books000001', '00000000-0000-0000-0000-0000000000a2') = 0));
reset role;
update private.save_turns set seen = now() - interval '5 seconds' where token = '00000000-0000-0000-0000-0000000000a2';
set role service_role;
select pg_temp.check('someone who stopped asking is not waited for', (select public.take_save_turn('ws_books000001', '00000000-0000-0000-0000-0000000000a4') = 0));
select public.end_save_turn('ws_books000001', '00000000-0000-0000-0000-0000000000a4');
select public.end_save_turn('ws_other000001', '00000000-0000-0000-0000-0000000000a3');
select pg_temp.blocked('the old whole-file save on a moved workspace', $q$select public.save_workspace('ws_books000001', (select version from public.workspaces where id='ws_books000001'), (select doc from original), null)$q$);
create function pg_temp.save(changes jsonb) returns bigint language sql as $f$
  select public.save_workspace_changes('ws_books000001', (select version from public.workspaces where id = 'ws_books000001'),
    (select doc from public.workspaces where id = 'ws_books000001'), changes, '00000000-0000-0000-0000-00000000000d')
$f$;
grant execute on function pg_temp.save(jsonb) to service_role;
select pg_temp.blocked('saving records back into the file', $q$select public.save_workspace_changes('ws_books000001', (select version from public.workspaces where id='ws_books000001'), (select doc from original), '{}', null)$q$);
select pg_temp.allowed('the server saves a new invoice with its journal entry', $q$select pg_temp.save('{"records":{"upsert":[{"id":"r_inv2","ord":100,"data":{"id":"r_inv2","module":"m_inv","number":"INV-0002"}}],"delete":[]},"journal_entries":{"upsert":[{"id":"j_2","ord":101,"data":{"id":"j_2","ref":"INV-0002","lines":[{"account":"1200","debit":10,"credit":0},{"account":"4000","debit":0,"credit":10}]}}],"delete":[]}}')$q$);
select pg_temp.check('the new rows are listed first', (select public.load_workspace('ws_books000001') #>> '{doc,data,records,m_inv,0,id}' = 'r_inv2' and public.load_workspace('ws_books000001') #>> '{doc,data,journal,0,id}' = 'j_2'));
select pg_temp.allowed('saving a journal entry again unchanged is harmless', $q$select pg_temp.save('{"journal_entries":{"upsert":[{"id":"j_2","ord":0,"data":{"id":"j_2","ref":"INV-0002","lines":[{"account":"1200","debit":10,"credit":0},{"account":"4000","debit":0,"credit":10}]}}],"delete":[]}}')$q$);
select pg_temp.blocked('the server changes a posted journal entry', $q$select pg_temp.save('{"journal_entries":{"upsert":[{"id":"j_1","ord":0,"data":{"id":"j_1","ref":"INV-0001","lines":[]}}],"delete":[]}}')$q$);
select pg_temp.blocked('the server deletes a journal entry', $q$select pg_temp.save('{"journal_entries":{"upsert":[],"delete":["j_1"]}}')$q$);
select pg_temp.blocked('the server deletes a stock movement', $q$select pg_temp.save('{"stock_moves":{"upsert":[],"delete":["s_1"]}}')$q$);
select pg_temp.blocked('the server deletes a payment', $q$select pg_temp.save('{"payments":{"upsert":[],"delete":["p_in"]}}')$q$);
select pg_temp.allowed('removing a sample journal entry', $q$select pg_temp.save('{"journal_entries":{"upsert":[],"delete":["j_s"]}}')$q$);
select pg_temp.blocked('a journal entry that does not balance', $q$select pg_temp.save('{"journal_entries":{"upsert":[{"id":"j_bad","ord":102,"data":{"id":"j_bad","ref":"X","lines":[{"account":"1200","debit":10,"credit":0},{"account":"4000","debit":0,"credit":9}]}}],"delete":[]}}')$q$);
select pg_temp.blocked('a journal entry with a negative amount', $q$select pg_temp.save('{"journal_entries":{"upsert":[{"id":"j_neg","ord":102,"data":{"id":"j_neg","ref":"X","lines":[{"account":"1200","debit":-10,"credit":0},{"account":"4000","debit":0,"credit":-10}]}}],"delete":[]}}')$q$);
select pg_temp.blocked('using a document number twice', $q$select pg_temp.save('{"records":{"upsert":[{"id":"r_dup","ord":103,"data":{"id":"r_dup","module":"m_inv","number":"INV-0001"}}],"delete":[]}}')$q$);
select pg_temp.blocked('a row whose id does not match its data', $q$select pg_temp.save('{"records":{"upsert":[{"id":"r_a","ord":104,"data":{"id":"r_b","module":"m_inv"}}],"delete":[]}}')$q$);
select pg_temp.allowed('the server changes and deletes records', $q$select pg_temp.save('{"records":{"upsert":[{"id":"r_prod","ord":0,"data":{"id":"r_prod","module":"m_prod","values":{"name":"Rice","price":55,"cost":30,"stock_value":300}}}],"delete":["r_hr"]}}')$q$);
select pg_temp.check('a save based on an old version changes nothing', (select public.save_workspace_changes('ws_books000001', 1, (select doc from public.workspaces where id='ws_books000001'), '{"records":{"upsert":[],"delete":["r_inv"]}}', null) is null and exists (select 1 from public.records where id = 'r_inv')));
reset role;
select pg_temp.check('earlier versions of changed and deleted records are kept, with who changed them', (select count(*) = 2 and bool_and(changed_by = '00000000-0000-0000-0000-00000000000d') from public.record_history where workspace_id = 'ws_books000001'));
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"sales@test.dev","role":"authenticated"}', false);
select pg_temp.check('a non-admin reads no record history', (select count(*) = 0 from public.record_history));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.check('an admin reads the record history', (select count(*) = 2 from public.record_history));
reset role;
select pg_temp.check('a refused save left no trace', (select not exists (select 1 from public.journal_entries where id in ('j_bad','j_neg')) and exists (select 1 from public.journal_entries where id = 'j_1') and not exists (select 1 from public.records where id = 'r_dup')));
select pg_temp.blocked('even the database owner deletes a posted journal entry', $q$delete from public.journal_entries where id = 'j_1'$q$);

-- Phase 1.2, part 2: formula fields built on cost are hidden like cost itself.
update public.workspaces set doc = jsonb_set(doc, '{published,modules}', '[{"id":"m_prod","fields":[
  {"key":"margin","type":"formula","formula":"price - cost"},
  {"key":"margin_pct","type":"formula","formula":"margin / price * 100"},
  {"key":"markup","type":"formula","formula":"price * 2"},
  {"key":"costly","type":"formula","formula":"price + costs_extra"}]}]') where id = 'ws_books000001';
update public.workspaces set doc = jsonb_set(doc, '{published,roles,2,access,m_prod}', '["view"]') where id = 'ws_books000001';
update public.records set data = jsonb_set(data, '{values}', data -> 'values' || '{"margin":25,"margin_pct":45,"markup":110,"costly":1}') where workspace_id = 'ws_books000001' and id = 'r_prod';
select pg_temp.check('cost formulas are found through other formulas, and only whole names count', (select private.cost_keys(doc) = array['cost','stock_value','margin','margin_pct'] from public.workspaces where id = 'ws_books000001'));
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"sales@test.dev","role":"authenticated"}', false);
select pg_temp.check('sales does not receive a margin built on cost', (select (public.open_workspace('ws_books000001') #> '{doc,data,records,m_prod,0,values}') = '{"name":"Rice","price":55,"markup":110,"costly":1}'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","email":"fin@test.dev","role":"authenticated"}', false);
select pg_temp.check('finance (who may see costs) sees the margin once given the products module', (select (public.open_workspace('ws_books000001') #>> '{doc,data,records,m_prod,0,values,margin}') = '25'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.check('an admin sees the margin', (select (public.open_workspace('ws_books000001') #>> '{doc,data,records,m_prod,0,values,margin}') = '25'));
reset role;

-- Phase 1.3a: invitations.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('a non-member invites people', $q$select public.create_invitation('ws_books000001', 'x@test.dev', true)$q$);
select pg_temp.check('a stranger sees no invitations of other workspaces', (select count(*) = 0 from public.invitations where workspace_id = 'ws_books000001'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"sales@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('a non-admin member invites people', $q$select public.create_invitation('ws_books000001', 'x@test.dev', true)$q$);
select pg_temp.blocked('a member reads the secret hash of invitations', $q$select token_hash from public.invitations$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('inviting someone already in the team', $q$select public.create_invitation('ws_books000001', 'sales@test.dev', false)$q$);
select pg_temp.blocked('inviting something that is not an e-mail', $q$select public.create_invitation('ws_books000001', 'not-an-email', false)$q$);
create temp table inv2 as select public.create_invitation('ws_books000001', 'new@test.dev', false) as token;
create temp table inv3 as select public.create_invitation('ws_books000001', 'new@test.dev', true) as token;
grant select on inv2, inv3 to anon;
select pg_temp.check('a new invitation replaces the open one for the same person', (select count(*) filter (where revoked_at is null) = 1 and count(*) = 2 from public.invitations where email = 'new@test.dev'));
select pg_temp.check('an admin sees the workspace''s invitations', (select count(*) = 2 from public.invitations where workspace_id = 'ws_books000001'));
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.check('the join page can read what a link is for before signing in', (select company is not null and email = 'new@test.dev' and status = 'open' from public.invitation_by_token((select token from inv3))));
select pg_temp.check('a replaced link shows as cancelled', (select status = 'cancelled' from public.invitation_by_token((select token from inv2))));
select pg_temp.check('a wrong link finds nothing', (select count(*) = 0 from public.invitation_by_token('nope')));
select pg_temp.blocked('the public accepts an invitation', $q$select public.respond_invitation((select id from public.invitation_by_token((select token from inv3))), true)$q$);
reset role;
update public.invitations set expires_at = now() - interval '1 minute' where token_hash = encode(sha256(convert_to((select token from inv3), 'UTF8')), 'hex');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","email":"new@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('accepting an expired invitation', $q$select public.respond_invitation((select id from public.invitation_by_token((select token from inv3))), true)$q$);
select pg_temp.check('an expired invitation is not offered', (select count(*) = 0 from public.my_invitations()));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
create temp table inv4 as select public.create_invitation('ws_books000001', 'new@test.dev', false) as token;
select pg_temp.allowed('an admin cancels an invitation', $q$select public.revoke_invitation((select id from public.invitation_by_token((select token from inv4))))$q$);
create temp table inv5 as select public.create_invitation('ws_books000001', 'new@test.dev', false) as token;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","email":"new@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('accepting a cancelled invitation', $q$select public.respond_invitation((select id from public.invitation_by_token((select token from inv4))), true)$q$);
select pg_temp.allowed('declining an invitation', $q$select public.respond_invitation((select id from public.invitation_by_token((select token from inv5))), false)$q$);
select pg_temp.check('declining does not make you a member', (select count(*) = 0 from public.my_workspaces()));
reset role;

-- Joining by link (the join server function): only the server can accept by link, and only an open invitation.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
create temp table inv6 as select public.create_invitation('ws_books000001', 'link@test.dev', false) as token;
grant select on inv6 to service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","email":"link@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('a person accepts by link without the server', $q$select public.accept_invitation_token((select token from inv6))$q$);
reset role;
select set_config('request.jwt.claims', '', false);
set role service_role;
select pg_temp.check('the server can read what a link is for', (select status = 'open' from public.invitation_by_token((select token from inv6))));
select pg_temp.blocked('the server accepts with a wrong link', $q$select public.accept_invitation_token('ffffffffffffffffffffffffffffffff')$q$);
select pg_temp.allowed('the server accepts an open invitation by its link', $q$select public.accept_invitation_token((select token from inv6))$q$);
select pg_temp.blocked('the same link is used twice', $q$select public.accept_invitation_token((select token from inv6))$q$);
reset role;
set role authenticated;
select pg_temp.blocked('a person looks up whether an e-mail has a login', $q$select * from public.login_for_email('owner@test.dev')$q$);
reset role;
set role service_role;
select pg_temp.check('the server sees an unconfirmed login as unconfirmed', (select not confirmed from public.login_for_email('Owner@Test.dev')));
reset role;
select pg_temp.check('joining by link made them a member', (select count(*) = 1 from public.workspace_members where workspace_id = 'ws_books000001' and email = 'link@test.dev' and not is_admin));

-- Phase 1.3b: two-factor login.
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-00000000000a', 'verified');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal1"}', false);
select pg_temp.blocked('someone with two-factor on opens the workspace with only a password', $q$select public.open_workspace('ws_books000001')$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.allowed('the same person after entering their code', $q$select public.open_workspace('ws_books000001')$q$);
select pg_temp.blocked('a person asks the server''s two-factor check about someone else', $q$select public.second_factor_problem_for('ws_books000001', '00000000-0000-0000-0000-00000000000e', 'fin@test.dev', 'aal1')$q$);
reset role;
select set_config('request.jwt.claims', '', false);
update public.workspaces set doc = jsonb_set(doc, '{security}', '{"requireTwoFactor":true}') where id = 'ws_books000001';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","email":"fin@test.dev","role":"authenticated","aal":"aal1"}', false);
select pg_temp.blocked('when the company requires it, finance without two-factor is sent to set it up', $q$select public.open_workspace('ws_books000001')$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"sales@test.dev","role":"authenticated","aal":"aal1"}', false);
select pg_temp.allowed('sales is not required to use two-factor', $q$select public.open_workspace('ws_books000001')$q$);
reset role;
set role service_role;
select pg_temp.check('the server function gets the same answer for each person', (select public.second_factor_problem_for('ws_books000001', '00000000-0000-0000-0000-00000000000e', 'fin@test.dev', 'aal1') like '%requires two-factor%'
  and public.second_factor_problem_for('ws_books000001', '00000000-0000-0000-0000-00000000000d', 'sales@test.dev', 'aal1') is null
  and public.second_factor_problem_for('ws_books000001', '00000000-0000-0000-0000-00000000000a', 'owner@test.dev', 'aal1') like '%6-digit code%'));
reset role;
select set_config('request.jwt.claims', '', false);
update public.workspaces set doc = doc - 'security' where id = 'ws_books000001';
delete from auth.mfa_factors;

-- Phase 1.4a: live updates.
select pg_temp.check('every save is announced on the workspace''s channel, with only the version', (select count(*) > 0 and bool_and(payload ? 'version' and not payload ? 'doc' and private) from realtime.messages where topic = 'ws:ws_books000001' and event = 'saved'));
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"sales@test.dev","role":"authenticated"}', false);
select set_config('realtime.topic', 'ws:ws_books000001', false);
select pg_temp.check('a member hears their workspace''s saves', (select count(*) > 0 from realtime.messages));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.check('a stranger hears nothing', (select count(*) = 0 from realtime.messages));
select pg_temp.blocked('a person sends a fake save announcement', $q$insert into realtime.messages (topic, extension, event, payload) values ('ws:ws_books000001', 'broadcast', 'saved', '{"version":999}')$q$);
select set_config('realtime.topic', '', false);
reset role;

-- Phase 1.4b: the nightly scheduler, its run log, and drafts for admins only.
select set_config('request.jwt.claims', '', false);
update public.workspaces set doc = doc || '{"draft":{"roles":[]},"history":[{"version":1}]}' where id = 'ws_books000001';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"sales@test.dev","role":"authenticated"}', false);
select pg_temp.check('people who aren''t admins don''t receive the setup draft or earlier versions', (select doc -> 'draft' = 'null' and doc -> 'history' = '[]' from (select public.open_workspace('ws_books000001') -> 'doc' as doc) x));
select pg_temp.blocked('a person checks a scheduler key', $q$select public.scheduler_key_ok('x')$q$);
select pg_temp.blocked('a person reads the scheduler key', $q$select key from private.scheduler_key$q$);
select pg_temp.blocked('a person lists the workspaces to run', $q$select public.scheduled_workspaces()$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.check('an admin still receives the draft and the versions', (select doc -> 'draft' <> 'null' and jsonb_array_length(doc -> 'history') = 1 from (select public.open_workspace('ws_books000001') -> 'doc' as doc) x));
reset role;
create temp table skey as select key from private.scheduler_key;
grant select on skey to service_role;
set role service_role;
select pg_temp.check('the scheduler''s key works, a wrong one doesn''t', (select public.scheduler_key_ok((select key from skey)) and not public.scheduler_key_ok('0123456789abcdef0123456789abcdef') and not public.scheduler_key_ok('')));
select pg_temp.check('the scheduler finds the published workspaces and their owner', (select array_agg(w) @> array['ws_books000001'] from public.scheduled_workspaces() w) and public.workspace_owner_email('ws_books000001') = 'owner@test.dev');
select pg_temp.allowed('the scheduler logs a run', $q$insert into public.automation_runs (workspace_id, ok, ran) values ('ws_books000001', true, 2)$q$);
select pg_temp.blocked('the run log is never edited', $q$update public.automation_runs set ran = 0$q$);
reset role;
set role authenticated;
select pg_temp.check('an admin reads the run log', (select count(*) = 1 from public.automation_runs));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"sales@test.dev","role":"authenticated"}', false);
select pg_temp.check('others don''t', (select count(*) = 0 from public.automation_runs));
reset role;

select pg_temp.check('snapshots of earlier versions are kept', (select count(*) >= 1 from public.workspace_versions where workspace_id='ws_test123456'));

-- Phase H5: the history store (past invoices and bills): added by admins and finance, read by side, never directly.
select set_config('request.jwt.claims', '', false);
update public.workspaces set doc = jsonb_set(jsonb_set(doc, '{published,modules}', '[{"id":"m_inv","role":"invoices"},{"id":"m_bill","role":"purchases"}]'), '{security}', '{"requireTwoFactor": false}') where id = 'ws_books000001';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","email":"fin@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.check('finance brings in past invoices, a credit note and a bill', (select public.history_add('ws_books000001', 'imp_h1', 'old.xlsx', '[{"id":"h1","side":"sales","kind":"invoice","number":"INV-1","date":"2025-03-01","party":"r_c1","partyName":"Nile","subtotal":100,"tax":14,"total":114,"lines":[{"sku":"R5","description":"Rice","qty":2,"price":50,"net":100}]},{"id":"h2","side":"sales","kind":"credit","number":"CN-1","date":"2025-03-05","party":"r_c1","subtotal":20,"tax":2.8,"total":22.8,"lines":[{"sku":"R5","description":"Rice","qty":1,"price":20,"net":20}]},{"id":"h3","side":"purchases","kind":"invoice","date":"2025-02-01","party":"r_s1","subtotal":60,"total":60}]') = 3));
select pg_temp.check('sent again, nothing is added twice', (select public.history_add('ws_books000001', 'imp_h1', 'old.xlsx', '[{"id":"h1","side":"sales","kind":"invoice","number":"INV-1","date":"2025-03-01","party":"r_c1","partyName":"Nile","subtotal":100,"tax":14,"total":114,"lines":[{"sku":"R5","description":"Rice","qty":2,"price":50,"net":100}]},{"id":"h2","side":"sales","kind":"credit","number":"CN-1","date":"2025-03-05","party":"r_c1","subtotal":20,"tax":2.8,"total":22.8,"lines":[{"sku":"R5","description":"Rice","qty":1,"price":20,"net":20}]},{"id":"h3","side":"purchases","kind":"invoice","date":"2025-02-01","party":"r_s1","subtotal":60,"total":60}]') = 0));
select pg_temp.blocked('a document with a bad id', $q$select public.history_add('ws_books000001', 'imp_h9', 'x', '[{"id":"../x","side":"sales","kind":"invoice","date":"2025-01-01","party":"r"}]')$q$);
select pg_temp.check('totals by month take credit notes off', (select array_agg(amount) = array[80.00]::numeric[] from public.history_summary('ws_books000001', 'sales', '2025-01-01', '2025-12-31', 'month')));
select pg_temp.check('totals by product count quantities', (select qty = 1 and amount = 80 from public.history_summary('ws_books000001', 'sales', '2025-01-01', '2025-12-31', 'product')));
select pg_temp.check('a customer''s history per year', (select amount = 80 and last_date = '2025-03-01' from public.history_party_stats('ws_books000001', 'r_c1') where side = 'sales'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"sales@test.dev","role":"authenticated"}', false);
select pg_temp.check('a sales person reads a customer''s sales history, newest first', (select array_agg(x ->> 'number') = array['CN-1', 'INV-1'] from public.history_for_party('ws_books000001', 'r_c1') x));
select pg_temp.check('but not purchase history', (select count(*) = 0 from public.history_for_party('ws_books000001', 'r_s1')));
select pg_temp.blocked('a sales person totals purchase history', $q$select * from public.history_summary('ws_books000001', 'purchases', '2025-01-01', '2025-12-31', 'month')$q$);
select pg_temp.blocked('a sales person brings in past documents', $q$select public.history_add('ws_books000001', 'imp_h2', 'x', '[]')$q$);
select pg_temp.blocked('a sales person takes a batch out', $q$select public.history_undo('ws_books000001', 'imp_h1')$q$);
select pg_temp.blocked('a person reads the table directly', $q$select * from public.history_docs$q$);
select pg_temp.blocked('a person writes the table directly', $q$insert into public.history_docs (workspace_id, id, side, kind, date, party, batch, added_by) values ('ws_books000001', 'hx', 'sales', 'invoice', '2025-01-01', 'r', 'imp_x', 'x')$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('someone outside the company reads its history', $q$select * from public.history_for_party('ws_books000001', 'r_c1')$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.check('an admin lists the batches', (select docs = 3 and lines = 2 and file = 'old.xlsx' from public.history_batches('ws_books000001')));
select pg_temp.check('and takes a batch out again', (select public.history_undo('ws_books000001', 'imp_h1') = 3));
reset role;
select pg_temp.check('adding and undoing are in the audit trail', (select count(*) = 3 from public.audit_events where workspace_id = 'ws_books000001' and command like 'history.%'));


-- Billing, as it works once charging is on (the launch period has it off; see the end).
update public.billing_settings set charging = true;
-- Phase 6.1a: billing. A trial for every new company; read-only after it; seats; the Free plan; paid periods.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.allowed('the owner makes a second company', $q$select public.create_workspace('ws_bill00000001','B','{"id":"ws_bill00000001","users":[{"id":"u_o","name":"O","email":"owner@test.dev","roleId":"role_admin"}],"draft":null,"published":{"roles":[{"id":"role_admin","admin":true}],"modules":[]},"data":{}}')$q$);
select pg_temp.check('it starts a 14-day trial with everything', (select b ->> 'state' = 'trial' and (b ->> 'writable')::boolean and (b ->> 'days_left')::int = 14 and b -> 'features' ? 'books' from (select public.billing_status('ws_bill00000001') b) x));
select pg_temp.blocked('a member reads the subscriptions table directly', $q$select * from public.subscriptions$q$);
select pg_temp.blocked('a member changes their own subscription', $q$update public.subscriptions set paid_until = now() + interval '10 years'$q$);
select pg_temp.blocked('a member grants themselves a plan', $q$select public.billing_grant('ws_bill00000001', 'pro', 99, now() + interval '10 years')$q$);
select pg_temp.blocked('a member asks for the server''s billing check', $q$select public.billing_status_for('ws_bill00000001')$q$);
select pg_temp.check('the pricing page reads the plans: Free, CRM, ERP, CRM + ERP, Pro', (select array_agg(id order by sort) = array['free', 'crm', 'erp', 'growth', 'pro'] from public.plans));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('someone outside the company reads its subscription', $q$select public.billing_status('ws_bill00000001')$q$);
reset role;
set role anon;
select pg_temp.check('the plans can be read without signing in', (select count(*) = 5 from public.plans) and (select vat_rate = 14 from public.billing_settings));
reset role;

-- the trial ends
update public.subscriptions set trial_ends_at = now() - interval '1 minute' where workspace_id = 'ws_bill00000001';
set role service_role;
select pg_temp.blocked('a save after the trial ended (read-only)', $q$select public.save_workspace_changes('ws_bill00000001', 1, '{"id":"ws_bill00000001","users":[],"data":{}}', '{}', '00000000-0000-0000-0000-00000000000a')$q$);
select pg_temp.check('the nightly run skips it', (select not ('ws_bill00000001' = any (array(select public.scheduled_workspaces())))));
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.check('the company says why it is read-only', (select b ->> 'state' = 'read_only' and b ->> 'reason' = 'trial_ended' and not (b ->> 'writable')::boolean from (select public.billing_status('ws_bill00000001') b) x));
select pg_temp.blocked('inviting someone while read-only', $q$select public.create_invitation('ws_bill00000001', 'new@test.dev', false)$q$);
select pg_temp.allowed('the owner moves to the Free plan', $q$select public.billing_choose_free('ws_bill00000001')$q$);
select pg_temp.check('Free: writable, 2 people, the CRM only', (select (b ->> 'writable')::boolean and (b ->> 'seat_limit')::int = 2 and b -> 'features' = '["crm"]' from (select public.billing_status('ws_bill00000001') b) x));
select pg_temp.allowed('inviting a second person on Free', $q$select public.create_invitation('ws_bill00000001', 'two@test.dev', false)$q$);
select pg_temp.blocked('inviting a third person on Free', $q$select public.create_invitation('ws_bill00000001', 'three@test.dev', false)$q$);
select pg_temp.blocked('past invoices on the Free plan', $q$select public.history_add('ws_bill00000001', 'imp_b1', 'x', '[]')$q$);
reset role;
insert into public.workspace_members (workspace_id, email) values ('ws_bill00000001', 'two@test.dev');
select pg_temp.blocked('a third member joins on Free (seats are checked by the database)', $q$insert into public.workspace_members (workspace_id, email) values ('ws_bill00000001', 'three@test.dev')$q$);
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"two@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('someone who isn''t the owner changes the plan', $q$select public.billing_choose_free('ws_bill00000001')$q$);
reset role;

-- a paid plan, set by Nasq360's staff (payment server or SQL editor)
set role service_role;
select pg_temp.allowed('Growth for 3 seats, paid for a month', $q$select public.billing_grant('ws_bill00000001', 'growth', 3, now() + interval '30 days', 'bank transfer')$q$);
reset role;
insert into public.workspace_members (workspace_id, email) values ('ws_bill00000001', 'three@test.dev');
select pg_temp.blocked('a fourth member on 3 seats', $q$insert into public.workspace_members (workspace_id, email) values ('ws_bill00000001', 'four@test.dev')$q$);
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.check('paid: active, the books included', (select b ->> 'state' = 'active' and b -> 'features' ? 'books' and (b ->> 'seat_limit')::int = 3 from (select public.billing_status('ws_bill00000001') b) x));
select pg_temp.blocked('moving to Free while the paid period runs', $q$select public.billing_choose_free('ws_bill00000001')$q$);
reset role;
update public.subscriptions set paid_until = now() - interval '2 days' where workspace_id = 'ws_bill00000001';
select pg_temp.check('a few days after the paid period: still writable, past due', (select b ->> 'state' = 'past_due' and (b ->> 'writable')::boolean from (select private.billing_state('ws_bill00000001') b) x));
update public.subscriptions set paid_until = now() - interval '8 days' where workspace_id = 'ws_bill00000001';
select pg_temp.check('after the grace days: read-only, unpaid', (select b ->> 'state' = 'read_only' and b ->> 'reason' = 'unpaid' from (select private.billing_state('ws_bill00000001') b) x));
select pg_temp.check('and nothing was deleted', (select count(*) = 3 from public.workspace_members where workspace_id = 'ws_bill00000001') and exists (select 1 from public.workspaces where id = 'ws_bill00000001'));


-- Phase 6.1b: paying online. The server works out the amount; only a settled notice extends the subscription, once.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.blocked('a member prepares a payment from the browser', $q$select public.billing_prepare_payment('ws_bill00000001', 'growth', 'month', 3, 'owner@test.dev')$q$);
select pg_temp.blocked('a member marks a payment paid', $q$select public.billing_payment_settle('bp_0123456789', true, 't', 'o')$q$);
select pg_temp.blocked('a member reads the payments table directly', $q$select * from public.billing_payments$q$);
reset role;
set role service_role;
select pg_temp.blocked('someone who isn''t an admin pays', $q$select public.billing_prepare_payment('ws_bill00000001', 'growth', 'month', 3, 'two@test.dev')$q$);
select pg_temp.blocked('fewer seats than the team', $q$select public.billing_prepare_payment('ws_bill00000001', 'growth', 'month', 2, 'owner@test.dev')$q$);
select pg_temp.blocked('paying for the Free plan', $q$select public.billing_prepare_payment('ws_bill00000001', 'free', 'month', 3, 'owner@test.dev')$q$);
create temp table p1 as select public.billing_prepare_payment('ws_bill00000001', 'growth', 'month', 3, 'Owner@Test.dev') as j;
select pg_temp.check('Growth, 3 people, a month: EGP 1,368 with VAT, worked out by the server', (select j ->> 'kind' = 'period' and (j ->> 'amount_cents')::int = 136800 from p1));
select public.billing_payment_set_order((select j ->> 'id' from p1), '217503754');
select pg_temp.check('the notice finds the payment by Paymob''s order', (select public.billing_payment_find(null, '217503754') ->> 'id' = (select j ->> 'id' from p1)));
select pg_temp.check('Paymob''s notice settles it', (select public.billing_payment_settle((select j ->> 'id' from p1), true, 'tx1', '217503754') = 'paid'));
select pg_temp.check('paid: the company is active for a month', (select b ->> 'state' = 'active' and (b ->> 'seat_limit')::int = 3 from (select public.billing_status_for('ws_bill00000001') b) x)
  and (select paid_until between now() + interval '27 days' and now() + interval '32 days' from public.subscriptions where workspace_id = 'ws_bill00000001'));
select pg_temp.check('the same notice again changes nothing', (select public.billing_payment_settle((select j ->> 'id' from p1), true, 'tx1', '217503754') = 'already paid'));
select pg_temp.check('and the period isn''t extended twice', (select paid_until < now() + interval '32 days' from public.subscriptions where workspace_id = 'ws_bill00000001'));
create temp table p2 as select public.billing_prepare_payment('ws_bill00000001', 'growth', 'month', 5, 'owner@test.dev') as j;
select pg_temp.check('2 more seats during the month cost only the days left', (select j ->> 'kind' = 'seats' and (j ->> 'amount_cents')::int between 1000 and 91200 from p2));
create temp table until_before as select paid_until from public.subscriptions where workspace_id = 'ws_bill00000001';
select pg_temp.check('the seats payment settles', (select public.billing_payment_settle((select j ->> 'id' from p2), true, 'tx2', null) = 'paid'));
select pg_temp.check('the seats are added, the period stays', (select seats = 5 and paid_until = (select paid_until from until_before) from public.subscriptions where workspace_id = 'ws_bill00000001'));
select pg_temp.blocked('a cheaper plan while the month runs (CRM + ERP to CRM)', $q$select public.billing_prepare_payment('ws_bill00000001', 'crm', 'month', 5, 'owner@test.dev')$q$);
select pg_temp.blocked('another period while the month runs', $q$select public.billing_prepare_payment('ws_bill00000001', 'growth', 'year', 5, 'owner@test.dev')$q$);
create temp table p3 as select public.billing_prepare_payment('ws_bill00000001', 'growth', 'month', 5, 'owner@test.dev') as j;
select pg_temp.check('a renewal of the same plan', (select j ->> 'kind' = 'period' and (j ->> 'amount_cents')::int = 228000 from p3));
select pg_temp.check('a declined payment is recorded', (select public.billing_payment_settle((select j ->> 'id' from p3), false, 'tx3', null, 'declined') = 'failed'));
select pg_temp.check('and changes nothing', (select seats = 5 and paid_until = (select paid_until from until_before) from public.subscriptions where workspace_id = 'ws_bill00000001'));
create temp table p4 as select public.billing_prepare_payment('ws_bill00000001', 'pro', 'month', 5, 'owner@test.dev') as j;
select pg_temp.check('a dearer plan now: only the difference for the days left', (select j ->> 'kind' = 'upgrade' and (j ->> 'amount_cents')::int between 1000 and 142500 from p4));
select pg_temp.check('the upgrade settles', (select public.billing_payment_settle((select j ->> 'id' from p4), true, 'tx4', null) = 'paid'));
select pg_temp.check('Pro from now, the same period end', (select plan = 'pro' and seats = 5 and paid_until = (select paid_until from until_before) from public.subscriptions where workspace_id = 'ws_bill00000001'));
grant select on p1 to authenticated;
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.check('an admin sees the payments, newest first', (select array_agg(status order by created_at desc) = array['paid', 'failed', 'paid', 'paid'] from public.billing_payments_list('ws_bill00000001')));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"two@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('a member who isn''t an admin sees the payments', $q$select * from public.billing_payments_list('ws_bill00000001')$q$);
reset role;
select pg_temp.check('the payment is in the audit trail', (select count(*) = 3 from public.audit_events where workspace_id = 'ws_bill00000001' and command = 'billing.paid'));


-- Deleting a login and deleting a company.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f2', 'two@test.dev');
insert into public.records (workspace_id, id, ord, data) values ('ws_bill00000001', 'r_del1', 1, '{"id":"r_del1","module":"m_acc","values":{"name":"Gone Co"}}');
insert into public.journal_entries (workspace_id, id, ord, data) values ('ws_bill00000001', 'j_del1', 1, '{"id":"j_del1","ref":"X","lines":[{"account":"1200","debit":5,"credit":0},{"account":"4000","debit":0,"credit":5}]}');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","email":"two@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('deleting a login without typing the e-mail', $q$select public.delete_my_account('someone@else.dev')$q$);
select pg_temp.blocked('someone who isn''t the owner deletes the company', $q$select public.request_company_deletion('ws_bill00000001', 'B')$q$);
select pg_temp.allowed('a member deletes their own login', $q$select public.delete_my_account('Two@Test.dev')$q$);
reset role;
select pg_temp.check('they left the company and the login is gone', (select count(*) = 0 from public.workspace_members where email = 'two@test.dev') and not exists (select 1 from auth.users where email = 'two@test.dev'));
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.blocked('an owner deletes their login while they still own a company', $q$select public.delete_my_account('owner@test.dev')$q$);
select pg_temp.blocked('deleting the company without typing its name', $q$select public.request_company_deletion('ws_bill00000001', 'not it')$q$);
select pg_temp.allowed('the owner asks to delete the company', $q$select public.request_company_deletion('ws_bill00000001', ' b ')$q$);
select pg_temp.check('it is read-only for 30 days, and says why', (select b ->> 'state' = 'read_only' and b ->> 'reason' = 'deleting' and (b ->> 'days_left')::int = 30 from (select public.billing_status('ws_bill00000001') b) x));
select pg_temp.blocked('inviting someone while it waits to be deleted', $q$select public.create_invitation('ws_bill00000001', 'new@test.dev', false)$q$);
select pg_temp.allowed('the owner restores it', $q$select public.cancel_company_deletion('ws_bill00000001')$q$);
select pg_temp.check('restored: no longer waiting to be deleted', (select b ->> 'reason' is distinct from 'deleting' from (select public.billing_status('ws_bill00000001') b) x));
select pg_temp.allowed('the owner asks again', $q$select public.request_company_deletion('ws_bill00000001', 'B')$q$);
select pg_temp.blocked('a member runs the erasing', $q$select public.purge_deleted_companies()$q$);
reset role;
set role service_role;
select pg_temp.check('nothing is erased before the 30 days', (select public.purge_deleted_companies() = 0) and exists (select 1 from public.workspaces where id = 'ws_bill00000001'));
reset role;
update public.workspace_deletions set delete_after = now() - interval '1 minute' where workspace_id = 'ws_bill00000001';
select pg_temp.blocked('the journal can''t be deleted outside the erasing', $q$delete from public.journal_entries where id = 'j_del1'$q$);
set role service_role;
select pg_temp.check('after 30 days the nightly run erases it', (select public.purge_deleted_companies() = 1));
reset role;
select pg_temp.check('the company, its people, records, books and audit trail are gone', not exists (select 1 from public.workspaces where id = 'ws_bill00000001')
  and not exists (select 1 from public.workspace_members where workspace_id = 'ws_bill00000001')
  and not exists (select 1 from public.records where workspace_id = 'ws_bill00000001')
  and not exists (select 1 from public.journal_entries where workspace_id = 'ws_bill00000001')
  and not exists (select 1 from public.audit_events where workspace_id = 'ws_bill00000001')
  and not exists (select 1 from public.subscriptions where workspace_id = 'ws_bill00000001'));
select pg_temp.check('Nasq360 keeps its own record of what the company paid', (select count(*) > 0 from public.billing_payments where workspace_id = 'ws_bill00000001'));
select pg_temp.check('other companies are untouched', exists (select 1 from public.workspaces where id = 'ws_books000001') and (select count(*) > 0 from public.audit_events where workspace_id = 'ws_books000001'));
select pg_temp.blocked('the audit trail is still append-only afterwards', $q$delete from public.audit_events where workspace_id = 'ws_books000001'$q$);


-- Inventor mode: Nasq360's own team makes as many companies as it likes and tries any billing state.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'inventor@test.dev');
insert into private.platform_staff (email) values ('inventor@test.dev');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated","aal":"aal2"}', false);
select pg_temp.check('someone else isn''t an inventor', not public.am_i_staff());
select pg_temp.blocked('someone else makes themselves an inventor', $q$insert into private.platform_staff (email) values ('owner@test.dev')$q$);
select pg_temp.blocked('someone else uses the test states', $q$select public.staff_set_billing('ws_books000001', 'internal')$q$);
select pg_temp.blocked('someone else erases a company at once', $q$select public.staff_erase_company('ws_books000001', 'Books')$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9","email":"inventor@test.dev","role":"authenticated"}', false);
select pg_temp.check('the inventor is one', public.am_i_staff());
do $$ begin for i in 1..7 loop perform public.create_workspace('ws_inv0000000' || i, 'Test ' || i, jsonb_build_object('id', 'ws_inv0000000' || i, 'users', '[]'::jsonb, 'draft', null, 'data', '{}'::jsonb)); end loop; end $$;
select pg_temp.check('the inventor makes 7 companies (more than the 5 others may own)', (select count(*) = 7 from public.my_workspaces() where id like 'ws_inv%'));
select pg_temp.check('they start unlocked: everything, 200 people', (select b ->> 'state' = 'active' and b ->> 'plan' = 'pro' and (b ->> 'seat_limit')::int = 200 from (select public.billing_status('ws_inv00000001') b) x));
select pg_temp.check('test state: trial ended (read-only)', (select b ->> 'state' = 'read_only' and b ->> 'reason' = 'trial_ended' from (select public.staff_set_billing('ws_inv00000001', 'trial_ended') b) x));
select pg_temp.check('test state: the CRM plan', (select b ->> 'state' = 'active' and b -> 'features' = '["crm"]' from (select public.staff_set_billing('ws_inv00000001', 'crm') b) x));
select pg_temp.check('test state: unpaid', (select b ->> 'reason' = 'unpaid' from (select public.staff_set_billing('ws_inv00000001', 'unpaid') b) x));
select pg_temp.check('back to unlocked', (select (b ->> 'writable')::boolean and (b ->> 'seat_limit')::int = 200 from (select public.staff_set_billing('ws_inv00000001', 'internal') b) x));
select pg_temp.blocked('an unknown test state', $q$select public.staff_set_billing('ws_inv00000001', 'gold')$q$);
select pg_temp.blocked('test states on a company they aren''t in', $q$select public.staff_set_billing('ws_books000001', 'internal')$q$);
select pg_temp.blocked('erasing without typing the name', $q$select public.staff_erase_company('ws_inv00000002', 'nope')$q$);
select pg_temp.allowed('the inventor erases a test company at once', $q$select public.staff_erase_company('ws_inv00000002', 'test 2')$q$);
reset role;
select pg_temp.check('it is gone, the others stay', not exists (select 1 from public.workspaces where id = 'ws_inv00000002') and (select count(*) = 6 from public.workspaces where id like 'ws_inv%'));

-- API keys and webhooks: only admins manage them, the key's secret is never stored, and only the server can use them.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.allowed('an admin makes an API key (only its hash is sent)', $q$select public.api_key_create('ws_test123456', 'key_shop00001', 'Web shop', 'write', repeat('ab', 32), 'nq_live_Ab12')$q$);
select pg_temp.check('the key list shows its name and start, never the hash', (select l -> 0 ->> 'name' = 'Web shop' and l -> 0 ->> 'prefix' = 'nq_live_Ab12' and not (l -> 0) ? 'hash' from (select public.api_keys_list('ws_test123456') l) x));
select pg_temp.blocked('a key with a bad hash', $q$select public.api_key_create('ws_test123456', 'key_shop00002', 'Bad', 'read', 'not-a-hash', 'nq_live_Ab12')$q$);
select pg_temp.blocked('reading the key table directly', $q$select hash from public.api_keys$q$);
select pg_temp.blocked('using a key from the app (server only)', $q$select public.api_key_use(repeat('ab', 32))$q$);
select pg_temp.blocked('a webhook to a plain http address', $q$select public.webhook_save('ws_test123456', 'wh_shop00001', 'http://example.com/hook', array['invoice.posted'], 'whsec_' || repeat('a', 32), true)$q$);
select pg_temp.allowed('an admin adds an https webhook', $q$select public.webhook_save('ws_test123456', 'wh_shop00001', 'https://example.com/hook', array['invoice.posted'], 'whsec_' || repeat('a', 32), true)$q$);
select pg_temp.check('the webhook list shows only the end of the secret', (select l -> 0 ->> 'secret_hint' = 'aaaa' and not (l -> 0) ? 'secret' from (select public.webhooks_list('ws_test123456') l) x));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('a stranger lists the API keys', $q$select public.api_keys_list('ws_test123456')$q$);
select pg_temp.blocked('a stranger makes an API key', $q$select public.api_key_create('ws_test123456', 'key_evil00001', 'Evil', 'write', repeat('cd', 32), 'nq_live_Ev12')$q$);
select pg_temp.blocked('a stranger reads the webhooks', $q$select public.webhooks_list('ws_test123456')$q$);
select pg_temp.blocked('a stranger revokes a key', $q$select public.api_key_revoke('ws_test123456', 'key_shop00001')$q$);
reset role;
set role service_role;
select pg_temp.check('the server finds the key by its hash and counts the call', (select k ->> 'workspace' = 'ws_test123456' and k ->> 'email' = 'owner@test.dev' and (k ->> 'calls')::int = 1 from (select public.api_key_use(repeat('ab', 32)) k) x));
select pg_temp.check('an unknown hash finds nothing', public.api_key_use(repeat('ef', 32)) is null);
select pg_temp.check('deliveries are queued and marked', (select (public.webhook_enqueue('[{"webhook":"wh_shop00001","workspace":"ws_test123456","event":"invoice.posted","payload":{"id":"e1"}}]') -> 0 ->> 'webhook') = 'wh_shop00001'));
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.allowed('the admin revokes the key', $q$select public.api_key_revoke('ws_test123456', 'key_shop00001')$q$);
reset role;
set role service_role;
select pg_temp.check('a revoked key no longer works', public.api_key_use(repeat('ab', 32)) is null);
reset role;

-- WhatsApp: only admins connect it, its token never comes back, and only the inbox's people read messages.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.allowed('an admin connects WhatsApp', $q$select public.whatsapp_connect('ws_test123456', '123456789012', '+20 100 000 0000', repeat('t', 40), repeat('ab', 16))$q$);
select pg_temp.check('the status never shows the access token or app secret', (select not (s ? 'access_token') and not (s ? 'token') and not (s ? 'app_secret') and (s ->> 'connected')::boolean and s ? 'verify_token' from (select public.whatsapp_status('ws_test123456') s) x));
select pg_temp.blocked('reading the WhatsApp accounts directly', $q$select access_token from public.whatsapp_accounts$q$);
select pg_temp.blocked('reading messages directly', $q$select body from public.whatsapp_messages$q$);
select pg_temp.blocked('getting the token from the app (server only)', $q$select public.whatsapp_account_for('ws_test123456')$q$);
reset role;
set role service_role;
select pg_temp.allowed('the server stores a customer''s message', $q$select public.whatsapp_store('[{"workspace":"ws_test123456","waId":"201001234567","name":"Ahmed","direction":"in","kind":"text","body":"Hello","waMessageId":"wamid.1","status":"received"}]')$q$);
select pg_temp.allowed('the same message stored twice is kept once', $q$select public.whatsapp_store('[{"workspace":"ws_test123456","waId":"201001234567","direction":"in","kind":"text","body":"Hello","waMessageId":"wamid.1","status":"received"}]')$q$);
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.check('the admin sees the conversation, unread', (select t -> 0 ->> 'wa_id' = '201001234567' and (t -> 0 ->> 'unread')::int = 1 and t -> 0 ->> 'name' = 'Ahmed' from (select public.whatsapp_threads('ws_test123456') t) x));
select pg_temp.check('the conversation opens', jsonb_array_length(public.whatsapp_thread('ws_test123456', '201001234567')) = 1);
select pg_temp.check('opening it read it', public.whatsapp_unread('ws_test123456') = 0);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.blocked('a stranger reads the inbox', $q$select public.whatsapp_threads('ws_test123456')$q$);
select pg_temp.blocked('a stranger connects their own number', $q$select public.whatsapp_connect('ws_test123456', '999999999999', '+1 555', repeat('x', 40), repeat('cd', 16))$q$);
select pg_temp.check('a stranger counts no unread messages', public.whatsapp_unread('ws_test123456') = 0);
reset role;

-- Customising the system: closed once live, asked for by an admin, opened only by Nasq360's own team, for a time.
insert into private.platform_staff (email) values ('inventor@test.dev') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.check('customising is closed for a company''s admin', not (public.builder_status('ws_test123456') ->> 'open')::boolean);
select pg_temp.blocked('an empty request is refused', $q$select public.builder_request('ws_test123456', 'x')$q$);
select pg_temp.allowed('the admin asks for it, saying why', $q$select public.builder_request('ws_test123456', 'Add a field for the car plate on deliveries')$q$);
select pg_temp.check('the request is open', public.builder_status('ws_test123456') -> 'request' ->> 'status' = 'open');
select pg_temp.blocked('the admin opens it themselves', $q$select public.staff_builder_grant('ws_test123456', 30, 'self')$q$);
select pg_temp.blocked('the admin reads every company''s requests', $q$select public.staff_builder_requests()$q$);
select pg_temp.blocked('the admin writes the access table directly', $q$insert into public.builder_access (workspace_id, granted_by) values ('ws_test123456', 'owner@test.dev')$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"inventor@test.dev","role":"authenticated"}', false);
select pg_temp.check('an inventor sees the request', (select r -> 0 ->> 'workspace_id' = 'ws_test123456' and r -> 0 ->> 'company' is not null and r -> 0 ->> 'status' = 'open' from (select public.staff_builder_requests() r) x));
select pg_temp.allowed('an inventor opens it for 14 days', $q$select public.staff_builder_grant('ws_test123456', 14, 'For the delivery fields')$q$);
select pg_temp.blocked('more than a year is refused', $q$select public.staff_builder_grant('ws_test123456', 400, '')$q$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.check('the admin now has it, until a date, with the request approved', (select (s ->> 'open')::boolean and s ->> 'until' is not null and s -> 'request' ->> 'status' = 'approved' from (select public.builder_status('ws_test123456') s) x));
reset role;
select pg_temp.check('the server sees it open', public.builder_open_for('ws_test123456', 'owner@test.dev'));
update public.builder_access set until = now() - interval '1 minute' where workspace_id = 'ws_test123456';
select pg_temp.check('once the time is up it is closed again', not public.builder_open_for('ws_test123456', 'owner@test.dev'));
select pg_temp.check('an inventor is never closed out', public.builder_open_for('ws_test123456', 'inventor@test.dev'));
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"inventor@test.dev","role":"authenticated"}', false);
select pg_temp.allowed('an inventor opens it until taken back, then takes it back', $q$select public.staff_builder_grant('ws_test123456', null, ''), public.staff_builder_revoke('ws_test123456')$q$);
reset role;
select pg_temp.check('taken back: closed', not public.builder_open_for('ws_test123456', 'owner@test.dev'));
set role authenticated;
select pg_temp.blocked('the server''s check isn''t for the app', $q$select public.builder_open_for('ws_test123456', 'owner@test.dev')$q$);
reset role;

-- Product photos: in Storage, under the company's folder, small WebP or JPEG only; only the company's people.
select pg_temp.check('the photos bucket is private and takes only small pictures', (select not public and file_size_limit <= 307200 and allowed_mime_types = array['image/webp', 'image/jpeg'] from storage.buckets where id = 'product-images'));
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"owner@test.dev","role":"authenticated"}', false);
select pg_temp.allowed('a member adds a photo under the company''s folder', $q$insert into storage.objects (bucket_id, name) values ('product-images', 'ws_test123456/p_1-abc.webp')$q$);
select pg_temp.blocked('a member adds a photo under another company''s folder', $q$insert into storage.objects (bucket_id, name) values ('product-images', 'ws_other00001/p_1-abc.webp')$q$);
select pg_temp.blocked('a file that isn''t a picture', $q$insert into storage.objects (bucket_id, name) values ('product-images', 'ws_test123456/p_1-abc.exe')$q$);
select pg_temp.blocked('a path that climbs out of the folder', $q$insert into storage.objects (bucket_id, name) values ('product-images', 'ws_test123456/../ws_other00001/x.webp')$q$);
select pg_temp.check('the member sees the company''s photo', (select count(*) = 1 from storage.objects where bucket_id = 'product-images'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"stranger@test.dev","role":"authenticated"}', false);
select pg_temp.check('a stranger sees none of them', (select count(*) = 0 from storage.objects where bucket_id = 'product-images'));
select pg_temp.blocked('a stranger adds one to the company''s folder', $q$insert into storage.objects (bucket_id, name) values ('product-images', 'ws_test123456/p_2-abc.webp')$q$);
delete from storage.objects where bucket_id = 'product-images';
reset role;
select pg_temp.check('a stranger can''t remove one', (select count(*) = 1 from storage.objects where bucket_id = 'product-images'));
set role anon;
select pg_temp.check('nobody signed out sees them', (select count(*) = 0 from storage.objects where bucket_id = 'product-images'));
reset role;

-- The launch period: charging off. Nothing locks: a company whose trial ended can save, invite and grow; it has
-- everything; a company being deleted still can't be changed.
update public.billing_settings set charging = false;
update public.subscriptions set status = 'trial', trial_ends_at = now() - interval '1 day', paid_until = null where workspace_id = 'ws_test123456';
select pg_temp.check('launch: a company past its trial has everything and can be changed', (select b ->> 'state' = 'launch' and (b ->> 'writable')::boolean and b -> 'features' ? 'books' and (b ->> 'seat_limit')::int >= 1000 from (select private.billing_state('ws_test123456') b) x));
select pg_temp.allowed('launch: a new member joins with no seat limit', $q$insert into public.workspace_members (workspace_id, email) values ('ws_test123456', 'launch-member@test.dev')$q$);
select pg_temp.check('launch: a company being deleted is still read-only', (select b ->> 'state' = 'read_only' and b ->> 'reason' = 'deleting' from (select private.billing_state(w.workspace_id) b from public.workspace_deletions w limit 1) x) or not exists (select 1 from public.workspace_deletions));

-- The product is Nasq360: no message from the database says the old name.
select pg_temp.check('no database message names the old product name', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc like '%Bonyan%'));
select pg_temp.check('the update message says Nasq360', exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc like '%Nasq360 was updated%'));

select 'ALL DATABASE PERMISSION TESTS PASSED' as result;
