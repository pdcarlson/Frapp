/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { AppState, StyleSheet } from "react-native";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { moduleDisabledMessage } from "@repo/validation";
import { TaskRow } from "@/components/tasks/task-row";

/**
 * The s08 board's status toggle on a gate refusal (#2710), the fifth paid-ops
 * write surface after new task, check-in, study and service hours.
 *
 * `PATCH /v1/tasks/:id/status` is refused permanently, until an officer acts,
 * by the subscription gate (no `@FreeTier`) and the module gate
 * (`@RequireModule('tasks')` on the controller). The hook reverts its own
 * optimistic write either way; what this pins is that the board then says
 * why and stops offering a toggle that cannot win, and that an ordinary
 * failure keeps its quiet revert and retap.
 *
 * It renders `app/(app)/(tabs)/tasks.tsx` but lives here: a spec under `app/` ships
 * as a route module (`lib/routes.spec.ts`).
 */

/** What `ChapterGuard` throws for a chapter that never finished checkout. */
const REFUSED = {
  statusCode: 403,
  error: "Forbidden",
  message:
    "Chapter subscription is not active; complete checkout to use this feature.",
  requestId: "req_refused",
};

/**
 * What `ChapterGuard` throws while an officer has `tasks` switched off,
 * without its `code`: only the message identifies it on installed builds and
 * an API older than #1020.
 */
const MODULE_OFF = {
  statusCode: 403,
  error: "Forbidden",
  message: moduleDisabledMessage("tasks"),
  requestId: "req_module_off",
};

/**
 * A 403 that is neither gate: the route's `@RequirePermissions`. It clears
 * once an officer grants the role, so it keeps the retap.
 */
const DENIED = {
  statusCode: 403,
  error: "Forbidden",
  message: "No roles assigned",
  requestId: "req_denied",
};

/** Any failure that is not a gate. */
const FAILED = {
  statusCode: 500,
  error: "Internal Server Error",
  message: "Task service is unavailable.",
  requestId: "req_failed",
};

const TASKS = [
  {
    id: "task-1",
    title: "Sweep the porch",
    stored_status: "TODO",
    status: "TODO",
    due_date: "2026-10-03",
    assignee_id: "user-1",
    point_reward: 5,
    points_awarded: false,
  },
  // A second row, so a latch scoped to the refused row alone would show.
  {
    id: "task-2",
    title: "Collect ride-share forms",
    stored_status: "TODO",
    status: "TODO",
    due_date: "2026-10-04",
    assignee_id: "user-1",
    point_reward: 3,
    points_awarded: false,
  },
];

let failure: unknown = REFUSED;
const mutateAsync = vi.fn(async () => {
  throw failure;
});

let chapterId: string | null = "chapter-1";

/** Each query's `refetch`, kept across renders so a pull can be asserted on. */
const refetch = vi.hoisted(() => ({
  viewer: vi.fn(async () => undefined),
  tasks: vi.fn(async () => undefined),
  points: vi.fn(async () => undefined),
  leaderboard: vi.fn(async () => undefined),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => chapterId,
  useViewerUserId: () => "user-1",
  useCurrentUser: () => ({ isError: false, refetch: refetch.viewer }),
  useTasks: () => ({
    data: TASKS,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: refetch.tasks,
  }),
  useMyPoints: () => ({ data: undefined, refetch: refetch.points }),
  useLeaderboard: () => ({ data: undefined, refetch: refetch.leaderboard }),
  usePermissionList: () => [],
  useUpdateTaskStatus: () => ({ mutateAsync }),
  useChapterRoster: () => ({ data: [] }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
}));

import TasksScreen from "@/app/(app)/(tabs)/tasks";
import { UndoBar } from "@/components/tasks/undo-bar";

/** "The member came back to this screen": an export of the mocked `expo-router` (vitest.setup.ts). */
const refocus = (expoRouter as unknown as { __refocus: () => void }).__refocus;

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <TasksScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const rows = (tree: ReactTestRenderer) => tree.root.findAllByType(TaskRow);
/** The row the specs tap: the first on the board. */
const row = (tree: ReactTestRenderer) => rows(tree)[0]!;

/** The listener the screen registered last with the mocked `AppState`. */
function appStateListener(): (state: string) => void {
  const calls = vi.mocked(AppState.addEventListener).mock.calls;
  return calls[calls.length - 1]![1] as (state: string) => void;
}

async function tapRow(tree: ReactTestRenderer) {
  const onToggle = row(tree).props.onToggle as (() => void) | undefined;
  expect(onToggle).toBeDefined();
  await act(async () => {
    onToggle?.();
  });
}

beforeEach(() => {
  mutateAsync.mockClear();
  successHaptic.mockReset();
  chapterId = "chapter-1";
});

describe("A task in flight", () => {
  it("dims the tapped row and reads it busy until its PATCH sequence ends", async () => {
    // The first write is held open; the second then fails quietly, which ends
    // the sequence and clears the busy flag.
    failure = FAILED;
    let release!: () => void;
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise<never>((_resolve, reject) => {
          release = () => reject(FAILED);
        }),
    );
    const tree = render();
    await tapRow(tree);

    // The host row. The screen drops `onToggle` while the sequence runs; the
    // row stays openable, and must still look and read in progress.
    const host = () =>
      row(tree).find(
        (node) =>
          typeof node.type === "string" &&
          node.props.accessibilityRole === "button",
      );
    const hostStyle = () => {
      const style = host().props.style;
      return StyleSheet.flatten(
        typeof style === "function" ? style({ pressed: false }) : style,
      );
    };
    expect(row(tree).props.onToggle).toBeUndefined();
    expect(host().props.accessibilityState).toMatchObject({ busy: true });
    expect(hostStyle().opacity).toBe(0.8);
    // The other row is untouched.
    expect(rows(tree)[1]!.props.isPending).toBe(false);

    await act(async () => release());

    expect(row(tree).props.onToggle).toBeDefined();
    expect(host().props.accessibilityState).toMatchObject({ busy: false });
    expect(hostStyle()).not.toHaveProperty("opacity");
    act(() => tree.unmount());
  });
});

