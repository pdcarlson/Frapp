/**
 * The member profile sheet's `⋯` menu (s13): what a viewer reaches for only
 * now and then, kept off the profile's face (Paul, 2026-11-11: nobody opens a
 * profile to remove someone, and web drew Remove member as a big red button
 * on his own profile). Block or Unblock for another member, and Remove from
 * chapter where the API says this viewer may (`viewer_can_remove`). Never on
 * your own profile: the sheet offers neither there, so the `⋯` isn't drawn.
 */
import { ActionSheetIOS, Alert, Platform } from "react-native";
import { blockActionLabel } from "@repo/chat-core/block-copy";
import {
  REMOVE_CONFIRM_BODY,
  REMOVE_FROM_CHAPTER_LABEL,
  removeConfirmTitle,
} from "@repo/hooks/member-removal-copy";

export type MemberMenuAction = "block" | "unblock" | "remove";

/** The menu's rows, in order, or none when the `⋯` has nothing to hold. */
export function memberMenuActions({
  canBlock,
  isBlocked,
  canRemove,
}: {
  /** Another real member, not the viewer or the system actor. */
  canBlock: boolean;
  isBlocked: boolean;
  /** The API's `viewer_can_remove`, already false on the viewer's own profile. */
  canRemove: boolean;
}): MemberMenuAction[] {
  const actions: MemberMenuAction[] = [];
  if (canBlock) actions.push(isBlocked ? "unblock" : "block");
  if (canRemove) actions.push("remove");
  return actions;
}

/** A row's label: `Block <name>` is `block-copy`'s on every surface. */
export function memberMenuLabel(
  action: MemberMenuAction,
  name: string,
): string {
  switch (action) {
    case "block":
      return blockActionLabel(name);
    case "unblock":
      return `Unblock ${name}`;
    case "remove":
      return REMOVE_FROM_CHAPTER_LABEL;
  }
}

const DESTRUCTIVE: ReadonlySet<MemberMenuAction> = new Set(["block", "remove"]);

/**
 * Opens the menu: the iOS action sheet, or Android's dialog, whose Cancel is
 * a tap outside or back (`cancelable`), as the Invited list's menu does.
 */
export function showMemberMenu(
  name: string,
  actions: readonly MemberMenuAction[],
  onPick: (action: MemberMenuAction) => void,
): void {
  if (actions.length === 0) return;
  const labels = actions.map((action) => memberMenuLabel(action, name));
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: name,
        options: [...labels, "Cancel"],
        destructiveButtonIndex: actions
          .map((action, index) => (DESTRUCTIVE.has(action) ? index : -1))
          .filter((index) => index >= 0),
        cancelButtonIndex: labels.length,
        userInterfaceStyle: "dark",
      },
      (index) => {
        const picked = actions[index];
        if (picked) onPick(picked);
      },
    );
    return;
  }
  Alert.alert(
    name,
    undefined,
    actions.map((action, index) => ({
      text: labels[index],
      style: DESTRUCTIVE.has(action)
        ? ("destructive" as const)
        : ("default" as const),
      onPress: () => onPick(action),
    })),
    { cancelable: true },
  );
}

/**
 * Asks before removing, as web's confirm dialog does: Cancel, then the
 * destructive verb naming its object.
 */
export function confirmRemoveMember({
  name,
  run,
}: {
  name: string;
  run: () => void;
}): void {
  Alert.alert(removeConfirmTitle(name), REMOVE_CONFIRM_BODY, [
    { text: "Cancel", style: "cancel" },
    { text: REMOVE_FROM_CHAPTER_LABEL, style: "destructive", onPress: run },
  ]);
}
