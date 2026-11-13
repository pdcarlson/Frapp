import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_PREVIEW,
  hoursLabel,
  ownServiceTotals,
  rankServiceLeaderboard,
  visibleLeaderboard,
} from "./service-summary";

const entry = (status: string, date: string, duration_minutes: number) => ({
  status,
  date,
  duration_minutes,
});

describe("ownServiceTotals", () => {
  const entries = [
    entry("APPROVED", "2026-08-20", 90),
    entry("APPROVED", "2026-08-01", 60),
    entry("PENDING", "2026-09-01", 45),
    entry("REJECTED", "2026-09-02", 600),
  ];

  it("counts approved time only, with pending beside it", () => {
    expect(ownServiceTotals(entries, null)).toEqual({
      semesterMinutes: 150,
      allTimeMinutes: 150,
      pendingMinutes: 45,
      pendingCount: 1,
    });
  });

  it("counts this semester from its first day, inclusive", () => {
    expect(ownServiceTotals(entries, "2026-08-20").semesterMinutes).toBe(90);
    expect(ownServiceTotals(entries, "2026-08-21").semesterMinutes).toBe(0);
  });

  it("leaves this semester unknown rather than guessing", () => {
    expect(ownServiceTotals(entries, undefined).semesterMinutes).toBeNull();
  });
});

describe("rankServiceLeaderboard", () => {
  const row = (user_id: string, total_minutes: number) => ({
    user_id,
    member_name: user_id,
    total_minutes,
    entry_count: 1,
  });

  it("shares a place on equal totals and marks the viewer", () => {
    const ranked = rankServiceLeaderboard(
      [row("a", 300), row("b", 120), row("c", 120), row("d", 60)],
      "c",
    );
    expect(ranked.map((r) => [r.user_id, r.rank, r.isViewer])).toEqual([
      ["a", 1, false],
      ["b", 2, false],
      ["c", 2, true],
      ["d", 4, false],
    ]);
  });

  it("marks nobody while the viewer is unknown", () => {
    expect(
      rankServiceLeaderboard([row("a", 1)], null).some((r) => r.isViewer),
    ).toBe(false);
  });
});

describe("visibleLeaderboard", () => {
  const ranked = (n: number, viewerAt: number | null) =>
    Array.from({ length: n }, (_, i) => ({
      user_id: `u${i}`,
      member_name: "",
      total_minutes: n - i,
      entry_count: 1,
      rank: i + 1,
      isViewer: i === viewerAt,
    }));

  it("shows everything that fits", () => {
    const { top, pinned } = visibleLeaderboard(
      ranked(LEADERBOARD_PREVIEW, 9),
      false,
    );
    expect(top).toHaveLength(LEADERBOARD_PREVIEW);
    expect(pinned).toBeNull();
  });

  it("pins a viewer below the preview, and only then", () => {
    expect(visibleLeaderboard(ranked(20, 15), false).pinned?.user_id).toBe(
      "u15",
    );
    expect(visibleLeaderboard(ranked(20, 3), false).pinned).toBeNull();
    expect(visibleLeaderboard(ranked(20, null), false).pinned).toBeNull();
  });

  it("shows every row when expanded", () => {
    const { top, pinned } = visibleLeaderboard(ranked(20, 15), true);
    expect(top).toHaveLength(20);
    expect(pinned).toBeNull();
  });
});

describe("hoursLabel", () => {
  it("drops a whole hour's decimal and keeps a half", () => {
    expect(hoursLabel(120)).toBe("2 h");
    expect(hoursLabel(90)).toBe("1.5 h");
    expect(hoursLabel(0)).toBe("0 h");
  });
});
