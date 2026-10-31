-- Phase 1.3b: two-factor login and limits.
-- * Two-factor login (an authenticator app): someone who turned it on can only open a workspace or make changes with a
--   login that passed the code step (Supabase's "aal2"). A workspace can also require it for admins and finance
--   (security.requireTwoFactor in the company file, set by an admin); they are then asked to set it up first.
-- * Limits: changes per person per minute (checked by the server function, indexed here), records per workspace,
--   people per workspace.

-- Why this person can't open the workspace yet, or null when they can.
create function private.second_factor_problem(p_id text, p_uid uuid, p_email text, p_aal text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  has_factor boolean := exists (select 1 from auth.mfa_factors f where f.user_id = p_uid and f.status::text = 'verified');
  v record;
begin
  if has_factor and coalesce(p_aal, '') <> 'aal2' then
    return 'Enter the 6-digit code from your authenticator app to continue.';
  end if;
  if has_factor or not coalesce((select (doc #>> '{security,requireTwoFactor}')::boolean from public.workspaces where id = p_id), false) then
    return null;
  end if;
  select * into v from private.viewer(p_id, lower(p_email));
  if v.is_admin or v.finance then
    return 'Your company requires two-factor login for admins and finance. Set it up under Security to continue.';
  end if;
  return null;
end
$$;

-- For the command server function, which checks the same before every change.
create function public.second_factor_problem_for(p_id text, p_uid uuid, p_email text, p_aal text) returns text
language sql stable security definer set search_path = '' as $$
  select private.second_factor_problem(p_id, p_uid, p_email, p_aal)
$$;
revoke execute on function public.second_factor_problem_for(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.second_factor_problem_for(text, uuid, text, text) to service_role;

create or replace function public.open_workspace(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
  view jsonb;
  problem text;
begin
  if me = '' or not private.is_member(p_id) then raise exception 'You are not a member of this workspace' using errcode = '42501'; end if;
  problem := private.second_factor_problem(p_id, auth.uid(), me, auth.jwt() ->> 'aal');
  if problem is not null then raise exception '%', problem using errcode = '28000', hint = 'two_factor'; end if;
  perform private.move_workspace_data(p_id);
  view := private.workspace_view(p_id, me);
  if view is null then raise exception 'You have no profile in this workspace. Ask your admin to add you again on the Team page.' using errcode = '42501'; end if;
  return jsonb_build_object('doc', view, 'version', (select version from public.workspaces where id = p_id));
end
$$;

-- Limits.
create index audit_events_actor_at_idx on public.audit_events (actor, at desc);

create or replace function public.save_workspace_changes(p_id text, p_base bigint, p_setup jsonb, p_changes jsonb, p_actor uuid) returns bigint
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
  -- limit: records per workspace (counted only when records were added or changed)
  if jsonb_array_length(coalesce(p_changes #> '{records,upsert}', '[]')) > 0
     and (select count(*) from public.records where workspace_id = p_id) > 200000 then
    raise exception 'This workspace has reached 200,000 records. Contact support to raise the limit.' using errcode = '54000';
  end if;
  delete from public.record_history where workspace_id = p_id and changed_at < now() - interval '90 days';
  return v;
end
$$;

create or replace function public.create_invitation(p_workspace text, p_email text, p_is_admin boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.auth_email();
  e text := lower(trim(coalesce(p_email, '')));
  token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if me = '' or not private.is_ws_admin(p_workspace) then raise exception 'Only an admin can invite people' using errcode = '42501'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid e-mail' using errcode = '22023'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = p_workspace and email = e) then
    raise exception 'This person is already in the team' using errcode = '23505';
  end if;
  if (select count(*) from public.workspace_members where workspace_id = p_workspace)
     + (select count(*) from public.invitations where workspace_id = p_workspace and accepted_at is null and declined_at is null
          and revoked_at is null and expires_at > now()) >= 200 then
    raise exception 'A workspace can have up to 200 people (members and open invitations)' using errcode = '54000';
  end if;
  if (select count(*) from public.invitations where workspace_id = p_workspace and created_at > now() - interval '1 day') >= 50 then
    raise exception 'You can send up to 50 invitations a day' using errcode = '54000';
  end if;
  -- a new invitation replaces an open one for the same person
  update public.invitations set revoked_at = now()
   where workspace_id = p_workspace and email = e and accepted_at is null and declined_at is null and revoked_at is null;
  insert into public.invitations (workspace_id, email, is_admin, token_hash, invited_by, invited_by_email)
  values (p_workspace, e, coalesce(p_is_admin, false), private.hash_token(token), auth.uid(), me);
  return token;
end
$$;


grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;
revoke execute on function private.move_workspace_data(text), private.table_data(text), private.viewer(text, text), private.workspace_view(text, text),
  private.cost_keys(jsonb), private.accept_invitation(public.invitations), private.second_factor_problem(text, uuid, text, text) from authenticated;
