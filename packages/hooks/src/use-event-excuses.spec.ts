import { describe, expect, it } from "vitest";
import {
  attendanceSettlesExcuse,
  excuseReceiverLine,
  excuseSummaryLine,
  myExcuseView,
  sortExcusesForReview,
  type EventExcuse,
  type MyEventExcuse,
} from "./use-event-excuses";

/**
 * The member's excuse block on both surfaces (`spec/behavior/events.md`
 * § Excuses, #3735), in the API's terms (`EventExcuseService`).
 */

const START = "2026-11-15T19:00:00Z";
const END = "2026-11-15T20:00:00Z";
const hoursAfterEnd = (h: number) =>
  new Date(new Date(END).getTime() + h * 3_600_000);

const excuse = (status: EventExcuse["status"]): EventExcuse => ({
  id: "x-1",
  chapter_id: "c-1",
  event_id: "e-1",
  user_id: "u-1",
  reason: "Exam review",
  status,
  decided_by: null,
  decided_at: null,
  created_at: "2026-11-12T12:00:00Z",
  updated_at: "2026-11-12T12:00:00Z",
});

const base = {
  required: true,
  mine: { excuse: null, receiver: null } as MyEventExcuse,
  mineLoading: false,
  ownAttendance: { attendance: null },
  ownLoading: false,
  start: START,
  end: END,
  opensMinutes: 15,
  now: new Date("2026-11-12T12:00:00Z"),
};

describe("myExcuseView", () => {
  it("offers Can't make it to a required member with no excuse", () => {
    expect(myExcuseView(base).kind).toBe("offer");
  });

  it("offers nothing on an optional event, which is RSVP's (#1035)", () => {
    expect(myExcuseView({ ...base, required: false }).kind).toBe("none");
  });

  it("holds back while either read is first loading", () => {
    expect(myExcuseView({ ...base, mineLoading: true }).kind).toBe("none");
    expect(myExcuseView({ ...base, ownLoading: true }).kind).toBe("none");
  });

  it("closes 48 hours after the end", () => {
    expect(myExcuseView({ ...base, now: hoursAfterEnd(47) }).kind).toBe(
      "offer",
    );
    expect(myExcuseView({ ...base, now: hoursAfterEnd(49) }).kind).toBe("none");
  });

  it("offers a late excuse over the sweep's ABSENT, not over an officer's", () => {
    const now = hoursAfterEnd(12);
    const absent = (marked_by: string | null) => ({
      attendance: { status: "ABSENT", marked_by },
    });
    expect(
      myExcuseView({ ...base, now, ownAttendance: absent(null) }).kind,
    ).toBe("offer");
    expect(
      myExcuseView({ ...base, now, ownAttendance: absent("officer") }).kind,
    ).toBe("none");
  });

  it("names the receiver of a pending excuse and lets it be withdrawn", () => {
    const view = myExcuseView({
      ...base,
      mine: {
        excuse: excuse("PENDING"),
        receiver: { user_id: "u-2", display_name: "Jake" },
      },
    });
    expect(view).toMatchObject({
      kind: "sent",
      title: "Excuse sent to Jake",
      canWithdraw: true,
    });
  });

  it("stops offering Withdraw once check-in closes", () => {
    const view = myExcuseView({
      ...base,
      now: hoursAfterEnd(1),
      mine: { excuse: excuse("APPROVED"), receiver: null },
    });
    expect(view).toMatchObject({ title: "Excused", canWithdraw: false });
  });

  it("never offers Withdraw on a declined excuse", () => {
    const view = myExcuseView({
      ...base,
      mine: { excuse: excuse("DECLINED"), receiver: null },
    });
    expect(view).toMatchObject({
      title: "Excuse not accepted",
      canWithdraw: false,
    });
  });
});

describe("excuse helpers", () => {
  it("words a null receiver as the officers, without a name", () => {
    expect(excuseReceiverLine(null)).toBe("Excuse sent to the officers");
    expect(excuseReceiverLine({ user_id: "u", display_name: "  " })).toBe(
      "Excuse sent to the officers",
    );
  });

  it("settles on a check-in, an excused row, or an officer's absent", () => {
    const row = (status: string, marked_by: string | null = null) => ({
      attendance: { status, marked_by },
    });
    expect(attendanceSettlesExcuse(row("PRESENT"))).toBe(true);
    expect(attendanceSettlesExcuse(row("LATE"))).toBe(true);
    expect(attendanceSettlesExcuse(row("EXCUSED"))).toBe(true);
    expect(attendanceSettlesExcuse(row("ABSENT", "o"))).toBe(true);
    expect(attendanceSettlesExcuse(row("ABSENT"))).toBe(false);
    expect(attendanceSettlesExcuse({ attendance: null })).toBe(false);
  });

  it("summarises what's left to decide and who is excused", () => {
    const rows = [excuse("PENDING"), excuse("PENDING"), excuse("APPROVED")];
    expect(excuseSummaryLine(rows, 12)).toBe("2 to decide · 12 excused");
    expect(excuseSummaryLine([], 0)).toBeNull();
  });

  it("puts pending excuses first, oldest first", () => {
    const rows = [
      { ...excuse("APPROVED"), id: "a", created_at: "2026-11-10T00:00:00Z" },
      { ...excuse("PENDING"), id: "b", created_at: "2026-11-12T00:00:00Z" },
      { ...excuse("PENDING"), id: "c", created_at: "2026-11-11T00:00:00Z" },
    ];
    expect(sortExcusesForReview(rows).map((row) => row.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
});
