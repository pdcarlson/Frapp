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

/**
 * One light tick, for a choice made: adding or taking back a reaction
 * (`spec/ui/mobile/README.md` § Native-feel rules). Fired once per tap, by the
 * handler that sends the request, never from a render or a rollback.
 *
 * Best effort and silent, as `successHaptic` is.
 */
export function selectionHaptic(): void {
  try {
    void Haptics.selectionAsync().catch(() => undefined);
  } catch {
    // The native module is missing; there is nothing to feel.
  }
}

/**
 * One firm tap, for a long press that opens a menu (a channel row on s04),
 * the feel a long press has anywhere else on the phone.
 *
 * Best effort and silent, as `successHaptic` is.
 */
export function pressHaptic(): void {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
      () => undefined,
    );
  } catch {
    // The native module is missing; there is nothing to feel.
  }
}
