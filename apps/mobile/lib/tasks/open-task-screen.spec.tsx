/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import * as expoRouter from "expo-router";
import { AccessibilityInfo, Alert } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { expectBackRow } from "@/test/back-row";
import { TASK_AUDIENCE_COPY } from "@repo/validation";

/**
 * A task up for grabs as its own screen (#5570), where its sheet rose until
 * then: `/task-details?posting=<id>`. What it shows, which controls each
 * viewer gets, and where each move goes.
 *
 * It renders `app/(app)/task-details.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

const soon = new Date(Date.now() + 3 * 86_400_000);
const SOON = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
const POSTING = {
  id: "open-1",
  chapter_id: "chapter-1",
  created_by: "user-9",
  title: "Drive the van",
  description: "Pick up at the house at 9.",
  due_date: SOON,
  due_at: null,
  point_reward: 10,
  proof_kind: "none",
  subtask_titles: ["Fuel up", "Return keys"],
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

let openTasks: unknown[] | undefined = [POSTING];
let openTasksError = false;
let permissions: string[] = [];
const claimMutate = vi.fn();
/** Whether a claim is on its way, as `useClaimOpenTask` reports it. */
let claimPending = false;
const assignMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useOpenTasks: () => ({
    data: openTasks,
    isError: openTasksError,
    error: openTasksError ? { statusCode: 500, message: "Down" } : null,
    isFetching: false,
    refetch: vi.fn(async () => undefined),
  }),
  usePermissionList: () => permissions,
  useMemberDisplayNames: () => ({ byId: { "user-3": "Sam Rivera" } }),
  useViewerUserId: () => "user-1",
  useClaimOpenTask: () => ({ mutate: claimMutate, isPending: claimPending }),
  useAssignOpenTask: () => ({ mutate: assignMutate, isPending: false }),
  useDeleteOpenTask: () => ({ mutate: deleteMutate, isPending: false }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));
// The picker has its own spec; here only that the screen opens it and what
// a pick sends.
vi.mock("@/components/tasks/open-task-picker", async () => {
  const { createElement } = await import("react");
  return {
    OpenTaskAssignPicker: (props: object) =>
      createElement("OpenTaskAssignPicker", props),
  };
});
vi.mock("@/lib/haptics", () => ({ successHaptic: () => undefined }));

import TaskDetailsRoute from "@/app/(app)/task-details";

const router = vi.mocked(expoRouter.useRouter)();

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <TaskDetailsRoute />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const control = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )[0];

type MutateOptions = {
  onSuccess?: (data?: unknown) => void;
  onError?: (error: unknown) => void;
};

beforeEach(() => {
  vi.clearAllMocks();
  openTasks = [POSTING];
  openTasksError = false;
  permissions = [];
  claimPending = false;
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
    posting: "open-1",
  });
});
afterEach(() => {
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
});

