/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import * as expoRouter from "expo-router";
import { useRouter } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityKeys, activityStandingKeys } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";
import { StyleSheet } from "react-native";
import { getSignetTokens } from "@repo/theme/signet";

/**
 * The phone's Activity screen (#3897; rebuilt around the week ring, #4766),
 * rendered for real over a stubbed read and a stubbed sheet: the week card,
 * the semester gauges, the To review card, the To do list by day, what the
 * member made, what a row opens, and when it reads again. The sheet has its
 * own spec (`activity-sheet.spec.tsx`); the models' are in `@repo/hooks`
 * (`activity-agenda.spec.ts`, `activity-rows.spec.ts`).
 *
 * It renders `app/(app)/(tabs)/activity.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  title: "Book the venue",
  due_date: "2099-01-01",
  status: "TODO",
  stored_status: "TODO",
  assignee_id: "me",
  assignee_name: "Me",
  created_by: "officer",
  created_by_name: "Olive",
  point_reward: null,
  completed_at: null,
  confirmed_at: null,
  created_at: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

/** A poll card the member posted, open (by default) or closed. */
const myPoll = (id: string, question: string, closed = false) => ({
  message_id: id,
  channel_id: "channel-1",
  channel_name: "general",
  channel_type: "PUBLIC",
  sender_id: "me",
  question,
  option_count: 2,
  closes_at: closed ? "2026-11-02T00:00:00.000Z" : null,
  closed_at: null,
  is_closed: closed,
  has_voted: true,
  created_at: "2026-11-01T00:00:00.000Z",
  message: {},
});

/** The member's week: two events (one made), one task still open. */
const week = (overrides: Record<string, unknown> = {}) => ({
  start: "2026-11-08T05:00:00.000Z",
  end: "2026-11-15T05:00:00.000Z",
  events: { done: 1, total: 2 },
  tasks: { done: 0, total: 1 },
  polls: { done: 0, total: 0 },
  cards: { done: 0, total: 0 },
  unavailable: [] as string[],
  ...overrides,
});

/** An event that invites the member, `hours` from now. */
const eventIn = (hours: number, overrides: Record<string, unknown> = {}) => ({
  id: "ev-1",
  name: "Chapter",
  start_time: new Date(Date.now() + hours * 3_600_000).toISOString(),
  end_time: null,
  location: "Great Hall",
  attendance: "required",
  check_in_open: false,
  checked_in: false,
  ...overrides,
});

const read = (overrides: Record<string, unknown> = {}) => ({
  needs_you: {
    tasks: [task()],
    task_confirmations: [],
    hours_approvals: [
      {
        id: "entry-1",
        user_id: "u-2",
        member_name: "Sam Hill",
        date: "2026-11-01",
        duration_minutes: 90,
        description: "Food bank",
        created_at: "2026-11-01T00:00:00.000Z",
      },
    ],
    polls: [],
  },
  coming_up: [],
  links: [],
  made_by_you: {
    polls: [
      myPoll("p-open", "Dues vote"),
      myPoll("p-closed", "Old vote", true),
    ],
    tasks: [],
    events: [],
  },
  needs_you_count: 2,
  unavailable: [] as string[],
  week: week(),
  ...overrides,
});

const activity = vi.hoisted(() => ({
  value: {} as {
    data?: unknown;
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    error?: unknown;
    refetch: () => Promise<unknown>;
  },
}));

/**
 * The chapter read: its module switches, which hide the Task board door,
 * and its plan, which decides whether rows carry Confirm and Approve (#4437).
 */
const chapter = vi.hoisted(() => ({
  data: undefined as
    | undefined
    | {
        enabled_modules: Record<string, boolean>;
        subscription_status?: string;
        past_due_since?: string | null;
      },
  isPending: false,
}));

/** The row actions' writes (#4437) and the connection they are held on. */
const writes = vi.hoisted(() => ({
  confirm: vi.fn(),
  review: vi.fn(),
  writeBlockedReason: null as string | null,
}));
vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: writes.writeBlockedReason }),
}));

/** The link writes, each a `mutateAsync` that resolves unless a test says not. */
const links = vi.hoisted(() => ({
  permissions: [] as string[],
  done: vi.fn(),
  hidden: vi.fn(),
  clear: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  markRead: vi.fn(),
}));

/** The standing read (`GET /v1/activity/standing`) behind the gauges. */
const standing = vi.hoisted(() => ({
  value: {
    data: undefined as unknown,
    isPending: false,
    refetch: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActivity: () => activity.value,
  useActivityStanding: () => standing.value,
  useViewerUserId: () => "me",
  useActiveChapterId: () => "chapter-1",
  useActivityUnread: () => ({ markRead: links.markRead }),
  // Read for the chapter's accent, its modules and its plan.
  useCurrentChapter: () => ({
    data: chapter.data,
    isPending: chapter.isPending,
  }),
  useConfirmTask: () => ({ mutateAsync: writes.confirm }),
  useReviewServiceEntry: () => ({ mutateAsync: writes.review }),
  useMyPermissions: () => ({ data: { permissions: links.permissions } }),
  useSetActivityLinkState: (state: "done" | "hidden") => ({
    mutateAsync: links[state],
  }),
  useClearActivityLinkState: () => ({ mutateAsync: links.clear }),
  useRemoveActivityLink: () => ({ mutateAsync: links.remove }),
  useRestoreActivityLink: () => ({ mutateAsync: links.restore }),
  // The roster knows the officer only: anyone else has left (#4402, faces).
  useActivityFaces: () => (id: string) =>
    id === "officer"
      ? {
          name: "Olive Officer",
          avatarUrl: "https://photos.example/olive.png",
          tint: { fill: "#102030", text: "#405060" },
        }
      : null,
}));

/** The props the screen last handed its sheet. */
const sheet = vi.hoisted(() => ({
  props: null as null | {
    row: { key: string } | null;
    viewerId: string | null;
    rowActionState?: string;
    onClosed: () => void;
    onActed: () => void;
    linkActions: import("@/components/activity/activity-sheet").LinkSheetActions;
  },
}));
const openLink = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat/open-link", () => ({ openMessageLink: openLink }));

vi.mock("@/components/activity/activity-sheet", () => ({
  ActivitySheet: (props: NonNullable<typeof sheet.props>) => {
    sheet.props = props;
    return null;
  },
}));

import ActivityScreen from "@/app/(app)/(tabs)/activity";
import {
  ActivityAsk,
  ActivityAskButton,
  ActivityListRow,
} from "@/components/activity/activity-row";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { InlineNote } from "@/components/inline-note";
import { SectionCount, SectionHeader } from "@/components/list-section";
import { HairlineChip, StatusChip } from "@/components/status-chip";
import { MemberAvatar } from "@/components/member-avatar";
import { ScreenShell } from "@/components/screen-shell";
import { UndoBar } from "@/components/tasks/undo-bar";
import { ProgressRing } from "@/components/activity/progress-ring";
import { ReviewCard } from "@/components/activity/review-card";
import {
  SemesterStrip,
  SemesterStripSkeleton,
} from "@/components/activity/semester-strip";
import { WeekCard } from "@/components/activity/week-card";

const mounted: ReactTestRenderer[] = [];
let queryClient: QueryClient;

const screen = () => (
  <QueryClientProvider client={queryClient}>
    <FrappThemeProvider>
      <ActivityScreen />
    </FrappThemeProvider>
  </QueryClientProvider>
);

/** Every mounted focus effect, run again: the member came back. */
const refocus = (expoRouter as unknown as { __refocus: () => void }).__refocus;

/**
 * Each re-read invalidates the list and the standing together, so a count of
 * re-reads is a count of the list's invalidations.
 */
const listRereads = (invalidate: ReturnType<typeof vi.spyOn>) =>
  invalidate.mock.calls.filter(
    ([filters]: unknown[]) =>
      JSON.stringify((filters as { queryKey?: unknown }).queryKey) ===
      JSON.stringify(activityKeys.chapter("chapter-1")),
  ).length;

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(screen());
  });
  mounted.push(tree);
  return tree;
}

