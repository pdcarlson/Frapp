import React from "react";
import { act } from "react";
import { BackHandler, Platform } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { arrangeActivityCards } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { ActivityEditor } from "./activity-editor";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#EFB63B" }),
}));

const START = arrangeActivityCards(undefined, "member");

function render(props: Partial<React.ComponentProps<typeof ActivityEditor>>) {
  const onDone = vi.fn();
  const onReset = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ActivityEditor
          initial={START}
          role="member"
          saved={false}
          onDone={onDone}
          onReset={onReset}
          {...props}
        />
      </FrappThemeProvider>,
    );
  });
  return { tree, onDone, onReset };
}

/** The pressable control with this label (a role="button" host). */
const press = (tree: ReactTestRenderer, label: string) => {
  const [node] = tree.root.findAll(
    (n) =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === "function",
  );
  if (!node) throw new Error(`no control labelled ${label}`);
  act(() => node.props.onPress());
};
const has = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (n) =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === "function",
  ).length > 0;

describe("ActivityEditor (#5520)", () => {
  afterEach(() => {
    Platform.OS = "ios";
    vi.restoreAllMocks();
  });

  it("lists Now first, then the three cards #5779 left, in the default order", () => {
    const { tree } = render({});
    const texts: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === "string") texts.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object" && "children" in node)
        walk((node as { children: unknown }).children);
    };
    walk(tree.toJSON());
    const names = ["Now", "Frapp card", "To do", "Running"];
    expect(texts.filter((text) => names.includes(text))).toEqual(names);
    // What moved off the page is not offered.
    for (const gone of [
      "Last week",
      "Links",
      "This semester",
      "Calendar",
      "Reminders",
      "To review",
      "Waiting on others",
    ]) {
      expect(texts).not.toContain(gone);
    }
  });

  it("hides and brings back cards, then hands Done the result", () => {
    const { tree, onDone } = render({});
    press(tree, "Hide Running");
    expect(has(tree, "Show Running")).toBe(true);
    press(tree, "Show Running");
    expect(has(tree, "Hide Running")).toBe(true);
    press(tree, "Hide Frapp card");
    press(tree, "Done");
    const result = onDone.mock.calls[0]![0];
    expect(result.hidden).toEqual(["nudge"]);
    expect(result.shown).toEqual(["todo", "running"]);
  });

  it("moves a card with its arrows, and not past either end", () => {
    const { tree, onDone } = render({});
    const moveUps = tree.root.findAll(
      (n) => n.props.accessibilityLabel === "Move up" && n.props.onPress,
    );
    // The first card's up arrow is drawn but disabled.
    expect(moveUps[0]!.props.disabled).toBe(true);
    act(() => moveUps[1]!.props.onPress());
    press(tree, "Done");
    expect(onDone.mock.calls[0]![0].shown.slice(0, 2)).toEqual([
      START.shown[1],
      START.shown[0],
    ]);
  });

  it("never offers to hide To do", () => {
    const { tree } = render({});
    expect(has(tree, "Hide To do")).toBe(false);
  });

  it("offers Reset only once the member has saved an arrangement", () => {
    expect(has(render({}).tree, "Reset to the default")).toBe(false);
    const { tree, onReset } = render({ saved: true });
    const reset = tree.root.findAll(
      (n) =>
        n.props.accessibilityRole === "button" &&
        n.props.accessibilityHint ===
          "Puts your cards back in the order Frapp starts with." &&
        n.props.onPress,
    )[0]!;
    act(() => reset.props.onPress());
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("takes Android's back button as Done, keeping what changed", () => {
    Platform.OS = "android";
    let back: (() => boolean) | undefined;
    vi.spyOn(BackHandler, "addEventListener").mockImplementation(
      (_event, handler) => {
        back = handler as () => boolean;
        return { remove: vi.fn() };
      },
    );
    const { tree, onDone } = render({});
    press(tree, "Hide Running");
    act(() => {
      expect(back?.()).toBe(true);
    });
    expect(onDone.mock.calls[0]![0].hidden).toEqual(["running"]);
  });
});
