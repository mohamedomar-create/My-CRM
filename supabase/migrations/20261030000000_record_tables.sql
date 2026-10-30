-- Phase 1.2: records and books get their own tables, and the server decides what each person may read.
-- * One row per record, journal entry, stock movement, payment, approval, comment, note and activity line, instead of
--   one big company file. The company file (workspaces.doc) keeps only the setup, the team and the counters.
-- * Journal, stock and payment rows can only be added (sample rows may be removed). A journal entry must balance.
-- * Every change to a record keeps the previous version in record_history (90 days).
-- * Each workspace moves to the tables the first time it is opened after this update (move_workspace_data), and the
--   move is checked: if the tables don't hold exactly what the file held, nothing moves.
-- * People read through open_workspace(), which leaves out the modules their role can't view, and costs, stock values
--   and the books unless their role may see them. Nobody reads the tables directly.

alter table public.workspaces add column data_in_tables boolean not null default false;

-- The same shape for every kind of row: the item as the app knows it (data), and its place in the list (ord, newest
-- first). The app's id is unique within the workspace.
do $$
declare
  t text;
begin
  foreach t in array array['records', 'journal_entries', 'stock_moves', 'payments', 'approvals', 'comments', 'notes', 'activity'] loop
    execute format($f$
      create table public.%1$I (
        workspace_id text not null references public.workspaces (id) on delete restrict,
        id text not null check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
        ord bigint not null,
        data jsonb not null check (jsonb_typeof(data) = 'object' and data ->> 'id' = id),
        sample boolean generated always as (coalesce((data ->> 'sample')::boolean, false)) stored,
        updated_at timestamptz not null default now(),
        primary key (workspace_id, id)
      );
      create index %1$s_ord_idx on public.%1$I (workspace_id, ord desc);
      alter table public.%1$I enable row level security;
      revoke all on public.%1$I from anon, authenticated;
    $f$, t);
  end loop;
end
$$;

alter table public.records add column module text generated always as (data ->> 'module') stored not null;
alter table public.records add column number text generated always as (data ->> 'number') stored;
create index records_module_idx on public.records (workspace_id, module, ord desc);
-- A document number is used once per module (SECU-14).
create unique index records_number_unique on public.records (workspace_id, module, number) where number is not null;

alter table public.journal_entries add column doc text generated always as (data ->> 'doc') stored;
alter table public.stock_moves add column doc text generated always as (data ->> 'doc') stored;
alter table public.stock_moves add column product text generated always as (data ->> 'product') stored;
alter table public.payments add column doc text generated always as (data ->> 'doc') stored;
alter table public.payments add column module text generated always as (data ->> 'module') stored;
create index journal_entries_doc_idx on public.journal_entries (workspace_id, doc);
create index stock_moves_product_idx on public.stock_moves (workspace_id, product);
create index payments_doc_idx on public.payments (workspace_id, doc);
alter table public.approvals add column record text generated always as (data ->> 'record') stored;
alter table public.comments add column record text generated always as (data ->> 'record') stored;
alter table public.activity add column record text generated always as (data ->> 'record') stored;
create index comments_record_idx on public.comments (workspace_id, record);
create index activity_record_idx on public.activity (workspace_id, record);

