/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vitest";
import { View } from "react-native";
import { memberAvatarTint } from "@repo/hooks";
import { signetDarkTokens } from "@repo/theme/signet";
import { flatStyle } from "@/test/flat-style";
import { FrappThemeProvider } from "@/lib/theme";
import {
  FaceWithBadge,
  faceBadgeGlyphSize,
  faceBadgeSize,
} from "./face-with-badge";

/**
 * #4476: the one face-with-a-kind-badge the Notifications screen and the
 * Activity rows share, so both draw the badge from one recipe.
 */

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

function render(props: Partial<React.ComponentProps<typeof FaceWithBadge>>) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <FaceWithBadge
          size={40}
          avatarUrl={null}
          name="Olive Officer"
          testID="face"
          badgeTestID="badge"
          badge="@"
          {...props}
        />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  const find = (id: string) =>
    tree.root.find(
      (node) => (node.type as unknown) === "View" && node.props.testID === id,
    );
  return { tree, face: find("face"), badge: find("badge") };
}

describe("FaceWithBadge", () => {
  it("sizes the badge from the face: half of it, glyph at three fifths", () => {
    expect([faceBadgeSize(36), faceBadgeGlyphSize(36)]).toEqual([18, 11]);
    expect([faceBadgeSize(40), faceBadgeGlyphSize(40)]).toEqual([20, 12]);
    const { face, badge } = render({ size: 36 });
    expect(flatStyle(face.props.style)).toMatchObject({
      width: 36,
      height: 36,
    });
    expect(flatStyle(badge.props.style)).toMatchObject({
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 18,
      height: 18,
      borderColor: signetDarkTokens.color.border.hairline,
    });
  });

  it("draws a mark in the badge, neutral unless given a tone", () => {
    const { tree, badge } = render({});
    expect(JSON.stringify(tree.toJSON())).toContain('"@"');
    expect(flatStyle(badge.props.style).backgroundColor).toBe(
      signetDarkTokens.color.surface.surface1,
    );
    const toned = render({ tone: { fill: "#C9A227", ink: "#1A1400" } });
    expect(flatStyle(toned.badge.props.style).backgroundColor).toBe("#C9A227");
  });

  it("hands a glyph its size and the badge's ink", () => {
    let handed: { size: number; color: string } | null = null;
    render({
      size: 40,
      badge: (glyph) => {
        handed = glyph;
        return <View testID="glyph" />;
      },
    });
    expect(handed).toEqual({
      size: 12,
      color: signetDarkTokens.color.text.mutedForeground,
    });
  });

  it("draws the member's initials on their tint, hidden from a screen reader", () => {
    const tint = memberAvatarTint("#8FA8FF");
    const { tree, face } = render({ tint });
    expect(JSON.stringify(tree.toJSON())).toContain("OO");
    expect(face.props.accessibilityElementsHidden).toBe(true);
    expect(face.props.importantForAccessibility).toBe("no-hide-descendants");
  });
});
