-- The server function loads the whole company before every save, and sends it back after. Built as jsonb, each took
-- about 90 ms for a company with 5,000 customers; put together as text, about a third of that, so saves are shorter
-- and people saving at the same moment wait less (src/lib/dbsim.test.ts).
-- The rows of a company in the shape of the file's "data" part, as JSON text (the same content as private.table_data).
create function private.tables_text(p_id text) returns text
language sql stable security definer set search_path = '' as $$
  select '{"records":{' || coalesce((
           select string_agg(to_json(m.module)::text || ':[' || m.recs || ']', ',') from (
             select module, string_agg(data::text, ',' order by ord desc) recs from public.records where workspace_id = p_id group by module) m), '')
      || '},"journal":[' || coalesce((select string_agg(data::text, ',' order by ord desc) from public.journal_entries where workspace_id = p_id), '')
      || '],"stock":[' || coalesce((select string_agg(data::text, ',' order by ord desc) from public.stock_moves where workspace_id = p_id), '')
      || '],"payments":[' || coalesce((select string_agg(data::text, ',' order by ord desc) from public.payments where workspace_id = p_id), '')
      || '],"approvals":[' || coalesce((select string_agg(data::text, ',' order by ord desc) from public.approvals where workspace_id = p_id), '')
      || '],"comments":[' || coalesce((select string_agg(data::text, ',' order by ord desc) from public.comments where workspace_id = p_id), '')
      || '],"notes":[' || coalesce((select string_agg(data::text, ',' order by ord desc) from public.notes where workspace_id = p_id), '')
      || '],"activity":[' || coalesce((select string_agg(data::text, ',' order by ord desc) from public.activity where workspace_id = p_id), '')
      || ']}'
$$;
revoke execute on function private.tables_text(text) from public, anon, authenticated;

-- Like load_workspace, in one statement (the version and the rows are read at the same instant), with the rows apart
-- from the setup: { doc: the setup, tables: the rows, version, max_ord }.
create function public.load_workspace_fast(p_id text) returns json
language plpgsql security definer set search_path = '' as $$
begin
  perform private.move_workspace_data(p_id);
  return (
    select ('{"doc":' || w.doc::text || ',"version":' || w.version
      || ',"max_ord":' || greatest(
           (select max(ord) from public.records where workspace_id = p_id), (select max(ord) from public.journal_entries where workspace_id = p_id),
           (select max(ord) from public.stock_moves where workspace_id = p_id), (select max(ord) from public.payments where workspace_id = p_id),
           (select max(ord) from public.approvals where workspace_id = p_id), (select max(ord) from public.comments where workspace_id = p_id),
           (select max(ord) from public.notes where workspace_id = p_id), (select max(ord) from public.activity where workspace_id = p_id), 0)
      || ',"tables":' || private.tables_text(p_id) || '}')::json
    from public.workspaces w where w.id = p_id);
end
$$;

-- Like workspace_view_for. An admin sees everything, so their copy is put together as text the fast way
-- ({ doc, tables }); everyone else gets exactly what workspace_view_for gives them ({ view }).
create function public.workspace_view_fast(p_id text, p_email text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v record;
begin
  perform private.move_workspace_data(p_id);
  select * into v from private.viewer(p_id, p_email);
  if v.user_id is null then return null; end if;
  if v.is_admin then
    return (select ('{"doc":' || w.doc::text || ',"tables":' || private.tables_text(p_id) || '}')::json from public.workspaces w where w.id = p_id);
  end if;
  return json_build_object('view', private.workspace_view(p_id, p_email));
end
$$;

revoke execute on function public.load_workspace_fast(text), public.workspace_view_fast(text, text) from public, anon, authenticated;
grant execute on function public.load_workspace_fast(text), public.workspace_view_fast(text, text) to service_role;
