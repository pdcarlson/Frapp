import { describe, expect, it } from "vitest";
import {
  buildMemberDisplayNameMap,
  leaderboardSubjectId,
  resolveLeaderboardDisplayName,
} from "./activity-feed-leaderboard";

describe("leaderboardSubjectId", () => {
  it("prefers user_id", () => {
    expect(
      leaderboardSubjectId({
        user_id: "  uuid-1  ",
        userId: "uuid-2",
        member_id: "mem-1",
      }),
    ).toBe("uuid-1");
  });

  it("falls back to userId then member_id", () => {
    expect(leaderboardSubjectId({ userId: "u2" })).toBe("u2");
    expect(leaderboardSubjectId({ member_id: "m1" })).toBe("m1");
  });

  it("falls back to camelCase memberId", () => {
    expect(leaderboardSubjectId({ memberId: "mem-1" })).toBe("mem-1");
  });

  it("falls back to generic id when no user or member keys", () => {
    expect(leaderboardSubjectId({ id: "mem-77" })).toBe("mem-77");
  });
});

describe("resolveLeaderboardDisplayName", () => {
  it("matches on user_id when present", () => {
    const map = buildMemberDisplayNameMap([
      { id: "mem-1", user_id: "user-aa", display_name: "Alex" },
    ]);
    expect(
      resolveLeaderboardDisplayName(
        { user_id: "user-aa", total: 10 },
        map,
      ),
    ).toBe("Alex");
  });

  it("falls back to member_id when user_id does not match the roster", () => {
    const map = buildMemberDisplayNameMap([
      { id: "mem-99", user_id: "user-aa", display_name: "Alex" },
    ]);
    expect(
      resolveLeaderboardDisplayName(
        { user_id: "wrong-uuid", member_id: "mem-99", total: 5 },
        map,
      ),
    ).toBe("Alex");
  });

  it("matches generic id to membership id in the map", () => {
    const map = buildMemberDisplayNameMap([
      { id: "mem-99", user_id: "user-aa", display_name: "Alex" },
    ]);
    expect(resolveLeaderboardDisplayName({ id: "mem-99", total: 1 }, map)).toBe(
      "Alex",
    );
  });
});

describe("buildMemberDisplayNameMap", () => {
  it("indexes by user_id and membership id for the same display name", () => {
    const map = buildMemberDisplayNameMap([
      { id: "mem-99", user_id: "user-aa", display_name: "Alex" },
    ]);
    expect(map.get("user-aa")).toBe("Alex");
    expect(map.get("mem-99")).toBe("Alex");
  });

  it("skips empty display names", () => {
    const map = buildMemberDisplayNameMap([
      { id: "m1", user_id: "u1", display_name: "" },
      { id: "m2", user_id: "u2", display_name: "   " },
    ]);
    expect(map.size).toBe(0);
  });

  it("indexes camelCase userId and displayName", () => {
    const map = buildMemberDisplayNameMap([
      { id: "mem-99", userId: "user-aa", displayName: "Alex" },
    ]);
    expect(map.get("user-aa")).toBe("Alex");
    expect(map.get("mem-99")).toBe("Alex");
  });
});
