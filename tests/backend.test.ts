import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const agent = "33333333-3333-4333-8333-333333333333";
let db: PGlite;
async function role(name = "authenticated", uid = owner) {
  await db.exec(
    `reset role; set request.jwt.claim.sub = '${uid}'; set request.jwt.claim.role = '${name}'; set role ${name};`,
  );
}
async function create(name = "Original") {
  const { rows } = await db.query<{ id: string }>(
    "select public.v1_create_room($1,'unlisted','# Initial world') id",
    [name],
  );
  return rows[0].id;
}
async function message(room: string, author = owner, content = "hello") {
  const { rows } = await db.query<{ id: number }>(
    "insert into public.events(room_id,user_id,type,payload) values($1,$2,'message',jsonb_build_object('content',$3::text)) returning id",
    [room, author, content],
  );
  return rows[0].id;
}
async function fork(room: string, cutoff: number) {
  const { rows } = await db.query<{ id: string }>(
    "select public.v1_fork_room($1,$2,'Child','unlisted') id",
    [room, cutoff],
  );
  return rows[0].id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/backend-fixture.sql", "utf8"));
  await db.exec(readFileSync("backend/v1.sql", "utf8"));
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    "reset role; truncate public.mcp_tokens,public.events,public.world_versions,public.rooms,public.users restart identity cascade;",
  );
  await db.query(
    "insert into public.users(id,type,name) values($1,'human','Owner'),($2,'human','Other'),($3,'agent','Agent')",
    [owner, other, agent],
  );
  await role();
});
describe("transactional V1 against inspected RLS", () => {
  it("creates a room and its immutable snapshot together", async () => {
    const id = await create();
    const result = await db.query<{ markdown: string }>(
      "select w.markdown from public.rooms r join public.world_versions w on w.id=r.current_world_version_id and w.room_id=r.id where r.id=$1",
      [id],
    );
    expect(result.rows[0].markdown).toBe("# Initial world");
    expect(
      (
        await db.query(
          "update public.world_versions set markdown='changed' returning id",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("rejects unauthenticated creation and invalid inputs", async () => {
    await role("anon", "");
    await expect(create()).rejects.toThrow(/permission denied/);
    await role();
    await expect(create("   ")).rejects.toThrow(/Room name/);
    await expect(
      db.query("select public.v1_create_room('x','private','# world')"),
    ).rejects.toThrow(/visibility/);
    await expect(
      db.query("select public.v1_create_room('x','public',repeat('a',200001))"),
    ).rejects.toThrow(/200 KB/);
    expect((await db.query("select * from public.rooms")).rows).toHaveLength(0);
  });
  it("forks inclusive history with original authors and no later events", async () => {
    const source = await create();
    await message(source);
    await role("authenticated", other);
    const cutoff = await message(source, other, "other voice");
    await role();
    await message(source, owner, "future");
    const child = await fork(source, cutoff);
    const history = await db.query<{
      user_id: string;
      payload: { content: string };
    }>(
      "select user_id,payload from public.events where room_id=$1 order by id",
      [child],
    );
    expect(history.rows.map((row) => row.user_id)).toEqual([owner, other]);
    expect(history.rows.map((row) => row.payload.content)).toEqual([
      "hello",
      "other voice",
    ]);
    const original = await db.query(
      "select * from public.events where room_id=$1",
      [source],
    );
    expect(original.rows).toHaveLength(3);
    const provenance = await db.query<{
      forked_from_room_id: string;
      forked_at_event_id: number;
    }>("select * from public.rooms where id=$1", [child]);
    expect(provenance.rows[0]).toMatchObject({
      forked_from_room_id: source,
      forked_at_event_id: cutoff,
    });
  });
  it("copies more than the REST 1000-row cap and supports a fork of a fork", async () => {
    const source = await create();
    await db.query(
      "insert into public.events(room_id,user_id,type,payload) select $1,$2,'message',jsonb_build_object('content',n::text) from generate_series(1,1205) n",
      [source, owner],
    );
    const child = await fork(source, 1202);
    const { rows } = await db.query<{ id: number }>(
      "select id from public.events where room_id=$1 order by id",
      [child],
    );
    expect(rows).toHaveLength(1202);
    const grandchild = await fork(child, rows[10].id);
    expect(
      (
        await db.query("select id from public.events where room_id=$1", [
          grandchild,
        ])
      ).rows,
    ).toHaveLength(11);
  });
  it("rejects mismatched cutoffs and ambiguous historical worlds before writing", async () => {
    const source = await create();
    const elsewhere = await create("Elsewhere");
    const foreignEvent = await message(elsewhere);
    await expect(fork(source, foreignEvent)).rejects.toThrow(/does not belong/);
    const cutoff = await message(source);
    await db.query(
      "insert into public.world_versions(room_id,markdown) values($1,'# Future')",
      [source],
    );
    await expect(fork(source, cutoff)).rejects.toThrow(
      /historical world-version contract/,
    );
    expect((await db.query("select * from public.rooms")).rows).toHaveLength(2);
  });
  it("rolls back a fork if copying fails midway", async () => {
    const source = await create();
    const cutoff = await message(source);
    await db.exec(
      `reset role; create function public.reject_copy() returns trigger language plpgsql as $$ begin if new.room_id <> '${source}'::uuid then raise exception 'simulated copy failure'; end if; return new; end $$; create trigger reject_copy before insert on public.events for each row execute function public.reject_copy();`,
    );
    await role();
    try {
      await expect(fork(source, cutoff)).rejects.toThrow(
        /simulated copy failure/,
      );
    } finally {
      await db.exec(
        "reset role; drop trigger reject_copy on public.events; drop function public.reject_copy();",
      );
      await role();
    }
    expect((await db.query("select * from public.rooms")).rows).toHaveLength(1);
    expect(
      (await db.query("select * from public.world_versions")).rows,
    ).toHaveLength(1);
  });
  it("blocks author impersonation, token reassignment, and human type changes", async () => {
    const source = await create();
    await expect(message(source, other)).rejects.toThrow(/row-level security/);
    await expect(
      db.query("update public.users set type='agent' where id=$1", [owner]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        "insert into public.mcp_tokens(owner_user_id,agent_user_id,token_hash) values($1,$2,'fake')",
        [owner, agent],
      ),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    await db.query(
      "insert into public.mcp_tokens(owner_user_id,agent_user_id,token_hash) values($1,$2,'fixture')",
      [owner, agent],
    );
    await role();
    await expect(
      db.query("update public.mcp_tokens set agent_user_id=$1", [other]),
    ).rejects.toThrow(/permission denied/);
    expect(
      (
        await db.query(
          "update public.mcp_tokens set revoked_at=now() returning id",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("prevents human callers from choosing another owner or using the agent RPC", async () => {
    const source = await create();
    const cutoff = await message(source);
    await expect(
      db.query("select chaos_private.fork_room($1,$2,$3,'x','unlisted')", [
        other,
        source,
        cutoff,
      ]),
    ).rejects.toThrow(/another user/);
    await expect(
      db.query(
        "select public.v1_fork_room_for_agent($1,$2,$3,'x','unlisted')",
        [other, source, cutoff],
      ),
    ).rejects.toThrow(/permission denied/);
    await role("service_role", "");
    const result = await db.query<{ id: string }>(
      "select public.v1_fork_room_for_agent($1,$2,$3,'Agent fork','unlisted') id",
      [owner, source, cutoff],
    );
    expect(result.rows[0].id).toBeTruthy();
  });
});
