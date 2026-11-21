/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import type { ChannelAccessOption } from "@repo/hooks/channel-access";
import { ChannelAccessSheet } from "./channel-access-sheet";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

/**
 * The tiers a document list always keeps (#5216): Chosen starts with them,
 * they can't be unticked, and a tick adds them to a stored list that lacks
 * them. The channel form passes none, and is unchanged.
 */

const option = (entry: string, name: string): ChannelAccessOption => ({
  entry,
  kind: entry.startsWith("tier:") ? "tier" : "role",
  id: entry.split(":")[1]!,
  name,
  color: null,
  tier_id: null,
  user_ids: ["u-1"],
});

const OPTIONS = [
  option("tier:t-exec", "Executive board"),
  option("role:r-rush", "Rush chair"),
];

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

function render(value: string[] | null, locked?: string[]) {
  const onChange = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChannelAccessSheet
          question="see"
          value={value}
          onChange={onChange}
          options={OPTIONS}
          optionsState="ready"
          locked={locked}
        />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return { tree, onChange };
}

// The list stand-in draws its props but never its rows (`vitest.setup.ts`),
// so a row and the header are rendered from the props it was handed.
const list = (tree: ReactTestRenderer) =>
  tree.root.find((node) => (node.type as unknown) === "BottomSheetFlatList");

function drawn(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  mounted.push(tree);
  return tree;
}

function row(tree: ReactTestRenderer, name: string) {
  const { data, renderItem } = list(tree).props;
  const item = data.find(
    (entry: { kind: string; option?: { name: string } }) =>
      entry.kind !== "heading" && entry.option?.name === name,
  );
  return drawn(renderItem({ item })).root.find(
    (node) =>
      node.props.accessibilityRole === "checkbox" &&
      typeof node.props.onPress === "function",
  );
}

const segmented = (tree: ReactTestRenderer) =>
  drawn(list(tree).props.ListHeaderComponent).root.find(
    (node) =>
      node.props.accessibilityLabel === "Who can see" &&
      Array.isArray(node.props.options) &&
      typeof node.props.onChange === "function",
  );

describe("ChannelAccessSheet locked entries (#5216)", () => {
  it("starts Chosen roles with the locked tiers", () => {
    const { tree, onChange } = render(null, ["tier:t-exec"]);
    const modes = segmented(tree);
    act(() => modes.props.onChange("chosen"));
    expect(onChange).toHaveBeenLastCalledWith(["tier:t-exec"]);
  });

  it("starts Chosen roles empty with nothing locked, as the channel form does", () => {
    const { tree, onChange } = render(null);
    const modes = segmented(tree);
    act(() => modes.props.onChange("chosen"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("holds a locked tier on, said to a screen reader", () => {
    const { tree, onChange } = render(["tier:t-exec"], ["tier:t-exec"]);
    const exec = row(tree, "Executive board");
    expect(exec.props.accessibilityState).toMatchObject({
      checked: true,
      disabled: true,
    });
    expect(exec.props.accessibilityHint).toBe(
      "Always on a list you set: your tier and those above.",
    );
    act(() => exec.props.onPress());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds the locked tiers when a stored list without them is first changed", () => {
    const { tree, onChange } = render(["role:r-rush"], ["tier:t-exec"]);
    expect(row(tree, "Executive board").props.disabled).toBe(false);
    const rush = row(tree, "Rush chair");
    act(() => rush.props.onPress());
    expect(onChange).toHaveBeenLastCalledWith(["tier:t-exec"]);
  });

  it("lets the channel form untick any entry", () => {
    const { tree, onChange } = render(["tier:t-exec", "role:r-rush"]);
    const exec = row(tree, "Executive board");
    act(() => exec.props.onPress());
    expect(onChange).toHaveBeenLastCalledWith(["role:r-rush"]);
  });
});
