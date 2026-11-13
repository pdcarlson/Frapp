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
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SendBackSheet
          title="Mop the kitchen"
          proofKind={proofKind}
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