const rowLabels = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(ActivityListRow).map((row) => row.props.row.title);

const row = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByType(ActivityListRow)
    .find((node) => node.props.row.title === label)!;

/**
 * The count a group's header draws beside its caption, as drawn (`null` when
 * it draws none), checked against what a screen reader hears.
 */
const sectionCount = (tree: ReactTestRenderer, label: string) => {
  const header = tree.root
    .findAllByType(SectionHeader)
    .find((node) => node.props.children === label)!;
  const drawn = header.findAllByType(SectionCount);
  if (drawn.length === 0) return null;
  const count = drawn[0]!.props.count as number;
  expect(drawnText(drawn[0]!)).toBe(String(count));
  expect(
    header.find((node) => node.props.accessible === true).props
      .accessibilityLabel,
  ).toBe(`${label}, ${count}`);
  return count;
};

const tokens = getSignetTokens("dark");

/** Any pressable the screen draws, by its test id. */
const pressable = (tree: ReactTestRenderer, testID: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" && node.props.testID === testID,
  );

/** A line of the week card, by the kind it counts. */
const weekLine = (tree: ReactTestRenderer, id: string) =>
  pressable(tree, `activity-week-line-${id}`);

/** The day headings the To do list draws, in order, each with its count. */
const dayHeadings = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(
      (node) =>
        (node.type as unknown) === "View" &&
        String(node.props.testID ?? "").startsWith("activity-day-"),
    )
    .map(
      (day) =>
        day.find((node) => node.props.accessibilityRole === "header").props
          .accessibilityLabel as string,
    );

/** Whether a section heading is drawn at all. */
const hasSection = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByType(SectionHeader)
    .some((node) => node.props.children === label);

/** The To review card's own row: its count, and what opens or closes it. */
const reviewToggle = (tree: ReactTestRenderer) =>
  pressable(tree, "activity-review-toggle");

