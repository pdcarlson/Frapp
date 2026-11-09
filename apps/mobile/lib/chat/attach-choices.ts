import { ActionSheetIOS, Alert, Platform } from "react-native";

/**
 * What the composer's + offers (#3701): a photo, and a poll for a member who
 * may create one. Each is offered only while it can work right now. With one
 * choice the + does it straight away, which keeps the + exactly what it was
 * for a member who can't make polls: it opens the photo library.
 */
export const PHOTO_CHOICE = "Photo";
export const POLL_CHOICE = "Poll";

export interface AttachChoice {
  label: string;
  run: () => void;
}

export function attachChoices({
  photo,
  poll,
}: {
  /** Set while a photo can be attached now; opens the library. */
  photo?: () => void;
  /** Set while a poll can be started now; opens the New poll sheet. */
  poll?: () => void;
}): AttachChoice[] {
  const choices: AttachChoice[] = [];
  if (photo) choices.push({ label: PHOTO_CHOICE, run: photo });
  if (poll) choices.push({ label: POLL_CHOICE, run: poll });
  return choices;
}

/**
 * Offers the choices as the platform's own menu, as the profile photo's
 * Choose or Remove does: the action sheet on iOS, an alert on Android (which
 * fits Cancel and two choices, all this ever offers). No choices does nothing;
 * one runs at once.
 */
export function presentAttachChoices(
  choices: readonly AttachChoice[],
  platform: string = Platform.OS,
): void {
  if (choices.length === 0) return;
  if (choices.length === 1) {
    choices[0]!.run();
    return;
  }
  if (platform === "ios") {
    const options = [...choices.map((choice) => choice.label), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: options.length - 1,
        userInterfaceStyle: "dark",
      },
      (index) => choices[index]?.run(),
    );
    return;
  }
  Alert.alert(
    "Add to the conversation",
    undefined,
    [
      { text: "Cancel", style: "cancel" },
      ...choices.map((choice) => ({ text: choice.label, onPress: choice.run })),
    ],
    { cancelable: true },
  );
}
