/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useRouter } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityKeys } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";

/**
 * The phone's Activity screen (#3897), rendered for real over a stubbed read
 * and a stubbed sheet: the groups and rows it draws, what a row opens, and
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

const file = (source: "document" | "backwork", id: string, title: string) => ({
  id,
  source,
  title,
  created_at: "2026-11-01T00:00:00.000Z",
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
  made_by_you: {
    polls: [],
    tasks: [],
    files: [
      file("document", "doc-1", "Bylaws"),
      file("backwork", "bw-1", "CS 101 midterm"),
    ],
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

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActivity: () => activity.value,
  useViewerUserId: () => "me",
  useActiveChapterId: () => "chapter-1",
  // Read by the back row and the chips for the chapter's accent.
  useCurrentChapter: () => ({ data: undefined }),
}));

/** The props the screen last handed its sheet. */
const sheet = vi.hoisted(() => ({
  props: null as null | {
    row: { key: string } | null;
    viewerId: string | null;
    onClosed: () => void;
    onActed: () => void;
  },
}));
vi.mock("@/components/activity/activity-sheet", () => ({
  ActivitySheet: (props: NonNullable<typeof sheet.props>) => {
    sheet.props = props;
    return null;
  },
}));

import ActivityScreen from "@/app/(app)/activity";
import { FilterChips } from "@/components/filter-chips";
import { ListRow } from "@/components/list-section";

const mounted: ReactTestRenderer[] = [];
let queryClient: QueryClient;

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <FrappThemeProvider>
          <ActivityScreen />
        </FrappThemeProvider>
      </QueryClientProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

const rowLabels = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(ListRow).map((row) => row.props.label);

const row = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAllByType(ListRow).find((node) => node.props.label === label)!;

describe("Activity screen (#3897)", () => {
  beforeEach(() => {
    queryClient = new QueryClient();
    sheet.props = null;
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
    expect(rowLabels(tree)).toEqual([
      "Book the venue",
      "Food bank",
      "Bylaws",
      "CS 101 midterm",
    ]);
    const text = screenText(tree);
    expect(text).toContain("Needs you · 2");
    expect(text).toContain("Made by you · 2");
    // Nothing is coming up, and the group says so instead of vanishing.
    expect(text).toContain("No events in the next two weeks.");
  });

  it("names what a row asks of the member, for the eye and for a screen reader", () => {
    const tree = render();
    expect(row(tree, "Food bank").props.accessibilityValue).toBe("Approve");
    expect(row(tree, "Food bank").props.description).toBe("Sam Hill · 1h 30m");
    expect(screenText(tree)).toContain("Approve");
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
      tree.update(
        <QueryClientProvider client={queryClient}>
          <FrappThemeProvider>
            <ActivityScreen />
          </FrappThemeProvider>
        </QueryClientProvider>,
      );
    });
    expect(rowLabels(tree)).not.toContain("Food bank");
    expect(sheet.props?.row?.key).toBe("needs:hours:entry-1");
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

  it("sends a document row to Documents, and gives a backwork row nowhere to go", () => {
    const tree = render();
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    act(() => {
      row(tree, "Bylaws").props.onPress();
    });
    expect(push).toHaveBeenCalledWith("/documents");
    expect(sheet.props?.row).toBeNull();
    // The phone has no Backwork screen, so the row is a record only.
    expect(row(tree, "CS 101 midterm").props.onPress).toBeUndefined();
  });

  it("narrows every group to one kind under a chip, keeping Needs you", () => {
    const tree = render();
    act(() => {
      tree.root.findByType(FilterChips).props.onSelect("file");
    });
    expect(rowLabels(tree)).toEqual(["Bylaws", "CS 101 midterm"]);
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
    const text = screenText(render());
    expect(text).toContain("Couldn't load polls. Pull down to try again.");
    expect(text).not.toContain("Nothing is waiting on you.");
  });

  it("shows the loading rows before the first read, and no list", () => {
    activity.value = { ...activity.value, data: undefined, isPending: true };
    const tree = render();
    expect(rowLabels(tree)).toEqual([]);
    expect(screenText(tree)).not.toContain("Needs you");
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
});
