/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { StyleSheet } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens as signetTokens } from "@repo/theme/signet";
import { FrappThemeProvider, tint } from "@/lib/theme";
import { ImportantStrip } from "./important-strip";

function render(total: number) {
  const onShow = vi.fn();
  const onDismiss = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ImportantStrip total={total} onShow={onShow} onDismiss={onDismiss} />
      </FrappThemeProvider>,
    );
  });
  return { tree, onShow, onDismiss };
}

const pressable = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      node.props.accessibilityLabel === label,
  );

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => node.type === ("Text" as never))
    .map((node) => node.props.children);

describe("ImportantStrip, mobile (#4186)", () => {
  it("reads the count, then Show", () => {
    const { tree } = render(1);
    expect(texts(tree)).toEqual(["1 important message", "Show ↑"]);
    act(() => tree.unmount());
  });

  it("is one target that shows the oldest, and × dismisses", () => {
    const { tree, onShow, onDismiss } = render(3);

    act(() =>
      pressable(
        tree,
        "3 important messages. Jump to the oldest",
      ).props.onPress(),
    );
    expect(onShow).toHaveBeenCalledTimes(1);

    act(() => pressable(tree, "Dismiss important messages").props.onPress());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("wears the Important row's paint, at the touch floor", () => {
    const { tree } = render(1);
    const strip = tree.root.find(
      (node) => node.props.testID === "important-strip",
    );
    const style = StyleSheet.flatten(strip.props.style);
    const danger = signetTokens.color.semantic.destructive;
    expect(style).toMatchObject({
      backgroundColor: tint(danger),
      borderLeftColor: danger,
      borderLeftWidth: 2,
      minHeight: signetTokens.touch.minimum,
    });
    act(() => tree.unmount());
  });
});
