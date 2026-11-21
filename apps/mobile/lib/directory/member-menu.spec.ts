import { Alert } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmRemoveMember,
  memberMenuActions,
  showMemberMenu,
} from "./member-menu";
import {
  currentItemMenu,
  dismissItemMenu,
  pickItemMenuAction,
} from "@/components/item-actions-menu";

type AlertButton = { text?: string; style?: string; onPress?: () => void };

function lastAlert() {
  const call = vi.mocked(Alert.alert).mock.calls.at(-1)!;
  return { title: call[0], buttons: (call[2] ?? []) as AlertButton[] };
}

describe("memberMenuActions", () => {
  it("offers Block, then Remove where the API allows it", () => {
    expect(
      memberMenuActions({ canBlock: true, isBlocked: false, canRemove: true }),
    ).toEqual(["block", "remove"]);
  });

  it("offers Unblock for a member you blocked", () => {
    expect(
      memberMenuActions({ canBlock: true, isBlocked: true, canRemove: false }),
    ).toEqual(["unblock"]);
  });

  it("holds nothing on your own profile", () => {
    expect(
      memberMenuActions({
        canBlock: false,
        isBlocked: false,
        canRemove: false,
      }),
    ).toEqual([]);
  });
});

describe("showMemberMenu", () => {
  afterEach(() => {
    dismissItemMenu();
    vi.mocked(Alert.alert).mockClear();
  });

  it("lists each action, destructive ones marked, and runs the one tapped", () => {
    const onPick = vi.fn();
    showMemberMenu("Ada", ["unblock", "block", "remove"], onPick);

    const menu = currentItemMenu()!;
    expect(menu.title).toBe("Ada");
    expect(
      menu.actions.map((action) => [action.label, action.destructive]),
    ).toEqual([
      ["Unblock Ada", false],
      ["Block Ada", true],
      ["Remove from chapter", true],
    ]);
    expect(Alert.alert).not.toHaveBeenCalled();
    pickItemMenuAction("Remove from chapter");
    expect(onPick).toHaveBeenCalledWith("remove");
    expect(currentItemMenu()).toBeNull();
  });

  it("picks nothing when it is dismissed", () => {
    const onPick = vi.fn();
    showMemberMenu("Ada", ["block"], onPick);
    dismissItemMenu();
    expect(onPick).not.toHaveBeenCalled();
    expect(currentItemMenu()).toBeNull();
  });

  it("opens nothing with nothing to offer", () => {
    showMemberMenu("Ada", [], vi.fn());
    expect(currentItemMenu()).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe("confirmRemoveMember", () => {
  it("asks first, and removes only from its destructive button", () => {
    const run = vi.fn();
    confirmRemoveMember({ name: "Ada", run });
    const { title, buttons } = lastAlert();
    expect(title).toBe("Remove Ada from the chapter?");
    expect(run).not.toHaveBeenCalled();
    expect(buttons.map((b) => b.text)).toEqual([
      "Cancel",
      "Remove from chapter",
    ]);
    buttons[1]!.onPress!();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
