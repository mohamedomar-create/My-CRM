-- Phase 1.2, part 2: formula fields built on cost (for example a "margin" field) are left out for people who can't see
-- costs, exactly like cost and stock value themselves. Same rule as costKeys() in src/lib/engine.ts.

-- cost and stock_value, plus every formula field of the published setup that uses them, directly or through another formula.
create function private.cost_keys(p_doc jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  keys text[] := array['cost', 'stock_value'];
  grew boolean := true;
  f record;
begin
  while grew loop
    grew := false;
    for f in
      select fd ->> 'key' as key, fd ->> 'formula' as formula
        from jsonb_array_elements(coalesce(p_doc #> '{published,modules}', p_doc #> '{draft,modules}', '[]')) m,
             jsonb_array_elements(coalesce(m -> 'fields', '[]')) fd
       where fd ->> 'type' = 'formula' and coalesce(fd ->> 'formula', '') <> '' and fd ->> 'key' is not null
    loop
      if not f.key = any (keys) and exists (
        select 1 from unnest(keys) k where f.formula ~* ('(^|[^a-z0-9_])' || k || '([^a-z0-9_]|$)')
      ) then
        keys := keys || f.key;
        grew := true;
      end if;
    end loop;
  end loop;
  return keys;
end
$$;

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
    -- the same people the notification bell shows them to
    'notes', coalesce((select jsonb_agg(data order by ord desc) from public.notes where workspace_id = p_id and
        case when data ->> 'user' is not null then data ->> 'user' = v.user_id
             else data ->> 'role' is null or data ->> 'role' = v.role_id or (data ->> 'role' = 'finance' and v.finance) end), '[]'),
    'activity', coalesce((select jsonb_agg(data order by ord desc) from public.activity where workspace_id = p_id and
        (data ->> 'module' is null or data ->> 'module' = any (v.viewable))), '[]'));
  return jsonb_set(w.doc, '{data}', coalesce(w.doc -> 'data', '{}') || visible);
end
$$;


revoke execute on function private.cost_keys(jsonb), private.workspace_view(text, text) from public, anon, authenticated;
