/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { View } from "react-native";
import { useBottomSheetInternal } from "@gorhom/bottom-sheet";
import { signetDarkTokens } from "@repo/theme/signet";
import { flatStyle } from "@/test/flat-style";
import { memberAvatarTint } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { LEAD_TILE_SIZE, LeadTile } from "./lead-tile";

/**
 * #4610 step 3: the tile a row's leading glyph sits in, shared by Activity,
 * the You tab and Up next (`spec/ui/mobile/patterns.md` § Rows).
 */

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

function tileStyle(
  props: Omit<React.ComponentProps<typeof LeadTile>, "children">,
) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <LeadTile testID="tile" {...props}>
          <View />
        </LeadTile>
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  const tile = tree.root.find(
    (node) => (node.type as unknown) === "View" && node.props.testID === "tile",
  );
  return { tile, style: flatStyle(tile.props.style) };
}

describe("LeadTile", () => {
  it("is one surface step above what its row sits on", () => {
    expect(tileStyle({}).style.backgroundColor).toBe(
      signetDarkTokens.color.surface.surface1,
    );
    // A card on a screen is `surface1` (`lib/surfaces.ts`), so the tile on
    // one is `card`.
    expect(tileStyle({ on: "card" }).style.backgroundColor).toBe(
      signetDarkTokens.color.surface.card,
    );
  });

  it("keeps `popover` on a sheet's card, which is `card`", () => {
    vi.mocked(useBottomSheetInternal).mockReturnValue({} as never);
    try {
      expect(tileStyle({ on: "card" }).style.backgroundColor).toBe(
        signetDarkTokens.color.surface.popover,
      );
    } finally {
      vi.mocked(useBottomSheetInternal).mockReturnValue(null);
    }
  });

  it("is 32pt on a one-line row and 40pt on a two-line row", () => {
    const row = tileStyle({}).style;
    expect([row.width, row.height]).toEqual([32, 32]);
    expect(row.borderRadius).toBe(signetDarkTokens.radius.chip);
    const lead = tileStyle({ size: "lead" }).style;
    expect([lead.width, lead.height]).toEqual([40, 40]);
    expect(lead.borderRadius).toBe(signetDarkTokens.radius.chipLarge);
    expect(LEAD_TILE_SIZE).toEqual({ row: 32, lead: 40 });
  });

  // The row's 12pt padding is sized for a line of text. Without this a tile
  // made every You row 56pt; the control size scale's row is 48.
  it("keeps a one-line row at 48pt", () => {
    const { style } = tileStyle({});
    const rowHeight =
      2 * signetDarkTokens.spacing.md +
      (style.height as number) +
      2 * (style.marginVertical as number);
    expect(rowHeight).toBe(48);
    expect(tileStyle({ size: "lead" }).style.marginVertical).toBeUndefined();
  });

  it("takes a place's hue as the tint an avatar takes, and is neutral without one", () => {
    const hue = "#8FA8FF";
    const tinted = tileStyle({ on: "card", hue }).style;
    expect(tinted.backgroundColor).toBe(memberAvatarTint(hue).fill);
    expect(tinted.borderColor).toBe(memberAvatarTint(hue).fill);
    expect(tileStyle({ on: "card" }).style.borderColor).toBe(
      signetDarkTokens.color.border.hairline,
    );
  });

  it("is decoration to a screen reader", () => {
    const { tile } = tileStyle({});
    expect(tile.props.accessibilityElementsHidden).toBe(true);
    expect(tile.props.importantForAccessibility).toBe("no-hide-descendants");
  });
});
