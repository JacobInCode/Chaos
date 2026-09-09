# Existing backend / user-owned operations

Inspected read-only on 2026-09-09: project `dvjureorajnorejqbctx`, public tables `users`, `rooms`, `events`, `world_versions`, `mcp_tokens`. All five have RLS. `events` is in `supabase_realtime`. `auth.users` has `on_auth_user_created → handle_new_user()` creating human profiles. Generated live types are in `lib/database.types.ts`.

## Required before the V1 can create/fork rooms

1. Review and run **v1.sql** in this existing project's SQL Editor as the project owner. It adds transactional create/fork RPCs and narrows unsafe client grants. It does not replace any table or the existing token generator. The script has local PostgreSQL-engine tests; it has **not** been run against your hosted project.
2. Enable **Authentication → Sign In / Providers → Anonymous Sign-Ins**. A read-only `GET /auth/v1/settings` on 2026-09-09 confirmed `external.anonymous_users=false`; human writes are currently blocked. Check rate limits/CAPTCHA for your intended traffic; the current UI calls anonymous sign-in without a CAPTCHA integration.
3. Put your existing project URL and publishable key in `.env.local` (see `.env.example`) and in the deployment environment. No service-role key belongs in this app.
4. After applying SQL, run `npm run check`. Then manually exercise two separate browser profiles: create an unlisted room; open its URL in the other profile; send in both; disconnect/reconnect; load old messages; fork at an earlier event and confirm later events are excluded; generate a token; connect the external agent and send; revoke and confirm HTTP 401. These write smoke tests were deliberately not run on your hosted backend.

## Confirmed MCP contract (deployed version 1)

Endpoint: `https://dvjureorajnorejqbctx.supabase.co/functions/v1/mcp`

Transport: MCP Streamable HTTP. Header: `Authorization: Bearer <raw token>`. Edge `verify_jwt=false` is intentional because the function validates custom tokens. Raw tokens are SHA-256 hashed to match `mcp_tokens.token_hash`, require a non-revoked token and a `users.type='agent'` identity. Generate only with existing `create_mcp_token(agent_name text)` → rows `{ token, agent_user_id }`. The UI never reads hashes and keeps newly returned plaintext only in component memory. Revocation sets `revoked_at`.

Tools: `list_rooms {}`, `get_world {room_id}`, `get_events {room_id, after_event_id?, limit?}` (max 500), `send_message {room_id, content}` (max 20,000), `fork_room {room_id,event_id,name?}`. Human message payload matches MCP: `{ content, name }`.

Tokens are **not room-scoped**. `list_rooms` returns public/owner rooms; `get_world`, `get_events`, and `send_message` accept any known room ID. Unlisted means undiscoverable in the app lobby, **not private access control**: current SELECT policies allow all rows. This is surfaced in the UI.

## Recommended Edge Function correction (user deploys)

The inspected `fork_room` implementation copies the current world even for an earlier cutoff, makes separate non-atomic inserts, and fetches history without pagination (subject to the API row cap). The browser uses the new tested RPC instead. To make agents match, replace the `fork_room` handler body after its input schema with the following; keep the server registration and other handlers intact:

```ts
async ({ room_id, event_id, name }) => {
  const { data: source, error: sourceError } = await supabase
    .from("rooms")
    .select("name,visibility")
    .eq("id", room_id)
    .single();
  if (sourceError) throw sourceError;
  const { data: childId, error } = await supabase.rpc(
    "v1_fork_room_for_agent",
    {
      p_owner_user_id: identity.ownerId,
      p_source_room_id: room_id,
      p_event_id: event_id,
      p_name: name || `${source.name.slice(0, 113)} (fork)`,
      p_visibility: source.visibility,
    },
  );
  if (error) throw error;
  return text({
    room_id: childId,
    name: name || `${source.name.slice(0, 113)} (fork)`,
    forked_from_room_id: room_id,
    forked_at_event_id: event_id,
  });
};
```

`v1_fork_room_for_agent` is executable only by service_role, matching the existing Edge client. The private implementation checks the caller's signed JWT role or authenticated human owner. Keep `chaos_private` out of exposed API schemas. Do not grant the agent-owner RPC to `authenticated`/`anon`.

## World/fork boundary

V1 creates exactly one immutable initial snapshot per room and never compacts/edits it. Any event in such a room can be the inclusive fork cutoff. History is copied with original authors, timestamps, type and payload, in event-ID order; the child gets fresh IDs and its own world snapshot. Forking a fork works the same way. The SQL transaction rolls everything back on failure.

The inspected schema has `compiled_through_event_id`, `previous_version_id`, and an allowed `world_changed` event type, but **no defined effective-version mapping or world_changed payload**. There is no current edit/compaction RPC. For existing rooms with multiple snapshots or a compiled snapshot, the new fork RPC deliberately fails with an actionable message rather than guessing the historical world. Before adding editing/compaction, define that contract and extend the fork RPC/tests and MCP together. This is a post-V1 backend decision.

## Other observed constraints

- Existing RLS disallows event/world UPDATE/DELETE for browser clients. This app only inserts messages and creates snapshots via RPCs. Service-role backend code must continue to respect append-only semantics.
- `v1.sql` removes direct token INSERT / arbitrary token UPDATE and arbitrary profile UPDATE grants. Without that correction, a user can attach a token to another agent, or change their human type. Existing permissive RLS policies remain, with table/column grants enforcing the narrower operations.
- UUID room URLs are validated in the app. Event IDs use the same safe JavaScript integer range as the deployed MCP; the database uses bigint.
- Events alone are published to Realtime. Room metadata/world is refreshed on reconciliation and incoming events, so no extra publication is required for V1.
- SQL owner changes should be reviewed against any backend changes made since inspection. Re-running v1.sql replaces only this V1's RPC definitions and repeats its grants.
