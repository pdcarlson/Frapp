/** @vitest-environment jsdom */
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The phone's New form sheet (#3926 step 3), rendered: what it posts, when
 * Post is held, a type change, a reorder, and what a refused queue leaves.
 * The draft rules themselves are `@repo/chat-core/form-draft`'s spec.
 */

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844", accentPrimary: "#DDB844" }),
}));

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
}));

import { NewFormSheet, type NewFormSheetProps } from "./new-form-sheet";

function render(onPost: NewFormSheetProps["onPost"]): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewFormSheet onPost={onPost} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const field = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onChangeText === "function",
  );

const control = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      (node.props.accessibilityLabel === label || node.props.label === label) &&
      typeof node.props.onPress === "function",
  )[0]!;

const postButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.label !== undefined &&
      /Post/.test(String(node.props.label)) &&
      typeof node.type === "function",
  );

function type(tree: ReactTestRenderer, label: string, text: string) {
  act(() => field(tree, label).props.onChangeText(text));
}

beforeEach(() => successHaptic.mockReset());

describe("New form sheet (#3926 step 3)", () => {
  it("holds Post until there's a title and a written question with an option", () => {
    const tree = render(vi.fn());
    expect(postButton(tree).props.disabled).toBe(true);
    type(tree, "Title", "Formal housing");
    type(tree, "Question 1", "Which room?");
    // A multiple-choice question with no option is refused, by name.
    expect(postButton(tree).props.disabled).toBe(true);
    expect(screenText(tree)).toContain(
      "Give this question at least one option.",
    );
    type(tree, "Question 1, option 1", "Room 1");
    expect(postButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("posts the built card in the order drawn, then clears the draft", async () => {
    const onPost = vi.fn<NewFormSheetProps["onPost"]>(async () => ({
      ok: true as const,
    }));
    const tree = render(onPost);
    type(tree, "Title", "Formal housing");
    type(tree, "Question 1", "Which room?");
    type(tree, "Question 1, option 1", "Room 1");
    type(tree, "Question 1, option 2", "Room 2");
    act(() => control(tree, "Add a question").props.onPress());
    type(tree, "Question 2", "Anything else?");
    // Its type: open the picker in place, pick Paragraph.
    act(() => control(tree, "Question 2 type").props.onPress());
    act(() => control(tree, "Paragraph").props.onPress());
    act(() => field(tree, "Question 2").props.onChangeText("Anything else?"));
    // Move it above the first.
    act(() => control(tree, "Move question 2 up").props.onPress());
    await act(async () => postButton(tree).props.onPress());

    expect(onPost).toHaveBeenCalledTimes(1);
    const form = onPost.mock.calls[0]![0];
    expect(form.content).toBe("Formal housing");
    expect(
      form.payload.questions.map(({ type: kind, title, options }) => ({
        kind,
        title,
        options: options?.map((o) => o.label),
      })),
    ).toEqual([
      { kind: "paragraph", title: "Anything else?", options: undefined },
      {
        kind: "multiple_choice",
        title: "Which room?",
        options: ["Room 1", "Room 2"],
      },
    ]);
    expect(successHaptic).toHaveBeenCalledTimes(1);
    expect(field(tree, "Title").props.value).toBe("");
    act(() => tree.unmount());
  });

  it("keeps the draft and says why when nothing was queued", async () => {
    const tree = render(async () => ({
      ok: false as const,
      error: "Couldn't post that form. Try again.",
    }));
    type(tree, "Title", "Formal housing");
    type(tree, "Question 1", "Which room?");
    type(tree, "Question 1, option 1", "Room 1");
    await act(async () => postButton(tree).props.onPress());
    expect(screenText(tree)).toContain("Couldn't post that form. Try again.");
    expect(field(tree, "Title").props.value).toBe("Formal housing");
    act(() => tree.unmount());
  });
});
