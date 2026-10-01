/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * #2101. s19 splits its rows into TODAY and EARLIER by "now", and a tab
 * screen is never unmounted. React Query's structural sharing keeps the data
 * reference stable across a refetch that returns the same rows, so a
 * `new Date()` read once would leave an 11:47 PM row under TODAY at 12:10 AM.
 * This pins that the split moves on the shared ticking clock.
 *
 * It renders `app/(tabs)/notifications.tsx` but lives here: a spec under
 * `app/` ships as a route module (`lib/routes.spec.ts`).
 */

// Local-time constructors: CI runs this suite in UTC and in Asia/Tokyo, and
// "today" is the member's own calendar day.
const CREATED_AT = new Date(2026, 8, 30, 23, 47);
const MOUNTED_AT = new Date(2026, 8, 30, 23, 59, 30);

const NOTIFICATIONS = [
  {
    id: "notif-1",
    title: "Dues reminder",
    body: "Spring dues are open.",
    created_at: CREATED_AT.toISOString(),
    read_at: null,
    data: null,
  },
];

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => "chapter-1",
  useNotifications: () => ({
    isPending: false,
    isError: false,
    isFetching: false,
    data: NOTIFICATIONS,
    refetch: vi.fn(),
  }),
  useMarkNotificationRead: () => ({ mutateAsync: vi.fn() }),
}));

import NotificationsScreen from "@/app/(tabs)/notifications";

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
        <NotificationsScreen />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

describe("Notifications clock (#2101)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOUNTED_AT);
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.useRealTimers();
  });

  it("moves a row from TODAY to EARLIER at midnight while the screen is up", () => {
    const tree = render();
    expect(screenText(tree)).toContain("Dues reminder");
    expect(screenText(tree)).toContain("TODAY");
    expect(screenText(tree)).not.toContain("EARLIER");

    // Past midnight, on the clock's own tick: no remount, no refetch.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(screenText(tree)).toContain("EARLIER");
    expect(screenText(tree)).not.toContain("TODAY");
  });
});
