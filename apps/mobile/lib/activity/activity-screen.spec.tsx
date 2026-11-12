/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import * as expoRouter from "expo-router";
import { useRouter } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityKeys } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { drawnText, screenText } from "@/test/screen-text";
import { StyleSheet } from "react-native";
import { getSignetTokens } from "@repo/theme/signet";

/**
 * The phone's Activity screen (#3897; its redesign, #4173 step 2), rendered
 * for real over a stubbed read and a stubbed sheet: the summary and its
 * tiles, the groups and their parts, the rows it draws, what a row opens, and
 * when it reads again. The sheet has its own spec
 * (`activity-sheet.spec.tsx`); the row model's is in `@repo/hooks`.
 *
 * It renders `app/(app)/activity.tsx` but lives here: a spec under `app/`
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

/** The chapter read: its module switches, which hide a module's tile. */
const chapter = vi.hoisted(() => ({
  data: undefined as undefined | { enabled_modules: Record<string, boolean> },
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

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActivity: () => activity.value,
  useViewerUserId: () => "me",
  useActiveChapterId: () => "chapter-1",
  useActivityUnread: () => ({ markRead: links.markRead }),
  // Read by the back row and the chips for the chapter's accent.
  useCurrentChapter: () => ({ data: chapter.data }),
  useMyPermissions: () => ({ data: { permissions: links.permissions } }),
  useSetActivityLinkState: (state: "done" | "hidden") => ({
    mutateAsync: links[state],
  }),
  useClearActivityLinkState: () => ({ mutateAsync: links.clear }),
  useRemoveActivityLink: () => ({ mutateAsync: links.remove }),
  useRestoreActivityLink: () => ({ mutateAsync: links.restore }),
}));

