-- Phase 1.4a: live updates. After every save the database tells that workspace's open screens there is a newer version
-- (Supabase Realtime broadcast on the private channel "ws:<id>"). The message holds only the version number; screens
-- then fetch what their person may see through open_workspace(), so nothing private travels in the broadcast.
-- Only members can listen to their workspace's channel, and nobody can send on it from the browser.

create function private.announce_save() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.version is distinct from old.version then
    begin
      perform realtime.send(jsonb_build_object('version', new.version), 'saved', 'ws:' || new.id, true);
    exception when others then
      -- a hiccup in live updates must never stop a save; screens catch up on their next change or reload
      raise warning 'live update for % not sent: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end
$$;
create trigger workspaces_announce after update on public.workspaces
for each row execute function private.announce_save();

create policy "members hear their workspace's saves" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and realtime.topic() like 'ws:%' and private.is_member(substr(realtime.topic(), 4)));

revoke execute on function private.announce_save() from authenticated;
