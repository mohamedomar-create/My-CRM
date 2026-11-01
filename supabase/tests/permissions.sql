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
select 'ALL DATABASE PERMISSION TESTS PASSED' as result;
