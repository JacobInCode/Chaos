import type { Tables } from "./database.types";
export type Room = Tables<"rooms">;
export type RoomEvent = Tables<"events">;
export type World = Tables<"world_versions">;
export function mergeEvents(current: RoomEvent[], incoming: RoomEvent[]) {
  const unique = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    if (!Number.isSafeInteger(event.id))
      throw new Error("An event ID exceeds the supported range.");
    unique.set(event.id, event);
  }
  return [...unique.values()].sort((a, b) => a.id - b.id);
}
export function eventText(event: RoomEvent, key: string) {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return "";
  return typeof payload[key] === "string" ? payload[key] : "";
}
export function errorMessage(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
  if (
    /v1_(create|fork)_room/.test(message) &&
    /schema cache|not find|does not exist/.test(message)
  ) {
    return "Room setup is not finished yet. The project owner needs to apply backend/v1.sql, then retry.";
  }
  return message;
}
export function validRoomId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
