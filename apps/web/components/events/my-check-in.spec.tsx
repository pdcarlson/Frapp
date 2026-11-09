import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mine, mutateAsync, mockToast, clock } = vi.hoisted(() => ({
  mine: {
    value: {
      data: { attendance: null } as unknown,
      isPending: false,
      fetchStatus: "idle",
    },
  },
  mutateAsync: vi.fn(),
  mockToast: vi.fn(),
  clock: { now: 0 },
}));

vi.mock("@repo/hooks", () => ({
  useMyAttendance: () => mine.value,
  useCheckIn: () => ({ mutateAsync, isPending: false }),
  useNow: () => clock.now,
}));

vi.mock("@/components/shared/subscription-gate", () => ({
  useSubscriptionGate: () => ({
    controlProps: (disabled: boolean) => ({ disabled }),
  }),
  SubscriptionNotice: () => null,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import {
  MyCheckIn,
  myCheckInView,
  readOwnAttendance,
  type ZoneState,
} from "./my-check-in";

// Local times, so the same-day labels hold in any test runner's zone.
const start = new Date(2026, 10, 9, 19, 0);
const end = new Date(2026, 10, 9, 21, 0);
const during = new Date(2026, 10, 9, 19, 30);

function view(
  overrides: Partial<Parameters<typeof myCheckInView>[0]> = {},
) {
  return myCheckInView({
    own: null,
    ownLoading: false,
    start: start.toISOString(),
    end: end.toISOString(),
    opensMinutes: undefined,
    zone: "none",
    now: during,
    ...overrides,
  });
}

describe("readOwnAttendance", () => {
  it("reads the row out of `/attendance/me`'s answer", () => {
    expect(
      readOwnAttendance({
        attendance: { status: "LATE", check_in_time: "2026-11-09T19:05:00Z" },
      }),
    ).toEqual({ status: "LATE", checkInTime: "2026-11-09T19:05:00Z" });
  });

  it("is null for no row or an unreadable one", () => {
    expect(readOwnAttendance({ attendance: null })).toBeNull();
    expect(readOwnAttendance({ attendance: { status: "GONE" } })).toBeNull();
    expect(readOwnAttendance(undefined)).toBeNull();
  });
});

describe("myCheckInView", () => {
  it("says when a member checked in, for PRESENT and LATE alike", () => {
    for (const status of ["PRESENT", "LATE"] as const) {
      const at = new Date(2026, 10, 9, 19, 5).toISOString();
      const result = view({ own: { status, checkInTime: at } });
      expect(result.kind).toBe("checked-in");
      expect(result).toMatchObject({
        label: expect.stringMatching(/^Checked in 7:05\sPM$/),
      });
    }
  });

  it("names an officer's mark, ABSENT and EXCUSED included, as mobile does", () => {
    expect(view({ own: { status: "EXCUSED", checkInTime: null } })).toEqual({
      kind: "marked",
      label: "Marked excused",
    });
    expect(view({ own: { status: "ABSENT", checkInTime: null } })).toEqual({
      kind: "marked",
      label: "Marked absent",
    });
    // Marked present by hand: a row, but no check-in time to state.
    expect(view({ own: { status: "PRESENT", checkInTime: null } })).toEqual({
      kind: "marked",
      label: "Marked present",
    });
  });

  it("holds while the row is first read, so Check in never flashes", () => {
    expect(view({ ownLoading: true })).toEqual({ kind: "loading" });
  });

  it("follows the server's window: lead before the start, grace after the end", () => {
    // Default lead is 10 minutes; grace is 15 after the end.
    expect(view({ now: new Date(2026, 10, 9, 18, 49) }).kind).toBe("upcoming");
    expect(view({ now: new Date(2026, 10, 9, 18, 51) }).kind).toBe("open");
    expect(view({ now: new Date(2026, 10, 9, 21, 14) }).kind).toBe("open");
    expect(view({ now: new Date(2026, 10, 9, 21, 16) }).kind).toBe("closed");
    // The event's own lead.
    expect(
      view({ now: new Date(2026, 10, 9, 18, 35), opensMinutes: 30 }).kind,
    ).toBe("open");
  });

  it("is unavailable when the event has no readable times", () => {
    expect(view({ start: null }).kind).toBe("unavailable");
  });
});

describe("<MyCheckIn />", () => {
  beforeEach(() => {
    mine.value = {
      data: { attendance: null },
      isPending: false,
      fetchStatus: "idle",
    };
    clock.now = during.getTime();
    mutateAsync.mockReset();
    mockToast.mockReset();
  });

  function renderBlock(zone: ZoneState = "none") {
    return render(
      <MyCheckIn
        eventId="e1"
        start={start.toISOString()}
        end={end.toISOString()}
        opensMinutes={undefined}
        pointValue={5}
        zone={zone}
      />,
    );
  }

  it("offers Check in during the window and sends the plain self check-in", async () => {
    mutateAsync.mockResolvedValue({});
    renderBlock();

    expect(screen.getByText("Check-in is open")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /check in/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Checked in", description: "+5 pts" }),
      ),
    );
    expect(mutateAsync).toHaveBeenCalledWith({ eventId: "e1" });
  });

  it("reads a 409 as already in, not a failure", async () => {
    mutateAsync.mockRejectedValue({ statusCode: 409, message: "Conflict" });
    renderBlock();

    fireEvent.click(screen.getByRole("button", { name: /check in/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Already checked in",
          variant: "default",
        }),
      ),
    );
  });

  it("sends a member with a zoned event to the mobile app, with no button", () => {
    renderBlock("zone");

    expect(screen.getByText(/check in from the Frapp mobile app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check in/i })).toBeNull();
  });

  it("offers no button for an incomplete zone, which rejects every check-in", () => {
    renderBlock("malformed");

    expect(screen.getByText(/zone is incomplete/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check in/i })).toBeNull();
  });

  it("shows a checked-in member their time and points, and no button", () => {
    mine.value = {
      data: {
        attendance: {
          status: "PRESENT",
          check_in_time: new Date(2026, 10, 9, 19, 5).toISOString(),
        },
      },
      isPending: false,
      fetchStatus: "idle",
    };
    renderBlock();

    expect(screen.getByText(/^Checked in 7:05\sPM$/)).toBeInTheDocument();
    expect(screen.getByText("5 points")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check in/i })).toBeNull();
  });

  it("shows no button while the own row is first read", () => {
    mine.value = { data: undefined, isPending: true, fetchStatus: "fetching" };
    renderBlock();

    expect(screen.queryByRole("button", { name: /check in/i })).toBeNull();
    expect(screen.queryByText("Check-in is open")).toBeNull();
  });

  it("still says the window when the own-row read is paused offline", () => {
    mine.value = { data: undefined, isPending: true, fetchStatus: "paused" };
    renderBlock();

    expect(screen.getByText("Check-in is open")).toBeInTheDocument();
  });

  it("says when check-in opens before the window", () => {
    clock.now = new Date(2026, 10, 9, 12, 0).getTime();
    renderBlock();

    expect(
      screen.getByText(/^Check-in opens 6:50\sPM$/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check in/i })).toBeNull();
  });
});