describe("Task status toggle on a gate refusal (#2710)", () => {
  it.each([
    ["a subscription refusal", REFUSED, SUBSCRIPTION_REFUSAL_COPY.taskStatus],
    ["a module-off refusal", MODULE_OFF, MODULE_REFUSAL_COPY.taskStatus],
  ])("explains %s and withdraws the toggle", async (_label, error, copy) => {
    failure = error;
    const tree = render();
    await tapRow(tree);

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain(copy);
    // The guard's own words: a checkout instruction the store declaration
    // forbids in the app, or a Settings → Modules instruction for an officer.
    expect(screenText(tree)).not.toContain(
      (error as { message: string }).message,
    );
    // Every row, not just the one tapped: each would refuse the same way.
    expect(rows(tree)).toHaveLength(2);
    for (const each of rows(tree)) expect(each.props.onToggle).toBeUndefined();
    act(() => tree.unmount());
  });

  it("offers the toggles again when the member comes back to the app on this tab", async () => {
    // No navigation focus fires for a return from the background, and the
    // officer may have sorted the gate out meanwhile.
    failure = REFUSED;
    const tree = render();
    await tapRow(tree);
    expect(row(tree).props.onToggle).toBeUndefined();

    act(() => appStateListener()("background"));
    expect(row(tree).props.onToggle).toBeUndefined();
    act(() => appStateListener()("active"));

    expect(screenText(tree)).not.toContain(
      SUBSCRIPTION_REFUSAL_COPY.taskStatus,
    );
    for (const each of rows(tree)) expect(each.props.onToggle).toBeDefined();
    act(() => tree.unmount());
  });

  it("offers the toggle again when the member comes back to the screen", async () => {
    // A tab is never unmounted, so without the reset an officer sorting the
    // gate out would leave the board dead until a force-quit.
    failure = MODULE_OFF;
    const tree = render();
    await tapRow(tree);
    expect(row(tree).props.onToggle).toBeUndefined();

    act(() => refocus());

    expect(screenText(tree)).not.toContain(MODULE_REFUSAL_COPY.taskStatus);
    expect(row(tree).props.onToggle).toBeDefined();
    act(() => tree.unmount());
  });

  // The direction that got an earlier attempt at #2297 reverted: only a gate
  // refusal may withdraw the retry. A bare 403 check would take the retap from
  // a permission denial.
  it.each([
    ["an ordinary failure", FAILED],
    ["a 403 that is neither gate", DENIED],
  ])("keeps the quiet revert and the retap after %s", async (_label, error) => {
    failure = error;
    const tree = render();
    await tapRow(tree);

    expect(screenText(tree)).not.toContain(
      SUBSCRIPTION_REFUSAL_COPY.taskStatus,
    );
    expect(screenText(tree)).not.toContain(MODULE_REFUSAL_COPY.taskStatus);
    expect(row(tree).props.onToggle).toBeDefined();
    act(() => tree.unmount());
  });
});

/**
 * Marking a task done is a confirming action (`spec/ui/mobile/README.md`
 * § Native-feel rules), felt once the writes have landed: a TODO row writes
 * two rungs, and a gate can refuse either.
 */