-- Ledgers: rows are only ever added. Sample rows may be removed; a database administrator can switch on maintenance.
create function private.ledger_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('bonyan.maintenance', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' and old.sample then return old; end if;
  raise exception 'Posted journal, stock and payment lines can''t be changed or deleted. Void the document instead.' using errcode = '42501';
end
$$;
create trigger journal_entries_append_only before update or delete on public.journal_entries for each row execute function private.ledger_append_only();
create trigger stock_moves_append_only before update or delete on public.stock_moves for each row execute function private.ledger_append_only();
create trigger payments_append_only before update or delete on public.payments for each row execute function private.ledger_append_only();

-- Every journal entry balances: total debits = total credits, no negative amounts.
create function private.journal_balances() returns trigger
language plpgsql set search_path = '' as $$
declare
  dr numeric;
  cr numeric;
  neg boolean;
begin
  if jsonb_typeof(new.data -> 'lines') is distinct from 'array' then
    raise exception 'Journal entry % has no lines', new.data ->> 'ref' using errcode = '22023';
  end if;
  select coalesce(sum((l ->> 'debit')::numeric), 0), coalesce(sum((l ->> 'credit')::numeric), 0),
         coalesce(bool_or((l ->> 'debit')::numeric < 0 or (l ->> 'credit')::numeric < 0), false)
    into dr, cr, neg
    from jsonb_array_elements(new.data -> 'lines') l;
  if neg then
    raise exception 'Journal entry % has a negative amount', new.data ->> 'ref' using errcode = '22023';
  end if;
  if round(dr, 2) <> round(cr, 2) then
    raise exception 'Journal entry % does not balance (% vs %)', new.data ->> 'ref', dr, cr using errcode = '22023';
  end if;
  return new;
end
$$;
create trigger journal_entries_balance before insert on public.journal_entries for each row execute function private.journal_balances();

-- The previous version of every changed or deleted record, kept 90 days.
create table public.record_history (
  id bigint generated always as identity primary key,
  workspace_id text not null references public.workspaces (id) on delete restrict,
  record_id text not null,
  op text not null,
  data jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index record_history_record_idx on public.record_history (workspace_id, record_id, changed_at desc);
alter table public.record_history enable row level security;
revoke all on public.record_history from anon, authenticated;
create policy "admins read record history" on public.record_history
  for select to authenticated using (private.is_ws_admin(workspace_id));
grant select on public.record_history to authenticated;

create function private.keep_record_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.data = old.data then return new; end if;
  insert into public.record_history (workspace_id, record_id, op, data, changed_by)
  values (old.workspace_id, old.id, lower(tg_op), old.data, nullif(current_setting('bonyan.actor', true), '')::uuid);
  return coalesce(new, old);
end
$$;
create trigger records_history after update or delete on public.records for each row execute function private.keep_record_history();

/* ---------------- moving a workspace from its file into the tables ---------------- */

-- Collections of the company file and the table each one lives in.
create function private.collections() returns table (key text, tbl text)
language sql immutable set search_path = '' as $$
  values ('journal', 'journal_entries'), ('stock', 'stock_moves'), ('payments', 'payments'), ('approvals', 'approvals'),
         ('comments', 'comments'), ('notes', 'notes'), ('activity', 'activity')
$$;

-- Everything in the tables for one workspace, in the shape of the file's "data" part (no filtering).
create function private.table_data(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'records', coalesce((select jsonb_object_agg(module, recs) from (
        select module, jsonb_agg(data order by ord desc) recs from public.records where workspace_id = p_id group by module) m), '{}'),
    'journal', coalesce((select jsonb_agg(data order by ord desc) from public.journal_entries where workspace_id = p_id), '[]'),
    'stock', coalesce((select jsonb_agg(data order by ord desc) from public.stock_moves where workspace_id = p_id), '[]'),
    'payments', coalesce((select jsonb_agg(data order by ord desc) from public.payments where workspace_id = p_id), '[]'),
    'approvals', coalesce((select jsonb_agg(data order by ord desc) from public.approvals where workspace_id = p_id), '[]'),
    'comments', coalesce((select jsonb_agg(data order by ord desc) from public.comments where workspace_id = p_id), '[]'),
    'notes', coalesce((select jsonb_agg(data order by ord desc) from public.notes where workspace_id = p_id), '[]'),
    'activity', coalesce((select jsonb_agg(data order by ord desc) from public.activity where workspace_id = p_id), '[]'))
$$;

-- Moves one workspace's records and books out of its file, once. The full file is kept as a snapshot first, and the
-- move is checked item by item; if anything differs the whole move is undone.
create function private.move_workspace_data(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
  d jsonb;
  c record;
  moved jsonb;
  m record;
begin
  select * into w from public.workspaces where id = p_id for update;
  if not found or w.data_in_tables then return; end if;
  d := coalesce(w.doc -> 'data', '{}');

  insert into public.workspace_versions (workspace_id, version, doc, saved_by) values (w.id, w.version, w.doc, w.updated_by)
  on conflict do nothing;

  begin
  -- Lists in the file are newest first, so the first item gets the highest place.
  insert into public.records (workspace_id, id, ord, data)
  select w.id, r ->> 'id', jsonb_array_length(m2.value) - i + 1, r
    from jsonb_each(coalesce(d -> 'records', '{}')) m2, jsonb_array_elements(m2.value) with ordinality x(r, i);
  for c in select * from private.collections() loop
    execute format('insert into public.%I (workspace_id, id, ord, data)
                    select $1, r ->> ''id'', jsonb_array_length($2) - i + 1, r from jsonb_array_elements($2) with ordinality x(r, i)', c.tbl)
      using w.id, coalesce(d -> c.key, '[]');
  end loop;

  moved := private.table_data(w.id);
  for m in select key, value from jsonb_each(coalesce(d -> 'records', '{}')) where jsonb_array_length(value) > 0 loop
    if moved #> array['records', m.key] is distinct from m.value then
      raise exception 'Moving workspace % failed a check (records of %); nothing was moved', w.id, m.key;
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(moved -> 'records')) <> (select count(*) from jsonb_each(coalesce(d -> 'records', '{}')) where jsonb_array_length(value) > 0) then
    raise exception 'Moving workspace % failed a check (record modules); nothing was moved', w.id;
  end if;
  for c in select * from private.collections() loop
    if moved -> c.key is distinct from coalesce(d -> c.key, '[]') then
      raise exception 'Moving workspace % failed a check (%); nothing was moved', w.id, c.key;
    end if;
  end loop;
  exception when others then
    raise warning 'move_workspace_data(%): %', w.id, sqlerrm;
    raise exception 'This workspace couldn''t be upgraded, so nothing was changed and your data is safe. Please contact support.' using errcode = 'P0001';
  end;

  perform set_config('bonyan.maintenance', 'on', true);
  update public.workspaces
     set doc = jsonb_set(doc, '{data}', d - 'records' - 'journal' - 'stock' - 'payments' - 'approvals' - 'comments' - 'notes' - 'activity'),
         data_in_tables = true
   where id = w.id;
  perform set_config('bonyan.maintenance', '', true);
end
$$;

/* ---------------- what each person may read ---------------- */

-- Who is asking, as far as reading goes: admin (from the membership), their role in the published setup, and whether
-- that role may see costs and the books.
create function private.viewer(p_id text, p_email text)
returns table (is_admin boolean, user_id text, role_id text, finance boolean, costs boolean, viewable text[])
language sql stable security definer set search_path = '' as $$
  with w as (select doc from public.workspaces where id = p_id),
       m as (select mm.is_admin from public.workspace_members mm where mm.workspace_id = p_id and mm.email = p_email),
       u as (select pu as person from w, jsonb_array_elements(w.doc -> 'users') pu where lower(pu ->> 'email') = p_email limit 1),
       r as (select pr as role from w, u, jsonb_array_elements(coalesce(w.doc #> '{published,roles}', w.doc #> '{draft,roles}', '[]')) pr
              where pr ->> 'id' = u.person ->> 'roleId' limit 1)
  select coalesce((select m.is_admin from m), false),
         (select person ->> 'id' from u),
         (select role ->> 'id' from r),
         coalesce((select (role ->> 'finance')::boolean from r), false),
         coalesce((select coalesce((role ->> 'finance')::boolean, false) or coalesce((role ->> 'costs')::boolean, false) from r), false),
         coalesce((select array_agg(a.key) from r, jsonb_each(coalesce(r.role -> 'access', '{}')) a
                    where jsonb_typeof(a.value) = 'array' and a.value ? 'view'), '{}')
$$;

-- The workspace as this person may see it: the setup, plus only the records and books their role allows.
-- Without "see costs", product cost and stock value, and the cost of stock movements, are left out.
-- The books (journal) and the full payment list are for admin and finance only.
create function private.workspace_view(p_id text, p_email text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
  w public.workspaces;
  visible jsonb;
begin
  select * into w from public.workspaces where id = p_id;
  if not found then return null; end if;
  select * into v from private.viewer(p_id, p_email);
  if v.user_id is null then return null; end if;
  if v.is_admin then
    return jsonb_set(w.doc, '{data}', coalesce(w.doc -> 'data', '{}') || private.table_data(p_id));
  end if;

  visible := jsonb_build_object(
    'records', coalesce((select jsonb_object_agg(module, recs) from (
        select module, jsonb_agg(case when v.costs then data else data #- '{values,cost}' #- '{values,stock_value}' end order by ord desc) recs
          from public.records where workspace_id = p_id and module = any (v.viewable) group by module) x), '{}'),
    'journal', case when v.finance then coalesce((select jsonb_agg(data order by ord desc) from public.journal_entries where workspace_id = p_id), '[]') else '[]' end,
    'stock', coalesce((select jsonb_agg(case when v.costs then data else data - 'cost' - 'value' end order by ord desc) from public.stock_moves where workspace_id = p_id), '[]'),
    'payments', coalesce((select jsonb_agg(data order by ord desc) from public.payments where workspace_id = p_id and (v.finance or module = any (v.viewable))), '[]'),
    'approvals', coalesce((select jsonb_agg(data order by ord desc) from public.approvals where workspace_id = p_id and data ->> 'module' = any (v.viewable)), '[]'),
    'comments', coalesce((select jsonb_agg(c.data order by c.ord desc) from public.comments c
        join public.records r on r.workspace_id = c.workspace_id and r.id = c.record
       where c.workspace_id = p_id and r.module = any (v.viewable)), '[]'),
    -- the same people the notification bell shows them to
    'notes', coalesce((select jsonb_agg(data order by ord desc) from public.notes where workspace_id = p_id and
        case when data ->> 'user' is not null then data ->> 'user' = v.user_id
             else data ->> 'role' is null or data ->> 'role' = v.role_id or (data ->> 'role' = 'finance' and v.finance) end), '[]'),
    'activity', coalesce((select jsonb_agg(data order by ord desc) from public.activity where workspace_id = p_id and
        (data ->> 'module' is null or data ->> 'module' = any (v.viewable))), '[]'));
  return jsonb_set(w.doc, '{data}', coalesce(w.doc -> 'data', '{}') || visible);
end
$$;

-- How people open a workspace.
create function public.open_workspace(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
  view jsonb;
begin
  if me = '' or not private.is_member(p_id) then raise exception 'You are not a member of this workspace' using errcode = '42501'; end if;
  perform private.move_workspace_data(p_id);
  view := private.workspace_view(p_id, me);
  if view is null then raise exception 'You have no profile in this workspace. Ask your admin to add you again on the Team page.' using errcode = '42501'; end if;
  return jsonb_build_object('doc', view, 'version', (select version from public.workspaces where id = p_id));
end
$$;
revoke execute on function public.open_workspace(text) from public, anon;
grant execute on function public.open_workspace(text) to authenticated;

/* ---------------- the server function's side ---------------- */

-- The whole workspace, for the server to run commands on, with the highest list place in use.
create function public.load_workspace(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
begin
  perform private.move_workspace_data(p_id);
  select * into w from public.workspaces where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'doc', jsonb_set(w.doc, '{data}', coalesce(w.doc -> 'data', '{}') || private.table_data(p_id)),
    'version', w.version,
    'max_ord', greatest(
      (select max(ord) from public.records where workspace_id = p_id), (select max(ord) from public.journal_entries where workspace_id = p_id),
      (select max(ord) from public.stock_moves where workspace_id = p_id), (select max(ord) from public.payments where workspace_id = p_id),
      (select max(ord) from public.approvals where workspace_id = p_id), (select max(ord) from public.comments where workspace_id = p_id),
      (select max(ord) from public.notes where workspace_id = p_id), (select max(ord) from public.activity where workspace_id = p_id), 0));
end
$$;

-- What the server sends back after a change: the workspace as that person may see it.
create function public.workspace_view_for(p_id text, p_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.workspace_view(p_id, lower(p_email))
$$;

-- Saves a set of changes in one go, only if nobody saved since `p_base`: the setup part of the file, then the rows
-- that were added, changed or removed. Returns the new version, or null if someone saved first.
-- p_changes: {"records": {"upsert": [{"id", "ord", "data"}], "delete": ["id", ...]}, "journal_entries": {...}, ...}
create function public.save_workspace_changes(p_id text, p_base bigint, p_setup jsonb, p_changes jsonb, p_actor uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v bigint;
  t text;
begin
  perform set_config('bonyan.actor', p_actor::text, true);
  if exists (select 1 from jsonb_object_keys(coalesce(p_setup -> 'data', '{}')) k
              where k in ('records', 'journal', 'stock', 'payments', 'approvals', 'comments', 'notes', 'activity')) then
    raise exception 'Records belong in their own tables' using errcode = '22023';
  end if;
  update public.workspaces
     set doc = p_setup, name = left(coalesce(p_setup #>> '{answers,companyName}', ''), 120)
   where id = p_id and version = p_base and data_in_tables
  returning version into v;
  if v is null then return null; end if;

  foreach t in array array['records', 'journal_entries', 'stock_moves', 'payments', 'approvals', 'comments', 'notes', 'activity'] loop
    execute format('delete from public.%I where workspace_id = $1 and id in (select jsonb_array_elements_text($2))', t)
      using p_id, coalesce(p_changes #> array[t, 'delete'], '[]');
    execute format('insert into public.%I as x (workspace_id, id, ord, data)
                    select $1, r ->> ''id'', (r ->> ''ord'')::bigint, r -> ''data'' from jsonb_array_elements($2) r
                    on conflict (workspace_id, id) do update set data = excluded.data, updated_at = now()
                    where x.data is distinct from excluded.data', t)
      using p_id, coalesce(p_changes #> array[t, 'upsert'], '[]');
  end loop;
  delete from public.record_history where workspace_id = p_id and changed_at < now() - interval '90 days';
  return v;
end
$$;

-- The old whole-file save can't be used once a workspace lives in the tables.
create or replace function public.save_workspace(p_id text, p_base bigint, p_doc jsonb, p_actor uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v bigint;
begin
  if (select data_in_tables from public.workspaces where id = p_id) then
    raise exception 'Bonyan was updated. Refresh the page to keep working.' using errcode = '55000';
  end if;
  perform set_config('bonyan.actor', p_actor::text, true);
  update public.workspaces
     set doc = p_doc, name = left(coalesce(p_doc #>> '{answers,companyName}', ''), 120)
   where id = p_id and version = p_base
  returning version into v;
  return v;
end
$$;

revoke execute on function public.load_workspace(text) from public, anon, authenticated;
revoke execute on function public.workspace_view_for(text, text) from public, anon, authenticated;
revoke execute on function public.save_workspace_changes(text, bigint, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.load_workspace(text) to service_role;
grant execute on function public.workspace_view_for(text, text) to service_role;
grant execute on function public.save_workspace_changes(text, bigint, jsonb, jsonb, uuid) to service_role;

grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;
-- These read or move any workspace, so only the functions above may call them.
revoke execute on function private.move_workspace_data(text), private.table_data(text), private.viewer(text, text), private.workspace_view(text, text) from authenticated;
