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

  it("hides and brings back cards, then hands Done the result", () => {
    const { tree, onDone } = render({});
    press(tree, "Hide Links");
    expect(has(tree, "Show Links")).toBe(true);
    press(tree, "Show Links");
    expect(has(tree, "Hide Links")).toBe(true);
    press(tree, "Hide Last week");
    press(tree, "Done");
    const result = onDone.mock.calls[0]![0];
    expect(result.hidden).toEqual(["recap"]);
    expect(result.shown).not.toContain("recap");
    expect(result.shown).toContain("links");
  });

  it("moves a card with the row's Move up action, never past the top", () => {
    const { tree, onDone } = render({});
    const rows = tree.root.findAll(
      (n) =>
        Array.isArray(n.props.accessibilityActions) &&
        typeof n.props.onAccessibilityAction === "function",
    );
    const actionsOf = (n: (typeof rows)[number]) =>
      n.props.accessibilityActions.map((a: { name: string }) => a.name);
    // The first card offers no Move up; the second moves above it.
    expect(actionsOf(rows[0]!)).not.toContain("up");
    act(() =>
      rows[1]!.props.onAccessibilityAction({
        nativeEvent: { actionName: "up" },
      }),
    );
    press(tree, "Done");
    expect(onDone.mock.calls[0]![0].shown.slice(0, 2)).toEqual([
      START.shown[1],
      START.shown[0],
    ]);
  });

  it("drops a dragged card where the drag ends, and holds the rest still meanwhile", () => {
    const onDraggingChange = vi.fn();
    const { tree, onDone } = render({ onDraggingChange });
    const handles = tree.root.findAll(
      (n) => n.type === ("GestureDetector" as never),
    );
    expect(handles).toHaveLength(START.shown.length);
    const at = START.shown.indexOf("links");
    const last = handles[at]!.props.gesture.handlers;
    act(() => last.onBegin());
    expect(onDraggingChange).toHaveBeenLastCalledWith(true);
    // While held, Hide waits.
    const hide = tree.root.findAll(
      (n) => n.props.accessibilityLabel === "Hide Links" && n.props.onPress,
    )[0]!;
    expect(hide.props.disabled).toBe(true);
    // Up three rows of 64.
    act(() => last.onUpdate({ translationY: -3 * 64 }));
    act(() => last.onFinalize());
    expect(onDraggingChange).toHaveBeenLastCalledWith(false);
    press(tree, "Done");
    const shown = onDone.mock.calls[0]![0].shown;
    expect(shown.indexOf("links")).toBe(at - 3);
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
    press(tree, "Hide Links");
    act(() => {
      expect(back?.()).toBe(true);
    });
    expect(onDone.mock.calls[0]![0].hidden).toEqual(["links"]);
  });
});