describe("Task status toggle haptic", () => {
  afterEach(() => {
    mutateAsync.mockImplementation(async () => {
      throw failure;
    });
  });

  it("taps once when a member marks a task done", async () => {
    mutateAsync.mockImplementation(async () => undefined as never);
    const tree = render();
    await tapRow(tree);

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(successHaptic).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("waits for both rungs to land", async () => {
    const releases: (() => void)[] = [];
    mutateAsync.mockImplementation(
      () =>
        new Promise<never>((resolve) => {
          releases.push(() => resolve(undefined as never));
        }),
    );
    const tree = render();
    act(() => {
      (row(tree).props.onToggle as () => void)();
    });

    expect(successHaptic).not.toHaveBeenCalled();
    // The first rung only draws the row in progress.
    await act(async () => releases[0]?.());
    expect(successHaptic).not.toHaveBeenCalled();
    await act(async () => releases[1]?.());
    expect(successHaptic).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it.each([
    ["a gate refusal", () => REFUSED],
    ["an ordinary failure", () => FAILED],
  ])("stays still when the completion meets %s", async (_label, error) => {
    failure = error();
    const tree = render();
    await tapRow(tree);

    expect(mutateAsync).toHaveBeenCalled();
    expect(successHaptic).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

/**
 * The board's clock, which the New task sheet's chips read: re-read when the
 * member comes back, since a tab is never unmounted.
 */
describe("Tasks board clock", () => {
  it("re-reads its clock when the member comes back to the app on this tab", () => {
    // A board left open overnight: no navigation focus fires on the return,
    // and "Due today" must mean the new day.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 8, 28, 22));
      const tree = render();
      const rowNow = () => (row(tree).props.now as Date).getDate();
      expect(rowNow()).toBe(28);

      vi.setSystemTime(new Date(2026, 8, 29, 8));
      act(() => appStateListener()("background"));
      expect(rowNow()).toBe(28);
      act(() => appStateListener()("active"));

      expect(rowNow()).toBe(29);
      act(() => tree.unmount());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Tasks board rows", () => {
  // Flush rows split by hairlines: the screen tells each group's first row it
  // is first, so no hairline floats above a group.
  it("marks only the first row of a group as first", () => {
    const tree = render();
    expect(rows(tree).map((r) => r.props.isFirst)).toEqual([true, false]);
  });
});

describe("Tasks board pull-to-refresh", () => {
  it("refreshes the board, the viewer, the points and the leaderboard on a pull (#3385)", async () => {
    for (const each of Object.values(refetch)) each.mockClear();
    const tree = render();
    // The ScrollView stand-in is a string, so it never renders the control it
    // is handed: the pull is the control element's own `refresh`.
    const control = tree.root.find(
      (node) =>
        (node.type as unknown) === "ScrollView" && node.props.refreshControl,
    ).props.refreshControl as React.ReactElement<{
      refresh: () => Promise<unknown>;
    }>;

    await act(async () => {
      await control.props.refresh();
    });

    for (const each of Object.values(refetch)) {
      expect(each).toHaveBeenCalledTimes(1);
      expect(each).toHaveBeenCalledWith({ cancelRefetch: true });
    }
    act(() => tree.unmount());
  });

  it("leaves the board out of a pull with no chapter, since its read has no gate (#3385)", async () => {
    for (const each of Object.values(refetch)) each.mockClear();
    chapterId = null;
    const tree = render();
    const control = tree.root.find(
      (node) =>
        (node.type as unknown) === "ScrollView" && node.props.refreshControl,
    ).props.refreshControl as React.ReactElement<{
      refresh: () => Promise<unknown>;
    }>;

    await act(async () => {
      await control.props.refresh();
    });

    expect(refetch.tasks).not.toHaveBeenCalled();
    expect(refetch.viewer).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe("Undo after the checkbox completes a task (P6.1)", () => {
  it("offers Undo, and Undo moves the task back to in progress", async () => {
    mutateAsync.mockImplementation(async () => undefined as never);
    const tree = render();
    expect(tree.root.findAllByType(UndoBar)).toHaveLength(0);

    await tapRow(tree);
    expect(
      mutateAsync.mock.calls.map((call) => (call as unknown[])[0]),
    ).toEqual([
      { id: "task-1", body: { status: "IN_PROGRESS" } },
      { id: "task-1", body: { status: "COMPLETED" } },
    ]);
    const bar = tree.root.findByType(UndoBar);
    expect(bar.props.message).toBe("Marked done");

    mutateAsync.mockClear();
    await act(async () => bar.props.onUndo());
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "task-1",
      body: { status: "IN_PROGRESS" },
    });
    expect(tree.root.findAllByType(UndoBar)).toHaveLength(0);
    mutateAsync.mockReset();
    mutateAsync.mockImplementation(async () => {
      throw failure;
    });
    act(() => tree.unmount());
  });

  it("says so when Undo is refused, since the bar has already gone", async () => {
    mutateAsync.mockImplementation(async () => undefined as never);
    const tree = render();
    await tapRow(tree);
    const bar = tree.root.findByType(UndoBar);

    mutateAsync.mockImplementation(async () => {
      throw FAILED;
    });
    await act(async () => bar.props.onUndo());
    const all = tree.root
      .findAllByType("Text" as never)
      .flatMap((node) => React.Children.toArray(node.props.children))
      .filter((child) => typeof child === "string");
    expect(all).toContain(
      "Couldn't mark that task not done. An officer may have confirmed it already.",
    );
    mutateAsync.mockReset();
    mutateAsync.mockImplementation(async () => {
      throw failure;
    });
    act(() => tree.unmount());
  });

  it("offers no Undo when the completion fails", async () => {
    failure = FAILED;
    const tree = render();
    await tapRow(tree);
    expect(tree.root.findAllByType(UndoBar)).toHaveLength(0);
    act(() => tree.unmount());
  });
});
