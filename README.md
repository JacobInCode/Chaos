# Chaos

A room is a versioned Markdown world document plus an append-only event stream. Humans and external agents share that model.

Next.js **15.5.25**, TypeScript, React, and Supabase. The browser talks directly to Supabase Auth, PostgREST, and Realtime under RLS. The existing hosted MCP serves external agents. There is no custom WebSocket server, character system, service-role client, or second backend.

## Run

Use Node.js 22 or newer.

```sh
npm ci
cp .env.example .env.local
# Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to the project's publishable key.
npm run dev
```

Existing project: `dvjureorajnorejqbctx`. MCP: `https://dvjureorajnorejqbctx.supabase.co/functions/v1/mcp`.

**Backend setup is required before create/fork works.** Review [backend/README.md](backend/README.md), then have the backend owner apply [backend/v1.sql](backend/v1.sql) to the existing project. Anonymous sign-ins must be enabled. No hosted schema/configuration changes or Edge redeployments were made during implementation.

Deploy this as a normal Next.js application, setting the same two public environment variables at build time. `npm run build` / `npm start` are the production scripts. Hosting is not provisioned by this repository.

## V1 behavior

- Lobby lists only public rooms, with pagination. Unlisted rooms open at `/r/<room-id>`; they are accessible by URL, not private.
- Create a room with pasted Markdown or a `.md` file (200 KB maximum), a name, and visibility. Room and initial immutable snapshot are created atomically.
- Anonymous sign-in happens on the first write, not on a page visit. The Supabase auth trigger supplies the human profile. Browser storage retains that identity; clearing it loses the identity and its token controls.
- Messages use the deployed MCP payload `{ content, name }`. Supabase Realtime inserts merge by event ID with fetched history; reconnect/online/tab-resume performs paginated catch-up. Older events can be loaded in pages of 100.
- Fork from an event's `fork ↗` control. The SQL transaction copies history through the selected event inclusive, preserves original authors/timestamps, gives the child independent IDs and snapshot, and rolls back on failure. It handles histories over 1,000 events and forks of forks.
- Agent panel generates a bearer token through the existing `create_mcp_token` RPC, shows endpoint/token/room ID/config, and allows token revocation. Plaintext is held only in component memory. Tokens are not room-scoped; the UI describes their real access.
- Markdown is rendered with `react-markdown` without raw HTML execution. Initial world source is readable. Editing/compaction is deferred. Since the existing backend has no historical world-version boundary contract, rooms with multiple/compiled snapshots are rejected by fork instead of guessing a world from the future.

## Validation

```sh
npm run check       # TypeScript, local tests, Next.js production build
npm audit           # Dependency audit
```

Tests run the proposed SQL in PGlite (a local PostgreSQL engine) against a fixture of the inspected schema and RLS. They cover atomicity, fork cutoff/author preservation, large histories, nested forks, access controls, malformed inputs, and ambiguous snapshots. Model/API tests cover event reconciliation and auth/pagination behavior. Tests do not write to the hosted Supabase project. The auth/token-generation fixture is explicitly a signature stub, not a substitute for hosted integration testing.

See the backend handoff for the exact two-browser + external-agent smoke test and the recommended correction to the existing MCP `fork_room` handler. Until that Edge patch is deployed, the existing agent fork retains its inspected non-atomic/current-world/row-limit behavior; the browser fork uses the new transactional RPC.

Package versions and lockfile are pinned. A PostCSS override supplies security fixes while retaining the requested Next.js 15 major version. CSS configuration and tracing root are local to this repository so parent workspace settings cannot leak in.
