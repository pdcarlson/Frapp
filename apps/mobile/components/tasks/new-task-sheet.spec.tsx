/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import * as ImagePicker from "expo-image-picker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { moduleDisabledMessage } from "@repo/validation";
import type { DispatchResult } from "@repo/chat-core/dispatch";

/**
 * The new-task sheet on a subscription refusal (#2297), rendered (#2416).
 *
 * A refusal withdraws Create, because retrying is the one thing that cannot
 * work until an officer sorts out billing. An ordinary failed save keeps
 * Create and its "try again" copy. This replaces a source-string lock on
 * `canSubmit`. The module gate (`@RequireModule('tasks')`, #2718) is the other
 * refusal retrying can't win, and gets the same treatment.
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
 * What `ChapterGuard` throws when an officer has switched `tasks` off, without
 * its `code`: only the message identifies it on installed builds and an API
 * older than #1020.
 */
const MODULE_OFF = {
  statusCode: 403,
  error: "Forbidden",
  message: moduleDisabledMessage("tasks"),
  requestId: "req_module_off",
};

/**
 * A 403 that is NOT either gate: `task.controller.ts` carries a
 * `@RequirePermissions` on this route, and a denial recovers once an officer
 * grants the role, so it must keep its retry.
 */
const DENIED = {
  statusCode: 403,
  error: "Forbidden",
  message: "No roles assigned",
  requestId: "req_denied",
};

/** Any failure that is not the subscription gate. */
const FAILED = {
  statusCode: 500,
  error: "Internal Server Error",
  message: "Task service is unavailable.",
  requestId: "req_failed",
};

const TRY_AGAIN = "That didn't save. Your task is still here — try again.";

const mintPhoto = vi.hoisted(() => vi.fn());
let failure: unknown = REFUSED;
let createPending = false;
const mutate = vi.fn(
  (_body: unknown, options: { onError: (error: unknown) => void }) =>
    options.onError(failure),
);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useViewerUserId: () => "user-1",
  useChapterRoster: () => ({ data: [] }),
  useCreateTask: () => ({ mutate, isPending: createPending }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: mintPhoto }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
}));

import { NewTaskSheet } from "./new-task-sheet";

function render({ keptDraft }: { keptDraft?: string } = {}): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewTaskSheet
          now={new Date("2026-09-27T12:00:00Z")}
          keptDraft={keptDraft}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const titleValueOf = (tree: ReactTestRenderer) =>
  tree.root.find((node) => node.props.accessibilityLabel === "Task title").props
    .value;

const createButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.label === "Create task" && typeof node.type === "function",
  );

function submitTask(tree: ReactTestRenderer) {
  const title = tree.root.find(
    (node) => node.props.accessibilityLabel === "Task title",
  );
  act(() => title.props.onChangeText("Sweep the porch"));
  expect(createButton(tree).props.disabled).toBe(false);
  act(() => createButton(tree).props.onPress());
}

beforeEach(() => {
  mutate.mockClear();
  successHaptic.mockReset();
  createPending = false;
});

describe("New task on a subscription refusal (#2297)", () => {
  it("explains the refusal and withdraws Create", () => {
    failure = REFUSED;
    const tree = render();
    submitTask(tree);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.task);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    expect(successHaptic).not.toHaveBeenCalled();
    expect(createButton(tree).props.disabled).toBe(true);
    // A screen reader lands on the disabled button, so the reason rides on it.
    expect(createButton(tree).props.accessibilityHint).toBe(
      SUBSCRIPTION_REFUSAL_COPY.task,
    );
    act(() => tree.unmount());
  });

  // The direction that got an earlier attempt at #2297 reverted: only a
  // refusal may withdraw the retry. The 403 is the trap: a bare status check
  // would take the retry from a permission denial.
  it.each([
    ["an ordinary failure", FAILED],
    ["a 403 that is neither gate", DENIED],
  ])("keeps Create and its retry copy after %s", (_label, error) => {
    failure = error;
    const tree = render();
    submitTask(tree);

    expect(screenText(tree)).toContain(TRY_AGAIN);
    expect(screenText(tree)).not.toContain(SUBSCRIPTION_REFUSAL_COPY.task);
    expect(screenText(tree)).not.toContain(MODULE_REFUSAL_COPY.task);
    expect(createButton(tree).props.disabled).toBe(false);
    expect(createButton(tree).props.accessibilityHint).toBeUndefined();
    act(() => tree.unmount());
  });
});

