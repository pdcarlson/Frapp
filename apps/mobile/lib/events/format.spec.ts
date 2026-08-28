import { describe, expect, it } from "vitest";
import {
  CHECK_IN_GRACE_MINUTES,
  formatCountdown,
  formatEventRowTime,
  formatEventWindow,
  isCurrentOrUpcoming,
  resolveCheckInWindow,
  sortEventsByStart,
} from "./format";

/**
 * Times are built from local-time constructors, not ISO strings with a zone:
 * every label here is produced by `toLocaleTimeString`/`toLocaleDateString`,
 * which read the runtime's zone. Pinning an offset in the fixture would make
 * these assertions pass or fail based on where CI happens to run.
 */
function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

const iso = (date: Date) => date.toISOString();

describe("formatEventWindow", () => {
  const now = at(2026, 3, 10, 14, 0);

  it('says "Tonight" for an evening event today', () => {
    const label = formatEventWindow(
      iso(at(2026, 3, 10, 18, 0)),
      iso(at(2026, 3, 10, 19, 0)),
      now,
    );
    expect(label).toMatch(/^Tonight · /);
    expect(label).toContain("–");
  });

  it('says "Today", not "Tonight", for a morning event today', () => {
    // The drawn copy is "Tonight · 6:00 – 7:00 PM"; a 9am meeting is not that.
    const label = formatEventWindow(
      iso(at(2026, 3, 10, 9, 0)),
      iso(at(2026, 3, 10, 10, 0)),
      now,
    );
    expect(label).toMatch(/^Today · /);
  });

  it("names tomorrow, the weekday inside a week, and the date beyond it", () => {
    expect(
      formatEventWindow(
        iso(at(2026, 3, 11, 18, 0)),
        iso(at(2026, 3, 11, 19, 0)),
        now,
      ),
    ).toMatch(/^Tomorrow · /);

    expect(
      formatEventWindow(
        iso(at(2026, 3, 13, 18, 0)),
        iso(at(2026, 3, 13, 19, 0)),
        now,
      ),
    ).toMatch(/^Friday · /);

    // Beyond a week: an explicit date, since "Tuesday" would be ambiguous.
    expect(
      formatEventWindow(
        iso(at(2026, 4, 21, 18, 0)),
        iso(at(2026, 4, 21, 19, 0)),
        now,
      ),
    ).toMatch(/Apr/);
  });

  it("returns an empty string rather than rendering Invalid Date", () => {
    expect(formatEventWindow("not-a-date", "also-not", now)).toBe("");
    expect(formatEventWindow("", "", now)).toBe("");
  });

  it("still renders a start time when the end time is unusable", () => {
    const label = formatEventWindow(iso(at(2026, 3, 10, 18, 0)), "", now);
    expect(label).toMatch(/^Tonight · /);
    expect(label).not.toContain("–");
  });
});

describe("formatEventRowTime", () => {
  const now = at(2026, 3, 10, 14, 0);

  it("labels today, tomorrow, this week and later", () => {
    expect(formatEventRowTime(iso(at(2026, 3, 10, 18, 0)), now)).toMatch(
      /^Today · /,
    );
    expect(formatEventRowTime(iso(at(2026, 3, 11, 18, 0)), now)).toMatch(
      /^Tomorrow · /,
    );
    expect(formatEventRowTime(iso(at(2026, 3, 13, 18, 0)), now)).toMatch(
      /^Friday · /,
    );
    expect(formatEventRowTime(iso(at(2026, 4, 21, 18, 0)), now)).toMatch(/Apr/);
  });

  it("returns an empty string for unusable input", () => {
    expect(formatEventRowTime("nope", now)).toBe("");
  });
});

describe("resolveCheckInWindow", () => {
  const start = at(2026, 3, 10, 18, 0);
  const end = at(2026, 3, 10, 19, 0);

  it("is upcoming before the start", () => {
    const window = resolveCheckInWindow(
      iso(start),
      iso(end),
      at(2026, 3, 10, 17, 45),
    );
    expect(window.state).toBe("upcoming");
    expect(window.opensAt?.getTime()).toBe(start.getTime());
  });

  it("is open during the event", () => {
    expect(
      resolveCheckInWindow(iso(start), iso(end), at(2026, 3, 10, 18, 30)).state,
    ).toBe("open");
  });

  it("stays open through the grace period and closes after it", () => {
    // The boundary that decides whether the screen offers a check-in the
    // server would reject.
    const graceEnd = new Date(end.getTime() + CHECK_IN_GRACE_MINUTES * 60_000);

    expect(
      resolveCheckInWindow(
        iso(start),
        iso(end),
        new Date(graceEnd.getTime() - 1_000),
      ).state,
    ).toBe("open");
    expect(
      resolveCheckInWindow(
        iso(start),
        iso(end),
        new Date(graceEnd.getTime() + 1_000),
      ).state,
    ).toBe("closed");
    expect(
      resolveCheckInWindow(iso(start), iso(end), at(2026, 3, 10, 18, 30))
        .closesAt?.getTime(),
    ).toBe(graceEnd.getTime());
  });

  it('reports "unknown" for unparseable times instead of guessing open', () => {
    // Failing to "open" would offer a check-in the client cannot reason about.
    const window = resolveCheckInWindow("garbage", "garbage", new Date());
    expect(window.state).toBe("unknown");
    expect(window.closesAt).toBeNull();
  });
});

describe("sortEventsByStart", () => {
  it("orders ascending and drops rows with no usable start", () => {
    const sorted = sortEventsByStart([
      { id: "late", start_time: iso(at(2026, 3, 12, 9, 0)) },
      { id: "broken", start_time: "nonsense" },
      { id: "early", start_time: iso(at(2026, 3, 10, 9, 0)) },
      { id: "missing" },
    ]);

    expect(sorted.map((event) => event.id)).toEqual(["early", "late"]);
  });
});

describe("isCurrentOrUpcoming", () => {
  const now = at(2026, 3, 10, 14, 0);

  it("keeps upcoming and in-window events, drops finished ones", () => {
    expect(
      isCurrentOrUpcoming(
        iso(at(2026, 3, 10, 18, 0)),
        iso(at(2026, 3, 10, 19, 0)),
        now,
      ),
    ).toBe(true);
    expect(
      isCurrentOrUpcoming(
        iso(at(2026, 3, 9, 18, 0)),
        iso(at(2026, 3, 9, 19, 0)),
        now,
      ),
    ).toBe(false);
  });

  it("keeps an event whose grace period has not closed", () => {
    const start = at(2026, 3, 10, 13, 0);
    const end = at(2026, 3, 10, 13, 50);
    expect(isCurrentOrUpcoming(iso(start), iso(end), now)).toBe(true);
  });
});

describe("formatCountdown", () => {
  it("renders mm:ss", () => {
    expect(formatCountdown(21_000)).toBe("0:21");
    expect(formatCountdown(9_000)).toBe("0:09");
    expect(formatCountdown(65_000)).toBe("1:05");
  });

  it("clamps at zero rather than rendering a negative countdown", () => {
    // A late refetch must read as "rotating now", not "-0:03".
    expect(formatCountdown(-3_000)).toBe("0:00");
  });
});