describe("A task up for grabs, on its own screen (#5570)", () => {
  it("draws the posting: title, chip, facts, who can claim, notes; back to Tasks", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Drive the van");
    expect(text).toContain(TASK_AUDIENCE_COPY.upForGrabs);
    expect(text).toContain("10 points");
    expect(text).toContain("2 steps");
    expect(text).toContain("Someone in Philanthropy");
    expect(text).toContain("Pick up at the house at 9.");
    expectBackRow(tree, "Tasks", "/tasks");
    act(() => tree.unmount());
  });

  it("gives a member Claim and no officer controls", () => {
    const tree = render();
    expect(control(tree, TASK_AUDIENCE_COPY.claim)).toBeDefined();
    expect(control(tree, TASK_AUDIENCE_COPY.assignToSomeone)).toBeUndefined();
    expect(control(tree, "Delete")).toBeUndefined();
    act(() => tree.unmount());
  });

  it("draws no bar for a member who may not claim it", () => {
    openTasks = [{ ...POSTING, viewer_can_claim: false }];
    const tree = render();
    expect(control(tree, TASK_AUDIENCE_COPY.claim)).toBeUndefined();
    act(() => tree.unmount());
  });

  it("claims, and replaces itself with the task the claim made", () => {
    const tree = render();
    act(() => control(tree, TASK_AUDIENCE_COPY.claim)!.props.onPress());
    expect(claimMutate).toHaveBeenCalledWith("open-1", expect.anything());
    // The claim is optimistic: the posting leaves the list at once, and the
    // screen holds it while the claim is on its way rather than flash
    // "isn't on Up for grabs".
    openTasks = [];
    claimPending = true;
    const rerender = () =>
      act(() =>
        tree.update(
          <FrappThemeProvider>
            <TaskDetailsRoute />
          </FrappThemeProvider>,
        ),
      );
    rerender();
    expect(screenText(tree)).toContain("Drive the van");
    expect(screenText(tree)).not.toContain("any more");
    const options = claimMutate.mock.calls[0]![1] as MutateOptions;
    claimPending = false;
    act(() => options.onSuccess?.({ id: "task-9" }));
    rerender();
    expect(screenText(tree)).toContain("Drive the van");
    expect(router.replace).toHaveBeenCalledWith({
      pathname: "/task-details",
      params: { id: "task-9" },
    });
    act(() => tree.unmount());
  });

  it("says another member claimed it first", () => {
    const tree = render();
    act(() => control(tree, TASK_AUDIENCE_COPY.claim)!.props.onPress());
    const options = claimMutate.mock.calls[0]![1] as MutateOptions;
    act(() => options.onError?.({ statusCode: 409, message: "Claimed" }));
    expect(screenText(tree)).toContain(TASK_AUDIENCE_COPY.alreadyClaimed);
    expect(router.replace).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("gives an officer Assign to someone and Delete, each going back to the board", () => {
    permissions = ["tasks:manage", "members:view"];
    const tree = render();
    act(() =>
      control(tree, TASK_AUDIENCE_COPY.assignToSomeone)!.props.onPress(),
    );
    const picker = tree.root.findByType(
      "OpenTaskAssignPicker" as unknown as React.ComponentType,
    );
    act(() => picker.props.onPick("user-3"));
    expect(assignMutate).toHaveBeenCalledWith(
      { id: "open-1", assigneeId: "user-3" },
      expect.anything(),
    );
    const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    act(() => (assignMutate.mock.calls[0]![1] as MutateOptions).onSuccess?.());
    // Said before it goes, since the board's line has no live region.
    expect(announce).toHaveBeenCalledWith("Assigned to Sam Rivera.");
    announce.mockRestore();
    expect(router.dismissTo).toHaveBeenCalledWith({
      pathname: "/tasks",
      params: { assigned: "user-3" },
    });

    const alert = vi.spyOn(Alert, "alert");
    act(() => control(tree, "Delete")!.props.onPress());
    const buttons = alert.mock.calls[0]![2] as {
      text: string;
      onPress?: () => void;
    }[];
    act(() => buttons.find((button) => button.text === "Delete")!.onPress!());
    expect(deleteMutate).toHaveBeenCalledWith("open-1", expect.anything());
    vi.mocked(router.dismissTo).mockClear();
    act(() => (deleteMutate.mock.calls[0]![1] as MutateOptions).onSuccess?.());
    expect(router.dismissTo).toHaveBeenCalledWith("/tasks");
    alert.mockRestore();
    act(() => tree.unmount());
  });

  it("says so when the posting is no longer up for grabs", () => {
    openTasks = [{ ...POSTING, status: "claimed" }];
    const tree = render();
    expect(screenText(tree)).toContain(
      `This task isn't on ${TASK_AUDIENCE_COPY.upForGrabs} any more.`,
    );
    act(() => tree.unmount());
  });

  it("offers a retry when the list can't be read", () => {
    openTasks = undefined;
    openTasksError = true;
    const tree = render();
    expect(screenText(tree)).toContain("Couldn't load this task");
    act(() => tree.unmount());
  });
});
