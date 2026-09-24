import { Alert } from "react-native";

/**
 * The one account-deletion prompt, shared by every surface that offers it.
 *
 * Apple 5.1.1(v) requires in-app deletion wherever an account can be created,
 * and Frapp creates accounts implicitly on first sign-in — so the control has
 * to exist on more than one screen (Settings for a member with a chapter, the
 * join screen for the zero-membership state that cannot reach Settings at all,
 * #2295, and the Terms prompt for a member the gate holds there, #2302).
 * Several screens offering the same destructive action is exactly how copy
 * drifts, so the strings and the confirm/fail choreography live here once
 * rather than being written a second time.
 *
 * `Alert.alert` with a destructive button is required by the native-feel table
 * in `spec/ui/mobile/README.md`; `window.confirm` is banned everywhere.
 */

export const DELETE_ACCOUNT_CONFIRM_TITLE = "Delete account?";

export const DELETE_ACCOUNT_CONFIRM_BODY =
  "This cannot be undone. Your profile and contact details are erased; " +
  "chapter history you took part in stays, anonymized as “Deleted User”. " +
  "See the Privacy Policy for what is kept and for how long.";

export const DELETE_ACCOUNT_FAILURE_TITLE = "Deletion didn't finish";

/**
 * The endpoint documents a 502 as "did not finish", and every step is
 * idempotent — so the instruction is retry. It must not also say the account is
 * intact: media is purged and PII is scrubbed *before* the auth record is
 * deleted, so a failure after that point has already destroyed the profile.
 * Telling someone "nothing is lost" there would talk them out of the retry that
 * finishes the job.
 */
export const DELETE_ACCOUNT_FAILURE_BODY =
  "Part of it may already have gone through, and running it again is safe. Try once more in a moment.";

/**
 * The shape `useDeleteAccount()` satisfies. Declared structurally rather than
 * imported so this module stays free of TanStack Query types — the specs drive
 * it with a stub, and the prompt genuinely does not care what produced the
 * mutation.
 */
export type DeleteAccountMutation = {
  mutateAsync: (variables?: undefined) => Promise<unknown>;
};

export type ConfirmDeleteAccountOptions = {
  deleteAccount: DeleteAccountMutation;
  /**
   * Run once the account is gone. Every caller signs out here — the session
   * outlives the account by a moment, and leaving the user on a screen backed
   * by a deleted account is how you get an unrecoverable 401 loop. This runs
   * even if the screen that started the deletion has since unmounted, which is
   * the whole reason the call below is `mutateAsync`.
   */
  onDeleted: () => void;
};

export function confirmDeleteAccount({
  deleteAccount,
  onDeleted,
}: ConfirmDeleteAccountOptions): void {
  Alert.alert(DELETE_ACCOUNT_CONFIRM_TITLE, DELETE_ACCOUNT_CONFIRM_BODY, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Delete",
      style: "destructive",
      onPress: () => {
        // `mutateAsync`, never `mutate(…, { onSuccess })`. TanStack gates the
        // per-call callbacks on `hasListeners()`
        // (`mutationObserver.ts` — `#notify`), so they are silently skipped
        // once the screen unmounts, while `execute()`'s promise resolves
        // either way. A back gesture or hardware Back can unmount mid-delete
        // — `/join` has back-stack history whenever the chapter picker pushed
        // it, and disabling the screen's own controls cannot block native
        // navigation. With the callback form, the account was deleted
        // server-side and `onDeleted` never ran, leaving the deleted account's
        // Supabase session and cached data live on the device.
        void (async () => {
          try {
            await deleteAccount.mutateAsync(undefined);
            onDeleted();
          } catch {
            // Always the native alert. An earlier revision let a caller route
            // this into its own UI; the join screen did, and its error slot is
            // cleared on every keystroke, so the retry instruction vanished on
            // the one flow whose entire contract is retry. The alert also
            // announces itself and survives navigation.
            Alert.alert(
              DELETE_ACCOUNT_FAILURE_TITLE,
              DELETE_ACCOUNT_FAILURE_BODY,
            );
          }
        })();
      },
    },
  ]);
}
