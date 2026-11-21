/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import * as expoRouter from "expo-router";
import { useRouter } from "expo-router";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * Last week and This semester on the You tab (#5779), which Activity drew
 * until then: the same cards from the same reads. Moved here from the
 * Activity screen's spec with them. Whether You draws them at all is
 * `lib/more/you-screen.spec.tsx`'s.
 */

/** Last week's recap (`GET /v1/activity/recap`), unread unless a test sets it. */
const recap = vi.hoisted(() => ({ value: { data: undefined as unknown } }));
/** The standing read (`GET /v1/activity/standing`) behind the gauges. */
const standing = vi.hoisted(() => ({
  value: {
    data: undefined as unknown,
    isPending: false,
    refetch: vi.fn(() => Promise.resolve()),
  },
}));
/** The active chapter: the recap's dismissals are kept per chapter. */
const activeChapter = vi.hoisted(() => ({ id: "chapter-1" }));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActivityStanding: () => standing.value,
  useActivityRecap: () => recap.value,
  useActiveChapterId: () => activeChapter.id,
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accentPrimary: "#2D7BFF" }),
}));

import { StandingCards } from "./standing-cards";
import { recapDismissal } from "./recap-card";
import { SemesterStrip, SemesterStripSkeleton } from "./semester-strip";
import { ProgressRing } from "./progress-ring";

const refocus = (expoRouter as unknown as { __refocus: () => void }).__refocus;

const mounted: ReactTestRenderer[] = [];
function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <StandingCards />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

const pressable = (tree: ReactTestRenderer, testID: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" && node.props.testID === testID,
  );

beforeEach(() => {
  recap.value = { data: undefined };
  standing.value = {
    data: undefined,
    isPending: false,
    refetch: vi.fn(() => Promise.resolve()),
  };
  activeChapter.id = "chapter-1";
});

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

describe("Last week (#4983)", () => {
  const recapRead = {
    start: new Date(2026, 10, 8).toISOString(),
    end: new Date(2026, 10, 15).toISOString(),
    events_attended: 2,
    tasks_done: 3,
    points: null,
    service_minutes: 0,
    study_minutes: 90,
    unavailable: [],
  };
  beforeEach(() => {
    // A Monday morning: the card's season.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 16, 9));
  });
  afterEach(() => {
    vi.useRealTimers();
    recapDismissal.resetForTests();
  });

  it("sums up what the member did, and stays gone once dismissed", () => {
    recap.value = { data: recapRead };
    const tree = render();
    const card = tree.root.findByProps({ testID: "activity-recap" });
    expect(drawnText(card)).toContain("Last week");
    expect(drawnText(card)).toContain("November 8 – November 14");
    const figure = (id: string) =>
      card.findByProps({ testID: `activity-recap-${id}`, accessible: true })
        .props.accessibilityLabel;
    expect(figure("events")).toBe("2 events attended");
    expect(figure("tasks")).toBe("3 tasks done");
    expect(figure("study")).toBe("1h 30m studied");
    // Points are off and service is zero: neither is drawn.
    expect(
      card.findAll(
        (node) =>
          node.props.testID === "activity-recap-points" ||
          node.props.testID === "activity-recap-service",
      ),
    ).toHaveLength(0);

    act(() => {
      pressable(tree, "activity-recap-dismiss").props.onPress();
    });
    const drawn = (tree: ReactTestRenderer) =>
      tree.root.findAll((node) => node.props.testID === "activity-recap")
        .length;
    expect(drawn(tree)).toBe(0);

    // Another chapter's recap that week still shows.
    activeChapter.id = "chapter-2";
    expect(drawn(render())).toBeGreaterThan(0);

    // And so does this chapter's next week.
    activeChapter.id = "chapter-1";
    vi.setSystemTime(new Date(2026, 10, 23, 9));
    recap.value = {
      data: {
        ...recapRead,
        start: new Date(2026, 10, 15).toISOString(),
        end: new Date(2026, 10, 22).toISOString(),
      },
    };
    expect(drawn(render())).toBeGreaterThan(0);
  });

  it("draws nothing after Tuesday, whatever the read still holds", () => {
    vi.setSystemTime(new Date(2026, 10, 18, 9));
    recap.value = { data: recapRead };
    expect(screenText(render())).not.toContain("Last week");
  });

  it("draws nothing for a week with nothing to show", () => {
    recap.value = {
      data: {
        ...recapRead,
        events_attended: 0,
        tasks_done: 0,
        study_minutes: null,
      },
    };
    expect(screenText(render())).not.toContain("Last week");
  });
});

