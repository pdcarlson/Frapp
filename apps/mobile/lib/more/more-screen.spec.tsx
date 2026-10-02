/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * #2101. s09 works out three things against "now", and a tab screen is never
 * unmounted, so a `new Date()` read once would freeze each of them:
 *
 * - the Dues chip would keep an invoice "Due" after the day it fell due;
 * - the officer's Host check-in row would keep pointing at an event whose
 *   check-in window has closed;
 * - the Study hours total would keep counting last week.
 *
 * This pins that all three move on the shared ticking clock.
 *
 * It renders `app/(tabs)/more.tsx` but lives here: a spec under `app/` ships
 * as a route module (`lib/routes.spec.ts`).
 */

// Local-time constructors throughout: CI runs this suite in UTC and in
// Asia/Tokyo, and a due day and a study week are the member's own calendar.

let permissions: string[] = [];
let events: unknown[] = [];
let sessions: unknown[] | undefined;
let invoices: unknown[] = [];

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useListChapters: () => ({ isSuccess: true, data: [{ id: "chapter-1" }] }),
  usePermissionList: () => permissions,
  useNotifications: () => ({ data: [] }),
  useEvents: () => ({ data: events }),
  useViewerUserId: () => "user-1",
  useStudySessions: () => ({ data: sessions }),
  useInvoices: () => ({ data: invoices }),
}));

import MoreScreen from "@/app/(tabs)/more";

/**
 * Unmounted in `afterEach`, not at the end of each test: the shared clock is
 * module state, and a failed test's tree left subscribed would hold it at that
 * test's time for the next one.
 */
const mounted: ReactTestRenderer[] = [];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MoreScreen />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

/** Past the next tick of the 30 s clock: no remount, no refetch. */
function tick() {
  act(() => {
    vi.advanceTimersByTime(90_000);
  });
}

const minutes = (at: Date, delta: number) =>
  new Date(at.getTime() + delta * 60_000).toISOString();

describe("More hub clock (#2101)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    permissions = [];
    events = [];
    sessions = undefined;
    invoices = [];
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.useRealTimers();
  });

  it("turns the Dues chip past due when the due day ends while the screen is up", () => {
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 30));
    invoices = [
      {
        id: "inv-1",
        user_id: "user-1",
        title: "Spring dues",
        amount: 12_500,
        status: "OPEN",
        due_date: "2026-09-30",
        paid_at: null,
      },
    ];
    const tree = render();
    expect(screenText(tree)).toMatch(/(^|\n)Due Sep 30(\n|$)/);
    expect(screenText(tree)).not.toContain("Past due");

    tick();

    expect(screenText(tree)).toMatch(/(^|\n)Past due Sep 30(\n|$)/);
  });

  it("moves Host check-in to the next event when a check-in window closes while the screen is up", () => {
    const mountedAt = new Date(2026, 8, 30, 20, 0, 0);
    vi.setSystemTime(mountedAt);
    permissions = ["events:update"];
    events = [
      // Ended 14 minutes ago, so check-in's 15-minute grace closes in one.
      {
        id: "evt-1",
        name: "Chapter meeting",
        location: null,
        start_time: minutes(mountedAt, -74),
        end_time: minutes(mountedAt, -14),
        point_value: null,
        is_mandatory: false,
      },
      {
        id: "evt-2",
        name: "Rush dinner",
        location: null,
        start_time: minutes(mountedAt, 120),
        end_time: minutes(mountedAt, 180),
        point_value: null,
        is_mandatory: false,
      },
    ];
    const tree = render();
    expect(screenText(tree)).toContain("Chapter meeting");
    expect(screenText(tree)).not.toContain("Rush dinner");

    tick();

    expect(screenText(tree)).toContain("Rush dinner");
    expect(screenText(tree)).not.toContain("Chapter meeting");
  });

  it("starts a new Study hours week at the week boundary while the screen is up", () => {
    // Saturday 23:59:30. The week starts on Sunday (`startOfWeek`).
    vi.setSystemTime(new Date(2026, 9, 3, 23, 59, 30));
    sessions = [
      {
        id: "session-1",
        status: "COMPLETED",
        start_time: new Date(2026, 9, 3, 10, 0).toISOString(),
        end_time: new Date(2026, 9, 3, 12, 0).toISOString(),
        total_foreground_minutes: 120,
      },
    ];
    const tree = render();
    expect(screenText(tree)).toContain("2.0 hrs");

    tick();

    expect(screenText(tree)).toContain("0.0 hrs");
    expect(screenText(tree)).not.toContain("2.0 hrs");
  });
});
