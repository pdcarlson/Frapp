/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { Text } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "./icon-button";

/**
 * components.md § Icon-only actions: the glyph alone, the word in the
 * accessibility label, and the 44pt touch floor reached through slop rather
 * than a box that makes a one-line banner taller.
 */

function render(props: { disabled?: boolean; onPress?: () => void } = {}) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <IconButton
        label="Dismiss"
        hint="Hides this message."
        onPress={props.onPress ?? vi.fn()}
        disabled={props.disabled}
      >
        <Text>×</Text>
      </IconButton>,
    );
  });
  return tree.root.find((node) => (node.type as unknown) === "Pressable");
}

const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity));

describe("IconButton", () => {
  it("names its action for a screen reader and runs it", () => {
    const onPress = vi.fn();
    const button = render({ onPress });
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Dismiss");
    expect(button.props.accessibilityHint).toBe("Hides this message.");
    act(() => button.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("reaches 44pt through slop, with a box no taller than the glyph", () => {
    const button = render();
    const box = flat(button.props.style({ pressed: false }));
    expect(box.height).toBe(20);
    expect(box.height + 2 * button.props.hitSlop).toBe(44);
  });

  it("says it is disabled and stays disabled", () => {
    const button = render({ disabled: true });
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityState).toEqual({ disabled: true });
  });
});
