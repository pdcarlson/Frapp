/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * #2101. s06 used to read `now` once per mount (`useMemo(() => new Date(), [])`),
 * and a tab is never unmounted, so a check-in window that opened while the
 * list was on screen never showed as open, and a finished event never fell off.
 * This pins that the list reads the shared ticking clock instead.
 *
 * It renders `app/(tabs)/events.tsx` but lives here: a spec under `app/` ships
 * as a route module (`lib/routes.spec.ts`).
 */

const START = new Date("2026-09-25T18:00:00Z");
const MOUNTED_AT = new Date(START.getTime() - 60_000);

const EVENTS = [
  {
    id: "evt-1",
    name: "Chapter meeting",
    location: null,
    start_time: START.toISOString(),
    end_time: new Date(START.getTime() + 60 * 60_000).toISOString(),
    point_value: null,
    is_mandatory: false,
  },
];

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useEvents: () => ({
    isPending: false,
    isError: false,
    isFetching: false,
    data: EVENTS,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

vi.mock("@/lib/ask/flag", () => ({ isAskAvailable: () => false }));

import EventsScreen from "@/app/(tabs)/events";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <EventsScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType("Text" as never, { deep: true })
    .map((text) => JSON.stringify(text.props.children ?? ""));

describe("Events list clock (#2101)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOUNTED_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a check-in window that starts while the list is on screen", () => {
    const tree = render();
    expect(texts(tree)).toContain(JSON.stringify("Chapter meeting"));
    expect(texts(tree)).not.toContain(JSON.stringify("Check-in is open"));

    // Past the start, on the clock's own tick — no remount, no refetch.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(texts(tree)).toContain(JSON.stringify("Check-in is open"));
    act(() => tree.unmount());
  });
});
