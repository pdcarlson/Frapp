import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberFacingError } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The phone's Type sheet (Paul 2026-11-20): sized to its rows rather than
 * full height, "No type" first, and for someone who can make types a
 * "Find or add a type" search whose unmatched name offers "Create “…”".
 */

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCreateEventType: () => ({ mutateAsync: mockCreate, isPending: false }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#DDB844",
    accentPrimary: "#DDB844",
    accentOnPrimary: "#1A1405",
  }),
}));

import { EventTypeSheet } from "./event-form-rows";

const TYPES = [
  {
    id: "t-1",
    chapter_id: "c",
    name: "Chapter meeting",
    point_value: 10,
    is_mandatory: true,
    position: 0,
    created_at: "",
    updated_at: "",
  },
  {
    id: "t-2",
    chapter_id: "c",
    name: "Social",
    point_value: 0,
    is_mandatory: false,
    position: 1,
    created_at: "",
    updated_at: "",
  },
];

const SEVEN = Array.from({ length: 7 }, (_, i) => ({
  ...TYPES[1]!,
  id: `t-${i + 10}`,
  name: `Kind ${i}`,
}));

const fromForm = (name: string) => ({
  name,
  point_value: 5,
  is_mandatory: false,
});

function render(
  onPick: (type: unknown, made?: boolean) => void,
  canAdd = true,
  types = TYPES,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <EventTypeSheet
          ref={React.createRef()}
          types={types}
          value={null}
          showSets
          onPick={onPick}
          typeFromForm={canAdd ? fromForm : undefined}
        />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          element.type === ("BottomSheetModal" as never)
            ? { dismiss: vi.fn() }
            : {},
      },
    );
  });
  return tree;
}

const search = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      typeof node.props.onChangeText === "function" &&
      typeof node.props.placeholder === "string",
  );

beforeEach(() => mockCreate.mockReset());

describe("EventTypeSheet", () => {
  it("sizes a short list to its rows instead of opening full height", () => {
    const tree = render(vi.fn());
    const modal = tree.root.find(
      (node) => node.type === ("BottomSheetModal" as never),
    );
    expect(modal.props.enableDynamicSizing).toBe(true);
    expect(modal.props.snapPoints).toBeUndefined();
    expect(screenText(tree)).toContain("No type");
  });

  it("offers Create for a typed name no type has, and holds what it makes", async () => {
    const created = { ...TYPES[1]!, id: "t-9", name: "Work party" };
    mockCreate.mockResolvedValue(created);
    const onPick = vi.fn();
    const tree = render(onPick);
    expect(search(tree).props.placeholder).toBe("Find or add a type");
    act(() => search(tree).props.onChangeText("Work party"));
    const row = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Create “Work party”" &&
        typeof node.props.onPress === "function",
    );
    await act(async () => row.props.onPress());
    expect(mockCreate).toHaveBeenCalledWith({
      name: "Work party",
      point_value: 5,
      is_mandatory: false,
    });
    expect(onPick).toHaveBeenCalledWith(created, true);
  });

  it("sizes seven types, as older chapters hold, to their rows too", () => {
    const tree = render(vi.fn(), true, SEVEN);
    const modal = tree.root.find(
      (node) => node.type === ("BottomSheetModal" as never),
    );
    expect(modal.props.enableDynamicSizing).toBe(true);
    expect(modal.props.snapPoints).toBeUndefined();
  });

  it("stops a long list where every pick-one sheet stops, and scrolls", () => {
    const tree = render(vi.fn(), true, [...SEVEN, ...TYPES]);
    const modal = tree.root.find(
      (node) => node.type === ("BottomSheetModal" as never),
    );
    expect(modal.props.enableDynamicSizing).toBe(false);
    expect(modal.props.snapPoints).toEqual(["70%"]);
  });

  it("says so in the sheet when the type can't be made, and holds nothing", async () => {
    mockCreate.mockRejectedValueOnce(
      new MemberFacingError("That name is taken."),
    );
    const onPick = vi.fn();
    const tree = render(onPick);
    act(() => search(tree).props.onChangeText("Rush"));
    const row = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Create \u201cRush\u201d" &&
        typeof node.props.onPress === "function",
    );
    await act(async () => row.props.onPress());
    expect(screenText(tree)).toContain("That name is taken.");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("holds the one match on return, and never makes a type from a half search", async () => {
    const onPick = vi.fn();
    const tree = render(onPick);
    act(() => search(tree).props.onChangeText("Soc"));
    await act(async () => search(tree).props.onSubmitEditing());
    expect(mockCreate).not.toHaveBeenCalled();
    expect(onPick.mock.calls[0]?.[0]).toEqual(TYPES[1]);
  });

  it("finds a type typed with extra spaces", () => {
    const tree = render(vi.fn());
    act(() => search(tree).props.onChangeText("Chapter   meeting"));
    expect(screenText(tree)).toContain("Chapter meeting");
    expect(screenText(tree)).not.toContain("No type by that name");
  });

  it("offers no Create for a name a type already has", () => {
    const tree = render(vi.fn());
    act(() => search(tree).props.onChangeText("social"));
    expect(screenText(tree)).not.toContain("Create");
    expect(screenText(tree)).toContain("Social");
  });

  it("gives someone who can't make types no search on a short list", () => {
    const tree = render(vi.fn(), false);
    expect(
      tree.root.findAll(
        (node) =>
          typeof node.props.onChangeText === "function" &&
          typeof node.props.placeholder === "string",
      ),
    ).toHaveLength(0);
  });
});