describe("New task on a module-off refusal (#2718)", () => {
  it("explains a module-off refusal in the member's terms and withdraws Create", () => {
    failure = MODULE_OFF;
    const tree = render();
    submitTask(tree);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain(MODULE_REFUSAL_COPY.task);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    // The guard's own words send an officer to Settings → Modules.
    expect(screenText(tree)).not.toContain(MODULE_OFF.message);
    expect(createButton(tree).props.disabled).toBe(true);
    expect(createButton(tree).props.accessibilityHint).toBe(
      MODULE_REFUSAL_COPY.task,
    );
    act(() => tree.unmount());
  });
});

/** The create sheet itself: the modal that carries `onDismiss`, not the picker. */
const sheetModal = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.type === ("BottomSheetModal" as never) &&
      typeof node.props.onDismiss === "function",
  );

describe("New task assignee picker", () => {
  it("opens as a tall sheet with its header pinned (components.md § Surface size)", () => {
    const tree = render();
    const picker = tree.root.find(
      (node) =>
        node.type === ("BottomSheetModal" as never) &&
        typeof node.props.onDismiss !== "function",
    );
    expect(picker.props.snapPoints).toEqual(["100%"]);
    // Without this, @gorhom adds a content-height detent and the sheet opens
    // short again.
    expect(picker.props.enableDynamicSizing).toBe(false);
    expect(picker.props.topInset).toBeGreaterThan(0);
    const list = picker.find(
      (node) => node.props.stickyHeaderIndices !== undefined,
    );
    expect(list.props.stickyHeaderIndices).toEqual([0]);
    act(() => tree.unmount());
  });
});

