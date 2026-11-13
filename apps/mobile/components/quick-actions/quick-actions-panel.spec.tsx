/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import type { QuickActionKey } from "@/lib/quick-actions";

const haptic = vi.hoisted(() => vi.fn());
vi.mock("@/lib/haptics", () => ({ selectionHaptic: haptic }));

import { QuickActionsPanel } from "./quick-actions-panel";

type Node = ReactTestRenderer["root"];

const OFFICER: QuickActionKey[] = [
  "newTask",
  "message",
  "invite",
  "hostCheckIn",
  "logHours",
  "study",
  "upload",
];

const props = {
  onEditingChange: vi.fn(),
  onRun: vi.fn(),
  onSave: vi.fn(),
};

beforeEach(() => {
  props.onEditingChange.mockReset();
  props.onRun.mockReset();
  props.onSave.mockReset();
  haptic.mockReset();
});

function render(
  shown: QuickActionKey[],
  editing = false,
  available: QuickActionKey[] = OFFICER,
  canEdit = true,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <QuickActionsPanel
          shown={shown}
          available={available}
          width={374}
          editing={editing}
          canEdit={canEdit}
          {...props}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const pressables = (root: Node) =>
  root.findAll((node) => (node.type as unknown) === "Pressable");
const byLabel = (root: Node, label: string) =>
  pressables(root).find((node) => node.props.accessibilityLabel === label);

describe("the panel at rest", () => {
  it("draws each action as a button that runs it", () => {
    const tree = render(["message", "invite", "logHours"]);
    const labels = pressables(tree.root)
      .map((node) => node.props.accessibilityLabel)
      .filter(Boolean);
    expect(labels).toEqual(["Message", "Invite", "Log hours"]);

    act(() => byLabel(tree.root, "Invite")!.props.onPress());
    expect(props.onRun).toHaveBeenCalledWith("invite");
  });

  it("starts editing on a hold, on an action or between them", () => {
    const tree = render(["message", "invite"]);
    act(() => byLabel(tree.root, "Message")!.props.onLongPress());
    expect(props.onEditingChange).toHaveBeenCalledWith(true);
    expect(haptic).toHaveBeenCalledTimes(1);

    const surface = pressables(tree.root).find(
      (node) => node.props.accessible === false,
    );
    act(() => surface!.props.onLongPress());
    expect(props.onEditingChange).toHaveBeenCalledTimes(2);
  });

  it("offers editing to a screen reader as a named action", () => {
    const tree = render(["message"]);
    const button = byLabel(tree.root, "Message")!;
    expect(button.props.accessibilityActions).toEqual([
      { name: "longpress", label: "Edit quick actions" },
    ]);
    act(() =>
      button.props.onAccessibilityAction({
        nativeEvent: { actionName: "longpress" },
      }),
    );
    expect(props.onEditingChange).toHaveBeenCalledWith(true);
  });

  it("runs actions but offers no editing while the role loads", () => {
    const tree = render(["message"], false, OFFICER, false);
    const button = byLabel(tree.root, "Message")!;
    expect(button.props.accessibilityActions).toEqual([]);
    expect(button.props.onLongPress).toBeUndefined();
    const surface = pressables(tree.root).find(
      (node) => node.props.accessible === false,
    );
    act(() => surface!.props.onLongPress());
    expect(props.onEditingChange).not.toHaveBeenCalled();
    act(() => button.props.onPress());
    expect(props.onRun).toHaveBeenCalledWith("message");
  });

  it("says how to add actions when the member removed them all", () => {
    const tree = render([]);
    const text = tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.props.children);
    expect(text).toContain("Press and hold here to add actions.");
  });
});

