/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushAskAction } from "@/lib/notifications/use-push-primer";

/**
 * The chat home's one reminder row. `use-push-primer.spec.tsx` covers when it
 * shows and what its answers record; this covers what the row draws and that
 * each control reaches the hook.
 */
const reminder = vi.hoisted(() => ({
  show: true,
  action: "ask" as PushAskAction,
  isRequesting: false,
  turnOn: vi.fn(async () => {}),
  dismiss: vi.fn(),
}));
vi.mock("@/lib/notifications/use-push-primer", () => ({
  usePushReminder: () => reminder,
}));

import { FrappThemeProvider } from "@/lib/theme";
import { PushReminder } from "./push-reminder";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <PushReminder />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType("Text" as never, { deep: true })
    .map((t) => String(t.props.children));

const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByType("Pressable" as never, { deep: true })
    .find((p) => p.props.accessibilityLabel === label);

describe("PushReminder", () => {
  beforeEach(() => {
    reminder.show = true;
    reminder.action = "ask";
    reminder.isRequesting = false;
    reminder.turnOn.mockClear();
    reminder.dismiss.mockClear();
  });

  it("draws nothing when there is nothing to remind", () => {
    reminder.show = false;
    expect(render().toJSON()).toBeNull();
  });

  it("says push is off, and wires Turn on and the close", () => {
    const tree = render();
    expect(texts(tree)).toContain("Notifications are off");
    expect(texts(tree)).toContain("Turn on");

    act(() => byLabel(tree, "Turn on notifications")!.props.onPress());
    expect(reminder.turnOn).toHaveBeenCalledTimes(1);

    act(() => byLabel(tree, "Dismiss")!.props.onPress());
    expect(reminder.dismiss).toHaveBeenCalledTimes(1);
  });

  it("says Open Settings when no OS prompt can appear", () => {
    reminder.action = "settings";
    const tree = render();
    expect(texts(tree)).toContain("Open Settings");
    expect(
      byLabel(tree, "Open Settings to turn on notifications"),
    ).toBeDefined();
  });

  it("turns its button off while an answer runs", () => {
    reminder.isRequesting = true;
    const tree = render();
    expect(byLabel(tree, "Turn on notifications")!.props.disabled).toBe(true);
  });
});
