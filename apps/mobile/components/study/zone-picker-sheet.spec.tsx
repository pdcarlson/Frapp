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
    Array.from({ length: count }, (_, i) => ({
      id: `z${i}`,
      name: `Zone ${i}`,
    })),
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

  it("sizes six zones to content: one threshold with every pick-one sheet (#5318)", () => {
    expect(sheetProps(6).enableDynamicSizing).toBe(true);
    expect(sheetProps(7).enableDynamicSizing).toBe(false);
  });
});

describe("ZonePickerSheet rows (#5318)", () => {
  function renderSheet(selectedZoneId: string | null, onSelect = vi.fn()) {
    const dismiss = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ZonePickerSheet
            ref={React.createRef<never>()}
            zones={zonesOf(2)}
            selectedZoneId={selectedZoneId}
            onSelect={onSelect}
          />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) =>
            (element.type as unknown) === "BottomSheetModal"
              ? { present: vi.fn(), dismiss }
              : null,
        },
      );
    });
    const rows = tree.root.findAll(
      (node) =>
        node.props.accessibilityRole === "radio" &&
        typeof node.props.onPress === "function",
    );
    return { tree, rows, onSelect, dismiss };
  }

  it("reports the picked zone as checked, for a screen reader", () => {
    const { tree, rows } = renderSheet("z1");
    expect(rows.map((row) => row.props.accessibilityState)).toEqual([
      { checked: false },
      { checked: true },
    ]);
    act(() => tree.unmount());
  });

  it("picks a zone and closes itself", () => {
    const { tree, rows, onSelect, dismiss } = renderSheet(null);
    act(() => rows[0]!.props.onPress());
    expect(onSelect).toHaveBeenCalledWith("z0");
    expect(dismiss).toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
