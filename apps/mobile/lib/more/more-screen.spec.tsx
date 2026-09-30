/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * #2101. s09's Dues row carries a due chip worked out against "now", and a
 * tab screen is never unmounted. A `new Date()` read once would keep an
 * invoice "Due" on the More tab after the day it fell due. This pins that
 * the chip moves on the shared ticking clock.
 *
 * It renders `app/(tabs)/more.tsx` but lives here: a spec under `app/` ships
 * as a route module (`lib/routes.spec.ts`).
 */

// Local-time constructors: CI runs this suite in UTC and in Asia/Tokyo, and a
// bare due date is past due once the member's own calendar day has ended.
const MOUNTED_AT = new Date(2026, 8, 30, 23, 59, 30);

const INVOICES = [
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

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useListChapters: () => ({ isSuccess: true, data: [{ id: "chapter-1" }] }),
  usePermissionList: () => [],
  useNotifications: () => ({ data: [] }),
  useEvents: () => ({ data: [] }),
  useViewerUserId: () => "user-1",
  useStudySessions: () => ({ data: undefined }),
  useInvoices: () => ({ data: INVOICES }),
}));

import MoreScreen from "@/app/(tabs)/more";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MoreScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("More hub clock (#2101)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOUNTED_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns the Dues chip past due when the due day ends while the screen is up", () => {
    const tree = render();
    expect(screenText(tree)).toMatch(/\bDue Sep 30\b/);
    expect(screenText(tree)).not.toContain("Past due");

    // Past midnight, on the clock's own tick: no remount, no refetch.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(screenText(tree)).toContain("Past due Sep 30");
    act(() => tree.unmount());
  });
});