describe("New task after a gate refusal", () => {
  const REFUSALS = [
    ["a subscription refusal", REFUSED, SUBSCRIPTION_REFUSAL_COPY.task],
    ["a module-off refusal", MODULE_OFF, MODULE_REFUSAL_COPY.task],
  ] as const;

  it.each(REFUSALS)(
    "posts nothing more when Create is pressed anyway after %s",
    (_label, error) => {
      // The disabled button is one guard; `submit` checking `canSubmit` is the
      // other, so a press that gets through anyway still can't re-post.
      failure = error;
      const tree = render();
      submitTask(tree);
      expect(createButton(tree).props.disabled).toBe(true);

      act(() => createButton(tree).props.onPress());

      expect(mutate).toHaveBeenCalledTimes(1);
      act(() => tree.unmount());
    },
  );

  it("sends one create for two taps in one batch", () => {
    // Both presses run before `isPending` reaches a render, so both see the
    // same render's `canSubmit`; only the in-flight ref stops the second.
    mutate.mockImplementationOnce(() => {});
    const tree = render();
    const title = tree.root.find(
      (node) => node.props.accessibilityLabel === "Task title",
    );
    act(() => title.props.onChangeText("Sweep the porch"));
    act(() => {
      const button = createButton(tree);
      button.props.onPress();
      button.props.onPress();
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it.each(REFUSALS)(
    "offers Create again once the sheet is dismissed after %s",
    (_label, error, copy) => {
      // The sheet lives in a tab that is never unmounted, so without the
      // reset an officer who sorted the gate out would find Create dead until
      // a force-quit.
      failure = error;
      const tree = render();
      submitTask(tree);
      expect(screenText(tree)).toContain(copy);

      act(() => sheetModal(tree).props.onDismiss());

      expect(screenText(tree)).not.toContain(copy);
      // `submitTask` asserts Create is enabled again before pressing it.
      submitTask(tree);
      expect(mutate).toHaveBeenCalledTimes(2);
      act(() => tree.unmount());
    },
  );
});

/**
 * The draft and the close: a swipe or a scrim tap keeps the draft for the next
 * visit, Cancel gives it up (the rule s20 and s21 follow), and a create that
 * settles after the sheet closed neither dismisses a closed modal (which
 * wedges its next `present()`, #3405) nor closes a visit reopened since.
 */
describe("New task draft across visits", () => {
  /** Stands in for gorhom's modal instance, so a spec can see `dismiss()`. */
  const dismiss = vi.fn();
  const ref = React.createRef<never>();
  const sheetAt = (now: Date, keptDraft?: string) => (
    <FrappThemeProvider>
      <NewTaskSheet ref={ref} now={now} keptDraft={keptDraft} />
    </FrappThemeProvider>
  );

  function renderWithRef(
    now = new Date("2026-09-27T12:00:00Z"),
    keptDraft?: string,
  ): ReactTestRenderer {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(sheetAt(now, keptDraft), {
        // The create sheet is the modal with `onDismiss`; the assignee
        // picker's own modal gets a stand-in of its own, so its Done is
        // never counted as the sheet closing.
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal"
            ? typeof (element.props as { onDismiss?: unknown }).onDismiss ===
              "function"
              ? { dismiss, present: vi.fn() }
              : { dismiss: vi.fn(), present: vi.fn() }
            : null,
      });
    });
    // What gorhom reports as `present()` starts bringing the sheet up.
    act(() => sheetModal(tree).props.onAnimate(-1, 0));
    return tree;
  }

  const titleValue = (tree: ReactTestRenderer) =>
    tree.root.find((node) => node.props.accessibilityLabel === "Task title")
      .props.value;

  const typeTitle = (tree: ReactTestRenderer) =>
    act(() =>
      tree.root
        .find((node) => node.props.accessibilityLabel === "Task title")
        .props.onChangeText("Sweep the porch"),
    );

  beforeEach(() => {
    dismiss.mockReset();
  });

  it("keeps the draft through a swipe or scrim close", () => {
    const tree = renderWithRef();
    typeTitle(tree);

    act(() => sheetModal(tree).props.onDismiss());

    expect(titleValue(tree)).toBe("Sweep the porch");
    act(() => tree.unmount());
  });

  it("keeps the draft past its screen, for the Tasks screen's next visit (#4593)", () => {
    const first = renderWithRef(undefined, "tasks-create");
    typeTitle(first);
    act(() => first.unmount());

    const second = renderWithRef(undefined, "tasks-create");
    expect(titleValue(second)).toBe("Sweep the porch");
    act(() => second.unmount());
  });

  it("keeps nothing past its screen once Cancel gave the draft up (#4593)", () => {
    const first = renderWithRef(undefined, "tasks-create");
    typeTitle(first);
    act(() => pressCancel(first));
    act(() => first.unmount());

    const second = renderWithRef(undefined, "tasks-create");
    expect(titleValue(second)).toBe("");
    act(() => second.unmount());
  });

  it("keeps nothing past its screen once the task saved, and keeps the next one (#4593)", () => {
    const saves = () =>
      mutate.mockImplementationOnce((_body, options) =>
        (options as unknown as { onSuccess: () => void }).onSuccess(),
      );
    saves();
    const first = renderWithRef(undefined, "tasks-create");
    submitTask(first);
    act(() => first.unmount());
    const second = renderWithRef(undefined, "tasks-create");
    expect(titleValue(second)).toBe("");

    // The same visit, a second task: the first one's hold is over, so what
    // is typed next is kept again.
    saves();
    submitTask(second);
    act(() =>
      second.root
        .find((node) => node.props.accessibilityLabel === "Task title")
        .props.onChangeText("Mop the hall"),
    );
    act(() => second.unmount());
    const third = renderWithRef(undefined, "tasks-create");
    expect(titleValue(third)).toBe("Mop the hall");
    act(() => third.unmount());
  });

  it("keeps a draft whose save failed past its screen (#4593)", () => {
    failure = FAILED;
    const first = renderWithRef(undefined, "tasks-create");
    submitTask(first);
    expect(screenText(first)).toContain(TRY_AGAIN);
    act(() => first.unmount());

    const second = renderWithRef(undefined, "tasks-create");
    expect(titleValue(second)).toBe("Sweep the porch");
    act(() => second.unmount());
  });

  it("gives the draft up on Cancel", () => {
    const tree = renderWithRef();
    typeTitle(tree);

    act(() => pressCancel(tree));

    expect(titleValue(tree)).toBe("");
    expect(dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("closes and clears the draft when the task saves", () => {
    mutate.mockImplementationOnce((_body, options) =>
      (options as unknown as { onSuccess: () => void }).onSuccess(),
    );
    const tree = renderWithRef();
    submitTask(tree);

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(titleValue(tree)).toBe("");
    // The confirming action's haptic (`spec/ui/mobile/README.md`).
    expect(successHaptic).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("doesn't dismiss again when a create lands after the sheet closed", () => {
    let succeed = () => {};
    mutate.mockImplementationOnce((_body, options) => {
      succeed = (options as unknown as { onSuccess: () => void }).onSuccess;
    });
    const tree = renderWithRef();
    submitTask(tree);
    act(() => sheetModal(tree).props.onDismiss());
    act(() => succeed());

    expect(dismiss).not.toHaveBeenCalled();
    // The task was created, so its draft goes with it rather than inviting
    // a duplicate.
    expect(titleValue(tree)).toBe("");
    act(() => tree.unmount());
  });

  it("leaves a sheet reopened mid-create open when the create lands", () => {
    let succeed = () => {};
    mutate.mockImplementationOnce((_body, options) => {
      succeed = (options as unknown as { onSuccess: () => void }).onSuccess;
    });
    const tree = renderWithRef();
    submitTask(tree);
    act(() => sheetModal(tree).props.onDismiss());
    act(() => sheetModal(tree).props.onAnimate(-1, 0)); // reopened
    act(() => succeed());

    expect(dismiss).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("doesn't latch a refusal that lands after the sheet closed", () => {
    let refuse = () => {};
    mutate.mockImplementationOnce((_body, options) => {
      refuse = () => options.onError(REFUSED);
    });
    const tree = renderWithRef();
    submitTask(tree);
    act(() => sheetModal(tree).props.onDismiss());
    act(() => sheetModal(tree).props.onAnimate(-1, 0)); // reopened
    act(() => refuse());

    expect(screenText(tree)).not.toContain(SUBSCRIPTION_REFUSAL_COPY.task);
    expect(createButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  const titleField = (tree: ReactTestRenderer) =>
    tree.root.find((node) => node.props.accessibilityLabel === "Task title");
  const pointsField = (tree: ReactTestRenderer) =>
    tree.root.find((node) => node.props.accessibilityLabel === "Point reward");
  const assigneeRow = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        /^Assignee: /.test(String(node.props.accessibilityLabel)),
    );
  const cancelButton = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) && drawnText(node) === "Cancel",
    );
  const chip = (tree: ReactTestRenderer, label: string) =>
    tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) && drawnText(node) === label,
    );
  const sentBody = () =>
    mutate.mock.calls.at(-1)?.[0] as { title: string; due_date: string };
  /**
   * Picks a member in the assignee picker. Its list is a string stand-in that
   * never draws rows (vitest.setup.ts), so the row is built from `renderItem`.
   */
  const pickAssignee = (tree: ReactTestRenderer, userId: string) => {
    const list = tree.root.find(
      (node) => node.type === ("BottomSheetFlatList" as never),
    );
    const row = list.props.renderItem({ item: { userId, name: null } });
    act(() => row.props.onPress());
  };
  const isSelected = (tree: ReactTestRenderer, label: string) =>
    chip(tree, label).props.accessibilityState.selected as boolean;

  it("holds the draft and Cancel still while a create is in flight", () => {
    mutate.mockImplementationOnce(() => {});
    const tree = renderWithRef();
    typeTitle(tree);
    act(() => createButton(tree).props.onPress());
    createPending = true;
    act(() => tree.update(sheetAt(new Date("2026-09-27T12:00:00Z"))));

    expect(titleField(tree).props.editable).toBe(false);
    expect(pointsField(tree).props.editable).toBe(false);
    expect(assigneeRow(tree).props.disabled).toBe(true);
    expect(cancelButton(tree).props.disabled).toBe(true);
    act(() => chip(tree, "Tomorrow").props.onPress());
    expect(chip(tree, "Today").props.accessibilityState).toEqual({
      selected: true,
    });

    createPending = false;
    act(() => tree.update(sheetAt(new Date("2026-09-27T12:00:00Z"))));
    expect(titleField(tree).props.editable).toBe(true);
    expect(cancelButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("does nothing on a Cancel in the same batch as Create", () => {
    // Both presses run before `isPending` reaches a render, so the Cancel the
    // member reached was not drawn disabled yet; `sending` holds it instead.
    let fail = () => {};
    mutate.mockImplementationOnce((_body, options) => {
      fail = () => options.onError(FAILED);
    });
    const tree = renderWithRef();
    typeTitle(tree);
    const cancel = cancelButton(tree);
    act(() => {
      createButton(tree).props.onPress();
      cancel.props.onPress();
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();
    expect(titleValue(tree)).toBe("Sweep the porch");

    // The create fails: the visit hears of it, and the draft is still there
    // for the retry, or for a Cancel that now gives it up.
    act(() => fail());
    expect(screenText(tree)).toContain(TRY_AGAIN);
    expect(titleValue(tree)).toBe("Sweep the porch");
    act(() => cancelButton(tree).props.onPress());
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(titleValue(tree)).toBe("");
    act(() => tree.unmount());
  });

  // 2026-09-28 is a Monday.
  const monday = new Date(2026, 8, 28, 12);
  const tuesday = new Date(2026, 8, 29, 12);

  it("locks a visit reopened mid-create, and clears it when the create lands", () => {
    let succeed = () => {};
    mutate.mockImplementationOnce((_body, options) => {
      succeed = (options as unknown as { onSuccess: () => void }).onSuccess;
    });
    const tree = renderWithRef(monday);
    typeTitle(tree);
    act(() => pointsField(tree).props.onChangeText("5"));
    act(() => chip(tree, "Friday").props.onPress());
    pickAssignee(tree, "user-2");
    expect(assigneeRow(tree).props.accessibilityLabel).not.toBe(
      "Assignee: You",
    );
    act(() => createButton(tree).props.onPress());
    createPending = true;
    act(() => tree.update(sheetAt(monday)));
    act(() => sheetModal(tree).props.onDismiss());
    act(() => sheetModal(tree).props.onAnimate(-1, 0)); // reopened

    // The sheet stays mounted across the swipe, so the reopened visit reads
    // the same pending create: nothing in it can be edited or given up.
    expect(titleValue(tree)).toBe("Sweep the porch");
    expect(titleField(tree).props.editable).toBe(false);
    expect(pointsField(tree).props.editable).toBe(false);
    expect(assigneeRow(tree).props.disabled).toBe(true);
    expect(cancelButton(tree).props.disabled).toBe(true);
    act(() => chip(tree, "Tomorrow").props.onPress());
    expect(isSelected(tree, "Friday")).toBe(true);

    // TanStack runs the call's `onSuccess` before the render that drops
    // `isPending`, so the fields are still locked when the clear lands.
    act(() => succeed());
    createPending = false;
    act(() => tree.update(sheetAt(monday)));

    expect(titleValue(tree)).toBe("");
    expect(pointsField(tree).props.value).toBe("");
    expect(isSelected(tree, "Today")).toBe(true);
    expect(assigneeRow(tree).props.accessibilityLabel).toBe("Assignee: You");
    expect(titleField(tree).props.editable).toBe(true);
    // A visit reopened since stays open.
    expect(dismiss).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("keeps a kept draft's Today meaning today", () => {
    const tree = renderWithRef(monday);
    typeTitle(tree);
    act(() => sheetModal(tree).props.onDismiss());

    // The host re-reads its clock the next day and reopens the sheet.
    act(() => tree.update(sheetAt(tuesday)));
    act(() => sheetModal(tree).props.onAnimate(-1, 0));

    expect(chip(tree, "Today").props.accessibilityState).toEqual({
      selected: true,
    });
    act(() => createButton(tree).props.onPress());
    expect(sentBody().due_date).toBe("2026-09-29");
    act(() => tree.unmount());
  });

  it("keeps a kept draft's other chip relative too", () => {
    const tree = renderWithRef(monday);
    typeTitle(tree);
    act(() => chip(tree, "Tomorrow").props.onPress());
    act(() => sheetModal(tree).props.onDismiss());

    act(() => tree.update(sheetAt(tuesday)));
    act(() => sheetModal(tree).props.onAnimate(-1, 0));

    act(() => createButton(tree).props.onPress());
    expect(sentBody().due_date).toBe("2026-09-30");
    act(() => tree.unmount());
  });

  // 2026-09-30 is a Wednesday, and its Friday is 2026-10-02.
  const wednesday = new Date(2026, 8, 30, 12);
  const thursday = new Date(2026, 9, 1, 12);
  const saturday = new Date(2026, 9, 3, 12);

  /** Picks `label` on `pickedOn`, swipes the draft away, reopens on `filedOn`. */
  function keepChip(label: string, pickedOn: Date, filedOn: Date) {
    const tree = renderWithRef(pickedOn);
    typeTitle(tree);
    act(() => chip(tree, label).props.onPress());
    act(() => sheetModal(tree).props.onDismiss());
    act(() => tree.update(sheetAt(filedOn)));
    act(() => sheetModal(tree).props.onAnimate(-1, 0));
    return tree;
  }

  it("files a kept Friday on its Friday, shown as Tomorrow on the Thursday", () => {
    // Thursday draws no Friday chip: Tomorrow is that day.
    const tree = keepChip("Friday", wednesday, thursday);

    expect(isSelected(tree, "Tomorrow")).toBe(true);
    expect(isSelected(tree, "Today")).toBe(false);
    act(() => createButton(tree).props.onPress());
    expect(sentBody().due_date).toBe("2026-10-02");
    act(() => tree.unmount());
  });

  it("files a kept Friday that has passed as Today", () => {
    const tree = keepChip("Friday", wednesday, saturday);

    expect(isSelected(tree, "Today")).toBe(true);
    // Saturday's Friday chip is the next week's, not the one picked.
    expect(isSelected(tree, "Friday")).toBe(false);
    act(() => createButton(tree).props.onPress());
    expect(sentBody().due_date).toBe("2026-10-03");
    act(() => tree.unmount());
  });

  it("keeps a kept Next week's date when no chip draws it", () => {
    const tree = keepChip("Next week", monday, tuesday);

    for (const label of ["Today", "Tomorrow", "Friday", "Next week"]) {
      expect(isSelected(tree, label)).toBe(false);
    }
    act(() => createButton(tree).props.onPress());
    expect(sentBody().due_date).toBe("2026-10-05");
    act(() => tree.unmount());
  });
});

/** The header's Cancel, which `SheetHeader` draws as a bare pressable. */
function pressCancel(tree: ReactTestRenderer) {
  const cancel = tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) && drawnText(node) === "Cancel",
  );
  cancel.props.onPress();
}

describe("New task from a chat's + (#3865)", () => {
  const dismiss = vi.fn();
  const ref = React.createRef<never>();

  function renderFromChat(
    postToChannel: (input: unknown) => Promise<DispatchResult>,
    onPosted = vi.fn(),
  ): ReactTestRenderer {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <NewTaskSheet
            ref={ref}
            now={new Date("2026-09-27T12:00:00Z")}
            postToChannel={postToChannel}
            onPosted={onPosted}
          />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) =>
            (element.type as unknown) === "BottomSheetModal"
              ? typeof (element.props as { onDismiss?: unknown }).onDismiss ===
                "function"
                ? { dismiss, present: vi.fn() }
                : { dismiss: vi.fn(), present: vi.fn() }
              : null,
        },
      );
    });
    act(() => sheetModal(tree).props.onAnimate(-1, 0));
    return tree;
  }

  const titleValue = (tree: ReactTestRenderer) =>
    tree.root.find((node) => node.props.accessibilityLabel === "Task title")
      .props.value;

  beforeEach(() => {
    dismiss.mockReset();
  });

  it("posts through the channel, not the board's create, and closes", async () => {
    const postToChannel = vi.fn(async () => ({ ok: true }));
    const onPosted = vi.fn();
    const tree = renderFromChat(postToChannel, onPosted);
    submitTask(tree);
    await act(async () => {});
    expect(mutate).not.toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sweep the porch",
        assignee_id: "user-1",
      }),
    );
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(titleValue(tree)).toBe("");
    expect(successHaptic).toHaveBeenCalledTimes(1);
    expect(onPosted).toHaveBeenCalledWith({ ok: true });
    act(() => tree.unmount());
  });

  it("closes on a lost answer, which may have written, and hands it on", async () => {
    // Neither route dedupes: keeping the draft would be one tap from a second task.
    const lost = { ok: true, unconfirmed: true, warning: "Couldn't confirm." };
    const onPosted = vi.fn();
    const tree = renderFromChat(
      vi.fn(async () => lost),
      onPosted,
    );
    submitTask(tree);
    await act(async () => {});
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(titleValue(tree)).toBe("");
    // No success haptic for a task that may not exist.
    expect(successHaptic).not.toHaveBeenCalled();
    expect(onPosted).toHaveBeenCalledWith(lost);
    act(() => tree.unmount());
  });

  it("keeps the draft on a refusal, and reads its gate from the cause", async () => {
    const onPosted = vi.fn();
    const tree = renderFromChat(
      vi.fn(async () => ({
        ok: false,
        error: REFUSED.message,
        cause: REFUSED,
      })),
      onPosted,
    );
    submitTask(tree);
    await act(async () => {});
    expect(dismiss).not.toHaveBeenCalled();
    expect(titleValue(tree)).toBe("Sweep the porch");
    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.task);
    expect(onPosted).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe("Accepting a suggested task through the form (#4313)", () => {
  const accept = vi.fn();
  function renderSuggestion(assigneeId: string | null = null) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <NewTaskSheet
            now={new Date("2026-09-27T12:00:00Z")}
            suggestion={{
              title: "Book the hall",
              assigneeId,
              dueDay: "2026-10-02",
              dueAt: null,
              subtasks: ["Call the venue"],
              accept,
            }}
          />
        </FrappThemeProvider>,
      );
    });
    return tree;
  }
  const acceptButton = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.props.label === "Accept" && typeof node.type === "function",
    );

  beforeEach(() => {
    accept.mockReset();
    accept.mockResolvedValue(undefined);
  });

  it("opens on the suggestion, not a new task's kept draft (#4593)", () => {
    // A new task's draft kept from the Tasks screen's last visit.
    const draft = render({ keptDraft: "tasks-create" });
    act(() =>
      draft.root
        .find((node) => node.props.accessibilityLabel === "Task title")
        .props.onChangeText("Sweep the porch"),
    );
    act(() => draft.unmount());
    expect(titleValueOf(render({ keptDraft: "tasks-create" }))).toBe(
      "Sweep the porch",
    );

    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <NewTaskSheet
            now={new Date("2026-09-27T12:00:00Z")}
            keptDraft="tasks-create"
            suggestion={{
              title: "Book the hall",
              assigneeId: null,
              dueDay: "2026-10-02",
              dueAt: null,
              subtasks: [],
              accept,
            }}
          />
        </FrappThemeProvider>,
      );
    });
    const title = tree.root.find(
      (node) => node.props.accessibilityLabel === "Task title",
    );
    expect(title.props.value).toBe("Book the hall");
    act(() => tree.unmount());
  });

  it("starts from what the minutes said, under its own title and button", () => {
    const tree = renderSuggestion("user-2");
    expect(screenText(tree)).toContain("Change before accepting");
    expect(screenText(tree)).not.toContain("New task");
    const title = tree.root.find(
      (node) => node.props.accessibilityLabel === "Task title",
    );
    expect(title.props.value).toBe("Book the hall");
    act(() => tree.unmount());
  });

  it("accepts through the suggestion, never the board's create", async () => {
    const tree = renderSuggestion("user-2");
    await act(async () => acceptButton(tree).props.onPress());
    expect(mutate).not.toHaveBeenCalled();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0]![0]).toMatchObject({
      title: "Book the hall",
      assignee_id: "user-2",
      due_date: "2026-10-02",
      subtasks: ["Call the venue"],
    });
    act(() => tree.unmount());
  });

  it("doesn't hand a task nobody was named for to whoever opened the form", async () => {
    const tree = renderSuggestion(null);
    if (!acceptButton(tree).props.disabled) {
      await act(async () => acceptButton(tree).props.onPress());
    }
    for (const [body] of accept.mock.calls) {
      expect((body as { assignee_id?: string }).assignee_id).not.toBe("user-1");
    }
    act(() => tree.unmount());
  });

  it("says why a suggestion can't be accepted any more, and withdraws Accept", async () => {
    accept.mockRejectedValue({ code: "ai.suggestion.decided" });
    const tree = renderSuggestion("user-2");
    await act(async () => acceptButton(tree).props.onPress());
    expect(acceptButton(tree).props.disabled).toBe(true);
    expect(screenText(tree)).toContain(
      "Another officer already decided this one.",
    );
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    act(() => tree.unmount());
  });

  it("leaves photos and the proof control off a suggestion's form", () => {
    const tree = renderSuggestion("user-2");
    expect(screenText(tree)).not.toContain("Proof");
    act(() => tree.unmount());
  });
});

