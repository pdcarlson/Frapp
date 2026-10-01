/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import * as expoRouter from "expo-router";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * #2101. s07 is often opened before check-in opens: a member arriving early
 * taps through from UP NEXT. A `new Date()` captured at mount left "Check-in
 * hasn't opened" on screen through the start and past the close, with no way
 * to the scanner but backing out. This pins that the screen reads the shared
 * ticking clock, as the Events list does (`events-screen.spec.tsx`), for both
 * of the things it works out from "now": the check-in card and the header's
 * "Tonight / Tomorrow" line.
 *
 * It renders `app/(tabs)/event-details.tsx` but lives here: a spec under
 * `app/` ships as a route module (`lib/routes.spec.ts`).
 */

const START = new Date("2026-09-25T18:00:00Z");
const MOUNTED_AT = new Date(START.getTime() - 60_000);

const EVENT = {
  id: "evt-1",
  name: "Chapter meeting",
  location: null,
  start_time: START.toISOString(),
  end_time: new Date(START.getTime() + 60 * 60_000).toISOString(),
  point_value: null,
  is_mandatory: false,
};

let event = EVENT;

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useEvent: () => ({
    isPending: false,
    isError: false,
    isFetching: false,
    data: event,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

vi.mocked(expoRouter.useLocalSearchParams).mockImplementation(() => ({
  id: EVENT.id,
}));

import EventDetailsScreen from "@/app/(tabs)/event-details";

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
        <EventDetailsScreen />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

describe("Event details clock (#2101)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOUNTED_AT);
    event = EVENT;
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.useRealTimers();
  });

  it("opens check-in when the window opens while the screen is up", () => {
    const tree = render();
    expect(screenText(tree)).toContain("Chapter meeting");
    expect(screenText(tree)).not.toContain("Check-in is open");

    // Past the start, on the clock's own tick: no remount, no refetch.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(screenText(tree)).toContain("Check-in is open");
  });

  it("turns tomorrow's event into tonight's at midnight while the screen is up", () => {
    // Local-time constructors: CI runs this suite in UTC and in Asia/Tokyo,
    // and "tomorrow" is the member's own calendar day.
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 30));
    event = {
      ...EVENT,
      start_time: new Date(2026, 9, 1, 18, 0).toISOString(),
      end_time: new Date(2026, 9, 1, 19, 0).toISOString(),
    };
    const tree = render();
    expect(screenText(tree)).toMatch(/(^|\n)Tomorrow · /);

    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(screenText(tree)).toMatch(/(^|\n)Tonight · /);
    expect(screenText(tree)).not.toContain("Tomorrow");
  });
});
