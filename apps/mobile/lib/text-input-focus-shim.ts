import { Platform, TextInput } from "react-native";

/**
 * Expo web only: gives react-native-web's `TextInput.State` the
 * `currentlyFocusedInput()` that React Native has and react-native-web lacks
 * (#5061).
 *
 * ## Why
 *
 * `@gorhom/bottom-sheet`'s `BottomSheetTextInput` (5.2.14, the latest release)
 * calls `TextInput.State.currentlyFocusedInput()` when a field blurs, to tell
 * whether focus moved to another field in the same sheet. react-native-web's
 * `TextInput.State` only has the older `currentlyFocusedField()`, so on the
 * Expo web build every sheet with a text field threw
 * `currentlyFocusedInput is not a function` as soon as focus left a field.
 * expo-router's stack keyboard manager calls the same method when a swipe-back
 * begins.
 *
 * ## What it does
 *
 * Both readers want the focused field (or `null`), and react-native-web's
 * `currentlyFocusedField()` returns that DOM node, so the shim delegates to
 * it. expo-router calls `.blur()` / `.focus()` on it, which a DOM input has.
 * The sheet reads it inside `onBlur`, by which point react-native-web has
 * already cleared the focused node, so on web it always gets `null` there: it
 * clears its keyboard target, and the next field's `onFocus` sets it again.
 * That is harmless on web, where no keyboard lifts the sheet. One shim at app
 * start covers every sheet, instead of a wrapper imported in each.
 *
 * It only fills a gap: when `currentlyFocusedInput` already exists it is left
 * alone, and it is installed only when `Platform.OS === "web"`, so iOS and
 * Android keep React Native's own implementation untouched.
 */

type TextInputStateLike = {
  currentlyFocusedInput?: () => unknown;
  currentlyFocusedField?: () => unknown;
};

/** Returns whether it installed the shim. */
export function installTextInputFocusShim(textInput: {
  State?: TextInputStateLike;
}): boolean {
  const state = textInput.State;
  if (!state || typeof state.currentlyFocusedInput === "function") {
    return false;
  }
  if (typeof state.currentlyFocusedField !== "function") return false;
  // Called through `state` so `this` is react-native-web's TextInputState,
  // which `currentlyFocusedField` reads.
  state.currentlyFocusedInput = () => state.currentlyFocusedField?.() ?? null;
  return true;
}

if (Platform.OS === "web") {
  installTextInputFocusShim(
    TextInput as unknown as { State?: TextInputStateLike },
  );
}