describe("editing in place", () => {
  it("puts a remove control on each placed action", () => {
    const tree = render(["message", "invite"], true);
    act(() => byLabel(tree.root, "Remove Message")!.props.onPress());
    expect(props.onSave).toHaveBeenCalledWith(["invite"]);
  });

  it("adds from the Add row at the end", () => {
    const tree = render(["message"], true, ["message", "study"]);
    act(() => byLabel(tree.root, "Add Study")!.props.onPress());
    expect(props.onSave).toHaveBeenCalledWith(["message", "study"]);
  });

  it("holds the Add row once six are placed", () => {
    const six = OFFICER.slice(0, 6);
    const tree = render(six, true);
    const add = byLabel(tree.root, "Add Upload")!;
    expect(add.props.disabled).toBe(true);
    expect(add.props.accessibilityState).toEqual({ disabled: true });
  });

  it("lets a screen reader remove and move, one place at a time", () => {
    const tree = render(["message", "invite", "logHours"], true);
    const placed = (label: string) =>
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Animated.View" &&
          node.props.accessible === true &&
          node.props.accessibilityLabel === label,
      )[0];
    const names = (label: string) =>
      (placed(label).props.accessibilityActions as { name: string }[]).map(
        (action) => action.name,
      );
    expect(names("Message")).toEqual(["remove", "moveLater"]);
    expect(names("Invite")).toEqual(["remove", "moveEarlier", "moveLater"]);
    expect(names("Log hours")).toEqual(["remove", "moveEarlier"]);

    const act11y = (label: string, actionName: string) =>
      act(() =>
        placed(label).props.onAccessibilityAction({
          nativeEvent: { actionName },
        }),
      );
    act11y("Invite", "moveLater");
    expect(props.onSave).toHaveBeenLastCalledWith([
      "message",
      "logHours",
      "invite",
    ]);
    act11y("Invite", "moveEarlier");
    expect(props.onSave).toHaveBeenLastCalledWith([
      "invite",
      "message",
      "logHours",
    ]);
    act11y("Log hours", "remove");
    expect(props.onSave).toHaveBeenLastCalledWith(["message", "invite"]);
  });

  it("leaves editing on Done", () => {
    const tree = render(["message"], true);
    act(() => byLabel(tree.root, "Done editing")!.props.onPress());
    expect(props.onEditingChange).toHaveBeenCalledWith(false);
  });

  it("moves an action to where it is dropped, and keeps that order", () => {
    const tree = render(["message", "invite", "logHours"], true);
    const detectors = tree.root.findAll(
      (node) => (node.type as unknown) === "GestureDetector",
    );
    expect(detectors).toHaveLength(3);
    const drag = detectors[0].props.gesture.handlers as Record<
      string,
      (event?: object) => void
    >;

    // Message, first in a row of three 118pt cells, dragged two cells right.
    act(() => drag.onStart());
    act(() => drag.onUpdate({ translationX: 240, translationY: 0 }));
    act(() => drag.onFinalize());

    expect(props.onSave).toHaveBeenCalledWith([
      "invite",
      "logHours",
      "message",
    ]);
    expect(haptic).toHaveBeenCalled();
  });

  it("saves nothing for a drag that ends where it started", () => {
    const tree = render(["message", "invite"], true);
    const [first] = tree.root.findAll(
      (node) => (node.type as unknown) === "GestureDetector",
    );
    const drag = first.props.gesture.handlers as Record<
      string,
      (event?: object) => void
    >;
    act(() => drag.onStart());
    act(() => drag.onUpdate({ translationX: 10, translationY: 4 }));
    act(() => drag.onFinalize());
    expect(props.onSave).not.toHaveBeenCalled();
  });
});

describe("the Ask Frapp bar", () => {
  function panel(onAsk: (() => void) | undefined, editing = false) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <QuickActionsPanel
            shown={["message"]}
            available={OFFICER}
            width={374}
            editing={editing}
            canEdit
            onAsk={onAsk}
            {...props}
          />
        </FrappThemeProvider>,
      );
    });
    return tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Ask Frapp",
    );
  }

  it("is drawn only for a member who has Ask", () => {
    expect(panel(undefined)).toHaveLength(0);
    const onAsk = vi.fn();
    const bars = panel(onAsk);
    expect(bars).toHaveLength(1);
    act(() => bars[0].props.onPress());
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it("steps aside while the actions are being edited", () => {
    expect(panel(vi.fn(), true)).toHaveLength(0);
  });
});

/**
 * WCAG 2.2 relative-luminance contrast of two opaque `#RRGGBB` colours.
 * `@repo/color`'s `contrastRatio` is the repo's one implementation, but
 * `apps/mobile/package.json` (a frozen hotspot) doesn't declare that package,
 * so this spec carries the formula, with the same 0.03928 threshold.
 */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("the edit badges' glyphs (#4393)", () => {
  // WCAG 1.4.11: a glyph that carries meaning needs 3:1 on what it sits on.
  const NON_TEXT = 3;

  // Every badge of a kind: six actions are addable here, one removable.
  const glyphsOn = (root: Node, path: string) => {
    const fillOf = (node: Node) =>
      [node.props.style]
        .flat(Infinity)
        .reduce<string | undefined>(
          (fill, style) => style?.backgroundColor ?? fill,
          undefined,
        );
    const glyphs = root.findAll(
      (node) => (node.type as unknown) === "Path" && node.props.d === path,
    );
    expect(glyphs.length).toBeGreaterThan(0);
    return glyphs.map((glyph) => {
      // The badge is the nearest ancestor that paints a fill.
      let badge = glyph.parent;
      while (badge && !fillOf(badge)) badge = badge.parent;
      // A faded ancestor would draw the pair at a lower ratio than the one
      // measured here (the add tray dims its faces), so nothing above the
      // glyph may carry opacity.
      for (let node = glyph.parent; node; node = node.parent) {
        const opacity = [node.props.style]
          .flat(Infinity)
          .reduce<number>((o, style) => style?.opacity ?? o, 1);
        expect(opacity, "a badge glyph sits under a faded ancestor").toBe(1);
      }
      return { ink: glyph.props.stroke as string, fill: fillOf(badge!)! };
    });
  };

  it("draws the add badge's plus at 3:1 or better on its success fill", () => {
    const tree = render(["message"], true);
    for (const { ink, fill } of glyphsOn(tree.root, "M5 2v6M2 5h6")) {
      expect(contrast(ink, fill)).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });

  it("draws the remove badge's minus at 3:1 or better on its fill", () => {
    const tree = render(["message"], true);
    for (const { ink, fill } of glyphsOn(tree.root, "M2 5h6")) {
      expect(contrast(ink, fill)).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });
});
