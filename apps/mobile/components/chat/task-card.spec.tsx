/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { AppState } from "react-native";
import * as expoRouter from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import type { TaskPayload } from "@repo/chat-core/cards";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";
import { moduleDisabledMessage } from "@repo/validation";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";

/**
 * The mobile chat task card (#3185). Which controls show is
 * `taskCardControls`, which `packages/hooks/src/task-card.spec.ts` covers
 * branch by branch; these cases check the card draws and wires what it
 * decides, and that nothing renders off the creation-time snapshot (#2065).
 */

const ASSIGNEE = "assignee-1";

const state = vi.hoisted(() => ({
  now: new Date(2026, 10, 5, 12, 0),
  permissions: [] as string[],
  live: undefined as unknown,
  taskIds: [] as string[],
  enabledModules: {} as Record<string, boolean>,
  writeBlockedReason: null as string | null,
}));
const updateStatus = vi.hoisted(() => vi.fn());
const confirmTask = vi.hoisted(() => vi.fn());
const rejectTask = vi.hoisted(() => vi.fn());

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useNowDate: () => state.now,
  usePermissionList: () => state.permissions,
  // The real hook is disabled on an empty id, so an empty id reads nothing.
  useTask: (id: string) => {
    state.taskIds.push(id);
    return { data: id ? state.live : undefined };
  },
  useUpdateTaskStatus: () => ({ mutateAsync: updateStatus, isPending: false }),
  useConfirmTask: () => ({ mutateAsync: confirmTask, isPending: false }),
  useRejectTask: () => ({ mutateAsync: rejectTask, isPending: false }),
  useCurrentChapter: () => ({
    data: { enabled_modules: state.enabledModules },
  }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: state.writeBlockedReason }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

// The edit sheet is the board's (#4296), covered by its own spec; here only
// what it was opened on matters.
const editSheet = vi.hoisted(() => ({
  editing: null as unknown,
  present: vi.fn(),
}));
vi.mock("@/components/tasks/new-task-sheet", async () => {
  const React = await import("react");
  return {
    NewTaskSheet: React.forwardRef(function NewTaskSheet(
      props: { editing: unknown },
      ref: React.Ref<{ present: () => void }>,
    ) {
      editSheet.editing = props.editing;
      React.useImperativeHandle(ref, () => ({ present: editSheet.present }));
      return null;
    }),
  };
});

// Mark done's and Send back's sheets (#4635) have their own specs; here only
// that the card opens them, on what, and what their submit sends.
const sheets = vi.hoisted(() => ({
  markDone: null as null | {
    task: {
      proofKind: string;
      sentBack: boolean;
      sentBackReason: string | null;
    };
    initialProblem: string | null;
    onComplete: (proof: Record<string, unknown>) => Promise<void>;
  },
  sendBack: null as null | {
    proofKind: string;
    onSubmit: (input: Record<string, unknown>) => Promise<void>;
  },
}));
vi.mock("@/components/tasks/mark-done-sheet", () => ({
  MarkDoneSheet: (props: NonNullable<typeof sheets.markDone>) => {
    sheets.markDone = props;
    return null;
  },
}));
vi.mock("@/components/tasks/send-back-sheet", () => ({
  SendBackSheet: (props: NonNullable<typeof sheets.sendBack>) => {
    sheets.sendBack = props;
    return null;
  },
}));

import { TaskCard } from "./task-card";
import { CardMeta } from "./chat-card";

/** Every mounted focus effect, run again: the member came back to the thread. */
const refocus = (expoRouter as unknown as { __refocus: () => void }).__refocus;

/** The listener the card registered last with the mocked `AppState`. */
function appStateListener(): (state: string) => void {
  const calls = vi.mocked(AppState.addEventListener).mock.calls;
  return calls[calls.length - 1]![1] as (state: string) => void;
}

const PAYLOAD: TaskPayload = {
  task_id: "task-1",
  title: "Fix the laundry room door",
  assigner_user_id: "admin-1",
  assigner_name: "Alice",
  assignee_user_id: ASSIGNEE,
  assignee_name: "Bob",
  due_date: "2026-11-06",
  status: "TODO",
  point_reward: 15,
  created_at: "2026-11-01T12:00:00.000Z",
};

function liveTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    status: "TODO",
    stored_status: "TODO",
    points_awarded: false,
    // Points, so a completion waits on an officer (#4635).
    point_reward: 15,
    ...overrides,
  };
}

function message(): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: "admin-1",
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: 'Assigned "Fix the laundry room door" to Bob (due 2026-11-06)',
    kind: "task",
    payload: PAYLOAD,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: "2026-11-01T12:00:00.000Z",
    client_message_id: "client-1",
    attachment_count: 0,
    sender_blocked: false,
    _blockEvaluated: true,
    reactions: {},
    actions: [],
    _status: "confirmed",
  } as unknown as ChatMessage;
}

function render(
  viewerId: string,
  options: { isConfirmed?: boolean } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <TaskCard
          message={message()}
          payload={PAYLOAD}
          viewerId={viewerId}
          isConfirmed={options.isConfirmed ?? true}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/** The card's own action buttons, by label: reactions and delivery excluded. */
function actions(tree: ReactTestRenderer): string[] {
  const labels = ["Start", "Mark done", "Confirm", "Confirmed", "Send back"];
  return tree.root
    .findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        labels.includes(node.props.accessibilityLabel),
    )
    .map((node) => node.props.accessibilityLabel as string);
}

function button(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );
}

async function press(tree: ReactTestRenderer, label: string) {
  await act(async () => {
    button(tree, label).props.onPress();
  });
}

beforeEach(() => {
  state.now = new Date(2026, 10, 5, 12, 0);
  state.permissions = [];
  state.live = liveTask();
  state.taskIds = [];
  state.enabledModules = {};
  state.writeBlockedReason = null;
  updateStatus.mockReset().mockResolvedValue({});
  confirmTask.mockReset().mockResolvedValue({});
  rejectTask.mockReset().mockResolvedValue({});
});

describe("TaskCard — the snapshot", () => {
  it("draws the title, who assigned whom, and the reward", () => {
    const text = screenText(render(ASSIGNEE));
    expect(text).toContain("Task");
    expect(text).toContain("Fix the laundry room door");
    expect(text).toContain("Alice → Bob");
    expect(text).toContain("+15 pts");
  });

  it("draws who assigned whom on a line apart from the due date and reward", () => {
    // Run together, a phone wraps the line and the wrapped half starts with a
    // stray separator. `screenText` joins every node, so read each line.
    const lines = render(ASSIGNEE)
      .root.findAllByType(CardMeta)
      .map((line) => drawnText(line));
    expect(lines).toEqual(["Alice → Bob", "Due tomorrow·+15 pts"]);
  });

  it("counts down to the due date while the task is open", () => {
    expect(screenText(render(ASSIGNEE))).toContain("Due tomorrow");
  });

  it("never calls a finished task late, and gives a viewer who can't read it the plain date", () => {
    // The rule every task surface shares (`taskDueLine`, #4135): a finished
    // task still on time keeps its countdown, one past its date reads the
    // plain date rather than "Overdue by…".
    state.live = liveTask({ status: "COMPLETED", stored_status: "COMPLETED" });
    expect(screenText(render(ASSIGNEE))).toContain("Due tomorrow");
    state.now = new Date(2026, 10, 9, 12, 0);
    const late = screenText(render(ASSIGNEE));
    expect(late).not.toContain("Overdue");
    expect(late).toMatch(/Due Nov 6/);
    expect(screenText(render("bystander"))).toMatch(/Due Nov 6/);
  });

  it("reads the live due date over the snapshot's (#4135)", () => {
    state.now = new Date(2026, 10, 9, 12, 0);
    state.live = liveTask({ due_date: "2026-11-20" });
    const text = screenText(render(ASSIGNEE));
    expect(text).not.toContain("Overdue");
    expect(text).toContain("Due Nov 20");
  });
});

describe("TaskCard — the live status", () => {
  it("offers nothing and badges nothing until the live task is read (#2065)", () => {
    state.live = undefined;
    const tree = render(ASSIGNEE);
    expect(actions(tree)).toEqual([]);
    expect(screenText(tree)).not.toContain("To do");
  });

  it("doesn't ask for a task the viewer can't read", () => {
    const tree = render("bystander");
    expect(state.taskIds.every((id) => id === "")).toBe(true);
    expect(screenText(tree)).not.toContain("To do");
    expect(actions(tree)).toEqual([]);
  });

  it("badges the live status, a confirmed completion as Confirmed", () => {
    expect(screenText(render(ASSIGNEE))).toContain("To do");
    state.live = liveTask({
      status: "COMPLETED",
      stored_status: "COMPLETED",
      points_awarded: true,
    });
    const text = screenText(render(ASSIGNEE));
    expect(text).toContain("Confirmed");
    expect(text).not.toContain("Waiting on an officer");
  });
});

