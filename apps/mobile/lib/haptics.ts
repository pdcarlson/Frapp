import * as Haptics from "expo-haptics";

/**
 * One success tap, for a moment worth marking: a chapter going live (#3351),
 * or a member landing in one from an invite (s02 join).
 *
 * Best effort and silent. A device with no haptic engine, a member who turned
 * system haptics off, or a web build all just get nothing, and nothing here
 * can throw into the screen that called it.
 */
export function successHaptic(): void {
  try {
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => undefined);
  } catch {
    // The native module is missing; there is nothing to feel.
  }
}
