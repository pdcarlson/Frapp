/** @vitest-environment jsdom */
import React, { useState } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { EventAttendanceDraft } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The Who's coming sheet: the default for everyone, the roles that differ,
 * and a search to add one, at the scale an imported chapter brings (a
 * hundred roles).
 */

const ROLES = [
  { id: "role-officers", name: "Officers" },
  { id: "role-new", name: "New Members" },
  { id: "role-alumni", name: "Alumni" },
  ...Array.from({ length: 100 }, (_, i) => ({
    id: `role-${i}`,
    name: `Committee ${i}`,
  })),
];

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRoles: () => ({ data: ROLES, isPending: false, isError: false }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#DDB844",
    accentPrimary: "#DDB844",
    accentOnPrimary: "#1A1405",
  }),
}));

import { AttendanceSheet } from "./attendance-sheet";

let latest: EventAttendanceDraft;

function Host() {
  const [value, setValue] = useState<EventAttendanceDraft>({
    everyone: "optional",
    roles: {},
  });
  return (
    <AttendanceSheet
      value={value}
      onChange={(next) => {
        latest = next;
        setValue(next);
      }}
    />
  );
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Host />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/**
 * The list is a string stand-in under test, so its header and rows are drawn
 * here from its own props, the way the list would draw them.
 */
function list(tree: ReactTestRenderer) {
  const node = tree.root.find(
    (each) => each.type === ("BottomSheetFlatList" as never),
  );
  const props = node.props as {
    data: { id: string; name: string }[];
    ListHeaderComponent: React.ReactElement;
    renderItem: (info: {
      item: { id: string; name: string };
    }) => React.ReactElement<{ onPress: () => void }>;
  };
  let header!: ReactTestRenderer;
  act(() => {
    header = create(
      <FrappThemeProvider>{props.ListHeaderComponent}</FrappThemeProvider>,
    );
  });
  return { props, header };
}

/** Press the control labelled `label`, inside the group labelled `within`. */
function pressLabel(tree: ReactTestRenderer, label: string, within?: string) {
  const scope = within
    ? tree.root.findAll((each) => each.props.accessibilityLabel === within)[0]!
    : tree.root;
  const [node] = scope.findAll(
    (each) =>
      each.props.accessibilityLabel === label &&
      typeof each.props.onPress === "function",
  );
  if (!node) throw new Error(`nothing labelled ${label}`);
  act(() => node.props.onPress());
}

describe("Who's coming", () => {
  it("lists every role to add, and nothing as a control until one is set", () => {
    const tree = render();
    const { props, header } = list(tree);
    expect(props.data).toHaveLength(ROLES.length);
    expect(screenText(header)).not.toContain("Roles that differ");
    act(() => tree.unmount());
  });

  it("narrows the list as the officer types", () => {
    const tree = render();
    const { header } = list(tree);
    const search = header.root.find(
      (each) => each.props.accessibilityLabel === "Search roles",
    );
    act(() => search.props.onChangeText("new mem"));
    expect(list(tree).props.data.map((role) => role.name)).toEqual([
      "New Members",
    ]);
    act(() => tree.unmount());
  });

  it("adds a role as required when everyone else is optional, then lets it switch", () => {
    const tree = render();
    const officers = list(tree).props.renderItem({
      item: { id: "role-officers", name: "Officers" },
    });
    act(() => officers.props.onPress());
    expect(latest).toEqual({
      everyone: "optional",
      roles: { "role-officers": "required" },
    });

    // Its row offers the two answers that differ from the default.
    const { header } = list(tree);
    expect(screenText(header)).toContain("Roles that differ");
    pressLabel(header, "Not invited", "Attendance for Officers");
    expect(latest.roles["role-officers"]).toBe("not_invited");
    // And a set role leaves the list to add from.
    expect(list(tree).props.data.map((role) => role.id)).not.toContain(
      "role-officers",
    );
    act(() => tree.unmount());
  });

  it("drops a role whose answer the new default matches", () => {
    const tree = render();
    act(() =>
      list(tree)
        .props.renderItem({ item: { id: "role-new", name: "New Members" } })
        .props.onPress(),
    );
    pressLabel(list(tree).header, "Required", "Attendance for everyone");
    expect(latest).toEqual({ everyone: "required", roles: {} });
    act(() => tree.unmount());
  });

  it("removes a role", () => {
    const tree = render();
    act(() =>
      list(tree)
        .props.renderItem({ item: { id: "role-alumni", name: "Alumni" } })
        .props.onPress(),
    );
    pressLabel(list(tree).header, "Remove Alumni");
    expect(latest.roles).toEqual({});
    act(() => tree.unmount());
  });
});
