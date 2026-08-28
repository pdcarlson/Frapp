import { describe, expect, it } from "vitest";
import {
  creditedSeconds,
  endedNotice,
  isReportingStale,
  isPaused,
  isTerminal,
  narrowSession,
  selectActiveSession,
  selectSessionHistory,
  selectSessions,
  settleIfEnded,
  TERMINAL_STATUSES,
} from "./session";

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "ss-1",
    chapter_id: "c-1",
    user_id: "u-1",
    geofence_id: "gf-1",
    status: "ACTIVE",
    start_time: "2026-08-18T14:00:00.000Z",
    end_time: null,
    last_heartbeat_at: "2026-08-18T14:30:00.000Z",
    paused_at: null,
    total_foreground_minutes: 30,
    points_awarded: false,
    ...overrides,
  };
}

describe("narrowSession", () => {
  it("narrows a session row into a drawable model", () => {
    const model = narrowSession(session());
    expect(model?.id).toBe("ss-1");
    expect(model?.status).toBe("ACTIVE");
    expect(model?.geofenceId).toBe("gf-1");
    expect(model?.totalForegroundMinutes).toBe(30);
    expect(model?.pointsAwarded).toBe(false);
  });

  it("drops a row with an unknown status rather than rendering it", () => {
    expect(narrowSession(session({ status: "PENDING" }))).toBeNull();
  });

  it("drops a row with no id or no start time", () => {
    expect(narrowSession(session({ id: null }))).toBeNull();
    expect(narrowSession(session({ start_time: "" }))).toBeNull();
  });

  it("defaults the credit watermark to the start instant, not the epoch", () => {
    const model = narrowSession(session({ last_heartbeat_at: null }));
    expect(model?.lastHeartbeatAt).toBe("2026-08-18T14:00:00.000Z");
  });

  it("returns null for anything that is not a record", () => {
    expect(narrowSession(null)).toBeNull();
    expect(narrowSession([session()])).toBeNull();
    expect(narrowSession("ss-1")).toBeNull();
  });
});

describe("status predicates", () => {
  it("treats every non-ACTIVE status as terminal", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual([
      "COMPLETED",
      "EXPIRED",
      "LOCATION_INVALID",
      "PAUSED_EXPIRED",
    ]);
    expect(isTerminal("ACTIVE")).toBe(false);
  });

  it("reads pausing off paused_at, because a paused session is still ACTIVE", () => {
    const paused = narrowSession(
      session({ paused_at: "2026-08-18T14:31:00.000Z" }),
    )!;
    expect(paused.status).toBe("ACTIVE");
    expect(isPaused(paused)).toBe(true);
    expect(isPaused(narrowSession(session())!)).toBe(false);
  });

  it("does not call a closed session paused, even with paused_at set", () => {
    const expired = narrowSession(
      session({ status: "PAUSED_EXPIRED", paused_at: "2026-08-18T14:31:00.000Z" }),
    )!;
    expect(isPaused(expired)).toBe(false);
  });
});

