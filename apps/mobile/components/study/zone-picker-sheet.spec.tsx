/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { Text } from "react-native";
import { FrappThemeProvider } from "@/lib/theme";
import { proximityCopy, type ProximityMap } from "@/lib/study/proximity";
import { zoneRewardCopy } from "@/lib/study/zones";
import { ZonePickerSheet } from "@/components/study/zone-picker-sheet";
import { selectActiveZones } from "@/lib/study/zones";
import {
  MAX_ROWS_SIZED_TO_CONTENT,
  TWO_LINE_ROW_WEIGHT,
} from "@/components/option-sheet";

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

  it("sizes through the shared rule, two-line rows weighed (#5318)", () => {
    // Six two-line zone rows fill the one-line budget; one more scrolls.
    const fitting = Math.floor(MAX_ROWS_SIZED_TO_CONTENT / TWO_LINE_ROW_WEIGHT);
    expect(sheetProps(fitting).enableDynamicSizing).toBe(true);
    expect(sheetProps(fitting + 1).enableDynamicSizing).toBe(false);
  });
});

describe("ZonePickerSheet rows (#5318)", () => {
  function renderSheet(
    selectedZoneId: string | null,
    onSelect = vi.fn(),
    proximity: ProximityMap | null = null,
    onDismiss?: () => void,
  ) {
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
            proximity={proximity}
            onDismiss={onDismiss}
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

  it("lists the nearest zone first, saying how far and what it pays", () => {
    const proximity: ProximityMap = new Map([
      ["z0", { inside: false, distanceM: 300 }],
      ["z1", { inside: true, distanceM: 0 }],
    ]);
    const { tree, rows } = renderSheet(null, vi.fn(), proximity);
    const reward = zoneRewardCopy(zonesOf(1)[0]!);
    // Zone 1 is the one the member is in, so it leads.
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      "Zone 1, You're here",
      `Zone 0, ${proximityCopy({ inside: false, distanceM: 300 })}`,
    ]);
    expect(rows[0]!.props.accessibilityHint).toBe(reward);
    const flat = (node: unknown): string =>
      typeof node === "string"
        ? node
        : Array.isArray(node)
          ? node.map(flat).join("")
          : node && typeof node === "object" && "props" in node
            ? flat((node as { props: { children?: unknown } }).props.children)
            : "";
    const lines = rows[0]!
      .findAllByType(Text)
      .map((text) => flat(text.props.children));
    expect(lines).toContain(`You're here · ${reward}`);
    act(() => tree.unmount());
  });

  it("tells the screen when it closes, so its distances move again", () => {
    const onDismiss = vi.fn();
    const { tree } = renderSheet(null, vi.fn(), null, onDismiss);
    tree.root
      .find((node) => (node.type as unknown) === "BottomSheetModal")
      .props.onDismiss();
    expect(onDismiss).toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
