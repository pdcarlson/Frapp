/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { AppState, StyleSheet } from "react-native";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { expectBackRow } from "@/test/back-row";
import { FloatingCreateButton } from "@/components/floating-create-button";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { moduleDisabledMessage } from "@repo/validation";
import { TaskRow, TaskTile } from "@/components/tasks/task-row";
import { ListLayoutToggle } from "@/components/list-layout-toggle";
import { resetListLayoutsForTests, setListLayout } from "@/lib/list-layout";

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
 * It renders `app/(app)/tasks.tsx` but lives here: a spec under `app/` ships
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
/** The board's rows, the viewer's grants and the chapter, per spec. */
let tasks: unknown[] = TASKS;
let permissions: string[] = [];
let enabledModules: Record<string, boolean> | undefined = undefined;
let events: unknown[] | undefined = [];
/** Each `useEvents` call's `enabled`, so a spec can see whether it read. */
const eventsEnabled: (boolean | undefined)[] = [];

/** Each query's `refetch`, kept across renders so a pull can be asserted on. */
/** Up for grabs: the postings read, and each open-task write. */
let openTasks: unknown[] | undefined = [];
let openTasksError = false;
const claimMutate = vi.fn();
const releaseMutate = vi.fn();
const assignMutate = vi.fn();
const deleteMutate = vi.fn();
const deleteTask = vi.fn(async () => ({}));

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
    data: tasks,
    isSuccess: true,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: refetch.tasks,
  }),
  useMyPoints: () => ({ data: undefined, refetch: refetch.points }),
  useLeaderboard: () => ({ data: undefined, refetch: refetch.leaderboard }),
  usePermissionList: () => permissions,
  useCurrentChapter: () => ({
    isSuccess: true,
    data: { enabled_modules: enabledModules },
  }),
  useEvents: (options?: { enabled?: boolean }) => {
    eventsEnabled.push(options?.enabled);
    return { data: options?.enabled ? events : undefined };
  },
  useUpdateTaskStatus: () => ({ mutateAsync }),
  useDeleteTask: () => ({ mutateAsync: deleteTask, isPending: false }),
  useConfirmTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRejectTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChapterRoster: () => ({ data: [] }),
  useOpenTasks: () => ({
    data: openTasks,
    isError: openTasksError,
    refetch: vi.fn(async () => undefined),
  }),
  useClaimOpenTask: () => ({ mutate: claimMutate, isPending: false }),
  useReleaseTask: () => ({ mutate: releaseMutate, isPending: false }),
  useAssignOpenTask: () => ({ mutate: assignMutate, isPending: false }),
  useDeleteOpenTask: () => ({ mutate: deleteMutate, isPending: false }),
}));

// Suggested tasks' entry has its own spec
// (`components/tasks/suggested-tasks-entry.spec.tsx`).
vi.mock("@/components/tasks/suggested-tasks-entry", () => ({
  SuggestedTasksEntry: () => null,
}));

// The sheet reads the roster and posts through the API client; the board's
// side of it (mount on +, say where the task went) is what is pinned here.
vi.mock("@/components/tasks/new-task-sheet", async () => {
  const { forwardRef, createElement } = await import("react");
  return {
    NewTaskSheet: forwardRef(function NewTaskSheet(props: object) {
      return createElement("NewTaskSheet", props);
    }),
  };
});
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

// Mark done's sheet has its own spec (#4635); here only that the board
// opens it, on what, and what its Mark done sends.
vi.mock("@/components/tasks/mark-done-sheet", async () => {
  const { createElement } = await import("react");
  return {
    MarkDoneSheet: (props: object) => createElement("MarkDoneSheet", props),
  };
});

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
  pressHaptic: () => undefined,
}));

import TasksScreen from "@/app/(app)/tasks";
import { UndoBar } from "@/components/tasks/undo-bar";
import { OpenTaskRow } from "@/components/tasks/open-task-row";
import { TASK_AUDIENCE_COPY } from "@repo/validation";

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
  resetListLayoutsForTests();
  mutateAsync.mockClear();
  successHaptic.mockReset();
  chapterId = "chapter-1";
  openTasks = [];
  openTasksError = false;
  claimMutate.mockReset();
  releaseMutate.mockReset();
  assignMutate.mockReset();
  deleteMutate.mockReset();
});

/**
 * List or Grid (#4175): today's rows are List, the default; Grid lays the same
 * tasks out as cards two to a line, with the row's two targets.
 */
