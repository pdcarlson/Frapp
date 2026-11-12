/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_NUMBER_INVALID_MESSAGE } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * The class editor behind a member's profile (#3991): it opens on the saved
 * values, sends the class and number together in one assignment, refuses a
 * number the API would refuse before sending, and keeps the draft with the
 * reason when a save fails.
 */

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => ({ data: undefined }),
  usePledgeClasses: () => ({
    data: [
      { id: "pc-1", name: "Alpha" },
      { id: "pc-2", name: "Beta" },
    ],
    isPending: false,
    isError: false,
  }),
  useAssignPledgeClasses: () => ({
    mutate: state.mutate,
    isPending: state.isPending,
  }),
}));

import {
  MemberClassSheet,
  type MemberClassSession,
} from "./member-class-sheet";
import { SheetPrimaryButton } from "@/components/sheet-scaffold";

const SESSION: MemberClassSession = {
  memberId: "m-ada",
  name: "Ada",
  pledgeClassId: "pc-1",
  orderNumber: 4,
};

function render(session: MemberClassSession = SESSION): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MemberClassSheet session={session} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function numberField(tree: ReactTestRenderer) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "BottomSheetTextInput" &&
      node.props.accessibilityLabel === "Fraternal order",
  );
}

function option(tree: ReactTestRenderer, name: string) {
  return tree.root.find(
    (node) =>
      node.props.accessibilityRole === "radio" &&
      node.props.accessibilityLabel === name &&
      typeof node.props.onPress === "function",
  );
}

function saveButton(tree: ReactTestRenderer) {
  return tree.root.findByType(SheetPrimaryButton);
}

function texts(tree: ReactTestRenderer): unknown[] {
  return tree.root
    .findAll((node) => (node.type as unknown) === "Text")
    .map((node) => node.props.children);
}

describe("MemberClassSheet (#3991)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isPending = false;
  });

  it("opens on the member's saved class and number, with Save off", () => {
    const tree = render();
    expect(numberField(tree).props.value).toBe("4");
    expect(option(tree, "Alpha").props.accessibilityState.selected).toBe(true);
    expect(option(tree, "None").props.accessibilityState.selected).toBe(false);
    expect(saveButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("sends the class and the number together for this member", () => {
    const tree = render();
    act(() => option(tree, "Beta").props.onPress());
    act(() => numberField(tree).props.onChangeText("12"));
    expect(saveButton(tree).props.disabled).toBe(false);
    act(() => saveButton(tree).props.onPress());

    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0]![0]).toEqual([
      { member_id: "m-ada", pledge_class_id: "pc-2", order_number: 12 },
    ]);
    act(() => tree.unmount());
  });

  it("clears both with None and a blank number", () => {
    const tree = render();
    act(() => option(tree, "None").props.onPress());
    act(() => numberField(tree).props.onChangeText(""));
    act(() => saveButton(tree).props.onPress());

    expect(state.mutate.mock.calls[0]![0]).toEqual([
      { member_id: "m-ada", pledge_class_id: null, order_number: null },
    ]);
    act(() => tree.unmount());
  });

  it("refuses a number the API would refuse, and sends nothing", () => {
    const tree = render();
    act(() => numberField(tree).props.onChangeText("0"));
    // Not on the keystroke: only once the field is left or Save is pressed.
    expect(texts(tree)).not.toContain(ORDER_NUMBER_INVALID_MESSAGE);
    act(() => saveButton(tree).props.onPress());

    expect(state.mutate).not.toHaveBeenCalled();
    expect(texts(tree)).toContain(ORDER_NUMBER_INVALID_MESSAGE);
    act(() => tree.unmount());
  });

  it("keeps the draft and says why when the save fails", () => {
    const tree = render();
    act(() => numberField(tree).props.onChangeText("7"));
    act(() => saveButton(tree).props.onPress());
    const callbacks = state.mutate.mock.calls[0]![1] as {
      onError: (error: unknown) => void;
      onSettled: () => void;
    };
    act(() => {
      callbacks.onError(new Error("network"));
      callbacks.onSettled();
    });

    expect(numberField(tree).props.value).toBe("7");
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" &&
          node.props.accessibilityRole === "alert",
      ),
    ).toHaveLength(1);
    act(() => tree.unmount());
  });
});
