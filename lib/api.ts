import { db } from "./supabase";
import type { RoomEvent } from "./model";
let signingIn: Promise<string> | undefined;
export async function ensureHuman(name: string): Promise<string> {
  if (signingIn) return signingIn;
  signingIn = (async () => {
    const client = db();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    let user = data.session?.user;
    if (!user) {
      const result = await client.auth.signInAnonymously({
        options: { data: { name: name.trim() || "Anonymous" } },
      });
      if (result.error) throw result.error;
      user = result.data.user ?? undefined;
    }
    if (!user) throw new Error("Anonymous sign-in did not return a user.");
    const result = await client
      .from("users")
      .update({ name: name.trim() || "Anonymous" })
      .eq("id", user.id)
      .select("id")
      .single();
    if (result.error) throw result.error;
    return user.id;
  })();
  try {
    return await signingIn;
  } finally {
    signingIn = undefined;
  }
}
export async function getRoom(id: string) {
  const { data, error } = await db()
    .from("rooms")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  const world = data.current_world_version_id
    ? await db()
        .from("world_versions")
        .select("*")
        .eq("id", data.current_world_version_id)
        .eq("room_id", id)
        .single()
    : { data: null, error: null };
  if (world.error) throw world.error;
  return { room: data, world: world.data };
}
export async function recentEvents(roomId: string, before?: number) {
  let query = db()
    .from("events")
    .select("*")
    .eq("room_id", roomId)
    .order("id", { ascending: false })
    .limit(100);
  if (before !== undefined) query = query.lt("id", before);
  const { data, error } = await query;
  if (error) throw error;
  return data.reverse();
}
export async function catchUpEvents(
  roomId: string,
  after: number,
): Promise<RoomEvent[]> {
  const events: RoomEvent[] = [];
  while (true) {
    const { data, error } = await db()
      .from("events")
      .select("*")
      .eq("room_id", roomId)
      .gt("id", after)
      .order("id")
      .limit(500);
    if (error) throw error;
    events.push(...data);
    if (data.length < 500) return events;
    after = data[data.length - 1].id;
  }
}
