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
  "checkIn",
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
    const tree = render(["message", "checkIn", "logHours"]);
    const labels = pressables(tree.root)
      .map((node) => node.props.accessibilityLabel)
      .filter(Boolean);
    expect(labels).toEqual(["Message", "Check in", "Log hours"]);

    act(() => byLabel(tree.root, "Check in")!.props.onPress());
    expect(props.onRun).toHaveBeenCalledWith("checkIn");
  });

  it("starts editing on a hold, on an action or between them", () => {
    const tree = render(["message", "checkIn"]);
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
    const tree = render(["message", "checkIn"], true);
    act(() => byLabel(tree.root, "Remove Message")!.props.onPress());
    expect(props.onSave).toHaveBeenCalledWith(["checkIn"]);
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
    const tree = render(["message", "checkIn", "logHours"], true);
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
    expect(names("Check in")).toEqual(["remove", "moveEarlier", "moveLater"]);
    expect(names("Log hours")).toEqual(["remove", "moveEarlier"]);

    const act11y = (label: string, actionName: string) =>
      act(() =>
        placed(label).props.onAccessibilityAction({
          nativeEvent: { actionName },
        }),
      );
    act11y("Check in", "moveLater");
    expect(props.onSave).toHaveBeenLastCalledWith([
      "message",
      "logHours",
      "checkIn",
    ]);
    act11y("Check in", "moveEarlier");
    expect(props.onSave).toHaveBeenLastCalledWith([
      "checkIn",
      "message",
      "logHours",
    ]);
    act11y("Log hours", "remove");
    expect(props.onSave).toHaveBeenLastCalledWith(["message", "checkIn"]);
  });

  it("leaves editing on Done", () => {
    const tree = render(["message"], true);
    act(() => byLabel(tree.root, "Done editing")!.props.onPress());
    expect(props.onEditingChange).toHaveBeenCalledWith(false);
  });

  it("moves an action to where it is dropped, and keeps that order", () => {
    const tree = render(["message", "checkIn", "logHours"], true);
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
      "checkIn",
      "logHours",
      "message",
    ]);
    expect(haptic).toHaveBeenCalled();
  });

  it("saves nothing for a drag that ends where it started", () => {
    const tree = render(["message", "checkIn"], true);
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