describe("Tasks List / Grid", () => {
  it("draws rows by default, and cards that keep the box and the open in Grid", async () => {
    const tree = render();
    expect(tree.root.findAllByType(ListLayoutToggle)).toHaveLength(1);
    expect(rows(tree).length).toBeGreaterThan(0);
    expect(tree.root.findAllByType(TaskTile)).toHaveLength(0);

    act(() => setListLayout("tasks", "grid"));
    const tiles = tree.root.findAllByType(TaskTile);
    expect(rows(tree)).toHaveLength(0);
    expect(tiles.length).toBeGreaterThan(0);
    // The card's own targets, pressed as a member would: the body pushes
    // the task's screen (#5492, where an officer's Edit sits)...
    const tile = tiles[0]!;
    const body = tile.find(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "button",
    );
    vi.mocked(vi.mocked(expoRouter.useRouter)().push).mockClear();
    act(() => body.props.onPress());
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/task-details",
      params: { id: tile.props.row.id },
    });

    // ...and the box completes it.
    const box = tile.find(
      (node) =>
        typeof node.type === "string" &&
        node.props.testID === `task-checkbox-${tile.props.row.id}`,
    );
    await act(async () => {
      box.props.onPress();
    });
    expect(mutateAsync).toHaveBeenCalled();
  });
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

  // #4635: Mark done is a compare-and-set, refused with a 400 and a sentence
  // when the task changed after the board read it. That reason is said.
  it("says why when the server refuses Mark done with a 400", async () => {
    failure = {
      statusCode: 400,
      error: "Bad Request",
      message:
        "This task changed while you were marking it done. Look again and retry.",
      requestId: "req_changed",
    };
    const tree = render();
    await tapRow(tree);
    expect(screenText(tree)).toContain(
      "This task changed while you were marking it done. Look again and retry.",
    );
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

/**
 * The board left the tab bar for Activity's place there (#4610): it is pushed
 * from Activity, goes back to it, and carries its own + for New task, since a
 * pushed screen covers the tab bar's.
 */
describe("Tasks as a pushed screen (#4610)", () => {
  afterEach(() => {
    permissions = [];
    enabledModules = undefined;
  });

  it("goes back to Activity", () => {
    const tree = render();
    expectBackRow(tree, "Activity", "/activity");
    act(() => tree.unmount());
  });

  it("draws its own New task + for a role that can assign", () => {
    permissions = ["tasks:manage", "members:view"];
    const tree = render();
    const [plus] = tree.root.findAllByType(FloatingCreateButton);
    expect(plus!.props.label).toBe("New task");
    act(() => tree.unmount());
  });

  it("opens New task from its +, and says where the task went", () => {
    permissions = ["tasks:manage", "members:view"];
    const tree = render();
    const [plus] = tree.root.findAllByType(FloatingCreateButton);
    act(() => plus!.props.onPress());
    const [sheet] = tree.root.findAll(
      (node) => (node.type as unknown) === "NewTaskSheet",
    );
    expect(sheet).toBeDefined();
    act(() => sheet!.props.onCreated("Sam Lee", false));
    expect(screenText(tree)).toContain("Assigned to Sam Lee.");
    act(() => tree.unmount());
  });

  it("pushes the task's screen for a task link it can read (#5492)", () => {
    const router = vi.mocked(expoRouter.useRouter)();
    vi.mocked(router.push).mockClear();
    vi.mocked(router.setParams).mockClear();
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      task: "task-2",
    });
    const tree = render();
    expect(router.setParams).toHaveBeenCalledWith({ task: undefined });
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/task-details",
      params: { id: "task-2" },
    });
    act(() => tree.unmount());
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
  });

  it("stays on the board for a task link its read doesn't hold", () => {
    const router = vi.mocked(expoRouter.useRouter)();
    vi.mocked(router.push).mockClear();
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      task: "someone-elses",
    });
    const tree = render();
    expect(router.push).not.toHaveBeenCalled();
    act(() => tree.unmount());
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
  });

  it("says a task given back from its screen is up for grabs again, through the focus that lands here", async () => {
    const router = vi.mocked(expoRouter.useRouter)();
    vi.mocked(router.setParams).mockClear();
    // The board is under the task's screen; going back to it brings the
    // param and a focus together.
    const tree = render();
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      released: "1",
    });
    act(() => refocus());
    expect(screenText(tree)).toContain(
      `It's back on ${TASK_AUDIENCE_COPY.upForGrabs}.`,
    );
    expect(router.setParams).toHaveBeenCalledWith({
      released: undefined,
      assigned: undefined,
    });
    // The next focus takes it down, as any line under the points line.
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screenText(tree)).toContain(
      `It's back on ${TASK_AUDIENCE_COPY.upForGrabs}.`,
    );
    act(() => refocus());
    expect(screenText(tree)).not.toContain(
      `It's back on ${TASK_AUDIENCE_COPY.upForGrabs}.`,
    );
    act(() => tree.unmount());
  });

  it("draws no + while the chapter has Tasks off", () => {
    permissions = ["tasks:manage", "members:view"];
    enabledModules = { tasks: false };
    const tree = render();
    expect(tree.root.findAllByType(FloatingCreateButton)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("draws no + for a member who can't assign", () => {
    const tree = render();
    expect(tree.root.findAllByType(FloatingCreateButton)).toHaveLength(0);
    act(() => tree.unmount());
  });
});

/**
 * Rule 7 of the empty-states plan: a member with nothing assigned reads one
 * line under the points line, the same line web's board writes, rather than a
 * card. The + is the board's own (New task), so only an officer hears about
 * it.
 */
describe("Tasks with nothing assigned", () => {
  const soon = (hours: number) =>
    new Date(Date.now() + hours * 3_600_000).toISOString();
  const text = (tree: ReactTestRenderer) => screenText(tree);

  afterEach(() => {
    tasks = TASKS;
    permissions = [];
    enabledModules = undefined;
    events = [];
    eventsEnabled.length = 0;
  });

  it("says the plate is clear and names the next event", () => {
    tasks = [];
    events = [
      { name: "Formal", start_time: soon(72) },
      { name: "Chapter meeting", start_time: soon(2) },
    ];
    const tree = render();

    expect(text(tree)).toMatch(
      /Nothing on your plate\. Next up: Chapter meeting, /,
    );
    expect(text(tree)).not.toContain("all clear");
    expect(text(tree)).not.toContain("Tap +");
    act(() => tree.unmount());
  });

  it("tells an officer the + assigns a task", () => {
    tasks = [];
    permissions = ["tasks:manage", "members:view"];
    const tree = render();

    expect(text(tree)).toContain(
      "Nothing on your plate. Tap + to assign a task.",
    );
    act(() => tree.unmount());
  });

  it("points at no + for a role the quick actions don't offer New task (#3865)", () => {
    // `POST /v1/tasks` also needs members:view, so the + has no New task.
    tasks = [];
    permissions = ["tasks:manage"];
    const tree = render();

    expect(text(tree)).not.toContain("Tap + to assign a task.");
    act(() => tree.unmount());
  });

  it("leaves the events read off when Events is off", () => {
    tasks = [];
    enabledModules = { events: false };
    events = [{ name: "Chapter meeting", start_time: soon(2) }];
    const tree = render();

    expect(eventsEnabled.every((enabled) => !enabled)).toBe(true);
    expect(text(tree)).toContain("Nothing on your plate.");
    expect(text(tree)).not.toContain("Next up");
    act(() => tree.unmount());
  });

  it("reads no events while the board has rows", () => {
    const tree = render();

    expect(eventsEnabled.every((enabled) => !enabled)).toBe(true);
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

describe("Mark done with proof on the board (#4635)", () => {
  type SheetProps = {
    task: { id: string; proofKind: string; sentBack: boolean };
    keptDraft?: string;
    initialProblem: string | null;
    onComplete: (proof: Record<string, unknown>) => Promise<void>;
    onClosed: () => void;
  };
  const sheet = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => (node.type as unknown) === "MarkDoneSheet")[0]
      ?.props as SheetProps | undefined;

  afterEach(() => {
    tasks = TASKS;
    mutateAsync.mockReset();
    mutateAsync.mockImplementation(async () => {
      throw failure;
    });
  });

  it("opens Mark done's sheet for a Photo task, and sends the proof with the done rung", async () => {
    tasks = [{ ...TASKS[0], proof_kind: "photo" }];
    mutateAsync.mockImplementation(async () => undefined as never);
    const tree = render();
    await tapRow(tree);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(sheet(tree)?.task).toMatchObject({
      id: "task-1",
      proofKind: "photo",
    });
    // The same name as the task's chat card's Mark done (#5041).
    expect(sheet(tree)?.keptDraft).toBe("mark-done:task-1");
    await act(() =>
      sheet(tree)!.onComplete({ proof_photo_paths: ["p/1.jpg"] }),
    );
    expect(
      mutateAsync.mock.calls.map((call) => (call as unknown[])[0]),
    ).toEqual([
      { id: "task-1", body: { status: "IN_PROGRESS" } },
      {
        id: "task-1",
        body: { status: "COMPLETED", proof_photo_paths: ["p/1.jpg"] },
      },
    ]);
    expect(successHaptic).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("opens it for a sent-back task too", async () => {
    tasks = [
      {
        ...TASKS[0],
        stored_status: "IN_PROGRESS",
        status: "IN_PROGRESS",
        sent_back_at: "2026-10-01T12:00:00Z",
        sent_back_reason: "Floor is still sticky",
      },
    ];
    const tree = render();
    await tapRow(tree);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(sheet(tree)?.task.sentBack).toBe(true);
    act(() => tree.unmount());
  });

  it("opens it with the reason when the server asks for proof the board didn't know of", async () => {
    tasks = [
      { ...TASKS[0], stored_status: "IN_PROGRESS", status: "IN_PROGRESS" },
    ];
    mutateAsync.mockImplementation(async () => {
      throw { statusCode: 400, code: "task.proof_required", message: "x" };
    });
    const tree = render();
    await tapRow(tree);
    expect(sheet(tree)?.initialProblem).toMatch(/needs proof/);
    expect(screenText(tree)).not.toContain("on the web");
    act(() => tree.unmount());
  });

  it("hands the sheet a refusal to say", async () => {
    tasks = [
      {
        ...TASKS[0],
        stored_status: "IN_PROGRESS",
        status: "IN_PROGRESS",
        proof_kind: "link",
      },
    ];
    mutateAsync.mockImplementation(async () => {
      throw FAILED;
    });
    const tree = render();
    await tapRow(tree);
    await expect(
      sheet(tree)!.onComplete({ proof_link: "https://x.example" }),
    ).rejects.toBe(FAILED);
    act(() => tree.unmount());
  });
});

/** tasks.md § Up for grabs: open tasks a member may claim, above Today. */
describe("Up for grabs", () => {
  /** Three days out, as the local calendar reads it, so it says "Due ...". */
  const soon = new Date(Date.now() + 3 * 86_400_000);
  const SOON = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
  const POSTING = {
    id: "open-1",
    chapter_id: "chapter-1",
    created_by: "user-9",
    title: "Drive the van",
    description: null,
    due_date: SOON,
    due_at: null,
    point_reward: 10,
    proof_kind: "none",
    subtask_titles: [],
    scope: "group",
    scope_id: "g-1",
    scope_name: "Philanthropy",
    scope_user_ids: null,
    status: "open",
    claimed_task_id: null,
    claimed_by: null,
    claimed_at: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    eligible_count: 6,
    viewer_can_claim: true,
  };
  const openRows = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(OpenTaskRow);
  type MutateOptions = {
    onSuccess?: (data: unknown) => void;
    onError?: (error: unknown) => void;
  };

  it("draws nothing while nothing is open", () => {
    const tree = render();
    expect(openRows(tree)).toHaveLength(0);
    expect(screenText(tree)).not.toContain("UP FOR GRABS");
    act(() => tree.unmount());
  });

  it("sits above the board with its points, group and due, and a Claim", () => {
    openTasks = [POSTING, { ...POSTING, id: "open-2", status: "claimed" }];
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("UP FOR GRABS");
    expect(text.indexOf("UP FOR GRABS")).toBeLessThan(
      text.indexOf("Sweep the porch"),
    );
    // A claimed posting is not drawn.
    expect(openRows(tree)).toHaveLength(1);
    expect(text).toMatch(/10 points · Philanthropy · Due /);
    expect(openRows(tree)[0]!.props.onClaim).toBeDefined();
    act(() => tree.unmount());
  });

  it("draws no Claim on a posting the viewer may not claim", () => {
    openTasks = [{ ...POSTING, viewer_can_claim: false }];
    const tree = render();
    expect(openRows(tree)[0]!.props.onClaim).toBeUndefined();
    act(() => tree.unmount());
  });

  it("claims, says it's yours, and Give it back releases the new task", () => {
    openTasks = [POSTING];
    const tree = render();
    act(() => openRows(tree)[0]!.props.onClaim());
    expect(claimMutate).toHaveBeenCalledWith("open-1", expect.anything());
    const options = claimMutate.mock.calls[0]![1] as MutateOptions;
    act(() => options.onSuccess?.({ id: "task-9" }));
    const bar = tree.root.findByType(UndoBar);
    expect(bar.props.message).toMatch(/^It's yours\. Due /);
    expect(bar.props.actionLabel).toBe(TASK_AUDIENCE_COPY.release);
    act(() => bar.props.onUndo());
    expect(releaseMutate).toHaveBeenCalledWith("task-9", expect.anything());
    expect(tree.root.findAllByType(UndoBar)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("says another member claimed it first, and drops the row", () => {
    openTasks = [POSTING];
    const tree = render();
    act(() => openRows(tree)[0]!.props.onClaim());
    const options = claimMutate.mock.calls[0]![1] as MutateOptions;
    act(() => options.onError?.({ statusCode: 409, message: "Claimed" }));
    expect(screenText(tree)).toContain(TASK_AUDIENCE_COPY.alreadyClaimed);
    expect(openRows(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("says so in one line when the read fails", () => {
    openTasks = undefined;
    openTasksError = true;
    const tree = render();
    expect(screenText(tree)).toContain(
      `Couldn't load ${TASK_AUDIENCE_COPY.upForGrabs}`,
    );
    act(() => tree.unmount());
  });

  // #5570: a posting opens on its own screen, as a task does; no sheet.
  it("pushes a posting's own screen", () => {
    const router = vi.mocked(expoRouter.useRouter)();
    vi.mocked(router.push).mockClear();
    openTasks = [POSTING];
    const tree = render();
    act(() => openRows(tree)[0]!.props.onOpen());
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/task-details",
      params: { posting: "open-1" },
    });
    act(() => tree.unmount());
  });

  it("says who a posting went to when its screen handed it over", () => {
    const router = vi.mocked(expoRouter.useRouter)();
    vi.mocked(router.setParams).mockClear();
    const tree = render();
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      assigned: "user-1",
    });
    act(() => refocus());
    expect(screenText(tree)).toContain("Added to your tasks.");
    expect(router.setParams).toHaveBeenCalledWith({
      released: undefined,
      assigned: undefined,
    });
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
    act(() => tree.unmount());
  });
});

// #5492: hold a task on the board for its actions.
describe("Long-press menu on the board (#5492)", () => {
  const menuItems = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "menuitem",
    );
  const pressHost = (within: ReactTestRenderer["root"]) =>
    within.find(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "button" &&
        typeof node.props.onPress === "function",
    );
  const hold = (tree: ReactTestRenderer, within: ReactTestRenderer["root"]) => {
    const host = pressHost(within);
    expect(host.props.onLongPress, "a long press").toBeTypeOf("function");
    act(() => host.props.onLongPress({ nativeEvent: { pageY: 300 } }));
    return menuItems(tree).map((node) => node.props.accessibilityLabel);
  };

  beforeEach(() => {
    permissions = ["members:view", "tasks:manage"];
  });
  afterEach(() => {
    permissions = [];
  });

  it("opens a row's menu, and says where a Duplicate went in the board's line", () => {
    const tree = render();
    expect(hold(tree, row(tree))).toEqual([
      "Mark done",
      "Start",
      "Edit",
      "Reassign",
      "Duplicate",
      "Delete",
    ]);
    act(() =>
      menuItems(tree)
        .find((node) => node.props.accessibilityLabel === "Duplicate")!
        .props.onPress(),
    );
    const duplicate = tree.root.find(
      (node) =>
        (node.type as unknown) === "NewTaskSheet" &&
        node.props.prefill !== undefined,
    );
    expect(duplicate.props.prefill.title).toBe("Sweep the porch");
    act(() => duplicate.props.onCreated("Sam Lee", false, false));
    expect(screenText(tree)).toContain("Assigned to Sam Lee.");
    act(() => tree.unmount());
  });

  it("gives a Grid card the same long press and named actions", () => {
    const tree = render();
    act(() => setListLayout("tasks", "grid"));
    const tile = tree.root.findAllByType(TaskTile)[0]!;
    expect(
      (pressHost(tile).props.accessibilityActions as { label: string }[]).map(
        (action) => action.label,
      ),
    ).toEqual([
      "Mark done",
      "Start",
      "Edit",
      "Reassign",
      "Duplicate",
      "Delete",
    ]);
    expect(hold(tree, tile)).toContain("Duplicate");
    act(() => tree.unmount());
  });
});
