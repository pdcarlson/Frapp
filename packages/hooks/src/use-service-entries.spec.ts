import { describe, expect, it } from "vitest";
import {
  selectServiceLeaderboard,
  serviceSemesterStartDate,
} from "./use-service-entries";

describe("selectServiceLeaderboard", () => {
  it("keeps the server's order and drops rows without an id or a number", () => {
    expect(
      selectServiceLeaderboard([
        { user_id: "a", member_name: "A", total_minutes: 300, entry_count: 2 },
        { user_id: "b", total_minutes: "120", entry_count: null },
        { member_name: "no id", total_minutes: 60 },
        { user_id: "c", total_minutes: "lots" },
        null,
      ]),
    ).toEqual([
      { user_id: "a", member_name: "A", total_minutes: 300, entry_count: 2 },
      { user_id: "b", member_name: "", total_minutes: 120, entry_count: 0 },
    ]);
  });

  it("reads anything but an array as an empty board", () => {
    expect(selectServiceLeaderboard(undefined)).toEqual([]);
    expect(selectServiceLeaderboard({ rows: [] })).toEqual([]);
  });
});

describe("serviceSemesterStartDate", () => {
  it("starts the day after the newest archive's end", () => {
    expect(
      serviceSemesterStartDate([
        { end_date: "2026-05-10", created_at: "2026-05-11T00:00:00Z" },
        { end_date: "2025-12-15", created_at: "2025-12-16T00:00:00Z" },
      ]),
    ).toBe("2026-05-11");
  });

  it("is null for a chapter that never rolled over", () => {
    expect(serviceSemesterStartDate([])).toBeNull();
  });
});
