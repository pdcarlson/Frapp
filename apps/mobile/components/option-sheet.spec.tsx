/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Text } from "react-native";
import { FrappThemeProvider } from "@/lib/theme";
import {
  fitsContent,
  MAX_ROWS_SIZED_TO_CONTENT,
  OptionSheet,
  type SheetOption,
} from "@/components/option-sheet";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const SORTS: SheetOption[] = [
  { value: "name", label: "Name A–Z" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

const trees: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => trees.splice(0).forEach((tree) => tree.unmount()));
});

function render(
  options: readonly SheetOption[],
  selected: string | null,
  onSelect = vi.fn(),
) {
  const dismiss = vi.fn();
  const ref = React.createRef<never>();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <OptionSheet
          ref={ref}
          title="Sort by"
          options={options}
          selected={selected}
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
  trees.push(tree);
  const row = (label: string) =>
    tree.root.find(
      (node) =>
        node.props.accessibilityRole === "radio" &&
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === "function",
    );
  return { tree, row, onSelect, dismiss };
}

describe("OptionSheet (#5278)", () => {
  it("checks the current pick, and only it", () => {
    const { row } = render(SORTS, "newest");
    expect(row("Newest first").props.accessibilityState).toEqual({
      checked: true,
    });
    expect(row("Name A–Z").props.accessibilityState).toEqual({
      checked: false,
    });
  });

  it("applies a tapped row and closes", () => {
    const { row, onSelect, dismiss } = render(SORTS, "name");
    act(() => row("Oldest first").props.onPress());
    expect(onSelect).toHaveBeenCalledWith("oldest");
    expect(dismiss).toHaveBeenCalled();
  });

  it("passes null for the any row", () => {
    const { row, onSelect } = render(
      [{ value: null, label: "Any type" }, ...SORTS],
      "name",
    );
    act(() => row("Any type").props.onPress());
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("sizes a short list to its rows and scrolls a long one", () => {
    const sheet = (tree: ReactTestRenderer) =>
      tree.root.find((node) => (node.type as unknown) === "BottomSheetModal")
        .props;
    expect(sheet(render(SORTS, null).tree).enableDynamicSizing).toBe(true);
    const many = Array.from({ length: 12 }, (_, i) => ({
      value: `u${i}`,
      label: `Member ${i}`,
    }));
    const long = sheet(render(many, null).tree);
    expect(long.enableDynamicSizing).toBe(false);
    expect(long.snapPoints).toEqual(["70%"]);
  });

  it("sizes eight one-line rows or six two-line rows to content, and one more scrolls", () => {
    const rows = (n: number, detail?: string) =>
      Array.from({ length: n }, (_, i) => ({
        value: `r${i}`,
        label: `Row ${i}`,
        detail,
      }));
    expect(fitsContent(rows(MAX_ROWS_SIZED_TO_CONTENT))).toBe(true);
    expect(fitsContent(rows(MAX_ROWS_SIZED_TO_CONTENT + 1))).toBe(false);
    expect(fitsContent(rows(6, "1 pt / hour"))).toBe(true);
    expect(fitsContent(rows(7, "1 pt / hour"))).toBe(false);
    const sheet = (tree: ReactTestRenderer) =>
      tree.root.find((node) => (node.type as unknown) === "BottomSheetModal")
        .props;
    expect(sheet(render(rows(7, "x"), null).tree).enableDynamicSizing).toBe(
      false,
    );
  });
});

describe("OptionSheet rows with a second line (#5318)", () => {
  it("draws the detail under the label, with its own spoken label and hint", () => {
    const { tree } = render(
      [
        {
          value: "lib",
          label: "Library",
          detail: "1 pt / hour",
          accessibilityLabel: "Library, You're here",
          accessibilityHint: "1 pt / hour",
        },
      ],
      "lib",
    );
    const row = tree.root.find(
      (node) =>
        node.props.accessibilityRole === "radio" &&
        typeof node.props.onPress === "function",
    );
    expect(row.props.accessibilityLabel).toBe("Library, You're here");
    expect(row.props.accessibilityHint).toBe("1 pt / hour");
    expect(row.props.accessibilityState).toEqual({ checked: true });
    const texts = row.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toContain("Library");
    expect(texts).toContain("1 pt / hour");
  });

  it("hands the sheet's dismissal to the host", () => {
    const onDismiss = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <OptionSheet
            title="Study zone"
            options={SORTS}
            selected={null}
            onSelect={vi.fn()}
            onDismiss={onDismiss}
          />
        </FrappThemeProvider>,
      );
    });
    trees.push(tree);
    tree.root
      .find((node) => (node.type as unknown) === "BottomSheetModal")
      .props.onDismiss();
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("OptionSheet sections (#5473)", () => {
  const sectioned: SheetOption[] = [
    { value: null, label: "Just you" },
    { value: "tier:a", label: "Exec board · 4", heading: "Tiers" },
    { value: "role:b", label: "President · 1", heading: "Roles" },
    { value: "role:c", label: "Treasurer · 1" },
  ];

  it("draws a heading above the row that starts a section", () => {
    const { tree } = render(sectioned, null);
    const headers = tree.root
      .findAll(
        (node) =>
          node.props.accessibilityRole === "header" && node.type === Text,
      )
      .map((node) => node.props.children);
    expect(headers).toEqual(["Tiers", "Roles"]);
  });

  it("counts a heading as a row when sizing to content", () => {
    const rows = Array.from({ length: MAX_ROWS_SIZED_TO_CONTENT }, (_, i) => ({
      value: String(i),
      label: `Row ${i}`,
    }));
    expect(fitsContent(rows)).toBe(true);
    expect(fitsContent([{ ...rows[0]!, heading: "Tiers" }, ...rows.slice(1)])).toBe(
      false,
    );
  });
});
