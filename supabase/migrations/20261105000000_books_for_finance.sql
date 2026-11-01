-- Phase 2A.5: the books' own figures stay with finance.
-- The company file now carries VAT returns (2A.4) and bank reconciliations (2A.5) under "books". People without a
-- finance role receive only the lock date from it, like the journal, which they never receive either.
create or replace function private.workspace_view(p_id text, p_email text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
  w public.workspaces;
  visible jsonb;
  secret text[];
begin
  select * into w from public.workspaces where id = p_id;
  if not found then return null; end if;
  select * into v from private.viewer(p_id, p_email);
  if v.user_id is null then return null; end if;
  if v.is_admin then
    return jsonb_set(w.doc, '{data}', coalesce(w.doc -> 'data', '{}') || private.table_data(p_id));
  end if;

  secret := private.cost_keys(w.doc);
  visible := jsonb_build_object(
    'records', coalesce((select jsonb_object_agg(module, recs) from (
        select module, jsonb_agg(case when v.costs or not (data ? 'values') then data else jsonb_set(data, '{values}', (data -> 'values') - secret) end order by ord desc) recs
          from public.records where workspace_id = p_id and module = any (v.viewable) group by module) x), '{}'),
    'journal', case when v.finance then coalesce((select jsonb_agg(data order by ord desc) from public.journal_entries where workspace_id = p_id), '[]') else '[]' end,
    'stock', coalesce((select jsonb_agg(case when v.costs then data else data - 'cost' - 'value' end order by ord desc) from public.stock_moves where workspace_id = p_id), '[]'),
    'payments', coalesce((select jsonb_agg(data order by ord desc) from public.payments where workspace_id = p_id and (v.finance or module = any (v.viewable))), '[]'),
    'approvals', coalesce((select jsonb_agg(data order by ord desc) from public.approvals where workspace_id = p_id and data ->> 'module' = any (v.viewable)), '[]'),
    'comments', coalesce((select jsonb_agg(c.data order by c.ord desc) from public.comments c
        join public.records r on r.workspace_id = c.workspace_id and r.id = c.record
       where c.workspace_id = p_id and r.module = any (v.viewable)), '[]'),
    'notes', coalesce((select jsonb_agg(data order by ord desc) from public.notes where workspace_id = p_id and
        case when data ->> 'user' is not null then data ->> 'user' = v.user_id
             else data ->> 'role' is null or data ->> 'role' = v.role_id or (data ->> 'role' = 'finance' and v.finance) end), '[]'),
    'activity', coalesce((select jsonb_agg(data order by ord desc) from public.activity where workspace_id = p_id and
        (data ->> 'module' is null or data ->> 'module' = any (v.viewable))), '[]'));
  -- The books' own figures (VAT returns, bank reconciliations, closed years) are for finance; others only learn the lock date.
  return jsonb_set(w.doc || jsonb_build_object('draft', null, 'history', '[]'::jsonb)
      || case when v.finance then '{}'::jsonb else jsonb_build_object('books', jsonb_strip_nulls(jsonb_build_object('lockDate', w.doc #> '{books,lockDate}'))) end,
    '{data}', coalesce(w.doc -> 'data', '{}') || visible);
end
$$;

revoke execute on function private.workspace_view(text, text) from public, anon, authenticated;
