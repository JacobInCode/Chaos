-- REVIEW AND RUN MANUALLY in the existing project dvjureorajnorejqbctx.
-- Additive RPCs against the five inspected tables; no new project or table.
-- All statements apply atomically. This file has NOT been applied remotely.
begin;

create schema if not exists chaos_private;
revoke all on schema chaos_private from public;
grant usage on schema chaos_private to authenticated, service_role;

create or replace function public.v1_create_room(p_name text, p_visibility text, p_markdown text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  new_room uuid;
  new_world uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Room name must be 1–120 characters'; end if;
  if p_visibility is null or p_visibility not in ('public', 'unlisted') then raise exception 'Invalid visibility'; end if;
  if p_markdown is null or length(trim(p_markdown)) = 0 or octet_length(p_markdown) > 200000 then raise exception 'World must be nonempty and at most 200 KB'; end if;
  insert into public.rooms(name, visibility, created_by) values(trim(p_name), p_visibility, auth.uid()) returning id into new_room;
  insert into public.world_versions(room_id, markdown) values(new_room, p_markdown) returning id into new_world;
  update public.rooms set current_world_version_id = new_world where id = new_room;
  return new_room;
end;
$$;
revoke all on function public.v1_create_room(text,text,text) from public, anon;
grant execute on function public.v1_create_room(text,text,text) to authenticated;

-- Definer rights are needed only to copy historical authors under the inspected
-- events INSERT policy (user_id = auth.uid()). All source selection happens here;
-- callers cannot submit arbitrary copied events or choose another human owner.
create or replace function chaos_private.fork_room(
  p_owner uuid, p_source_room_id uuid, p_event_id bigint, p_name text, p_visibility text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  source public.rooms%rowtype;
  source_world public.world_versions%rowtype;
  child uuid;
  child_world uuid;
  world_count bigint;
begin
  if p_owner is null then raise exception 'Authentication required'; end if;
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' and (auth.uid() is null or p_owner <> auth.uid()) then
    raise exception 'Cannot fork as another user';
  end if;
  if not exists (select 1 from public.users where id = p_owner and type = 'human') then raise exception 'Human owner required'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Room name must be 1–120 characters'; end if;
  if p_visibility is null or p_visibility not in ('public', 'unlisted') then raise exception 'Invalid visibility'; end if;
  if p_event_id is null or p_event_id <= 0 then raise exception 'Invalid event'; end if;
  select * into source from public.rooms where id = p_source_room_id for share;
  if not found then raise exception 'Room not found'; end if;
  if not exists(select 1 from public.events where room_id = source.id and id = p_event_id) then raise exception 'Event does not belong to room'; end if;

  -- V1 has an initial immutable world and no world editing or compaction.
  -- Existing schema/MCP specify no world_changed payload or effective-version
  -- boundary. Do not silently use a future world when that contract is absent.
  select count(*) into world_count from public.world_versions where room_id = source.id;
  if world_count <> 1 then
    raise exception 'This room needs a historical world-version contract before it can be forked (expected one V1 snapshot)';
  end if;
  select * into source_world from public.world_versions where room_id = source.id and id = source.current_world_version_id;
  if not found then raise exception 'Room has no valid current world'; end if;
  if source_world.compiled_through_event_id is not null then
    raise exception 'Compacted worlds require a historical world-version contract before forking';
  end if;

  insert into public.rooms(name,visibility,created_by,forked_from_room_id,forked_at_event_id)
    values(trim(p_name),p_visibility,p_owner,source.id,p_event_id) returning id into child;
  insert into public.world_versions(room_id,markdown) values(child,source_world.markdown) returning id into child_world;
  update public.rooms set current_world_version_id = child_world where id = child;
  -- INSERT SELECT is not subject to the PostgREST default 1,000-row response cap.
  -- Preserve authors, content, timestamps, and order, with independent new IDs.
  insert into public.events(room_id,user_id,type,payload,created_at)
    select child,user_id,type,payload,created_at from public.events
    where room_id = source.id and id <= p_event_id order by id;
  return child;
end;
$$;
revoke all on function chaos_private.fork_room(uuid,uuid,bigint,text,text) from public, anon;
grant execute on function chaos_private.fork_room(uuid,uuid,bigint,text,text) to authenticated, service_role;

create or replace function public.v1_fork_room(p_source_room_id uuid,p_event_id bigint,p_name text,p_visibility text)
returns uuid language sql security invoker set search_path = '' as $$
  select chaos_private.fork_room(auth.uid(),p_source_room_id,p_event_id,p_name,p_visibility);
$$;
revoke all on function public.v1_fork_room(uuid,bigint,text,text) from public, anon;
grant execute on function public.v1_fork_room(uuid,bigint,text,text) to authenticated;

-- For the user's optional MCP patch: the verified Edge Function authenticates
-- its bearer and passes the resulting ownerId. Never grant this RPC to browsers.
create or replace function public.v1_fork_room_for_agent(p_owner_user_id uuid,p_source_room_id uuid,p_event_id bigint,p_name text,p_visibility text)
returns uuid language sql security invoker set search_path = '' as $$
  select chaos_private.fork_room(p_owner_user_id,p_source_room_id,p_event_id,p_name,p_visibility);
$$;
revoke all on function public.v1_fork_room_for_agent(uuid,uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.v1_fork_room_for_agent(uuid,uuid,bigint,text,text) to service_role;

-- Existing token table grants allow owners to attach a token to any agent ID.
-- Keep creation behind the existing RPC and permit only revocation from clients.
revoke insert, update on public.mcp_tokens from anon, authenticated;
grant update(revoked_at) on public.mcp_tokens to authenticated;
-- Likewise, a human must not be able to change their own type to agent.
revoke update on public.users from anon, authenticated;
grant update(name) on public.users to authenticated;
revoke all on function public.create_mcp_token(text) from public, anon;
grant execute on function public.create_mcp_token(text) to authenticated;

notify pgrst, 'reload schema';
commit;