/** The props the screen last handed its sheet. */
const sheet = vi.hoisted(() => ({
  props: null as null | {
    row: { key: string } | null;
    viewerId: string | null;
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

import AsyncStorage from "@react-native-async-storage/async-storage";
import ActivityScreen from "@/app/(app)/activity";
import { resetActivityFilterForTests } from "@/lib/activity/activity-filter";
import {
  ActivityAsk,
  ActivityListRow,
} from "@/components/activity/activity-row";
import { FilterChips } from "@/components/filter-chips";
import { InlineNote } from "@/components/inline-note";
import { SectionCount, SectionHeader } from "@/components/list-section";
import { StatusChip } from "@/components/status-chip";
import { ScreenShell } from "@/components/screen-shell";
import { UndoBar } from "@/components/tasks/undo-bar";

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

/** A tile's resting style, flattened. */
const tileStyle = (tree: ReactTestRenderer, id: string) =>
  StyleSheet.flatten(tile(tree, id).props.style({ pressed: false }));

const tokens = getSignetTokens("dark");

/** The pressable a tile draws, by its summary id. */
const tile = (tree: ReactTestRenderer, id: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.testID === `activity-tile-${id}`,
  );

/** The chip `FilterChips` shows as on (`null` is All). */
const litChip = (tree: ReactTestRenderer) =>
  tree.root.findByType(FilterChips).props.selected;

describe("Activity screen (#3897)", () => {
  beforeEach(() => {
    // The remembered chip (#4402) must not carry from one test to the next.
    resetActivityFilterForTests();
    queryClient = new QueryClient();
    sheet.props = null;
    // Reset here, not at a test's end: a failing test must not leave the
    // next one rendering as an officer.
    links.permissions = [];
    chapter.data = undefined;
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

  it("goes back to More", () => {
    expectBackRow(render(), "More", "/more");
  });

  it("lists what needs the member first, then what they made, each group with its count", () => {
    const tree = render();
    // The approval is for now and the task, due in 2099, is for later.
    expect(rowLabels(tree)).toEqual([
      "Food bank",
      "Book the venue",
      "Dues vote",
    ]);
    expect(sectionCount(tree, "Needs you")).toBe(2);
    // Open polls only: the closed one is archived, outside the count.
    expect(sectionCount(tree, "Made by you")).toBe(1);
    // The count is its own muted text, not part of the caption.
    expect(screenText(tree)).not.toContain("Needs you · 2");
    // Nothing is coming up, and the group says so instead of vanishing.
    expect(sectionCount(tree, "Coming up")).toBeNull();
    expect(screenText(tree)).toContain("No events in the next two weeks.");
  });

  it("splits Needs you into Now and Later, and Made by you by kind", () => {
    const text = screenText(render());
    expect(text).toMatch(
      /Now\n1\n[\s\S]*Food bank[\s\S]*Later\n1\n[\s\S]*Book the venue/,
    );
    expect(text).toContain("Polls you posted");
    expect(text).not.toContain("Files you uploaded");
  });

  it("draws one part with no heading when everything is for now", () => {
    activity.value = {
      ...activity.value,
      data: read({
        needs_you: { ...read().needs_you, tasks: [] },
      }),
    };
    const text = screenText(render());
    expect(text).toContain("Food bank");
    expect(text).not.toMatch(/^Now$/m);
    expect(text).not.toMatch(/^Later$/m);
  });

  it("names what a row asks of the member as the action, for the eye and for a screen reader", () => {
    const tree = render();
    const approval = row(tree, "Food bank");
    expect(approval.findByType(ActivityAsk).props.label).toBe("Approve");
    expect(approval.findAllByType(StatusChip)).toHaveLength(0);
    const pressable = approval.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    expect(pressable.props.accessibilityValue).toEqual({ text: "Approve" });
    expect(pressable.props.accessibilityHint).toBe("Sam Hill · 1h 30m.");
    // A state is a status chip, never the ask.
    const task = row(tree, "Book the venue");
    expect(task.findByType(StatusChip).props.label).toBe("To do");
    expect(task.findAllByType(ActivityAsk)).toHaveLength(0);
  });

  it("leads a row with its kind's glyph, and an event with its date", () => {
    activity.value = {
      ...activity.value,
      data: read({
        coming_up: [
          {
            id: "ev-1",
            name: "Chapter",
            start_time: "2099-03-07T19:00:00.000Z",
            end_time: null,
            location: "Great Hall",
            attendance: "optional",
            check_in_open: false,
            checked_in: false,
          },
        ],
      }),
    };
    const tree = render();
    const lead = (label: string, id: string) =>
      row(tree, label).findAll((node) => node.props.testID === id);
    expect(lead("Food bank", "activity-glyph-hours").length).toBeGreaterThan(0);
    expect(
      lead("Book the venue", "activity-glyph-task").length,
    ).toBeGreaterThan(0);
    expect(lead("Dues vote", "activity-glyph-poll").length).toBeGreaterThan(0);
    const block = row(tree, "Chapter").findAll(
      (node) =>
        (node.type as unknown) === "View" &&
        node.props.testID === "activity-date-block",
    );
    expect(block).toHaveLength(1);
    // The block is decoration; the detail still says the day in words.
    expect(block[0]!.props.accessibilityElementsHidden).toBe(true);
    expect(row(tree, "Chapter").props.row.detail).toContain("Great Hall");
  });

  describe("summary", () => {
    it("says how much is waiting, with a tile per kind of ask", () => {
      const tree = render();
      expect(screenText(tree)).toContain("2 things need you");
      // A member who confirms nothing and approves nothing gets neither tile.
      expect(tile(tree, "tasks").props.accessibilityLabel).toBe("Your tasks");
      expect(tile(tree, "tasks").props.accessibilityValue).toEqual({
        text: "1",
      });
      expect(tile(tree, "polls").props.accessibilityValue).toEqual({
        text: "0",
      });
      expect(
        tree.root.findAll(
          (node) => node.props.testID === "activity-tile-confirm",
        ),
      ).toHaveLength(0);
    });

    it("gives an officer the To confirm and Hours to approve tiles", () => {
      links.permissions = ["tasks:manage", "service:approve"];
      const tree = render();
      expect(tile(tree, "confirm").props.accessibilityLabel).toBe("To confirm");
      expect(tile(tree, "approve").props.accessibilityValue).toEqual({
        text: "1",
      });
    });

    it("sets its chip from a tile, and clears it from the lit tile", () => {
      const tree = render();
      act(() => {
        tile(tree, "tasks").props.onPress();
      });
      expect(litChip(tree)).toBe("task");
      expect(tile(tree, "tasks").props.accessibilityState).toEqual({
        selected: true,
      });
      expect(rowLabels(tree)).toEqual(["Book the venue"]);
      act(() => {
        tile(tree, "tasks").props.onPress();
      });
      expect(litChip(tree)).toBeNull();
    });

    it("keeps the Tasks chip lit under To confirm, which narrows to the confirmations", () => {
      links.permissions = ["tasks:manage"];
      activity.value = {
        ...activity.value,
        data: read({
          needs_you: {
            ...read().needs_you,
            task_confirmations: [
              task({
                id: "task-2",
                title: "Sweep the porch",
                status: "COMPLETED",
              }),
            ],
          },
        }),
      };
      const tree = render();
      act(() => {
        tile(tree, "confirm").props.onPress();
      });
      expect(litChip(tree)).toBe("task");
      expect(rowLabels(tree)).toEqual(["Sweep the porch"]);
      expect(tile(tree, "tasks").props.accessibilityState).toEqual({
        selected: false,
      });
    });

    it("is all caught up at zero, and never over a section that failed", () => {
      const empty = {
        tasks: [],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
      };
      activity.value = {
        ...activity.value,
        data: read({ needs_you: empty, needs_you_count: 0 }),
      };
      const tree = render();
      expect(screenText(tree)).toContain("You're all caught up");
      act(() => tree.unmount());
      activity.value = {
        ...activity.value,
        data: read({
          needs_you: empty,
          needs_you_count: 0,
          unavailable: ["polls"],
        }),
      };
      const failed = render();
      const text = screenText(failed);
      expect(text).not.toContain("You're all caught up");
      expect(text).toContain("Some of what needs you couldn't load");
      // Unknown, never 0: a dash on the tile, "Couldn't load" to a reader.
      expect(tile(failed, "polls").props.accessibilityValue).toEqual({
        text: "Couldn't load",
      });
      expect(drawnText(tile(failed, "polls"))).toBe("–Polls to vote on");
    });

    it("dims a tile with nothing waiting, and not one that has something", () => {
      const tree = render();
      expect(tileStyle(tree, "polls").opacity).toBe(0.6);
      expect(tileStyle(tree, "tasks").opacity).toBeUndefined();
    });

    it("shows no tile for a module the chapter has off", () => {
      chapter.data = { enabled_modules: { polls: false } };
      const tree = render();
      expect(
        tree.root.findAll(
          (node) => node.props.testID === "activity-tile-polls",
        ),
      ).toHaveLength(0);
      expect(tile(tree, "tasks").props.accessibilityLabel).toBe("Your tasks");
    });

    it("names the next event under the headline", () => {
      activity.value = {
        ...activity.value,
        data: read({
          coming_up: [
            {
              id: "ev-1",
              name: "Exec Board Sync",
              start_time: "2099-03-07T19:00:00.000Z",
              end_time: null,
              location: null,
              attendance: "optional",
              check_in_open: false,
              checked_in: false,
            },
          ],
        }),
      };
      expect(screenText(render())).toMatch(/Next up: Exec Board Sync · /);
    });
  });

  describe("Show all", () => {
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
      expect(screenText(tree)).toContain("Show all 5");
      act(() => {
        showAll.props.onPress();
      });
      expect(assigned()).toHaveLength(5);
      expect(screenText(tree)).toContain("Show fewer");
    });

    it("holds nothing back under a chip", () => {
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
      act(() => {
        tree.root.findByType(FilterChips).props.onSelect("task");
      });
      expect(
        rowLabels(tree).filter((label) => label.startsWith("Assigned")),
      ).toHaveLength(5);
      expect(screenText(tree)).not.toMatch(/Show all/);
    });
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
    expect(invalidate).toHaveBeenCalledTimes(1);
    act(() => {
      sheet.props!.onClosed();
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith({
      queryKey: activityKeys.chapter("chapter-1"),
      exact: true,
    });
    expect(sheet.props?.row).toBeNull();
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

  describe("the Needs you chip and the remembered chip (#4402)", () => {
    it("narrows to what is waiting on the member and leaves the other groups out", () => {
      const tree = render();
      const before = rowLabels(tree);
      act(() => {
        tree.root.findByType(FilterChips).props.onSelect("waiting");
      });
      expect(litChip(tree)).toBe("waiting");
      const after = rowLabels(tree);
      // Every kind under Needs you stays; nothing from another group does.
      expect(after).toContain("Book the venue");
      expect(after.length).toBeLessThan(before.length);
      const text = screenText(tree);
      expect(text).not.toContain("Coming up");
      expect(text).not.toContain("Made by you");
      expect(text).not.toContain("Nothing of this kind here.");
    });

    it("remembers a chip on the phone, and opens on it next time", () => {
      const first = render();
      act(() => {
        first.root.findByType(FilterChips).props.onSelect("poll");
      });
      expect(vi.mocked(AsyncStorage.setItem)).toHaveBeenCalledWith(
        "frapp.activity.filter",
        "poll",
      );
      act(() => first.unmount());
      mounted.splice(mounted.indexOf(first), 1);
      const second = render();
      expect(litChip(second)).toBe("poll");
    });

    it("opens on a chip stored by an earlier launch, read from the phone's storage", async () => {
      vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce("poll");
      const tree = render();
      await act(async () => {});
      expect(litChip(tree)).toBe("poll");
    });

    it("opens on All for a stored value that isn't a chip", async () => {
      vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce("confirm");
      const tree = render();
      await act(async () => {});
      expect(litChip(tree)).toBeNull();
    });

    it("says nothing is waiting, in Needs you's own words, under its chip", () => {
      activity.value = {
        ...activity.value,
        data: read({
          needs_you: {
            tasks: [],
            task_confirmations: [],
            hours_approvals: [],
            polls: [],
          },
        }),
      };
      const tree = render();
      act(() => {
        tree.root.findByType(FilterChips).props.onSelect("waiting");
      });
      const text = screenText(tree);
      expect(text).toContain("Nothing is waiting on you.");
      expect(text).not.toContain("Nothing of this kind here.");
    });

    it("leaves out the chip of a module the chapter has off, and a stored chip for it opens on All", async () => {
      chapter.data = { enabled_modules: { hours: false } };
      vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce("hours");
      const tree = render();
      await act(async () => {});
      const chips = tree.root.findByType(FilterChips).props.chips as {
        value: string | null;
      }[];
      expect(chips.map((chip) => chip.value)).not.toContain("hours");
      expect(litChip(tree)).toBeNull();
    });

    it("keeps the stored chip when the To confirm tile is cleared", () => {
      links.permissions = ["tasks:manage"];
      const tree = render();
      vi.mocked(AsyncStorage.setItem).mockClear();
      act(() => {
        tile(tree, "confirm").props.onPress();
      });
      act(() => {
        tile(tree, "confirm").props.onPress();
      });
      expect(litChip(tree)).toBeNull();
      expect(vi.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled();
    });

    it("doesn't remember the To confirm tile's narrowing", () => {
      links.permissions = ["tasks:manage"];
      vi.mocked(AsyncStorage.setItem).mockClear();
      const tree = render();
      act(() => {
        tile(tree, "confirm").props.onPress();
      });
      expect(vi.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled();
    });
  });

  it("narrows every group to one kind under a chip, keeping Needs you", () => {
    const tree = render();
    act(() => {
      tree.root.findByType(FilterChips).props.onSelect("poll");
    });
    expect(rowLabels(tree)).toEqual(["Dues vote"]);
    const text = screenText(tree);
    expect(text).toContain("Needs you");
    expect(text).toContain("Nothing of this kind here.");
    expect(text).not.toContain("Coming up");
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
    expect(text).not.toContain("Nothing is waiting on you.");
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
    // The skeleton mirrors the screen: the fixed caption is real, the
    // headline and the tiles are not drawn until the read lands.
    const text = screenText(tree);
    expect(text).not.toMatch(/need you|caught up/);
    expect(
      tree.root.findAll((node) =>
        String(node.props.testID ?? "").startsWith("activity-tile-"),
      ),
    ).toHaveLength(0);
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
      expect(invalidate).toHaveBeenCalledTimes(1);
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
