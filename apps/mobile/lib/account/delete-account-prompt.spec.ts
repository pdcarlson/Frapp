import { Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmDeleteAccount,
  DELETE_ACCOUNT_CONFIRM_BODY,
  DELETE_ACCOUNT_CONFIRM_TITLE,
  DELETE_ACCOUNT_FAILURE_BODY,
  DELETE_ACCOUNT_FAILURE_TITLE,
  type DeleteAccountMutation,
} from "./delete-account-prompt";

/**
 * #2295. This module exists because account deletion is offered from two
 * screens — Settings, and the join screen a zero-membership account cannot
 * escape — and Apple 5.1.1(v) is satisfied only if both actually delete. The
 * properties worth pinning are the ones a second hand-written copy would get
 * wrong: the confirm is destructive and cancellable, nothing is deleted until
 * the destructive button is pressed, and a failure is never silent.
 */

type AlertButton = { text: string; style?: string; onPress?: () => void };

function lastAlertCall() {
  const calls = vi.mocked(Alert.alert).mock.calls;
  return calls[calls.length - 1];
}

function pressDelete() {
  const buttons = lastAlertCall()?.[2] as AlertButton[] | undefined;
  const destructive = buttons?.find((button) => button.style === "destructive");
  if (!destructive?.onPress) {
    throw new Error("no destructive button was offered");
  }
  destructive.onPress();
}

function stubMutation(
  behaviour: "success" | "error" | "never",
): DeleteAccountMutation {
  return {
    mutate: vi.fn((_variables, options) => {
      if (behaviour === "success") options.onSuccess();
      if (behaviour === "error") options.onError();
    }),
  };
}

describe("confirmDeleteAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("confirms before deleting anything", () => {
    const deleteAccount = stubMutation("never");
    confirmDeleteAccount({ deleteAccount, onDeleted: vi.fn() });

    const [title, body] = lastAlertCall() ?? [];
    expect(title).toBe(DELETE_ACCOUNT_CONFIRM_TITLE);
    expect(body).toBe(DELETE_ACCOUNT_CONFIRM_BODY);
    // Comparing the alert's arguments to the same constants the implementation
    // passes proves only that they were forwarded. These pin what the user is
    // actually told, so a copy edit cannot quietly drop the irreversibility
    // warning, the anonymization disclosure or the retention pointer —
    // the three things App Review was shown and `spec/behavior/data-retention.md`
    // documents.
    expect(body).toMatch(/cannot be undone/i);
    expect(body).toMatch(/Deleted User/);
    expect(body).toMatch(/Privacy Policy/i);
    // The account survives merely opening the dialog.
    expect(deleteAccount.mutate).not.toHaveBeenCalled();
  });

  it("offers a cancel and a destructive button, in that order", () => {
    confirmDeleteAccount({
      deleteAccount: stubMutation("never"),
      onDeleted: vi.fn(),
    });

    const buttons = lastAlertCall()?.[2] as AlertButton[];
    expect(buttons.map((button) => button.style)).toEqual([
      "cancel",
      "destructive",
    ]);
    // Cancel must not carry an action — a cancel that deletes is the worst
    // possible bug on this dialog.
    expect(buttons[0]?.onPress).toBeUndefined();
  });

  it("deletes and then hands control back, once confirmed", () => {
    const deleteAccount = stubMutation("success");
    const onDeleted = vi.fn();
    confirmDeleteAccount({ deleteAccount, onDeleted });

    pressDelete();

    expect(deleteAccount.mutate).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("does not sign the user out when deletion fails", () => {
    const onDeleted = vi.fn();
    confirmDeleteAccount({ deleteAccount: stubMutation("error"), onDeleted });

    pressDelete();

    // Signing out on failure would strand the user: they could no longer reach
    // the control to retry, and the endpoint's whole contract is "retry".
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("surfaces a retryable failure natively when the caller has no slot", () => {
    confirmDeleteAccount({
      deleteAccount: stubMutation("error"),
      onDeleted: vi.fn(),
    });

    pressDelete();

    const [title, body] = lastAlertCall() ?? [];
    expect(title).toBe(DELETE_ACCOUNT_FAILURE_TITLE);
    expect(body).toBe(DELETE_ACCOUNT_FAILURE_BODY);
    // It says retry, and never claims the account is intact — PII is scrubbed
    // before the auth record goes, so "nothing was lost" would be a lie that
    // talks the user out of the retry that finishes the job.
    expect(body).toMatch(/running it again is safe/i);
  });

  it("lets a caller route the failure into its own error slot instead", () => {
    const onError = vi.fn();
    confirmDeleteAccount({
      deleteAccount: stubMutation("error"),
      onDeleted: vi.fn(),
      onError,
    });

    pressDelete();

    expect(onError).toHaveBeenCalledTimes(1);
    // Exactly one alert — the confirm. The override replaces the native
    // failure alert rather than stacking a second dialog on the first.
    expect(vi.mocked(Alert.alert)).toHaveBeenCalledTimes(1);
  });
});
