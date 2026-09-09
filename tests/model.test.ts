import { describe, expect, it } from "vitest";
import {
  errorMessage,
  eventText,
  mergeEvents,
  validRoomId,
  type RoomEvent,
} from "../lib/model";
const event = (
  id: number,
  payload: RoomEvent["payload"] = { content: "hello" },
): RoomEvent => ({
  id,
  room_id: "room",
  user_id: "human",
  type: "message",
  payload,
  created_at: "2026-09-09T00:00:00Z",
});
describe("event reconciliation", () => {
  it("merges paginated fetches and realtime duplicates in ID order", () => {
    expect(
      mergeEvents([event(9), event(11)], [event(10), event(9), event(8)]).map(
        (e) => e.id,
      ),
    ).toEqual([8, 9, 10, 11]);
  });
  it("rejects unsafe bigint conversion rather than silently collapsing events", () => {
    expect(() => mergeEvents([], [event(Number.MAX_SAFE_INTEGER + 1)])).toThrow(
      /supported range/,
    );
  });
  it("renders only string payload fields and tolerates non-message payloads", () => {
    expect(eventText(event(1), "content")).toBe("hello");
    for (const payload of [
      null,
      [],
      { content: { html: "<script>" } },
      { content: 42 },
    ])
      expect(eventText(event(1, payload), "content")).toBe("");
  });
  it("explains missing backend RPCs and validates room URLs", () => {
    expect(
      errorMessage({
        message: "Could not find public.v1_create_room in the schema cache",
      }),
    ).toContain("backend/v1.sql");
    expect(validRoomId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(validRoomId("../other")).toBe(false);
  });
});