describe("Activity screen (#3897)", () => {
  beforeEach(() => {
    standing.value = {
      data: undefined,
      isPending: false,
      refetch: vi.fn(() => Promise.resolve()),
    };
    queryClient = new QueryClient();
    sheet.props = null;
    // Reset here, not at a test's end: a failing test must not leave the
    // next one rendering as an officer.
    links.permissions = [];
    chapter.data = undefined;
    chapter.isPending = false;
    writes.confirm.mockReset().mockResolvedValue(undefined);
    writes.review.mockReset().mockResolvedValue(undefined);
    writes.writeBlockedReason = null;
    activity.value = {
      data: read(),
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(() => Promise.resolve()),
    };
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
  });

  it("is a tab, so it draws no back row (#4610)", () => {
    const rows = render().root.findAll(
      (node) =>
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.startsWith("Back to "),
    );
    expect(rows).toHaveLength(0);
  });

  it("opens the task board from its title row (#4610)", () => {
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    const [link] = render().root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Task board",
    );
    expect(link!.props.accessibilityRole).toBe("button");
    act(() => link!.props.onPress());
    expect(push).toHaveBeenCalledWith("/tasks");
  });

  it("draws no Task board while the chapter has Tasks off", () => {
    chapter.data = { enabled_modules: { tasks: false } };
    const links = render().root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Task board",
    );
    expect(links).toHaveLength(0);
  });

  describe("the week card (#4766)", () => {
    const ring = (tree: ReactTestRenderer) =>
      tree.root
        .findAllByType(ProgressRing)
        .find((node) => node.props.testID === "activity-week-ring")!;

    it("draws the week as one ring, done of total, with a line per kind", () => {
      const tree = render();
      expect(ring(tree).props.progress).toBeCloseTo(1 / 3);
      expect(drawnText(ring(tree))).toBe("1of 3");
      const text = screenText(tree);
      expect(text).toContain("2 left this week");
      // One sentence to a screen reader, where the ring is decoration.
      expect(
        tree.root.findAll(
          (node) =>
            node.props.accessibilityLabel ===
            "1 of 3 things done this week. 2 left this week.",
        ).length,
      ).toBeGreaterThan(0);
      expect(weekLine(tree, "events").props.accessibilityLabel).toBe(
        "Events: 1 of 2 done",
      );
      expect(drawnText(weekLine(tree, "tasks"))).toBe("Tasks0 of 1");
      // Nothing to answer this week: no line, never "0 of 0".
      expect(
        tree.root.findAll(
          (node) => node.props.testID === "activity-week-line-answers",
        ),
      ).toHaveLength(0);
      expect(text).not.toContain("0 of 0");
      // The count tiles and the chips are gone.
      expect(text).not.toMatch(/need you|Your tasks|Polls to vote on/);
    });

    it("puts the one thing to do next on the card, and no heading over an empty list", () => {
      const tree = render();
      const card = tree.root.findByType(WeekCard);
      expect(card.props.next.title).toBe("Book the venue");
      expect(drawnText(card)).toContain("Next");
      // It is on the card, not repeated under To do.
      expect(
        rowLabels(tree).filter((label) => label === "Book the venue"),
      ).toHaveLength(1);
      expect(hasSection(tree, "To do")).toBe(false);
      expect(screenText(tree)).not.toContain("Nothing to do right now.");
    });

    it("leads with an event open for check-in, whose ask is the one filled button", () => {
      activity.value = {
        ...activity.value,
        data: read({
          coming_up: [eventIn(0.1, { check_in_open: true })],
        }),
      };
      const tree = render();
      const card = tree.root.findByType(WeekCard);
      expect(card.props.next.title).toBe("Chapter");
      expect(drawnText(card)).toContain("Happening now");
      const asks = tree.root.findAllByType(ActivityAsk);
      expect(asks.filter((ask) => ask.props.filled)).toHaveLength(1);
      expect(card.findByType(ActivityAsk).props).toMatchObject({
        label: "Check in",
        filled: true,
      });
      // The task it displaced is the list's now.
      expect(hasSection(tree, "To do")).toBe(true);
    });

    it("says nothing is due, with a quiet check and no zero", () => {
      activity.value = {
        ...activity.value,
        data: read({
          needs_you: { ...read().needs_you, tasks: [] },
          week: week({
            events: { done: 0, total: 0 },
            tasks: { done: 0, total: 0 },
          }),
        }),
      };
      const tree = render();
      const text = screenText(tree);
      expect(text).toContain("Nothing due this week");
      expect(ring(tree).props.progress).toBe(0);
      expect(drawnText(ring(tree))).toBe("");
      expect(text).not.toMatch(/\b0 of 0\b|0 left/);
      expect(text).toContain("Nothing to do right now.");
    });

    it("closes the ring in the success hue when everything is done", () => {
      activity.value = {
        ...activity.value,
        data: read({
          needs_you: { ...read().needs_you, tasks: [] },
          week: week({
            events: { done: 2, total: 2 },
            tasks: { done: 1, total: 1 },
          }),
        }),
      };
      const tree = render();
      expect(screenText(tree)).toContain("All done this week");
      expect(ring(tree).props).toMatchObject({
        progress: 1,
        color: tokens.color.semantic.success,
      });
    });

    it("draws a part that couldn't load as a dash, says at least, and names it", () => {
      activity.value = {
        ...activity.value,
        data: read({
          needs_you: { ...read().needs_you, tasks: [] },
          unavailable: ["tasks"],
          week: week({ tasks: null, unavailable: ["tasks"] }),
        }),
      };
      const tree = render();
      const text = screenText(tree);
      expect(text).toContain("At least 1 left this week");
      expect(drawnText(weekLine(tree, "tasks"))).toBe("Tasks–");
      expect(weekLine(tree, "tasks").props.accessibilityLabel).toBe(
        "Tasks: couldn't load",
      );
      expect(text).toContain("Couldn't load tasks. Pull down to try again.");
      expect(text).not.toMatch(/All done|Nothing due/);
    });

    it("has no line for a kind the chapter has off", () => {
      activity.value = {
        ...activity.value,
        data: read({ week: week({ events: null, polls: null }) }),
      };
      const tree = render();
      expect(
        tree.root
          .findAll((node) =>
            String(node.props.testID ?? "").startsWith("activity-week-line-"),
          )
          .map((node) => node.props.testID),
      ).toContain("activity-week-line-tasks");
      expect(screenText(tree)).not.toContain("Events");
      expect(screenText(tree)).toContain("1 left this week");
    });

    it("draws only the next thing against an API from before the week", () => {
      const data = read() as Record<string, unknown>;
      delete data.week;
      activity.value = { ...activity.value, data };
      const tree = render();
      expect(
        tree.root
          .findAllByType(ProgressRing)
          .filter((node) => node.props.testID === "activity-week-ring"),
      ).toHaveLength(0);
      expect(tree.root.findByType(WeekCard).props.next.title).toBe(
        "Book the venue",
      );
      expect(screenText(tree)).not.toMatch(/this week/);
    });
  });

  describe("To do, by day (#4766)", () => {
    const busy = () =>
      read({
        needs_you: {
          ...read().needs_you,
          tasks: [
            task({
              id: "late",
              title: "Receipts",
              status: "OVERDUE",
              due_date: "2020-01-01",
            }),
            task({
              id: "late-2",
              title: "Old form",
              status: "OVERDUE",
              due_date: "2020-01-02",
            }),
            ...Array.from({ length: 5 }, (_, index) =>
              task({
                id: `far-${index}`,
                title: `Far ${index}`,
                due_date: "2099-01-01",
              }),
            ),
          ],
          polls: [
            {
              ...myPoll("p-ask", "Formal theme"),
              sender_id: "officer",
              has_voted: false,
            },
          ],
        },
        coming_up: [eventIn(30)],
        week: week({ polls: { done: 0, total: 1 } }),
      });

    it("lists the member's own things under their days, Overdue first", () => {
      activity.value = { ...activity.value, data: busy() };
      const tree = render();
      // The first overdue task is the card's; the rest lead the list.
      expect(tree.root.findByType(WeekCard).props.next.title).toBe("Receipts");
      const headings = dayHeadings(tree);
      expect(headings[0]).toBe("Overdue, 1");
      expect(headings.at(-2)).toBe("Later, 5");
      expect(headings.at(-1)).toBe("No deadline, 1");
      expect(sectionCount(tree, "To do")).toBe(8);
      // What waits on the member's review is never in this list.
      const toDo = tree.root
        .findAll((node) =>
          String(node.props.testID ?? "").startsWith("activity-day-"),
        )
        .flatMap((day) => day.findAllByType(ActivityListRow))
        .map((node) => node.props.row.title);
      expect(toDo).not.toContain("Food bank");
    });

    it("draws Overdue in the warning hue, without repeating it as a chip", () => {
      activity.value = { ...activity.value, data: busy() };
      const tree = render();
      const overdue = tree.root.find(
        (node) =>
          (node.type as unknown) === "View" &&
          node.props.testID === "activity-day-overdue",
      );
      const label = overdue.find(
        (node) =>
          (node.type as unknown) === "Text" && drawnText(node) === "Overdue",
      );
      expect(StyleSheet.flatten(label.props.style).color).toBe(
        tokens.color.semantic.warning,
      );
      expect(overdue.findAllByType(StatusChip)).toHaveLength(0);
    });

    it("says only what is news on a row: no To do chip, and Required on an event", () => {
      activity.value = { ...activity.value, data: busy() };
      const tree = render();
      expect(row(tree, "Far 0").findAllByType(HairlineChip)).toHaveLength(0);
      expect(row(tree, "Chapter").findByType(HairlineChip).props.label).toBe(
        "Required",
      );
      // An ask that isn't the card's stays the tinted ask, which opens it.
      expect(
        row(tree, "Formal theme").findByType(ActivityAsk).props,
      ).toMatchObject({ label: "Vote", filled: false });
    });

    it("draws a day's first three, then the rest on Show more", () => {
      activity.value = { ...activity.value, data: busy() };
      const tree = render();
      const far = () =>
        rowLabels(tree).filter((label) => label.startsWith("Far"));
      // Later is not a day, so nothing is held back there.
      expect(far()).toHaveLength(5);
      activity.value = {
        ...activity.value,
        data: read({
          needs_you: {
            ...read().needs_you,
            tasks: Array.from({ length: 6 }, (_, index) =>
              task({
                id: `soon-${index}`,
                title: `Soon ${index}`,
                due_date: null,
                due_at: new Date(Date.now() + 26 * 3_600_000).toISOString(),
              }),
            ),
          },
        }),
      };
      const days = render();
      const soon = () =>
        rowLabels(days).filter((label) => label.startsWith("Soon"));
      // One is the card's next thing; the day draws three of the other five.
      expect(soon()).toHaveLength(4);
      const more = days.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityState?.expanded === false &&
          drawnText(node) === "Show 2 more",
      );
      act(() => {
        more.props.onPress();
      });
      expect(soon()).toHaveLength(6);
      expect(screenText(days)).toContain("Show fewer");
    });

    it("narrows to one kind from a week line, and back from the same line or the note", () => {
      activity.value = { ...activity.value, data: busy() };
      const tree = render();
      act(() => {
        weekLine(tree, "events").props.onPress();
      });
      expect(weekLine(tree, "events").props.accessibilityState).toEqual({
        selected: true,
      });
      expect(dayHeadings(tree)).toHaveLength(1);
      expect(screenText(tree)).toContain("Showing only events.");
      // The card keeps its next thing; the rest of the page steps back.
      expect(tree.root.findByType(WeekCard).props.next.title).toBe("Receipts");
      expect(hasSection(tree, "Waiting on others")).toBe(false);
      const note = tree.root
        .findAllByType(InlineNote)
        .find((node) => node.props.action?.label === "Show everything")!;
      act(() => {
        note.props.action.onPress();
      });
      expect(weekLine(tree, "events").props.accessibilityState).toEqual({
        selected: false,
      });
      expect(hasSection(tree, "Waiting on others")).toBe(true);
      // The same line clears it too.
      act(() => {
        weekLine(tree, "tasks").props.onPress();
      });
      expect(sectionCount(tree, "To do")).toBe(7);
      act(() => {
        weekLine(tree, "tasks").props.onPress();
      });
      expect(sectionCount(tree, "To do")).toBe(8);
    });

    it("drops a narrowing when its line leaves the card", () => {
      activity.value = { ...activity.value, data: busy() };
      const tree = render();
      act(() => {
        weekLine(tree, "answers").props.onPress();
      });
      expect(screenText(tree)).toContain("Showing only polls and sign-ups.");
      activity.value = {
        ...activity.value,
        data: { ...busy(), week: week() },
      };
      act(() => {
        tree.update(screen());
      });
      expect(screenText(tree)).not.toContain("Showing only");
      expect(sectionCount(tree, "To do")).toBe(8);
      // For good: the line coming back (a new poll on Monday) must not
      // narrow the list again without a press.
      activity.value = { ...activity.value, data: busy() };
      act(() => {
        tree.update(screen());
      });
      expect(weekLine(tree, "answers").props.accessibilityState).toEqual({
        selected: false,
      });
      expect(screenText(tree)).not.toContain("Showing only");
    });
  });

  describe("To review (#4766)", () => {
    const queue = (length: number) =>
      read({
        needs_you: {
          ...read().needs_you,
          hours_approvals: [],
          task_confirmations: Array.from({ length }, (_, index) =>
            task({
              id: `done-${index}`,
              title: `Chore ${index}`,
              status: "COMPLETED",
              stored_status: "COMPLETED",
            }),
          ),
        },
      });

    it("is one card with one count, and the week never counts it", () => {
      const tree = render();
      const card = tree.root.findByType(ReviewCard);
      expect(reviewToggle(tree).props.accessibilityLabel).toBe("To review, 1");
      expect(drawnText(card)).toContain("1 hours entry");
      expect(screenText(tree)).toContain("2 left this week");
    });

    it("draws no card with nothing to review", () => {
      activity.value = {
        ...activity.value,
        data: read({
          needs_you: { ...read().needs_you, hours_approvals: [] },
        }),
      };
      const tree = render();
      expect(tree.root.findAllByType(ReviewCard)).toHaveLength(0);
      expect(screenText(tree)).not.toContain("To review");
    });

    it("starts a short queue open, so Confirm is still one press", () => {
      activity.value = { ...activity.value, data: queue(3) };
      const tree = render();
      expect(reviewToggle(tree).props.accessibilityState).toEqual({
        expanded: true,
      });
      expect(tree.root.findAllByType(ActivityAskButton)).toHaveLength(3);
    });

    it("keeps a long queue behind its count until pressed, five at a time", () => {
      activity.value = { ...activity.value, data: queue(8) };
      const tree = render();
      const chores = () =>
        rowLabels(tree).filter((label) => label.startsWith("Chore"));
      expect(reviewToggle(tree).props.accessibilityState).toEqual({
        expanded: false,
      });
      expect(reviewToggle(tree).props.accessibilityHint).toBe("8 tasks");
      expect(chores()).toHaveLength(0);
      act(() => {
        reviewToggle(tree).props.onPress();
      });
      expect(chores()).toHaveLength(5);
      const all = tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          drawnText(node) === "Show all 8",
      );
      act(() => {
        all.props.onPress();
      });
      expect(chores()).toHaveLength(8);
      // A press sticks: it stays closed once the member closes it.
      act(() => {
        reviewToggle(tree).props.onPress();
      });
      expect(chores()).toHaveLength(0);
    });

    it("says its part couldn't load to the officer whose queue it is", () => {
      links.permissions = ["service:approve"];
      activity.value = {
        ...activity.value,
        data: read({
          needs_you: { ...read().needs_you, hours_approvals: [] },
          unavailable: ["hours_approvals"],
        }),
      };
      const tree = render();
      expect(drawnText(tree.root.findByType(ReviewCard))).toContain(
        "Couldn't load hours waiting for approval. Pull down to try again.",
      );
      // Before the phone knows the member's role, too: the read tries that
      // queue only for a member who approves hours, so a failed one is never
      // drawn as an empty one.
      links.permissions = [];
      expect(drawnText(render().root.findByType(ReviewCard))).toContain(
        "Couldn't load hours waiting for approval.",
      );
    });
  });

  describe("Waiting on others, and Links", () => {
    it("lists what the member made under its own name, by kind, with its count", () => {
      const tree = render();
      // Open polls only: the closed one is archived, outside the count.
      expect(sectionCount(tree, "Waiting on others")).toBe(1);
      expect(screenText(tree)).toContain("Polls you posted");
      expect(hasSection(tree, "Made by you")).toBe(false);
    });

    it("leaves out a group with nothing in it, rather than an empty line", () => {
      activity.value = {
        ...activity.value,
        data: read({ made_by_you: { polls: [], tasks: [], events: [] } }),
      };
      const tree = render();
      expect(hasSection(tree, "Waiting on others")).toBe(false);
      expect(hasSection(tree, "Links")).toBe(false);
      expect(hasSection(tree, "Coming up")).toBe(false);
      expect(screenText(tree)).not.toMatch(/show up here/);
    });

    it("draws the first few of a long part, then all of them on Show all", () => {
      activity.value = {
        ...activity.value,
        data: read({
          made_by_you: {
            ...read().made_by_you,
            tasks: Array.from({ length: 5 }, (_, index) =>
              task({ id: `made-${index}`, title: `Assigned ${index}` }),
            ),
          },
        }),
      };
      const tree = render();
      const assigned = () =>
        rowLabels(tree).filter((label) => label.startsWith("Assigned"));
      expect(assigned()).toHaveLength(3);
      const showAll = tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityState?.expanded === false &&
          drawnText(node) === "Show all 5",
      );
      act(() => {
        showAll.props.onPress();
      });
      expect(assigned()).toHaveLength(5);
      expect(screenText(tree)).toContain("Show fewer");
    });

    it("says a part of it couldn't load instead of leaving it out", () => {
      activity.value = {
        ...activity.value,
        data: read({
          made_by_you: { polls: [], tasks: [], events: [] },
          unavailable: ["made_events"],
        }),
      };
      const tree = render();
      expect(hasSection(tree, "Waiting on others")).toBe(true);
      expect(screenText(tree)).toContain(
        "Couldn't load events you made. Pull down to try again.",
      );
    });
  });

  it("names what a row asks of the member as the action, for the eye and for a screen reader", () => {
    const tree = render();
    const approval = row(tree, "Food bank");
    // A one-press ask is the button (#4437), drawn in the ask's place.
    expect(approval.findByType(ActivityAskButton).props.action.label).toBe(
      "Approve",
    );
    expect(approval.findAllByType(StatusChip)).toHaveLength(0);
    const press = approval.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "button",
    );
    expect(press.props.accessibilityValue).toEqual({ text: "Approve" });
    expect(press.props.accessibilityHint).toBe("Sam Hill · 1h 30m.");
  });

  it("leads a row with the face of who it is from, its kind on the corner, else its glyph", () => {
    activity.value = {
      ...activity.value,
      data: read({
        coming_up: [eventIn(30, { attendance: "optional" })],
        needs_you: {
          ...read().needs_you,
          tasks: [
            task({
              due_date: null,
              due_at: new Date(Date.now() + 3_600_000).toISOString(),
            }),
          ],
        },
      }),
    };
    const tree = render();
    const lead = (label: string, id: string) =>
      row(tree, label).findAll((node) => node.props.testID === id);
    // Sam has left the roster, so their hours lead with the glyph alone.
    expect(lead("Food bank", "activity-glyph-hours").length).toBeGreaterThan(0);
    // Olive assigned the task: her face, with the task glyph on its corner.
    const face = lead("Book the venue", "activity-face-task");
    expect(face.length).toBeGreaterThan(0);
    expect(drawnText(face[0]!)).toContain("OO");
    expect(face[0]!.props.accessibilityElementsHidden).toBe(true);
    // Her photo and tint reach the avatar, and the kind's glyph its corner.
    const avatar = face[0]!.findByType(MemberAvatar);
    expect(avatar.props.uri).toBe("https://photos.example/olive.png");
    expect(avatar.props.tint).toEqual({ fill: "#102030", text: "#405060" });
    expect(
      face[0]!.findAll((node) => node.props.testID === "activity-face-glyph")
        .length,
    ).toBeGreaterThan(0);
    // A poll the member made shows no face of their own.
    expect(lead("Dues vote", "activity-glyph-poll").length).toBeGreaterThan(0);
    // Under its day's heading an event leads with its glyph: the heading
    // says the date, and the detail the time and place.
    expect(lead("Chapter", "activity-glyph-event").length).toBeGreaterThan(0);
    expect(lead("Chapter", "activity-date-block")).toHaveLength(0);
    expect(row(tree, "Chapter").props.row.detail).toContain("Great Hall");
  });

  it("leads the card's event with its date, month over day", () => {
    activity.value = {
      ...activity.value,
      data: read({
        needs_you: { ...read().needs_you, tasks: [] },
        coming_up: [eventIn(30)],
      }),
    };
    const tree = render();
    const block = row(tree, "Chapter").findAll(
      (node) =>
        (node.type as unknown) === "View" &&
        node.props.testID === "activity-date-block",
    );
    expect(block).toHaveLength(1);
    // The block is decoration; the detail still says the day in words.
    expect(block[0]!.props.accessibilityElementsHidden).toBe(true);
  });

  it("says a closing time less than a day away relatively, in the warning hue (#4402)", () => {
    const base = read();
    activity.value = {
      ...activity.value,
      data: read({
        needs_you: {
          ...base.needs_you,
          polls: [
            {
              ...myPoll("p-soon", "Formal venue?"),
              sender_id: "officer",
              has_voted: false,
              closes_at: new Date(Date.now() + 150 * 60_000).toISOString(),
            },
          ],
        },
      }),
    };
    const tree = render();
    const [phrase] = row(tree, "Formal venue?").findAll(
      (node) =>
        (node.type as unknown) === "Text" &&
        node.props.testID === "activity-soon",
    );
    expect(drawnText(phrase!)).toBe("closes in 2 hours");
    // Its detail names only the channel, so the label says who posted it.
    expect(
      row(tree, "Formal venue?").findAll(
        (node) =>
          node.props.accessibilityLabel === "Formal venue?, from Olive Officer",
      ).length,
    ).toBeGreaterThan(0);
    expect(StyleSheet.flatten(phrase!.props.style).color).toBe(
      getSignetTokens("dark").color.semantic.warning,
    );
  });

  it("opens a sign-up or form row on its card in chat, reading it, with no sheet (#3926)", () => {
    activity.value = {
      ...activity.value,
      data: read({
        needs_you: {
          tasks: [],
          task_confirmations: [],
          hours_approvals: [],
          polls: [],
          cards: [
            {
              kind: "form",
              message_id: "m-form",
              channel_id: "chan-rush",
              channel_name: "rush",
              channel_type: "PUBLIC",
              sender_id: "u-2",
              title: "Room picks",
              item_count: 3,
              closes_at: null,
              created_at: "2026-11-01T00:00:00.000Z",
              unread: true,
            },
          ],
        },
      }),
    };
    links.markRead.mockClear();
    const tree = render();
    const push = vi.mocked(useRouter().push);
    push.mockClear();

    act(() => row(tree, "Room picks").props.onPress());

    expect(push).toHaveBeenLastCalledWith({
      pathname: "/chat-thread",
      params: { channelId: "chan-rush", focusMessageId: "m-form" },
    });
    expect(links.markRead).toHaveBeenCalledWith([
      { kind: "form", item_id: "m-form" },
    ]);
    expect(sheet.props?.row ?? null).toBeNull();
  });

  it("opens a row's record in the sheet, with the viewer's id", () => {
    const tree = render();
    expect(sheet.props?.row).toBeNull();
    act(() => {
      row(tree, "Book the venue").props.onPress();
    });
    expect(sheet.props?.row?.key).toBe("needs:task:task-1");
    expect(sheet.props?.viewerId).toBe("me");
  });

  it("re-reads before opening a review push's task, so a warm cache can't miss it", async () => {
    // "Shawn Klein submitted: …" lands here as `/activity?review=<taskId>`.
    // The read in hand predates the submission: only the re-read has it.
    const router = vi.mocked(useRouter)() as unknown as {
      setParams?: (params: unknown) => void;
    };
    const setParams = vi.fn();
    router.setParams = setParams;
    const stale = read({
      needs_you: {
        tasks: [],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
      },
    });
    const fresh = read();
    fresh.needs_you.tasks = fresh.needs_you.tasks.map((t) => ({
      ...t,
      unread: true,
    }));
    const refetch = vi.fn(() => Promise.resolve({ data: fresh }));
    activity.value = { ...activity.value, data: stale, refetch };
    links.markRead.mockClear();
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      review: "task-1",
    });
    try {
      render();
      await act(async () => {});
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(sheet.props?.row?.key).toBe("needs:task:task-1");
      // Opened from the push reads it, as a tap on the row does.
      expect(links.markRead).toHaveBeenCalledWith([
        { kind: "task", item_id: "task-1" },
      ]);
      expect(setParams).toHaveBeenCalledWith({ review: undefined });
    } finally {
      vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
      delete router.setParams;
    }
  });

  it("opens nothing for a review the re-read doesn't hold, and still drops the param", async () => {
    const router = vi.mocked(useRouter)() as unknown as {
      setParams?: (params: unknown) => void;
    };
    const setParams = vi.fn();
    router.setParams = setParams;
    activity.value = {
      ...activity.value,
      refetch: vi.fn(() => Promise.resolve({ data: read() })),
    };
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      review: "gone",
    });
    try {
      render();
      await act(async () => {});
      expect(sheet.props?.row).toBeNull();
      expect(setParams).toHaveBeenCalledWith({ review: undefined });
    } finally {
      vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
      delete router.setParams;
    }
  });

  it("dots an unread row, says so, and records the open (#4405)", () => {
    const data = read();
    activity.value = {
      ...activity.value,
      data: {
        ...data,
        needs_you: {
          ...data.needs_you,
          tasks: data.needs_you.tasks.map((task, index) => ({
            ...task,
            unread: index === 0,
          })),
        },
      },
    };
    links.markRead.mockClear();
    const tree = render();
    const unread = row(tree, "Book the venue");
    expect(
      unread.findAllByProps({ testID: "activity-unread-dot" }),
    ).toHaveLength(1);
    const pressable = unread.find(
      (node) => typeof node.props.accessibilityLabel === "string",
    );
    expect(pressable.props.accessibilityLabel).toBe("Unread: Book the venue");
    act(() => {
      unread.props.onPress();
    });
    expect(links.markRead).toHaveBeenCalledWith([
      { kind: "task", item_id: "task-1" },
    ]);
  });

  it("keeps the sheet on the row it opened after that row leaves the list", () => {
    const tree = render();
    act(() => {
      row(tree, "Food bank").props.onPress();
    });
    activity.value = {
      ...activity.value,
      data: read({
        needs_you: { ...read().needs_you, hours_approvals: [] },
      }),
    };
    act(() => {
      tree.update(screen());
    });
    expect(rowLabels(tree)).not.toContain("Food bank");
    expect(sheet.props?.row?.key).toBe("needs:hours:entry-1");
  });

  it("hands the sheet the row as the latest read has it", () => {
    const tree = render();
    act(() => {
      row(tree, "Book the venue").props.onPress();
    });
    activity.value = {
      ...activity.value,
      data: read({
        needs_you: {
          ...read().needs_you,
          tasks: [task({ title: "Book the venue (moved)" })],
        },
      }),
    };
    act(() => {
      tree.update(screen());
    });
    expect(
      (sheet.props?.row as unknown as { title: string } | null)?.title,
    ).toBe("Book the venue (moved)");
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

    it("opens the screen that owns each number, switching tabs rather than stacking them", () => {
      vi.mocked(useRouter().navigate).mockClear();
      vi.mocked(useRouter().push).mockClear();
      standing.value = { ...standing.value, data: standingRead };
      const tree = render();
      act(() => gauge(tree, "required_events").props.onPress());
      expect(vi.mocked(useRouter)().navigate).toHaveBeenCalledWith("/events");
      act(() => gauge(tree, "service").props.onPress());
      expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith(
        "/service-hours",
      );
      // The board left the tab bar (#4610), so Points pushes it.
      vi.mocked(useRouter().navigate).mockClear();
      act(() => gauge(tree, "points").props.onPress());
      expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/tasks");
      expect(vi.mocked(useRouter)().navigate).not.toHaveBeenCalled();
    });

    it("holds its place while it loads, and draws nothing when its read fails", () => {
      standing.value = { ...standing.value, isPending: true };
      expect(render().root.findAllByType(SemesterStripSkeleton)).toHaveLength(
        1,
      );
      standing.value = { ...standing.value, isPending: false, data: undefined };
      const tree = render();
      expect(screenText(tree)).not.toContain("This semester");
      // The rest of the page is unaffected.
      expect(rowLabels(tree)).toContain("Book the venue");
    });

    it("reads again with the list when the member comes back, not on the first visit", () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      render();
      expect(invalidate).not.toHaveBeenCalled();
      act(() => refocus());
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: activityStandingKeys.chapter("chapter-1"),
        exact: true,
      });
    });
  });

  it("reads again when the member comes back to the screen", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render();
    expect(invalidate).not.toHaveBeenCalled();
    act(() => refocus());
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: activityKeys.chapter("chapter-1"),
      exact: true,
    });
  });

  it("re-reads on a pull, the gesture its couldn't-load note names", async () => {
    const tree = render();
    const refetch = vi.mocked(activity.value.refetch);
    await act(async () => {
      await tree.root.findByType(ScreenShell).props.refresh();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("reads again when the sheet closes, and after an action the sheet made", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const tree = render();
    act(() => {
      row(tree, "Book the venue").props.onPress();
    });
    act(() => {
      sheet.props!.onActed();
    });
    expect(listRereads(invalidate)).toBe(1);
    act(() => {
      sheet.props!.onClosed();
    });
    expect(listRereads(invalidate)).toBe(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: activityKeys.chapter("chapter-1"),
      exact: true,
    });
    expect(sheet.props?.row).toBeNull();
  });

  describe("Confirm and Approve on the row (#4437)", () => {
    const confirmRead = () =>
      read({
        needs_you: {
          ...read().needs_you,
          task_confirmations: [
            task({
              id: "task-2",
              title: "Sweep the porch",
              status: "COMPLETED",
              unread: true,
            }),
          ],
        },
      });
    const button = (tree: ReactTestRenderer, label: string) =>
      row(tree, label).find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.testID === "activity-row-action",
      );
    const rowPress = (tree: ReactTestRenderer, label: string) =>
      row(tree, label).find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityRole === "button",
      );

    it("confirms a completed task in one press, reads it, and re-reads", async () => {
      activity.value = { ...activity.value, data: confirmRead() };
      links.markRead.mockClear();
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const tree = render();
      expect(row(tree, "Sweep the porch").props.action.label).toBe("Confirm");
      await act(async () => {
        button(tree, "Sweep the porch").props.onPress();
      });
      expect(writes.confirm).toHaveBeenCalledWith("task-2");
      expect(links.markRead).toHaveBeenCalledWith([
        { kind: "task", item_id: "task-2" },
      ]);
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: activityKeys.chapter("chapter-1"),
        exact: true,
      });
      // Pressing it never opened the sheet.
      expect(sheet.props?.row).toBeNull();
    });

    it("approves pending hours with the sheet's write", async () => {
      const tree = render();
      await act(async () => {
        button(tree, "Food bank").props.onPress();
      });
      expect(writes.review).toHaveBeenCalledWith({
        id: "entry-1",
        body: { status: "APPROVED" },
      });
    });

    it("stays disabled once the write lands, so a second press can't repeat it", async () => {
      const tree = render();
      await act(async () => {
        button(tree, "Food bank").props.onPress();
      });
      expect(button(tree, "Food bank").props.disabled).toBe(true);
      // Nor is it offered to a screen reader any more.
      expect(rowPress(tree, "Food bank").props.accessibilityActions).toBe(
        undefined,
      );
      await act(async () => {
        button(tree, "Food bank").props.onPress();
      });
      expect(writes.review).toHaveBeenCalledTimes(1);
    });

    it("sends once for two taps in the same frame", async () => {
      const tree = render();
      await act(async () => {
        const press = button(tree, "Food bank").props.onPress;
        press();
        press();
      });
      expect(writes.review).toHaveBeenCalledTimes(1);
    });

    it("says any other refusal in the sheet's words, naming the item, and can be pressed again", async () => {
      const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
      writes.review.mockRejectedValueOnce(new Error("boom"));
      const tree = render();
      await act(async () => {
        button(tree, "Food bank").props.onPress();
      });
      expect(alert).toHaveBeenCalledWith(
        "Food bank",
        "Only a pending entry someone else submitted can be approved.",
      );
      expect(button(tree, "Food bank").props.disabled).toBe(false);
      alert.mockRestore();
    });

    it("withdraws the buttons after a refusal from the plan, until the member comes back", async () => {
      const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
      writes.confirm.mockRejectedValueOnce({
        statusCode: 403,
        error: "Forbidden",
        message:
          "Chapter subscription is not active; complete checkout to use this feature.",
      });
      activity.value = { ...activity.value, data: confirmRead() };
      const tree = render();
      await act(async () => {
        button(tree, "Sweep the porch").props.onPress();
      });
      // The confirm says it in the task card's words, never the server's
      // purchase path (lib/subscription-refusal.ts).
      expect(alert).toHaveBeenCalledWith(
        "Sweep the porch",
        SUBSCRIPTION_REFUSAL_COPY.taskStatus,
      );
      // Pressing again would only fetch the same refusal: every row is its
      // plain ask again, and opens its sheet.
      expect(tree.root.findAllByType(ActivityAskButton)).toHaveLength(0);
      expect(row(tree, "Food bank").findByType(ActivityAsk).props.label).toBe(
        "Approve",
      );
      act(() => {
        refocus();
      });
      expect(tree.root.findAllByType(ActivityAskButton)).toHaveLength(2);
      alert.mockRestore();
    });

    it("says Approved once the write lands", async () => {
      const tree = render();
      await act(async () => {
        button(tree, "Food bank").props.onPress();
      });
      expect(row(tree, "Food bank").props.action.label).toBe("Approved");
    });

    it("keeps a landed write across the row being drawn again, and tells the sheet", async () => {
      const tree = render();
      await act(async () => {
        button(tree, "Food bank").props.onPress();
      });
      // Closing the card and opening it again draws every row afresh.
      act(() => {
        reviewToggle(tree).props.onPress();
      });
      expect(rowLabels(tree)).not.toContain("Food bank");
      act(() => {
        reviewToggle(tree).props.onPress();
      });
      expect(button(tree, "Food bank").props.disabled).toBe(true);
      await act(async () => {
        button(tree, "Food bank").props.onPress();
      });
      expect(writes.review).toHaveBeenCalledTimes(1);
      // The sheet opened from the same row records the approval rather than
      // offering it again.
      act(() => {
        rowPress(tree, "Food bank").props.onPress();
      });
      expect(sheet.props?.rowActionState).toBe("done");
    });

    it("leaves Vote and Check in as the row's ask, which opens the sheet", () => {
      activity.value = {
        ...activity.value,
        data: read({
          needs_you: {
            ...read().needs_you,
            polls: [
              {
                ...myPoll("p-ask", "Formal theme"),
                sender_id: "officer",
                has_voted: false,
              },
            ],
          },
          coming_up: [eventIn(1, { check_in_open: true })],
        }),
      };
      const tree = render();
      for (const [label, ask] of [
        ["Formal theme", "Vote"],
        ["Chapter", "Check in"],
      ] as const) {
        expect(row(tree, label).findAllByType(ActivityAskButton)).toHaveLength(
          0,
        );
        expect(row(tree, label).findByType(ActivityAsk).props.label).toBe(ask);
      }
    });

    it("is offered to a screen reader as the row's named action", async () => {
      const tree = render();
      const press = rowPress(tree, "Food bank");
      expect(press.props.accessibilityActions).toEqual([
        { name: "rowAction", label: "Approve" },
      ]);
      // The button itself is no second focus stop inside the row's.
      expect(button(tree, "Food bank").props.accessible).toBe(false);
      await act(async () => {
        press.props.onAccessibilityAction({
          nativeEvent: { actionName: "rowAction" },
        });
      });
      expect(writes.review).toHaveBeenCalledTimes(1);
    });

    it("is disabled offline, with the reason as its hint, and the row still opens the sheet", () => {
      writes.writeBlockedReason = "You're offline.";
      const tree = render();
      expect(button(tree, "Food bank").props.disabled).toBe(true);
      // The button is no focus stop of its own, so the row says why.
      expect(rowPress(tree, "Food bank").props.accessibilityHint).toBe(
        "Sam Hill · 1h 30m. You're offline.",
      );
      act(() => {
        rowPress(tree, "Food bank").props.onPress();
      });
      expect(sheet.props?.row?.key).toBe("needs:hours:entry-1");
    });

    it("is disabled while the chapter loads", () => {
      chapter.isPending = true;
      const tree = render();
      expect(button(tree, "Food bank").props.disabled).toBe(true);
    });

    it("draws no button while the chapter's plan refuses those writes, so the row opens its sheet", () => {
      chapter.data = { enabled_modules: {}, subscription_status: "canceled" };
      const tree = render();
      expect(
        row(tree, "Food bank").findAllByType(ActivityAskButton),
      ).toHaveLength(0);
      expect(row(tree, "Food bank").findByType(ActivityAsk).props.label).toBe(
        "Approve",
      );
    });

    it("draws the button for an active plan", () => {
      chapter.data = { enabled_modules: {}, subscription_status: "active" };
      const tree = render();
      expect(
        row(tree, "Food bank").findAllByType(ActivityAskButton),
      ).toHaveLength(1);
    });
  });

  it("keeps a closed poll behind Archived polls, which opens its card (#4258)", () => {
    const tree = render();
    expect(rowLabels(tree)).not.toContain("Old vote");
    const toggle = tree.root
      .findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityRole === "button",
      )
      .find((node) => drawnText(node) === "Archived polls (1)")!;
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });

    act(() => {
      toggle.props.onPress();
    });
    expect(rowLabels(tree)).toContain("Old vote");
    expect(row(tree, "Old vote").props.row.badge?.label).toBe("Closed");
    act(() => {
      row(tree, "Old vote").props.onPress();
    });
    expect(sheet.props?.row?.key).toBe("made:poll:p-closed");
  });

  it("says which section couldn't load instead of showing it as empty", () => {
    activity.value = {
      ...activity.value,
      data: read({
        needs_you: { ...read().needs_you, tasks: [], hours_approvals: [] },
        unavailable: ["polls"],
      }),
    };
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Couldn't load polls. Pull down to try again.");
    expect(text).not.toContain("Nothing to do right now.");
    // In the warning hue, as web says it, so it can't read as an empty list.
    const note = tree.root
      .findAllByType(InlineNote)
      .find((node) => node.props.tone === "warning")!;
    const line = note.findByType("Text" as never);
    expect(StyleSheet.flatten(line.props.style).color).toBe(
      tokens.color.semantic.warning,
    );
  });

  it("shows the loading rows before the first read, and no list", () => {
    activity.value = { ...activity.value, data: undefined, isPending: true };
    const tree = render();
    expect(rowLabels(tree)).toEqual([]);
    // The skeleton mirrors the screen: the fixed captions are real, the
    // ring and its headline are not drawn until the read lands.
    const text = screenText(tree);
    expect(text).not.toMatch(/this week|Next/);
    expect(tree.root.findAllByType(WeekCard)).toHaveLength(0);
    expect(hasSection(tree, "To do")).toBe(true);
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Loading activity",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("offers a retry when the first read fails", () => {
    const refetch = vi.fn(() => Promise.resolve());
    activity.value = {
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new Error("boom"),
      refetch,
    };
    const tree = render();
    expect(screenText(tree)).toContain("Couldn't load your activity");
    const retry = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Try again",
    );
    act(() => {
      retry.props.onPress();
    });
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the list it has when a later read fails", () => {
    activity.value = {
      ...activity.value,
      isError: true,
      error: new Error("boom"),
    };
    const tree = render();
    expect(rowLabels(tree)).toContain("Book the venue");
    expect(screenText(tree)).not.toContain("Couldn't load your activity");
  });

  describe("sign-up links", () => {
    const link = (overrides: Record<string, unknown> = {}) => ({
      id: "l1",
      url: "https://forms.gle/abc",
      host: "forms.gle",
      title: null,
      message_id: "m1",
      thread_root_id: null,
      channel_id: "chan-1",
      channel_name: "rush",
      channel_type: "PUBLIC",
      posted_by: "olive",
      posted_by_name: "Olive",
      posted_at: "2026-11-10T15:00:00.000Z",
      ...overrides,
    });
    type LinkRow = Parameters<
      NonNullable<typeof sheet.props>["linkActions"]["done"]
    >[0];

    beforeEach(() => {
      links.permissions = [];
      for (const write of [
        links.done,
        links.hidden,
        links.clear,
        links.remove,
        links.restore,
      ]) {
        write.mockResolvedValue(undefined);
      }
      activity.value = { ...activity.value, data: read({ links: [link()] }) };
    });

    it("lists them in their own group, and opens one in the sheet", () => {
      const tree = render();
      expect(sectionCount(tree, "Links")).toBe(1);
      // Under what the member made, as the page's own order has it.
      const headings = tree.root
        .findAllByType(SectionHeader)
        .map((node) => node.props.children as string);
      expect(headings.indexOf("Waiting on others")).toBeGreaterThan(-1);
      expect(headings.indexOf("Links")).toBeGreaterThan(
        headings.indexOf("Waiting on others"),
      );
      act(() => {
        row(tree, "Google Form").props.onPress();
      });
      expect(sheet.props?.row?.key).toBe("link:l1");
      expect(sheet.props?.linkActions.canRemove).toBe(false);
    });

    it("draws a link by its page's name, with its kind leading the detail (#4187)", () => {
      activity.value = {
        ...activity.value,
        data: read({ links: [link({ title: "5K volunteer shifts" })] }),
      };
      const tree = render();
      expect(rowLabels(tree)).toContain("5K volunteer shifts");
      expect(screenText(tree)).toMatch(/Google Form · Olive · #rush · /);
    });

    it("lets only a channels:manage holder remove one for everyone", () => {
      links.permissions = ["channels:manage"];
      render();
      expect(sheet.props?.linkActions.canRemove).toBe(true);
    });

    const linkRow = () => ({ link: link(), title: "Google Form" }) as LinkRow;

    it.each([
      ["done", "Marked done", "clear"],
      ["hide", "Hidden", "clear"],
      ["remove", "Removed from everyone's Activity", "restore"],
    ] as const)(
      "offers Undo once %s lands, and Undo takes it back with the matching write",
      async (action, message, takeBack) => {
        const tree = render();
        const write = {
          done: links.done,
          hide: links.hidden,
          remove: links.remove,
        }[action];
        await act(async () => {
          sheet.props!.linkActions[action](linkRow());
        });
        expect(write).toHaveBeenCalledWith("l1");
        const bar = tree.root.findByType(UndoBar);
        expect(bar.props.message).toBe(message);
        await act(async () => {
          bar.props.onUndo();
        });
        expect(links[takeBack]).toHaveBeenCalledWith("l1");
        expect(tree.root.findAllByType(UndoBar)).toHaveLength(0);
      },
    );

    it("says a failed write with the platform alert, and offers no Undo", async () => {
      const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
      links.hidden.mockRejectedValueOnce(new Error("nope"));
      const tree = render();
      await act(async () => {
        sheet.props!.linkActions.hide(linkRow());
      });
      expect(alert).toHaveBeenCalledWith(
        "Couldn't hide it",
        expect.any(String),
      );
      expect(tree.root.findAllByType(UndoBar)).toHaveLength(0);
    });

    it("opens the link in the in-app browser", () => {
      render();
      act(() => {
        sheet.props!.linkActions.open(linkRow());
      });
      expect(openLink).toHaveBeenCalledWith("https://forms.gle/abc");
    });

    it("leaves the re-read to the write when the sheet closes behind one", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      render();
      await act(async () => {
        sheet.props!.linkActions.done(linkRow());
      });
      act(() => {
        sheet.props!.onClosed();
      });
      expect(invalidate).not.toHaveBeenCalled();
      // Only that one close: the next one re-reads as usual.
      act(() => {
        sheet.props!.onClosed();
      });
      expect(listRereads(invalidate)).toBe(1);
    });

    it("opens a thread reply in its thread, and a channel message in its channel", () => {
      render();
      const push = vi.mocked(useRouter().push);
      push.mockClear();
      act(() => {
        sheet.props!.linkActions.openInChat({
          link: link({ thread_root_id: "root-1" }),
        } as LinkRow);
      });
      expect(push).toHaveBeenLastCalledWith({
        pathname: "/chat-thread",
        params: { channelId: "chan-1", threadRootId: "root-1" },
      });
      act(() => {
        sheet.props!.linkActions.openInChat({ link: link() } as LinkRow);
      });
      expect(push).toHaveBeenLastCalledWith({
        pathname: "/chat-thread",
        params: { channelId: "chan-1" },
      });
    });
  });
});