describe("This semester (the gauges)", () => {
  const standingRead = {
    points: { total: 42, rank: 5, ranked: 58, goal: null },
    required_events: { required: 8, attended: 6, excused: 0 },
    service: {
      approved_minutes: 270,
      pending_minutes: 0,
      goal_minutes: 600,
    },
    study: {
      minutes: 0,
      week_start: "2026-11-08T05:00:00.000Z",
      goal_minutes: null,
    },
    unavailable: [],
  };
  const gauge = (tree: ReactTestRenderer, id: string) =>
    pressable(tree, `activity-standing-${id}`);
  const gaugeRings = (tree: ReactTestRenderer) =>
    tree.root
      .findByType(SemesterStrip)
      .findAllByType(ProgressRing)
      .map((node) => node.props.testID);

  it("draws a gauge per number, with a ring only where there is a target", () => {
    standing.value = { ...standing.value, data: standingRead };
    const tree = render();
    const strip = tree.root.findByType(SemesterStrip);
    expect(drawnText(strip)).toContain("This semester");
    expect(drawnText(gauge(tree, "points"))).toBe("42Points · #5 of 58");
    expect(drawnText(gauge(tree, "required_events"))).toBe("6 of 8Events");
    expect(drawnText(gauge(tree, "service"))).toBe("4h 30m of 10hService");
    expect(gauge(tree, "required_events").props.accessibilityLabel).toBe(
      "Attended 6 of 8 required events this semester",
    );
    // Points have no goal here: the number stands alone.
    expect(gaugeRings(tree)).toEqual([
      "activity-gauge-ring-required_events",
      "activity-gauge-ring-service",
    ]);
  });

  it("leaves out a zero with nothing to aim at, and the whole strip with none left", () => {
    standing.value = { ...standing.value, data: standingRead };
    const tree = render();
    // No study this week and no study goal: no gauge, not a zero.
    expect(
      tree.root.findAll(
        (node) => node.props.testID === "activity-standing-study",
      ),
    ).toHaveLength(0);
    standing.value = {
      ...standing.value,
      data: {
        points: { total: 0, rank: null, ranked: 0, goal: null },
        required_events: { required: 0, attended: 0, excused: 0 },
        service: {
          approved_minutes: 0,
          pending_minutes: 0,
          goal_minutes: null,
        },
        study: standingRead.study,
        unavailable: [],
      },
    };
    expect(screenText(render())).not.toContain("This semester");
  });

  it("pushes the screen that owns each number", () => {
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    standing.value = { ...standing.value, data: standingRead };
    const tree = render();
    act(() => gauge(tree, "required_events").props.onPress());
    expect(push).toHaveBeenLastCalledWith("/events");
    act(() => gauge(tree, "service").props.onPress());
    expect(push).toHaveBeenLastCalledWith("/service-hours");
    act(() => gauge(tree, "points").props.onPress());
    expect(push).toHaveBeenLastCalledWith("/tasks");
  });

  it("holds its place while it loads, and draws nothing when its read fails", () => {
    standing.value = { ...standing.value, isPending: true };
    expect(render().root.findAllByType(SemesterStripSkeleton)).toHaveLength(1);
    standing.value = { ...standing.value, isPending: false, data: undefined };
    const tree = render();
    expect(screenText(tree)).not.toContain("This semester");
    expect(tree.toJSON()).toBeNull();
  });

  it("reads again when the member comes back to You, not on the first visit", () => {
    render();
    expect(standing.value.refetch).not.toHaveBeenCalled();
    act(() => refocus());
    expect(standing.value.refetch).toHaveBeenCalledTimes(1);
  });
});
