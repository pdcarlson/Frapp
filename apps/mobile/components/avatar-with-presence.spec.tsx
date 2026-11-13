/** @vitest-environment jsdom */
/**
 * The phone's one avatar dot (#4633): its size per avatar size and its
 * corner, as web's `AvatarPresenceDot` pins it, and no dot before presence
 * has synced.
 */
import React from "react";
import { act } from "react";
import { StyleSheet, View } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import type { PresenceStatus } from "@repo/hooks/presence-status";
import { FrappThemeProvider } from "@/lib/theme";
import { AvatarWithPresence, presenceDotSize } from "./avatar-with-presence";

function draw(
  status: PresenceStatus | null,
  avatarSize: number,
  dotSize?: number,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <AvatarWithPresence
          status={status}
          avatarSize={avatarSize}
          ring="#000"
          dotSize={dotSize}
        >
          <View testID="face" />
        </AvatarWithPresence>
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function dot(tree: ReactTestRenderer) {
  return tree.root.findAll((node) =>
    String(node.props.testID ?? "").startsWith("member-presence-"),
  );
}

/** The dot's diameter: StatusDot's inner view, inside its ring padding. */
function diameter(tree: ReactTestRenderer): number {
  const outer = dot(tree)[0]!;
  const inner = outer.findAll((node) => node.type === ("View" as never))[1]!;
  return StyleSheet.flatten(inner.props.style).width as number;
}

/** Where the dot's wrapper sits on the avatar's corner. */
function corner(tree: ReactTestRenderer) {
  const wrapper = tree.root.findAll(
    (node) =>
      node.type === ("View" as never) &&
      StyleSheet.flatten(node.props.style)?.position === "absolute",
  )[0]!;
  const style = StyleSheet.flatten(wrapper.props.style);
  return { bottom: style.bottom, right: style.right };
}

describe("AvatarWithPresence", () => {
  it("draws web's 10pt dot on list avatars and a 16pt dot on the hero face", () => {
    expect(presenceDotSize(24)).toBe(10);
    expect(presenceDotSize(40)).toBe(10);
    expect(presenceDotSize(56)).toBe(10);
    expect(presenceDotSize(80)).toBe(16);
    expect(diameter(draw("online", 40))).toBe(10);
    expect(diameter(draw("online", 80))).toBe(16);
  });

  it("takes a size override (the You tab's glyph)", () => {
    expect(diameter(draw("dnd", 24, 8))).toBe(8);
  });

  it("pins the dot's edge on the corner, its 2pt ring just past it", () => {
    for (const size of [24, 40, 56, 80]) {
      expect(corner(draw("idle", size))).toEqual({ bottom: -2, right: -2 });
    }
  });

  it("draws the avatar and no dot before presence has synced", () => {
    const tree = draw(null, 40);
    expect(dot(tree)).toHaveLength(0);
    expect(
      tree.root.findAll((node) => node.props.testID === "face"),
    ).not.toHaveLength(0);
  });
});
