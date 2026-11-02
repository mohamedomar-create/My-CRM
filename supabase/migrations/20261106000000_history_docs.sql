-- Phase H5: the history store. Past invoices, bills, credit notes and quotations from a company's old system, kept on
-- the server and never loaded when the app opens: years of history must not slow the app down.
-- * They are history only: never in the books, stock, VAT or numbering (the books' past comes from the opening books).
-- * Admins and finance add them in batches and can take a batch out again; every batch is in the audit trail.
-- * People read them a page at a time (a customer's or supplier's history) or as totals worked out here (by month,
--   product, customer or rep), and only for the side their role can see: sales history with the invoices module,
--   purchase history with the bills module. Nobody reads or writes the table directly.

create table public.history_docs (
  workspace_id text not null references public.workspaces (id) on delete restrict,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  side text not null check (side in ('sales', 'purchases')),
  kind text not null check (kind in ('invoice', 'credit', 'quote')),
  number text not null default '' check (length(number) <= 120),
  date date not null,
  -- the customer's or supplier's record, and its name when it was imported
  party text not null check (length(party) between 1 and 80),
  party_name text not null default '' check (length(party_name) <= 200),
  rep text check (length(rep) <= 80),
  subtotal numeric(18, 2) not null default 0,
  tax numeric(18, 2) not null default 0,
  total numeric(18, 2) not null default 0,
  -- lines: product (record id, when found), sku, description, qty, price, net
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 500),
  -- the opening document still owed when this invoice was not fully paid, so the two are known as one invoice
  open_doc text check (length(open_doc) <= 80),
  batch text not null check (batch ~ '^imp_[A-Za-z0-9_-]{1,60}$'),
  file text not null default '' check (length(file) <= 120),
  added_by text not null,
  added_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index history_docs_party_idx on public.history_docs (workspace_id, party, date desc, id);
create index history_docs_side_date_idx on public.history_docs (workspace_id, side, date);
create index history_docs_batch_idx on public.history_docs (workspace_id, batch);
alter table public.history_docs enable row level security;
revoke all on public.history_docs from anon, authenticated;

-- What the caller may do with the history: add (admins and finance) and read each side.
create function private.history_rights(p_id text)
returns table (email text, writer boolean, sales boolean, purchases boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  me text := private.auth_email();
  v record;
  problem text;
  mods jsonb;
begin
  if me = '' or not private.is_member(p_id) then raise exception 'You are not a member of this workspace' using errcode = '42501'; end if;
  problem := private.second_factor_problem(p_id, auth.uid(), me, auth.jwt() ->> 'aal');
  if problem is not null then raise exception '%', problem using errcode = '28000', hint = 'two_factor'; end if;
  select * into v from private.viewer(p_id, me);
  if v.user_id is null then raise exception 'You have no profile in this workspace' using errcode = '42501'; end if;
  select coalesce(doc #> '{published,modules}', '[]') into mods from public.workspaces where id = p_id;
  return query select me, v.is_admin or v.finance,
    v.is_admin or v.finance or exists (select 1 from jsonb_array_elements(mods) m where m ->> 'role' = 'invoices' and m ->> 'id' = any (v.viewable)),
    v.is_admin or v.finance or exists (select 1 from jsonb_array_elements(mods) m where m ->> 'role' = 'purchases' and m ->> 'id' = any (v.viewable));
end
$$;
revoke execute on function private.history_rights(text) from public, anon, authenticated;

/** Adds a batch's documents (up to 1,000 per call; a file is sent in parts). Sent again, a document isn't added twice. */
create function public.history_add(p_id text, p_batch text, p_file text, p_docs jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer;
begin
  select * into r from private.history_rights(p_id);
  if not r.writer then raise exception 'Only Admin and finance roles can bring in past documents' using errcode = '42501'; end if;
  if p_batch is null or p_batch !~ '^imp_[A-Za-z0-9_-]{1,60}$' then raise exception 'That setup is not valid' using errcode = '22023'; end if;
  if jsonb_typeof(p_docs) <> 'array' or jsonb_array_length(p_docs) > 1000 then raise exception 'Send up to 1,000 documents at a time' using errcode = '22023'; end if;
  if exists (select 1 from public.history_docs where workspace_id = p_id and batch = p_batch and added_by <> r.email) then
    raise exception 'That import is closed. Start a new one.' using errcode = '42501';
  end if;
  insert into public.history_docs (workspace_id, id, side, kind, number, date, party, party_name, rep, subtotal, tax, total, lines, open_doc, batch, file, added_by)
  select p_id, d ->> 'id', d ->> 'side', d ->> 'kind', coalesce(d ->> 'number', ''), (d ->> 'date')::date, d ->> 'party', coalesce(d ->> 'partyName', ''),
         nullif(d ->> 'rep', ''), coalesce((d ->> 'subtotal')::numeric, 0), coalesce((d ->> 'tax')::numeric, 0), coalesce((d ->> 'total')::numeric, 0),
         coalesce(d -> 'lines', '[]'), nullif(d ->> 'openDoc', ''), p_batch, left(coalesce(p_file, ''), 120), r.email
    from jsonb_array_elements(p_docs) d
  on conflict (workspace_id, id) do nothing;
  get diagnostics n = row_count;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), r.email, 'history.add', format('%s documents from %s', n, left(coalesce(p_file, ''), 120)), true);
  return n;
end
$$;

/** Takes a whole batch out again: the person who brought it in, or an admin. */
create function public.history_undo(p_id text, p_batch text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer;
begin
  select * into r from private.history_rights(p_id);
  if not r.writer then raise exception 'Only Admin and finance roles can bring in past documents' using errcode = '42501'; end if;
  if not private.is_ws_admin(p_id) and exists (select 1 from public.history_docs where workspace_id = p_id and batch = p_batch and added_by <> r.email) then
    raise exception 'Only the person who imported the file, or an admin, can undo it' using errcode = '42501';
  end if;
  delete from public.history_docs where workspace_id = p_id and batch = p_batch;
  get diagnostics n = row_count;
  insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok)
    values (p_id, auth.uid(), r.email, 'history.undo', format('%s documents', n), true);
  return n;
end
$$;

/** The batches brought in, newest first. */
create function public.history_batches(p_id text)
returns table (batch text, file text, added_by text, added_at timestamptz, docs bigint, lines bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
begin
  select * into r from private.history_rights(p_id);
  if not r.writer then raise exception 'Only Admin and finance roles can bring in past documents' using errcode = '42501'; end if;
  return query select h.batch, max(h.file), max(h.added_by), min(h.added_at), count(*), sum(jsonb_array_length(h.lines))::bigint
    from public.history_docs h where h.workspace_id = p_id group by h.batch order by min(h.added_at) desc;
end
$$;

/** A customer's or supplier's past documents, newest first, a page at a time (pass the last date and id seen). */
create function public.history_for_party(p_id text, p_party text, p_limit integer default 20, p_before_date date default null, p_before_id text default null)
returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
begin
  select * into r from private.history_rights(p_id);
  return query select jsonb_build_object('id', h.id, 'side', h.side, 'kind', h.kind, 'number', h.number, 'date', h.date, 'rep', h.rep,
      'subtotal', h.subtotal, 'tax', h.tax, 'total', h.total, 'lines', h.lines, 'openDoc', h.open_doc, 'file', h.file)
    from public.history_docs h
   where h.workspace_id = p_id and h.party = p_party
     and ((h.side = 'sales' and r.sales) or (h.side = 'purchases' and r.purchases))
     and (p_before_date is null or (h.date, h.id) < (p_before_date, coalesce(p_before_id, '')))
   order by h.date desc, h.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
end
$$;

/** A customer's or supplier's history per year: documents, value before VAT (credits taken off) and the last date. */
create function public.history_party_stats(p_id text, p_party text)
returns table (side text, year integer, docs bigint, amount numeric, last_date date)
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
begin
  select * into r from private.history_rights(p_id);
  return query select h.side, extract(year from h.date)::integer, count(*) filter (where h.kind <> 'quote'),
      coalesce(sum(case h.kind when 'invoice' then h.subtotal when 'credit' then -h.subtotal else 0 end), 0), max(h.date) filter (where h.kind = 'invoice')
    from public.history_docs h
   where h.workspace_id = p_id and h.party = p_party and ((h.side = 'sales' and r.sales) or (h.side = 'purchases' and r.purchases))
   group by h.side, extract(year from h.date) order by 2 desc;
end
$$;

/**
 * Totals of a side's past documents from…to, by month, by customer or supplier, by product or by rep: the value before
 * VAT (credit notes taken off, quotations left out) and, by product, the quantity.
 */
create function public.history_summary(p_id text, p_side text, p_from date, p_to date, p_by text)
returns table (key text, label text, docs bigint, qty numeric, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
begin
  select * into r from private.history_rights(p_id);
  if not ((p_side = 'sales' and r.sales) or (p_side = 'purchases' and r.purchases)) then raise exception 'Your role can''t view these documents' using errcode = '42501'; end if;
  if p_by not in ('month', 'party', 'product', 'rep') then raise exception 'That setup is not valid' using errcode = '22023'; end if;
  if p_by = 'product' then
    return query select coalesce(nullif(l ->> 'product', ''), nullif(l ->> 'sku', ''), l ->> 'description', ''), max(coalesce(nullif(l ->> 'description', ''), l ->> 'sku', '')),
        count(distinct h.id), coalesce(sum(case h.kind when 'credit' then -1 else 1 end * coalesce((l ->> 'qty')::numeric, 0)), 0),
        coalesce(sum(case h.kind when 'credit' then -1 else 1 end * coalesce((l ->> 'net')::numeric, 0)), 0)
      from public.history_docs h, jsonb_array_elements(h.lines) l
     where h.workspace_id = p_id and h.side = p_side and h.kind <> 'quote' and h.date between p_from and p_to
     group by 1 order by 5 desc;
  else
    return query select case p_by when 'month' then to_char(h.date, 'YYYY-MM') when 'party' then h.party else coalesce(h.rep, '') end,
        max(case p_by when 'party' then h.party_name else '' end), count(*), 0::numeric,
        coalesce(sum(case h.kind when 'credit' then -h.subtotal else h.subtotal end), 0)
      from public.history_docs h
     where h.workspace_id = p_id and h.side = p_side and h.kind <> 'quote' and h.date between p_from and p_to
     group by 1 order by 1;
  end if;
end
$$;

revoke execute on function public.history_add(text, text, text, jsonb), public.history_undo(text, text), public.history_batches(text),
  public.history_for_party(text, text, integer, date, text), public.history_party_stats(text, text), public.history_summary(text, text, date, date, text) from public, anon;
grant execute on function public.history_add(text, text, text, jsonb), public.history_undo(text, text), public.history_batches(text),
  public.history_for_party(text, text, integer, date, text), public.history_party_stats(text, text), public.history_summary(text, text, date, date, text) to authenticated;