describe("TaskCard — actions", () => {
  it("lets the assignee start a fresh task", async () => {
    const tree = render(ASSIGNEE);
    expect(actions(tree)).toEqual(["Start"]);
    await press(tree, "Start");
    expect(updateStatus).toHaveBeenCalledWith({
      id: "task-1",
      body: { status: "IN_PROGRESS" },
    });
  });

  it("lets the assignee complete one in progress, overdue or not (#1051)", async () => {
    state.live = liveTask({ status: "OVERDUE", stored_status: "IN_PROGRESS" });
    const tree = render(ASSIGNEE);
    expect(screenText(tree)).toContain("Overdue");
    expect(actions(tree)).toEqual(["Mark done"]);
    await press(tree, "Mark done");
    expect(updateStatus).toHaveBeenCalledWith({
      id: "task-1",
      body: { status: "COMPLETED" },
    });
  });

  it("offers a tasks:manage holder Confirm and Send back on a completion", async () => {
    state.permissions = ["tasks:manage"];
    state.live = liveTask({ status: "COMPLETED", stored_status: "COMPLETED" });
    const tree = render("admin-2");
    expect(actions(tree)).toEqual(["Confirm", "Send back"]);
    await press(tree, "Confirm");
    expect(confirmTask).toHaveBeenCalledWith("task-1");
    // Send back asks for its reason first (#4635), then sends it.
    await press(tree, "Send back");
    expect(rejectTask).not.toHaveBeenCalled();
    expect(sheets.sendBack?.proofKind).toBe("none");
    await act(() =>
      sheets.sendBack!.onSubmit({
        comment: "Floor is still sticky",
        require_photo: true,
      }),
    );
    expect(rejectTask).toHaveBeenCalledWith({
      id: "task-1",
      body: { comment: "Floor is still sticky", require_photo: true },
    });
  });

  it("opens Mark done's sheet on a task that asks for a photo, and sends its proof (#4635)", async () => {
    state.live = liveTask({
      status: "IN_PROGRESS",
      stored_status: "IN_PROGRESS",
      proof_kind: "photo",
    });
    const tree = render(ASSIGNEE);
    expect(actions(tree)).toEqual([]);
    expect(screenText(tree)).toContain("Mark done with a photo");
    await press(tree, "Mark done with a photo");
    expect(updateStatus).not.toHaveBeenCalled();
    expect(sheets.markDone?.task.proofKind).toBe("photo");
    await act(() =>
      sheets.markDone!.onComplete({ proof_photo_paths: ["p/1.jpg"] }),
    );
    expect(updateStatus).toHaveBeenCalledWith({
      id: "task-1",
      body: { status: "COMPLETED", proof_photo_paths: ["p/1.jpg"] },
    });
  });

  it("asks a sent-back task's assignee for something new, showing the reason", async () => {
    state.live = liveTask({
      status: "IN_PROGRESS",
      stored_status: "IN_PROGRESS",
      sent_back_at: "2026-11-05T10:00:00.000Z",
      sent_back_reason: "Floor is still sticky",
    });
    const tree = render(ASSIGNEE);
    expect(screenText(tree)).toContain("Needs changes");
    expect(screenText(tree)).toContain("Floor is still sticky");
    await press(tree, "Mark done");
    expect(updateStatus).not.toHaveBeenCalled();
    expect(sheets.markDone?.task).toMatchObject({
      sentBack: true,
      sentBackReason: "Floor is still sticky",
    });
  });

  it("opens Mark done's sheet when the server asks for proof the card didn't know of", async () => {
    state.live = liveTask({
      status: "IN_PROGRESS",
      stored_status: "IN_PROGRESS",
    });
    updateStatus.mockRejectedValueOnce({
      statusCode: 400,
      code: "task.proof_required",
      message: "anything",
    });
    const tree = render(ASSIGNEE);
    await press(tree, "Mark done");
    expect(sheets.markDone?.initialProblem).toMatch(/needs proof/);
    expect(screenText(tree)).not.toContain("anything");
  });

  it("shows the proof above Confirm: the link's domain and the reply", () => {
    state.permissions = ["tasks:manage"];
    state.live = liveTask({
      status: "COMPLETED",
      stored_status: "COMPLETED",
      proof_kind: "link",
      proof_link: "https://www.example.com/report",
      completion_note: "Mopped twice",
      sent_back_reason: "Floor is still sticky",
    });
    const text = screenText(render("admin-2"));
    expect(text).toContain("example.com");
    expect(text).toContain("Mopped twice");
    expect(text).toContain("Floor is still sticky");
  });

  it("offers a Done task's officer Send back and no Confirm (#4635)", () => {
    state.permissions = ["tasks:manage"];
    state.live = liveTask({
      status: "COMPLETED",
      stored_status: "COMPLETED",
      points_awarded: true,
      point_reward: null,
      proof_kind: "none",
      completed_at: "2026-11-13T10:00:00.000Z",
      confirmed_at: "2026-11-13T10:00:00.000Z",
    });
    const tree = render("admin-2");
    expect(actions(tree)).toEqual(["Send back"]);
    expect(screenText(tree)).toContain("Done");
  });

  it("leaves an officer's own confirmation of a no-points task Confirmed (#4635)", () => {
    state.permissions = ["tasks:manage"];
    state.live = liveTask({
      status: "COMPLETED",
      stored_status: "COMPLETED",
      points_awarded: true,
      point_reward: null,
      proof_kind: "none",
      completed_at: "2026-11-13T10:00:00.000Z",
      confirmed_at: "2026-11-13T11:00:00.000Z",
    });
    expect(actions(render("admin-2"))).toEqual(["Confirmed"]);
  });

  it("never offers Confirm on the admin's own task (#1056)", () => {
    state.permissions = ["tasks:manage"];
    state.live = liveTask({ status: "COMPLETED", stored_status: "COMPLETED" });
    expect(actions(render(ASSIGNEE))).toEqual(["Send back"]);
  });

  it("leaves a disabled Confirmed indicator once points are awarded", () => {
    state.permissions = ["tasks:manage"];
    state.live = liveTask({
      status: "COMPLETED",
      stored_status: "COMPLETED",
      points_awarded: true,
    });
    const tree = render("admin-2");
    expect(actions(tree)).toEqual(["Confirmed"]);
    expect(button(tree, "Confirmed").props.disabled).toBe(true);
  });

  it("says why a gate refused, in the board's words", async () => {
    updateStatus.mockRejectedValue({
      statusCode: 403,
      error: "Forbidden",
      message:
        "Chapter subscription is not active; complete checkout to use this feature.",
    });
    const tree = render(ASSIGNEE);
    await press(tree, "Start");
    const text = screenText(tree);
    expect(text).toContain(SUBSCRIPTION_REFUSAL_COPY.taskStatus);
    expect(text).not.toContain("complete checkout");
    // Withdrawn, not left to collect the same refusal again (`writing.md`).
    const start = button(tree, "Start");
    expect(start.props.disabled).toBe(true);
    expect(start.props.accessibilityHint).toBe(
      SUBSCRIPTION_REFUSAL_COPY.taskStatus,
    );
  });

  it("withdraws the controls on a module refusal too", async () => {
    updateStatus.mockRejectedValue({
      statusCode: 403,
      error: "Forbidden",
      message: moduleDisabledMessage("tasks"),
    });
    const tree = render(ASSIGNEE);
    await press(tree, "Start");
    expect(screenText(tree)).toContain(MODULE_REFUSAL_COPY.taskStatus);
    expect(button(tree, "Start").props.disabled).toBe(true);
  });

  it("puts the controls back when the member returns to the thread or the app", async () => {
    // An officer may have fixed billing meanwhile, and a withdrawn card has
    // nothing to press to find out: the board's lifetime (`writing.md`).
    const refused = {
      statusCode: 403,
      error: "Forbidden",
      message:
        "Chapter subscription is not active; complete checkout to use this feature.",
    };
    updateStatus.mockRejectedValue(refused);
    const tree = render(ASSIGNEE);
    await press(tree, "Start");
    expect(button(tree, "Start").props.disabled).toBe(true);
    act(() => refocus());
    expect(button(tree, "Start").props.disabled).toBe(false);
    expect(screenText(tree)).not.toContain(
      SUBSCRIPTION_REFUSAL_COPY.taskStatus,
    );

    await press(tree, "Start");
    expect(button(tree, "Start").props.disabled).toBe(true);
    act(() => appStateListener()("background"));
    expect(button(tree, "Start").props.disabled).toBe(true);
    act(() => appStateListener()("active"));
    expect(button(tree, "Start").props.disabled).toBe(false);
  });

  it("sends one write for two taps in the same frame", async () => {
    let finish!: () => void;
    updateStatus.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const tree = render(ASSIGNEE);
    await act(async () => {
      const start = button(tree, "Start");
      start.props.onPress();
      start.props.onPress();
    });
    expect(updateStatus).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("relays any other refusal", async () => {
    confirmTask.mockRejectedValue({
      statusCode: 400,
      message: "Points have already been awarded for this task",
    });
    state.permissions = ["tasks:manage"];
    state.live = liveTask({ status: "COMPLETED", stored_status: "COMPLETED" });
    const tree = render("admin-2");
    await press(tree, "Confirm");
    expect(screenText(tree)).toContain(
      "Points were already given for this task.",
    );
    // Not a gate's refusal, so the member can try again.
    expect(button(tree, "Confirm").props.disabled).toBe(false);
  });

  it("can't be pressed while a write would be lost, and says why", () => {
    state.writeBlockedReason = "Reconnect to make changes.";
    const start = button(render(ASSIGNEE), "Start");
    expect(start.props.disabled).toBe(true);
    expect(start.props.accessibilityHint).toBe("Reconnect to make changes.");
  });

  it("can't be pressed on a row the server hasn't acknowledged", () => {
    expect(
      button(render(ASSIGNEE, { isConfirmed: false }), "Start").props.disabled,
    ).toBe(true);
  });

  it("offers nothing once Tasks is known to be off", () => {
    state.enabledModules = { tasks: false };
    expect(actions(render(ASSIGNEE))).toEqual([]);
  });
});

describe("TaskCard — Edit (#4512)", () => {
  const editable = (overrides: Record<string, unknown> = {}) =>
    liveTask({
      title: "Fix the laundry room door",
      description: null,
      assignee_id: ASSIGNEE,
      due_date: "2026-11-06",
      due_at: "2026-11-06T22:00:00.000Z",
      point_reward: 15,
      subtasks: [],
      ...overrides,
    });
  const hasEdit = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Edit",
    ).length > 0;

  beforeEach(() => {
    editSheet.editing = null;
    editSheet.present.mockClear();
    state.live = editable();
  });

  it("opens the board's edit sheet on the task for a tasks:manage holder", async () => {
    state.permissions = ["tasks:manage"];
    const tree = render("admin-1");
    await press(tree, "Edit");
    expect(editSheet.editing).toEqual({
      id: "task-1",
      title: "Fix the laundry room door",
      assigneeId: ASSIGNEE,
      dueDay: "2026-11-06",
      dueAt: "2026-11-06T22:00:00.000Z",
      pointReward: 15,
      storedStatus: "TODO",
      referencePhotos: [],
      proofKind: "none",
    });
    // Mounted is not shown: the sheet has to be presented.
    expect(editSheet.present).toHaveBeenCalledTimes(1);
  });

  it("holds Edit like the card's other writes while a write would be lost", () => {
    state.permissions = ["tasks:manage"];
    state.writeBlockedReason = "You're offline.";
    expect(button(render("admin-1"), "Edit").props.disabled).toBe(true);
  });

  it("isn't offered while the chapter has Tasks turned off", () => {
    state.permissions = ["tasks:manage"];
    state.enabledModules = { tasks: false };
    expect(hasEdit(render("admin-1"))).toBe(false);
  });

  it("isn't offered to anyone else", () => {
    expect(hasEdit(render(ASSIGNEE))).toBe(false);
  });

  it("isn't offered on a confirmed task", () => {
    state.permissions = ["tasks:manage"];
    state.live = editable({
      status: "COMPLETED",
      stored_status: "COMPLETED",
      points_awarded: true,
    });
    expect(hasEdit(render("admin-1"))).toBe(false);
  });
});