describe("New task photos and proof (#4635)", () => {
  it("sends the proof kind the officer picked", () => {
    failure = FAILED;
    const tree = render();
    const photo = tree.root.find(
      (node) =>
        node.props.accessibilityRole === "radio" &&
        node.props.accessibilityLabel === "Photo" &&
        typeof node.props.onPress === "function",
    );
    act(() => photo.props.onPress());
    expect(screenText(tree)).toContain(
      "Marking it done needs a photo of the finished job.",
    );
    submitTask(tree);
    expect(mutate.mock.calls[0]![0]).toMatchObject({ proof_kind: "photo" });
    act(() => tree.unmount());
  });

  it("uploads the picked photos on Create, then sends their paths", async () => {
    failure = FAILED;
    vi.mocked(
      ImagePicker.requestMediaLibraryPermissionsAsync,
    ).mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///mess.png",
          fileName: "mess.png",
          mimeType: "image/png",
          width: 10,
          height: 10,
          fileSize: 100,
        },
      ],
    } as never);
    mintPhoto.mockResolvedValue({
      upload_url: "https://signed",
      storage_path: "chapters/c/tasks/p1/mess.png",
    });
    const tree = render();
    await act(async () => {
      tree.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Add photos" &&
            typeof node.props.onPress === "function",
        )
        .props.onPress();
    });
    const title = tree.root.find(
      (node) => node.props.accessibilityLabel === "Task title",
    );
    act(() => title.props.onChangeText("Sweep the porch"));
    await act(async () => createButton(tree).props.onPress());
    expect(mintPhoto).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      reference_photo_paths: ["chapters/c/tasks/p1/mess.png"],
    });
    // A retry after the failed save doesn't upload the photo again.
    await act(async () => createButton(tree).props.onPress());
    expect(mintPhoto).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });

  it("uploads the photos again after a 400, which a held path can't win", async () => {
    // A create that landed with its answer lost holds the paths: the retry
    // is refused "already attached", so the next one uploads anew.
    failure = {
      statusCode: 400,
      error: "Bad Request",
      message:
        "reference_photo_paths is already attached to a task; upload the photo again",
    };
    vi.mocked(
      ImagePicker.requestMediaLibraryPermissionsAsync,
    ).mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///mess.png",
          fileName: "mess.png",
          mimeType: "image/png",
          width: 10,
          height: 10,
          fileSize: 100,
        },
      ],
    } as never);
    mintPhoto.mockReset();
    mintPhoto
      .mockResolvedValueOnce({
        upload_url: "https://signed",
        storage_path: "chapters/c/tasks/p1/mess.png",
      })
      .mockResolvedValueOnce({
        upload_url: "https://signed",
        storage_path: "chapters/c/tasks/p2/mess.png",
      });
    const tree = render();
    await act(async () => {
      tree.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Add photos" &&
            typeof node.props.onPress === "function",
        )
        .props.onPress();
    });
    const title = tree.root.find(
      (node) => node.props.accessibilityLabel === "Task title",
    );
    act(() => title.props.onChangeText("Sweep the porch"));
    await act(async () => createButton(tree).props.onPress());
    await act(async () => createButton(tree).props.onPress());
    expect(mintPhoto).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls.at(-1)![0]).toMatchObject({
      reference_photo_paths: ["chapters/c/tasks/p2/mess.png"],
    });
    act(() => tree.unmount());
  });
});