describe("selectSessions", () => {
  it("sorts newest first and skips unreadable rows", () => {
    const rows = selectSessions([
      session({ id: "older", start_time: "2026-08-17T14:00:00.000Z" }),
      session({ id: "newer", start_time: "2026-08-18T14:00:00.000Z" }),
      { id: "broken" },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["newer", "older"]);
  });

  it("returns an empty list for a non-array body", () => {
    expect(selectSessions(undefined)).toEqual([]);
    expect(selectSessions({ sessions: [] })).toEqual([]);
  });
});

describe("selectActiveSession", () => {
  it("recovers the live session across a relaunch", () => {
    const active = selectActiveSession([
      session({ id: "done", status: "COMPLETED" }),
      session({ id: "live", status: "ACTIVE" }),
    ]);
    expect(active?.id).toBe("live");
  });

  it("finds a paused session, which is still ACTIVE server-side", () => {
    const active = selectActiveSession([
      session({ id: "live", paused_at: "2026-08-18T14:31:00.000Z" }),
    ]);
    expect(active?.id).toBe("live");
  });

  it("returns null when everything has closed", () => {
    expect(
      selectActiveSession([session({ status: "EXPIRED" })]),
    ).toBeNull();
  });
});

describe("selectSessionHistory", () => {
  it("keeps only closed sessions, so the live one is never listed twice", () => {
    const history = selectSessionHistory([
      session({ id: "live", status: "ACTIVE" }),
      session({ id: "done", status: "COMPLETED" }),
    ]);
    expect(history.map((row) => row.id)).toEqual(["done"]);
  });
});

describe("creditedSeconds", () => {
  const now = new Date("2026-08-18T14:34:00.000Z");

  it("adds only the gap since the watermark, never since the start", () => {
    // Banked 30 min, watermark at 14:30, now 14:34 → 30 min + 4 min.
    // Counting from start_time would say 34 min of a session that has been
    // credited for 30 — the inflation patterns.md bans.
    expect(creditedSeconds(narrowSession(session())!, now)).toBe(34 * 60);
  });

  it("freezes at the banked total while paused", () => {
    const paused = narrowSession(
      session({ paused_at: "2026-08-18T14:31:00.000Z" }),
    )!;
    expect(creditedSeconds(paused, now)).toBe(30 * 60);
  });

  it("freezes at the banked total once the session is closed", () => {
    const done = narrowSession(session({ status: "COMPLETED" }))!;
    expect(creditedSeconds(done, now)).toBe(30 * 60);
  });

  it("never runs backwards when the watermark is ahead of the device clock", () => {
    const skewed = narrowSession(
      session({ last_heartbeat_at: "2026-08-18T15:00:00.000Z" }),
    )!;
    expect(creditedSeconds(skewed, now)).toBe(30 * 60);
  });

  it("stops climbing once the server has already decided to void the session", () => {
    // 40 minutes of failed heartbeats in a basement. Unclamped, the card ticks
    // smoothly to 0:70:00 for time the stale-heartbeat rule will not credit —
    // and then pays nothing. The clamp keeps the number honest; the screen's
    // `isReportingStale` warning is what tells the member.
    const stale = narrowSession(session())!;
    const muchLater = new Date("2026-08-18T15:10:00.000Z");
    expect(creditedSeconds(stale, muchLater)).toBe(30 * 60 + 10 * 60);
  });

  it("falls back to the banked total on an unparseable watermark", () => {
    const broken = narrowSession(session({ last_heartbeat_at: "soon" }))!;
    expect(creditedSeconds(broken, now)).toBe(30 * 60);
  });
});

describe("settleIfEnded", () => {
  it("treats a terminal 200 body as the end of the session", () => {
    const result = settleIfEnded(session({ status: "PAUSED_EXPIRED" }), "ss-1");
    expect(result.ended).toBe(true);
    if (result.ended) {
      expect(result.session.status).toBe("PAUSED_EXPIRED");
      expect(result.notice).toContain("background");
    }
  });

  it("leaves an ACTIVE response alone", () => {
    expect(settleIfEnded(session(), "ss-1").ended).toBe(false);
  });

  it("ignores a terminal response for a session the screen no longer holds", () => {
    // The real sequence: a pause fired on background lands after the member has
    // returned and started a fresh session. Without the id check its terminal
    // body would wipe the live one.
    const late = settleIfEnded(
      session({ id: "ss-old", status: "PAUSED_EXPIRED" }),
      "ss-2",
    );
    expect(late.ended).toBe(false);
  });

  it("settles against an unknown holder, so a cold response is not dropped", () => {
    expect(settleIfEnded(session({ status: "EXPIRED" }), null).ended).toBe(true);
  });

  it("ignores a body it cannot narrow", () => {
    expect(settleIfEnded({ ok: true }, "ss-1").ended).toBe(false);
  });
});

describe("endedNotice", () => {
  it("does not describe a points-awarding close as a loss", () => {
    const completed = endedNotice(narrowSession(session({ status: "COMPLETED" }))!);
    const graceLapsed = endedNotice(
      narrowSession(session({ status: "PAUSED_EXPIRED" }))!,
    );
    expect(completed).not.toContain("No points");
    expect(graceLapsed).not.toContain("No points");
  });

  it("says plainly that a zero-award close earned nothing", () => {
    expect(endedNotice(narrowSession(session({ status: "EXPIRED" }))!)).toContain(
      "No points",
    );
    expect(
      endedNotice(narrowSession(session({ status: "LOCATION_INVALID" }))!),
    ).toContain("No points");
  });
});

describe("isReportingStale", () => {
  it("warns before the void, not after it is too late to act", () => {
    const running = narrowSession(session())!;
    // Watermark 14:30. One heartbeat interval later is fine.
    expect(
      isReportingStale(running, new Date("2026-08-18T14:34:00.000Z")),
    ).toBe(false);
    // Past one missed beat, and still inside the 10-minute void window.
    expect(
      isReportingStale(running, new Date("2026-08-18T14:37:00.000Z")),
    ).toBe(true);
  });

  it("says nothing about a paused or closed session, where it is meaningless", () => {
    const paused = narrowSession(
      session({ paused_at: "2026-08-18T14:31:00.000Z" }),
    )!;
    const done = narrowSession(session({ status: "COMPLETED" }))!;
    const late = new Date("2026-08-18T16:00:00.000Z");
    expect(isReportingStale(paused, late)).toBe(false);
    expect(isReportingStale(done, late)).toBe(false);
  });
});
