/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { AccessibilityInfo, BackHandler, StyleSheet } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import * as Haptics from "expo-haptics";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import {
  ItemActionsMenu,
  itemMenuAccessibility,
  longPressOf,
  useItemMenu,
  type ItemMenu,
  type ItemMenuHandle,
} from "@/components/item-actions-menu";

/**
 * The long-press item menu (#5492), chat home's glass menu with a row's
 * actions in it: destructive last and apart, a pick closes then runs, and a
 * screen reader gets every action by name.
 */

const run = { edit: vi.fn(), delete: vi.fn(), duplicate: vi.fn() };
const MENU: ItemMenu = {
  title: "Sweep the porch",
  actions: [
    {
      key: "delete",
      label: "Delete",
      destructive: true,
      glyph: () => null,
      run: run.delete,
    },
    { key: "edit", label: "Edit", glyph: () => null, run: run.edit },
    {
      key: "duplicate",
      label: "Duplicate",
      glyph: () => null,
      run: run.duplicate,
    },
  ],
};

function render(onClose = vi.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ItemActionsMenu target={{ ...MENU, pageY: 200 }} onClose={onClose} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const items = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityRole === "menuitem",
  );

describe("ItemActionsMenu", () => {
  it("names what was pressed, and draws Delete last, red, under the break", () => {
    const tree = render();
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" &&
          node.props.children === "Sweep the porch",
      ),
    ).toHaveLength(1);
    const rows = items(tree);
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      "Edit",
      "Duplicate",
      "Delete",
    ]);
    const deleteStyle = StyleSheet.flatten(
      rows[2]!.props.style({ pressed: false }),
    );
    expect(deleteStyle.borderTopWidth).toBe(6);
    const deleteLabel = rows[2]!.findByType("Text" as never);
    expect(StyleSheet.flatten(deleteLabel.props.style).color).toBe(
      signetDarkTokens.color.semantic.destructiveText,
    );
    // The first row sits under the caption with no rule.
    expect(
      StyleSheet.flatten(rows[0]!.props.style({ pressed: false }))
        .borderTopWidth,
    ).toBeUndefined();
    act(() => tree.unmount());
  });

  it("closes, then runs the pick", () => {
    const order: string[] = [];
    const onClose = vi.fn(() => order.push("close"));
    run.edit.mockImplementation(() => order.push("run"));
    const tree = render(onClose);
    act(() => items(tree)[0]!.props.onPress());
    expect(order).toEqual(["close", "run"]);
    act(() => tree.unmount());
  });

  it("closes on a tap outside and on Android's back", () => {
    const onClose = vi.fn();
    const tree = render(onClose);
    const backdrop = tree.root.find(
      (node) => node.props.testID === "item-actions-backdrop",
    );
    act(() => backdrop.props.onPress());
    // Drawn in the app's own tree (#5517), so back is a listener it holds.
    const [, back] = vi
      .mocked(BackHandler.addEventListener)
      .mock.calls.at(-1) as unknown as [string, () => boolean];
    expect(back()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(
      tree.root.findAll((node) => (node.type as unknown) === "Modal"),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });
});

describe("useItemMenu", () => {
  it("opens at the press with the long press's tick, and gives no handle for nothing to do", () => {
    let handle: ItemMenuHandle | null = null;
    let empty: ItemMenuHandle | null = null;
    function Host() {
      const menu = useItemMenu();
      handle = menu.handleFor(MENU);
      empty = menu.handleFor({ title: "Nothing", actions: [] });
      return <>{menu.element}</>;
    }
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <Host />
        </FrappThemeProvider>,
      );
    });
    expect(empty).toBeNull();
    expect(longPressOf(empty)).toBeUndefined();
    act(() => longPressOf(handle)!({ nativeEvent: { pageY: 410 } } as never));
    expect(Haptics.impactAsync).toHaveBeenCalled();
    expect(tree.root.findByType(ItemActionsMenu).props.target).toMatchObject({
      title: "Sweep the porch",
      pageY: 410,
    });
    act(() => tree.unmount());
  });

  it("moves a screen reader's focus to the caption on open, and back to the pressed row on close", () => {
    vi.useFakeTimers();
    const focusEvents = vi.mocked(AccessibilityInfo.sendAccessibilityEvent);
    focusEvents.mockClear();
    try {
      let handle: ItemMenuHandle | null = null;
      function Host() {
        const menu = useItemMenu();
        handle = menu.handleFor(MENU);
        return <>{menu.element}</>;
      }
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <FrappThemeProvider>
            <Host />
          </FrappThemeProvider>,
          // Host refs resolve to a stand-in naming their element.
          { createNodeMock: (node) => ({ element: node }) },
        );
      });
      const row = { row: "Sweep the porch" };
      act(() =>
        longPressOf(handle)!({
          nativeEvent: { pageY: 410 },
          currentTarget: row,
        } as never),
      );
      act(() => vi.runAllTimers());
      const [target, kind] = focusEvents.mock.calls.at(-1) as unknown as [
        { element: { props: { children?: unknown } } },
        string,
      ];
      expect(kind).toBe("focus");
      expect(target.element.props.children).toBe("Sweep the porch");

      focusEvents.mockClear();
      act(() =>
        tree.root
          .find((node) => node.props.testID === "item-actions-backdrop")
          .props.onPress(),
      );
      act(() => vi.runAllTimers());
      expect(focusEvents).toHaveBeenCalledWith(row, "focus");
      act(() => tree.unmount());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("itemMenuAccessibility", () => {
  it("offers the row's own actions, then the menu's, each once, and runs them by name", () => {
    const toggle = vi.fn();
    const handle = { ...MENU, open: vi.fn() };
    const props = itemMenuAccessibility(handle, [
      { name: "toggle", label: "Edit", run: toggle },
    ]);
    // The menu's Edit has the row's own words, so it is offered once.
    expect(props.accessibilityActions).toEqual([
      { name: "toggle", label: "Edit" },
      { name: "menu:delete", label: "Delete" },
      { name: "menu:duplicate", label: "Duplicate" },
    ]);
    props.onAccessibilityAction!({
      nativeEvent: { actionName: "menu:duplicate" },
    } as never);
    props.onAccessibilityAction!({
      nativeEvent: { actionName: "toggle" },
    } as never);
    expect(run.duplicate).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(itemMenuAccessibility(null)).toEqual({});
  });
});
