-- People saving in the same company at the same moment take turns, in the order they asked, instead of all doing the
-- work and all but one starting again (with 5,000 customers on file and 20 people at once, that made some wait 8
-- seconds; src/lib/dbsim.test.ts). The server function asks for a turn before it loads the company, waits outside the
-- database while others are ahead (it holds no connection while it waits), and gives the turn back when done.
-- Someone whose request ended without giving it back stops being waited for after 2 seconds.
-- The queue is only for speed: every save is still checked against the version it started from, so a change can never
-- overwrite another, whether or not the queue was used.
create table private.save_turns (
  workspace_id text not null,
  token uuid not null,
  asked timestamptz not null default clock_timestamp(),
  seen timestamptz not null default clock_timestamp(),
  primary key (workspace_id, token)
);
create index save_turns_order_idx on private.save_turns (workspace_id, asked, token);
alter table private.save_turns enable row level security;
revoke all on private.save_turns from public, anon, authenticated;

/** 0 = it is your turn now; otherwise how many people are ahead of you (ask again shortly). */
create function public.take_save_turn(p_id text, p_token uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  mine private.save_turns;
begin
  -- places in one company's queue are handed out one at a time (a moment each), so two people asking at the same
  -- instant can't both see themselves first
  perform pg_advisory_xact_lock(hashtextextended('save_turns:' || p_id, 0));
  insert into private.save_turns (workspace_id, token) values (p_id, p_token)
  on conflict (workspace_id, token) do update set seen = clock_timestamp()
  returning * into mine;
  -- people who stopped asking (their request ended or failed) are not waited for
  delete from private.save_turns where workspace_id = p_id and seen < clock_timestamp() - interval '2 seconds';
  return (select count(*) from private.save_turns
           where workspace_id = p_id and (asked, token) < (mine.asked, mine.token));
end
$$;

create function public.end_save_turn(p_id text, p_token uuid) returns void
language sql security definer set search_path = '' as $$
  delete from private.save_turns where workspace_id = p_id and token = p_token
$$;

revoke execute on function public.take_save_turn(text, uuid), public.end_save_turn(text, uuid) from public, anon, authenticated;
grant execute on function public.take_save_turn(text, uuid), public.end_save_turn(text, uuid) to service_role;
