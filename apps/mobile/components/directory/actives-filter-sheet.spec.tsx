/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import {
  NO_ACTIVES_FILTER,
  type ActivesFilter,
  type FilterRole,
} from "@/lib/directory/actives-filter";

/**
 * The Directory's Actives filter sheet (#3971): the role list is typed down
 * and still scrolls, "Any role" leads it until a search is typed, and each
 * pick hands the screen the whole filter at once.
 */

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#CB9FFF",
    accentOnPrimary: "#000000",
  }),
}));

import { ActivesFilterSheet } from "./actives-filter-sheet";

const ROLES: FilterRole[] = [
  { id: "r-member", name: "Member", color: null },
  { id: "r-rush", name: "Rush/Recruitment Chair", color: "#ff0000" },
  { id: "r-social", name: "Social Chair", color: null },
];

function render(
  filter: ActivesFilter = NO_ACTIVES_FILTER,
  onChange = vi.fn(),
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ActivesFilterSheet
          filter={filter}
          onChange={onChange}
          roles={ROLES}
          years={[2028, 2027]}
          classes={[]}
          classWord="Pledge class"
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function list(tree: ReactTestRenderer) {
  return tree.root.find(
    (node) => (node.type as unknown) === "BottomSheetFlatList",
  );
}

type Row = FilterRole | "__any";

function shown(tree: ReactTestRenderer): string[] {
  return (list(tree).props.data as Row[]).map((row) =>
    row === "__any" ? "any" : row.id,
  );
}

/** The FlatList stand-in never renders rows, so draw one to read and tap it. */
function row(tree: ReactTestRenderer, item: Row) {
  return list(tree).props.renderItem({ item }) as React.ReactElement<{
    onPress: () => void;
    accessibilityLabel: string;
    accessibilityState: { checked: boolean };
  }>;
}

/** An element in the header, which the stand-in doesn't mount. */
function inHeader(
  tree: ReactTestRenderer,
  match: (props: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  const visit = (node: unknown): Record<string, unknown> | null => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }
    if (!React.isValidElement(node)) return null;
    const props = node.props as Record<string, unknown>;
    if (match(props)) return props;
    return visit(props.children);
  };
  return visit(list(tree).props.ListHeaderComponent);
}

function search(tree: ReactTestRenderer, text: string) {
  const field = inHeader(tree, (p) => p.accessibilityLabel === "Search roles")!;
  act(() => (field.onChangeText as (t: string) => void)(text));
}

describe("ActivesFilterSheet (#3971)", () => {
  it("leads the role list with Any role, checked while no role is picked", () => {
    const tree = render();
    expect(shown(tree)).toEqual(["any", "r-member", "r-rush", "r-social"]);
    expect(row(tree, "__any").props.accessibilityState.checked).toBe(true);
  });

  it("types the role list down by word starts, Any role stepping aside", () => {
    const tree = render();
    search(tree, "rec");
    expect(shown(tree)).toEqual(["r-rush"]);
    search(tree, "chair");
    expect(shown(tree)).toEqual(["r-rush", "r-social"]);
    search(tree, "");
    expect(shown(tree)[0]).toBe("any");
  });

  it("picks a role, and tapping the picked role again clears it", () => {
    const onChange = vi.fn();
    const tree = render({ ...NO_ACTIVES_FILTER, status: "active" }, onChange);

    act(() => row(tree, ROLES[1]!).props.onPress());
    expect(onChange).toHaveBeenLastCalledWith({
      ...NO_ACTIVES_FILTER,
      status: "active",
      roleId: "r-rush",
    });

    const picked = render({ ...NO_ACTIVES_FILTER, roleId: "r-rush" }, onChange);
    expect(row(picked, ROLES[1]!).props.accessibilityState.checked).toBe(true);
    act(() => row(picked, ROLES[1]!).props.onPress());
    expect(onChange).toHaveBeenLastCalledWith(NO_ACTIVES_FILTER);
  });

  it("offers Clear filters only while a filter is set", () => {
    const clear = (tree: ReactTestRenderer) =>
      inHeader(tree, (p) => p.accessibilityLabel === "Clear filters");
    expect(clear(render())).toBeNull();

    const onChange = vi.fn();
    const tree = render(
      { ...NO_ACTIVES_FILTER, graduationYear: 2028 },
      onChange,
    );
    act(() => (clear(tree)!.onPress as () => void)());
    expect(onChange).toHaveBeenLastCalledWith(NO_ACTIVES_FILTER);
  });

  it("hides the class section for a chapter that keeps no classes", () => {
    const tree = render();
    expect(
      inHeader(tree, (p) => p.accessibilityLabel === "Pledge class"),
    ).toBeNull();
    expect(
      inHeader(tree, (p) => p.accessibilityLabel === "Graduation year"),
    ).not.toBeNull();
  });
});
