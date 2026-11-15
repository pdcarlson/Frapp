/** @vitest-environment jsdom */
import React from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  TASK_SEND_BACK_REASON_MAX,
  type TaskProofKind,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#DDB844",
    accentPrimary: "#DDB844",
    accentOnPrimary: "#2B2009",
  }),
}));

import { SendBackSheet, sendBackProblem } from "./send-back-sheet";

function render(
  proofKind: TaskProofKind,
  onSubmit = vi.fn(async () => {}),
  keptDraft?: string,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SendBackSheet
          title="Mop the kitchen"
          proofKind={proofKind}
          keptDraft={keptDraft}
          onSubmit={onSubmit}
          onClosed={() => {}}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const reasonField = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === "What needs to change" &&
      typeof node.props.onChangeText === "function",
  );

function sendBack(tree: ReactTestRenderer) {
  const buttons = tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.findAll((child) => child.props?.children === "Send back").length > 0,
  );
  return buttons[buttons.length - 1]!;
}

async function press(node: ReactTestInstance) {
  await act(async () => {
    node.props.onPress();
  });
}

describe("sendBackProblem", () => {
  it("needs a reason that isn't blank", () => {
    expect(sendBackProblem("   ")).toBe("Say what needs to change.");
    expect(sendBackProblem("Still sticky")).toBeNull();
  });
});

describe("SendBackSheet (#4635)", () => {
  it("refuses to send without a reason", async () => {
    const onSubmit = vi.fn(async () => {});
    const tree = render("none", onSubmit);
    await press(sendBack(tree));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("Say what needs to change.");
  });

  it("sends the trimmed reason, capped and counted", async () => {
    const onSubmit = vi.fn(async () => {});
    const tree = render("none", onSubmit);
    expect(reasonField(tree).props.maxLength).toBe(TASK_SEND_BACK_REASON_MAX);
    act(() => reasonField(tree).props.onChangeText(" Floor is still sticky "));
    expect(screenText(tree)).toContain(`23/${TASK_SEND_BACK_REASON_MAX}`);
    await press(sendBack(tree));
    expect(onSubmit).toHaveBeenCalledWith({ comment: "Floor is still sticky" });
  });

  it("asks for a photo next time when the toggle is on", async () => {
    const onSubmit = vi.fn(async () => {});
    const tree = render("link", onSubmit);
    const toggle = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Ask for a photo next time" &&
        typeof node.props.onValueChange === "function",
    );
    act(() => toggle.props.onValueChange(true));
    act(() => reasonField(tree).props.onChangeText("Show me the floor"));
    await press(sendBack(tree));
    expect(onSubmit).toHaveBeenCalledWith({
      comment: "Show me the floor",
      require_photo: true,
    });
  });

  it("hides the toggle on a task that already asks for a photo", () => {
    expect(screenText(render("photo"))).not.toContain(
      "Ask for a photo next time",
    );
  });

  it("keeps the reason and says why when the server refuses", async () => {
    const onSubmit = vi.fn(async () => {
      throw { statusCode: 400, message: "Comment is required" };
    });
    const tree = render("none", onSubmit);
    act(() => reasonField(tree).props.onChangeText("Sticky"));
    await press(sendBack(tree));
    expect(reasonField(tree).props.value).toBe("Sticky");
    expect(screenText(tree)).toMatch(
      /Comment is required|Couldn't send it back/,
    );
  });
});

/**
 * The officer's reason outlives the sheet (#5041): the host mounts one per
 * Send back, so a swipe, or leaving the chat, used to lose it.
 */
describe("SendBackSheet's kept reason (#5041)", () => {
  let draftNo = 0;
  const nextDraft = () => `send-back:t${++draftNo}`;
  const cancel = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        typeof node.props.onCancel === "function" &&
        typeof node.type === "function",
    );

  it("keeps the reason and the photo ask for the task's next Send back", () => {
    const name = nextDraft();
    const first = render("link", undefined, name);
    act(() => reasonField(first).props.onChangeText("Still sticky"));
    const toggle = first.root.find(
      (node) =>
        node.props.accessibilityLabel === "Ask for a photo next time" &&
        typeof node.props.onValueChange === "function",
    );
    act(() => toggle.props.onValueChange(true));
    act(() => first.unmount());

    const second = render("link", undefined, name);
    expect(reasonField(second).props.value).toBe("Still sticky");
    expect(
      second.root.find(
        (node) =>
          node.props.accessibilityLabel === "Ask for a photo next time" &&
          typeof node.props.onValueChange === "function",
      ).props.value,
    ).toBe(true);
    act(() => second.unmount());
  });

  it("keeps nothing for another task", () => {
    const first = render("none", undefined, nextDraft());
    act(() => reasonField(first).props.onChangeText("Still sticky"));
    act(() => first.unmount());
    const other = render("none", undefined, nextDraft());
    expect(reasonField(other).props.value).toBe("");
    act(() => other.unmount());
  });

  it("gives it up on Cancel", () => {
    const name = nextDraft();
    const first = render("none", undefined, name);
    act(() => reasonField(first).props.onChangeText("Still sticky"));
    act(() => cancel(first).props.onCancel());
    act(() => first.unmount());
    const second = render("none", undefined, name);
    expect(reasonField(second).props.value).toBe("");
    act(() => second.unmount());
  });

  it("gives it up once the Send back lands", async () => {
    const name = nextDraft();
    const first = render(
      "none",
      vi.fn(async () => {}),
      name,
    );
    act(() => reasonField(first).props.onChangeText("Still sticky"));
    await press(sendBack(first));
    act(() => first.unmount());
    const second = render("none", undefined, name);
    expect(reasonField(second).props.value).toBe("");
    act(() => second.unmount());
  });

  it("holds it out while the Send back is in flight, and puts it back when it fails", async () => {
    const name = nextDraft();
    let fail: (error: unknown) => void = () => {};
    const first = render(
      "none",
      vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          }),
      ),
      name,
    );
    act(() => reasonField(first).props.onChangeText("Still sticky"));
    await press(sendBack(first));
    act(() => first.unmount());

    // Reopened mid-send: the same reason isn't offered to send twice.
    const during = render("none", undefined, name);
    expect(reasonField(during).props.value).toBe("");
    act(() => during.unmount());

    await act(async () => fail({ statusCode: 500, message: "Down" }));
    const after = render("none", undefined, name);
    expect(reasonField(after).props.value).toBe("Still sticky");
    act(() => after.unmount());
  });
});
