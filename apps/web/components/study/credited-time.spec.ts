import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_STALE_SECONDS,
  creditedSeconds,
  selectActiveSession,
} from "./credited-time";

const now = new Date("2026-09-09T12:00:00.000Z");

function session(
  overrides: Partial<{
    id: string;
    status: string;
    start_time: string;
    last_heartbeat_at: string | null;
    paused_at: string | null;
    total_foreground_minutes: number;
  }> = {},
) {
  return {
    id: "sess-1",
    status: "ACTIVE",
    start_time: "2026-09-09T11:26:00.000Z",
    last_heartbeat_at: "2026-09-09T11:26:00.000Z",
    paused_at: null,
    total_foreground_minutes: 30,
    ...overrides,
  };
}

describe("selectActiveSession", () => {
  it("returns the ACTIVE row even when history sits beside it", () => {
    expect(
      selectActiveSession([
        session({ id: "done", status: "COMPLETED" }),
        session({ id: "live" }),
      ])?.id,
    ).toBe("live");
  });

  it("reads pausing off paused_at — a paused session is still ACTIVE", () => {
    expect(
      selectActiveSession([session({ paused_at: "2026-09-09T11:50:00.000Z" })]),
    ).not.toBeNull();
  });

  it("returns null when every row is terminal", () => {
    expect(selectActiveSession([session({ status: "EXPIRED" })])).toBeNull();
  });
});

describe("creditedSeconds", () => {
  it("adds the gap since the watermark to the banked minutes", () => {
    // 30 banked minutes + 4 minutes since last heartbeat.
    expect(
      creditedSeconds(
        session({ last_heartbeat_at: "2026-09-09T11:56:00.000Z" }),
        now,
      ),
    ).toBe(30 * 60 + 4 * 60);
  });

  it("does not add wall time while paused", () => {
    expect(
      creditedSeconds(session({ paused_at: "2026-09-09T11:50:00.000Z" }), now),
    ).toBe(30 * 60);
  });

  it("does not add wall time after the session ended", () => {
    expect(creditedSeconds(session({ status: "COMPLETED" }), now)).toBe(
      30 * 60,
    );
  });

  it("falls back to start_time when no heartbeat has landed", () => {
    expect(
      creditedSeconds(
        session({
          last_heartbeat_at: null,
          total_foreground_minutes: 0,
          start_time: "2026-09-09T11:55:00.000Z",
        }),
        now,
      ),
    ).toBe(5 * 60);
  });

  it("clamps the open gap at the stale-heartbeat window", () => {
    expect(
      creditedSeconds(
        session({ last_heartbeat_at: "2026-09-09T11:00:00.000Z" }),
        now,
      ),
    ).toBe(30 * 60 + HEARTBEAT_STALE_SECONDS);
  });
});
