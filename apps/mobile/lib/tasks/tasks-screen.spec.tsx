/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
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
 * It renders `app/(tabs)/tasks.tsx` but lives here: a spec under `app/` ships
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
];

let failure: unknown = REFUSED;
const mutateAsync = vi.fn(async () => {
  throw failure;
});

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => "chapter-1",
  useViewerUserId: () => "user-1",
  useCurrentUser: () => ({ isError: false }),
  useTasks: () => ({
    data: TASKS,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useMyPoints: () => ({ data: undefined }),
  useLeaderboard: () => ({ data: undefined }),
  usePermissionList: () => [],
  useUpdateTaskStatus: () => ({ mutateAsync }),
}));

// The sheet has its own rendered spec; here it would only bring its own hooks.
vi.mock("@/components/tasks/new-task-sheet", () => ({
  NewTaskSheet: () => null,
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import TasksScreen from "@/app/(tabs)/tasks";

/** "The member came back to this screen": an export of the mocked `expo-router` (vitest.setup.ts). */
const refocus = (expoRouter as unknown as { __refocus: () => void })
  .__refocus;

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

const row = (tree: ReactTestRenderer) => tree.root.findByType(TaskRow);

async function tapRow(tree: ReactTestRenderer) {
  const onToggle = row(tree).props.onToggle as (() => void) | undefined;
  expect(onToggle).toBeDefined();
  await act(async () => {
    onToggle?.();
  });
}

beforeEach(() => {
  mutateAsync.mockClear();
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
    expect(screenText(tree)).not.toContain((error as { message: string }).message);
    expect(row(tree).props.onToggle).toBeUndefined();
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

    expect(screenText(tree)).not.toContain(SUBSCRIPTION_REFUSAL_COPY.taskStatus);
    expect(screenText(tree)).not.toContain(MODULE_REFUSAL_COPY.taskStatus);
    expect(row(tree).props.onToggle).toBeDefined();
    act(() => tree.unmount());
  });
});
