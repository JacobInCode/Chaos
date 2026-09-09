import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  profile: vi.fn(),
  pages: [] as unknown[][],
  cursors: [] as number[],
}));
vi.mock("../lib/supabase", () => ({
  db: () => ({
    auth: {
      getSession: mock.getSession,
      signInAnonymously: mock.signInAnonymously,
    },
    from: (table: string) => {
      if (table === "users")
        return {
          update: () => ({
            eq: () => ({ select: () => ({ single: mock.profile }) }),
          }),
        };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        gt: (_: string, after: number) => {
          mock.cursors.push(after);
          return chain;
        },
        limit: async () => ({ data: mock.pages.shift() ?? [], error: null }),
      };
      return chain;
    },
  }),
}));
import { catchUpEvents, ensureHuman } from "../lib/api";
beforeEach(() => {
  vi.clearAllMocks();
  mock.pages = [];
  mock.cursors = [];
  mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mock.signInAnonymously.mockResolvedValue({
    data: { user: { id: "human" } },
    error: null,
  });
  mock.profile.mockResolvedValue({ data: { id: "human" }, error: null });
});
describe("anonymous identity and catch-up", () => {
  it("coalesces simultaneous first writes into one anonymous sign-in", async () => {
    expect(
      await Promise.all([ensureHuman("Alice"), ensureHuman("Alice")]),
    ).toEqual(["human", "human"]);
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(mock.signInAnonymously).toHaveBeenCalledWith({
      options: { data: { name: "Alice" } },
    });
  });
  it("reuses the existing browser session", async () => {
    mock.getSession.mockResolvedValue({
      data: { session: { user: { id: "existing" } } },
      error: null,
    });
    expect(await ensureHuman("Alice")).toBe("existing");
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
  });
  it("releases the sign-in lock after a failed attempt", async () => {
    mock.signInAnonymously.mockResolvedValueOnce({
      data: { user: null },
      error: new Error("Sign-ins disabled"),
    });
    await expect(ensureHuman("Alice")).rejects.toThrow("Sign-ins disabled");
    expect(await ensureHuman("Alice")).toBe("human");
  });
  it("fetches every missed page with an advancing cursor", async () => {
    mock.pages = [
      Array.from({ length: 500 }, (_, i) => ({ id: i + 11 })),
      [{ id: 511 }, { id: 512 }],
    ];
    const result = await catchUpEvents("room", 10);
    expect(result).toHaveLength(502);
    expect(mock.cursors).toEqual([10, 510]);
  });
});
