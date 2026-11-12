/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORRECTION_NAME_REQUIRED_MESSAGE,
  PROFILE_FIELD_COPY,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * An officer's fix to another member's name and graduation year (#4367): it
 * opens on the stored values, sends only what changed for this membership,
 * refuses a blank name before sending, keeps the draft when a save fails,
 * and closes once the save lands.
 */

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => ({ data: undefined }),
  useCorrectMemberProfile: () => ({
    mutate: state.mutate,
    isPending: state.isPending,
  }),
}));

import {
  MemberCorrectionSheet,
  type MemberCorrectionSession,
} from "./member-correction-sheet";
import { SheetPrimaryButton } from "@/components/sheet-scaffold";

const SESSION: MemberCorrectionSession = {
  memberId: "m-ada",
  label: "Ada",
  name: "Ada",
  graduationYear: 2026,
};

const dismiss = vi.fn();

function render(session: MemberCorrectionSession = SESSION): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MemberCorrectionSheet
          ref={React.createRef<
            React.ComponentRef<typeof MemberCorrectionSheet>
          >()}
          session={session}
        />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          element.type === "BottomSheetModal" ? { dismiss } : null,
      },
    );
  });
  act(() =>
    tree.root.findByType("BottomSheetModal" as never).props.onAnimate(-1, 0),
  );
  return tree;
}

function field(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "BottomSheetTextInput" &&
      node.props.accessibilityLabel === label,
  );
}
const nameField = (tree: ReactTestRenderer) =>
  field(tree, PROFILE_FIELD_COPY.displayName.label);
const yearField = (tree: ReactTestRenderer) =>
  field(tree, PROFILE_FIELD_COPY.graduationYear.accessibleLabel);

function save(tree: ReactTestRenderer) {
  act(() => tree.root.findByType(SheetPrimaryButton).props.onPress());
}

function alerts(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Text" &&
      node.props.accessibilityRole === "alert",
  );
}

describe("MemberCorrectionSheet (#4367)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isPending = false;
  });

  it("opens on the member's stored name and year", () => {
    const tree = render();
    expect(nameField(tree).props.value).toBe("Ada");
    expect(yearField(tree).props.value).toBe("2026");
    act(() => tree.unmount());
  });

  it("opens a member with no stored name on a blank field", () => {
    const tree = render({ ...SESSION, label: "Member 1a2b3c4d", name: "" });
    expect(nameField(tree).props.value).toBe("");
    act(() => tree.unmount());
  });

  it("sends only what changed, for this membership", () => {
    const tree = render();
    act(() => yearField(tree).props.onChangeText("2027"));
    save(tree);

    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0]![0]).toEqual({
      id: "m-ada",
      graduation_year: 2027,
    });
    act(() => tree.unmount());
  });

  it("closes without sending when nothing changed", () => {
    const tree = render();
    save(tree);
    expect(state.mutate).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("refuses a blank name on Save, not on the keystroke, and sends nothing", () => {
    const tree = render();
    act(() => nameField(tree).props.onChangeText("  "));
    expect(alerts(tree)).toHaveLength(0);
    save(tree);

    expect(state.mutate).not.toHaveBeenCalled();
    expect(alerts(tree)[0]!.props.children).toBe(
      CORRECTION_NAME_REQUIRED_MESSAGE,
    );
    act(() => tree.unmount());
  });

  it("keeps the draft and says why when the save fails", () => {
    const tree = render();
    act(() => nameField(tree).props.onChangeText("Ada Lovelace"));
    save(tree);
    const callbacks = state.mutate.mock.calls[0]![1] as {
      onError: (error: unknown) => void;
      onSettled: () => void;
    };
    act(() => {
      callbacks.onError(new Error("network"));
      callbacks.onSettled();
    });

    expect(nameField(tree).props.value).toBe("Ada Lovelace");
    expect(alerts(tree)).toHaveLength(1);
    expect(dismiss).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("closes once the save lands", () => {
    const tree = render();
    act(() => nameField(tree).props.onChangeText("Ada Lovelace"));
    save(tree);
    const callbacks = state.mutate.mock.calls[0]![1] as {
      onSuccess: () => void;
      onSettled: () => void;
    };
    act(() => {
      callbacks.onSuccess();
      callbacks.onSettled();
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});
