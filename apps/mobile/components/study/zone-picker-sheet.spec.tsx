/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { ZonePickerSheet } from "@/components/study/zone-picker-sheet";
import { selectActiveZones } from "@/lib/study/zones";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const zonesOf = (count: number) =>
  selectActiveZones(
    Array.from({ length: count }, (_, i) => ({ id: `z${i}`, name: `Zone ${i}` })),
  );

function sheetProps(count: number) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ZonePickerSheet
          zones={zonesOf(count)}
          selectedZoneId={null}
          onSelect={() => {}}
        />
      </FrappThemeProvider>,
    );
  });
  const props = tree.root.find(
    (node) => (node.type as unknown) === "BottomSheetModal",
  ).props;
  act(() => tree.unmount());
  return props;
}

describe("ZonePickerSheet sizing", () => {
  it("sizes a chapter's handful of zones to its rows, never a fixed box", () => {
    // A fixed detent with gorhom v5's dynamic sizing left on opened the sheet
    // at its title's height, cutting the zones off (2026-11-12).
    const props = sheetProps(3);
    expect(props.enableDynamicSizing).toBe(true);
    expect(props.snapPoints).toBeUndefined();
  });

  it("gives a long list a fixed detent with dynamic sizing off, so it scrolls", () => {
    const props = sheetProps(9);
    expect(props.enableDynamicSizing).toBe(false);
    expect(props.snapPoints).toEqual(["70%"]);
  });
});
