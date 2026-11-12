/** @vitest-environment jsdom */
import React, { useState } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { EventAttendanceDraft } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The Who's coming sheet: Everyone else first, then one row per role with the
 * same three answers, a one-line summary on top and Done to go back, at the
 * scale an imported chapter brings (a hundred roles).
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

function Host({
  initial = { everyone: "optional", roles: {} },
}: {
  initial?: EventAttendanceDraft;
}) {
  const [value, setValue] = useState<EventAttendanceDraft>(initial);
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

function render(initial?: EventAttendanceDraft): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Host initial={initial} />
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
    }) => React.ReactElement;
  };
  let header!: ReactTestRenderer;
  act(() => {
    header = create(
      <FrappThemeProvider>{props.ListHeaderComponent}</FrappThemeProvider>,
    );
  });
  return { props, header };
}

/** Press the answer `label` in the radio group labelled `group`. */
function pressIn(tree: ReactTestRenderer, group: string, label: string) {
  const scope = tree.root.findAll(
    (each) => each.props.accessibilityLabel === group,
  )[0];
  if (!scope) throw new Error(`no group labelled ${group}`);
  const [node] = scope.findAll(
    (each) =>
      each.props.accessibilityLabel === label &&
      typeof each.props.onPress === "function",
  );
  if (!node) throw new Error(`nothing labelled ${label} in ${group}`);
  act(() => node.props.onPress());
}

/** A role's row, drawn the way the list would draw it. */
function row(tree: ReactTestRenderer, id: string, name: string) {
  let drawn!: ReactTestRenderer;
  act(() => {
    drawn = create(
      <FrappThemeProvider>
        {list(tree).props.renderItem({ item: { id, name } })}
      </FrappThemeProvider>,
    );
  });
  return drawn;
}

/** Whether a row's held answer is lit (set apart) or quiet (following). */
function quiet(drawn: ReactTestRenderer): boolean {
  return drawn.root.find((each) => typeof each.props.quiet === "boolean").props
    .quiet as boolean;
}

describe("Who's coming", () => {
  it("lists every role as a row, Everyone else first, with a search at scale", () => {
    const tree = render();
    const { props, header } = list(tree);
    expect(props.data).toHaveLength(ROLES.length);
    expect(screenText(header)).toContain("Everyone else");
    expect(screenText(header)).toContain("Optional for everyone");
    expect(
      header.root.findAll(
        (each) => each.props.accessibilityLabel === "Search roles",
      ),
    ).not.toHaveLength(0);
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

  it("sets a role apart from its row and says so in the summary", () => {
    const tree = render();
    const officers = row(tree, "role-officers", "Officers");
    expect(quiet(officers)).toBe(true);
    pressIn(officers, "Attendance for Officers", "Required");
    expect(latest).toEqual({
      everyone: "optional",
      roles: { "role-officers": "required" },
    });
    expect(screenText(list(tree).header)).toContain(
      "Officers required, everyone else optional",
    );
    expect(quiet(row(tree, "role-officers", "Officers"))).toBe(false);
    act(() => tree.unmount());
  });

  it("puts a role back with everyone else by picking the same answer", () => {
    const tree = render({
      everyone: "optional",
      roles: { "role-alumni": "not_invited" },
    });
    pressIn(
      row(tree, "role-alumni", "Alumni"),
      "Attendance for Alumni",
      "Optional",
    );
    expect(latest.roles).toEqual({});
    act(() => tree.unmount());
  });

  it("drops a role whose answer the new default matches", () => {
    const tree = render({
      everyone: "optional",
      roles: { "role-new": "required" },
    });
    pressIn(list(tree).header, "Attendance for everyone else", "Required");
    expect(latest).toEqual({ everyone: "required", roles: {} });
    act(() => tree.unmount());
  });

  it("leads with the roles set apart when it opens, and keeps the order while editing", () => {
    const tree = render({
      everyone: "optional",
      roles: { "role-officers": "required" },
    });
    expect(list(tree).props.data[0]!.id).toBe("role-officers");
    pressIn(
      row(tree, "role-new", "New Members"),
      "Attendance for New Members",
      "Required",
    );
    // New Members is set apart now, but stays where it was this visit.
    expect(list(tree).props.data[1]!.id).toBe("role-alumni");
    act(() => tree.unmount());
  });

  it("closes with Done, not an X", () => {
    const tree = render();
    const { header } = list(tree);
    expect(screenText(header)).toContain("Done");
    expect(
      header.root.findAll((each) => each.props.accessibilityLabel === "Close"),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });
});
