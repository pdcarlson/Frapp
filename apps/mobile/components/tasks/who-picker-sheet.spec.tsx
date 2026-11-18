/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { TASK_AUDIENCE_COPY, type TaskWho } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import {
  buildWhoDirectory,
  EVERYONE_IN_CHAPTER,
  NOBODY_YET,
  WHO_PICKER_COPY,
  type WhoRow,
} from "@/lib/tasks/who-picker";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import { WhoPickerBody, WhoPickerFooter } from "./who-picker-sheet";

/**
 * The Assign to picker's sheet (the Tasks overhaul § 2). Its rules have
 * their own spec (`lib/tasks/who-picker.spec.ts`); this pins what a member
 * sees and taps. The list is gorhom's, a stand-in under test, so its rows are
 * drawn here through its own `renderItem`.
 */
const directory = buildWhoDirectory({
  members: [
    { user_id: "u-me", display_name: "Paul Carlson", role_ids: [] },
    { user_id: "u-sam", display_name: "Sam Lee", role_ids: ["r-rec"] },
    { user_id: "u-alex", display_name: "Alex Kim", role_ids: ["r-rec"] },
  ],
  roles: [
    { id: "r-rec", name: "Recruitment", tier_id: null },
    { id: "r-hist", name: "Historian", tier_id: null },
  ],
  groups: [{ id: "g-1", name: "Formal planning", kind: "manual", member_ids: [] }],
  viewerUserId: "u-me",
  fallbackName: (id) => id,
});

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

/** The list's rows, drawn as the real list would draw them. */
function rows(tree: ReactTestRenderer): ReactTestRenderer {
  const list = tree.root.find(
    (node) => (node.type as unknown) === "BottomSheetFlatList",
  );
  const data = list.props.data as WhoRow[];
  return render(
    <>
      {data.map((item) => (
        <React.Fragment key={item.key}>
          {list.props.renderItem({ item })}
        </React.Fragment>
      ))}
    </>,
  );
}

const byLabel = (tree: ReactTestRenderer, label: string) => {
  const found = tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )[0];
  if (!found) throw new Error(`No control labelled ${label}`);
  return found;
};

function body(
  value: TaskWho | null,
  onPick: (next: TaskWho | null) => void,
  over: Partial<React.ComponentProps<typeof WhoPickerBody>> = {},
) {
  return render(
    <WhoPickerBody
      value={value}
      onChange={() => undefined}
      directory={directory}
      people="ready"
      sets="ready"
      mode="each"
      onPick={onPick}
      onDone={() => undefined}
      footerRoom={false}
      {...over}
    />,
  );
}

describe("WhoPickerBody", () => {
  it("heads People with Everyone in the chapter and its count, and marks the viewer", () => {
    const onPick = vi.fn();
    const list = rows(body(null, onPick));
    act(() => byLabel(list, `${EVERYONE_IN_CHAPTER}, 3`).props.onPress());
    expect(onPick).toHaveBeenLastCalledWith({
      kind: "each",
      target: { kind: "chapter" },
    });
    act(() =>
      byLabel(list, `Paul Carlson · ${WHO_PICKER_COPY.you}`).props.onPress(),
    );
    expect(onPick).toHaveBeenLastCalledWith({ kind: "person", userId: "u-me" });
  });

  it("ticks a second person into a list", () => {
    const onPick = vi.fn();
    const list = rows(body({ kind: "person", userId: "u-sam" }, onPick));
    expect(byLabel(list, "Sam Lee").props.accessibilityState.checked).toBe(true);
    act(() => byLabel(list, "Alex Kim").props.onPress());
    expect(onPick).toHaveBeenLastCalledWith({
      kind: "each",
      target: { kind: "people", userIds: ["u-sam", "u-alex"] },
    });
  });

  it("opens on Roles and groups for a role, ticked whole, with nobody greyed", () => {
    const onPick = vi.fn();
    const list = rows(
      body({ kind: "each", target: { kind: "role", id: "r-rec" } }, onPick),
    );
    expect(byLabel(list, "Recruitment, 2").props.accessibilityState.checked).toBe(
      true,
    );
    const historian = byLabel(list, `Historian, ${NOBODY_YET}`);
    expect(historian.props.accessibilityState.disabled).toBe(true);
    // Everyone reads partly on while one role is.
    expect(
      byLabel(list, `${EVERYONE_IN_CHAPTER}, 3`).props.accessibilityState.checked,
    ).toBe("mixed");
  });

  it("lists only people for one person, and picks with a tap", () => {
    const onPick = vi.fn();
    const tree = body({ kind: "person", userId: "u-sam" }, onPick, {
      single: true,
    });
    const list = rows(tree);
    expect(
      list.root.findAll(
        (node) => node.props.accessibilityLabel === `${EVERYONE_IN_CHAPTER}, 3`,
      ),
    ).toHaveLength(0);
    act(() => byLabel(list, "Alex Kim").props.onPress());
    expect(onPick).toHaveBeenLastCalledWith({ kind: "person", userId: "u-alex" });
  });
});

describe("WhoPickerFooter", () => {
  it("says who is in, asks who does it, and says what that makes", () => {
    const onMode = vi.fn();
    const tree = render(
      <WhoPickerFooter
        value={{ kind: "someone", target: { kind: "role", id: "r-rec" } }}
        directory={directory}
        mode="someone"
        onMode={onMode}
      />,
    );
    const text = tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .flatMap((node) => React.Children.toArray(node.props.children))
      .filter((child) => typeof child === "string");
    expect(text).toContain("Recruitment · 2 members");
    expect(text).toContain(TASK_AUDIENCE_COPY.someoneHint(2));
    expect(text).toContain(WHO_PICKER_COPY.each);
  });
});
