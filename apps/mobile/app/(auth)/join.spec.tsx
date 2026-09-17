/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import {
  DELETE_ACCOUNT_FAILURE_BODY,
  DELETE_ACCOUNT_FAILURE_TITLE,
} from "@/lib/account/delete-account-prompt";

/**
 * #2295 — Apple 5.1.1(v).
 *
 * An account with zero chapter memberships is pinned to this screen:
 * `resolveAuthGate` returns `"join"` (covered in `lib/auth-gate.spec.ts`) and
 * `useOnboardingRedirect`, mounted app-wide by `components/app-runtime.tsx`,
 * replaces every other path with `/join` — that hook is what makes Settings
 * unreachable, since the frozen `(tabs)` layout resolves the gate without
 * memberships and never redirects itself. Settings is the other place account
 * deletion is offered, so if the control is not on *this* screen it does not
 * exist for that account at all.
 *
 * That is what these pin: the affordance is rendered here, it is destructive
 * and confirmed, it actually calls the endpoint, and a failure neither signs
 * the user out nor disappears.
 */

const signOut = vi.fn().mockResolvedValue(undefined);
const mutateAsync = vi.fn();
let isPending = false;
let isSuccess = false;

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ status: "authenticated", signOut }),
}));

vi.mock("@/lib/select-chapter", () => ({
  useSelectChapter: () => vi.fn().mockResolvedValue(true),
}));

vi.mock("@repo/hooks", () => ({
  useRedeemInvite: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteAccount: () => ({ isPending, isSuccess, mutateAsync }),
}));

import JoinChapter from "./join";

type Node = ReactTestRenderer["root"];
type AlertButton = { text: string; style?: string; onPress?: () => void };

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <JoinChapter />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/**
 * The pressable whose rendered text is `label`, by walking its subtree.
 *
 * `"Pressable" as never` is the cast `components/tasks/task-row.spec.tsx` uses
 * for the same reason: `vitest.setup.ts` mocks react-native's host components
 * as plain strings, but `tsc` resolves the real react-native types, where
 * `node.type` is never those strings.
 */
function control(root: Node, label: string) {
  return root
    .findAllByType("Pressable" as never, { deep: true })
    .find((pressable) =>
      pressable
        .findAllByType("Text" as never, { deep: true })
        .some((text) =>
          JSON.stringify(text.props.children ?? "").includes(label),
        ),
    );
}

function confirmButtons(): AlertButton[] {
  const calls = vi.mocked(Alert.alert).mock.calls;
  return (calls[calls.length - 1]?.[2] ?? []) as AlertButton[];
}

describe("join screen — account deletion (5.1.1(v))", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
  });

  it("offers account deletion on the screen a zero-membership account is pinned to", () => {
    const tree = render();
    // The trap itself: the same account cannot reach Settings, so this control
    // being present here is the whole of the 5.1.1(v) compliance.
    expect(control(tree.root, "Delete account")).toBeDefined();
    // And the screen still does its own job.
    expect(control(tree.root, "Join chapter")).toBeDefined();
    expect(control(tree.root, "Sign out")).toBeDefined();
  });

  it("confirms before deleting, and does not delete on cancel", () => {
    const tree = render();

    act(() => {
      control(tree.root, "Delete account")?.props.onPress();
    });

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(confirmButtons().map((button) => button.style)).toEqual([
      "cancel",
      "destructive",
    ]);
  });

  it("deletes and signs out once confirmed, even if the screen is gone", async () => {
    mutateAsync.mockResolvedValue({});
    const tree = render();

    act(() => {
      control(tree.root, "Delete account")?.props.onPress();
    });
    act(() => {
      confirmButtons().find((b) => b.style === "destructive")?.onPress?.();
    });
    // The sign-out hangs off `mutateAsync`'s promise, not a per-call callback,
    // so it still runs after a back gesture unmounts this screen — which
    // `/join` can have, since the chapter picker pushes to it.
    tree.unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("reports a failure through the shared alert and stays signed in", async () => {
    mutateAsync.mockRejectedValue(new Error("502"));
    const tree = render();

    act(() => {
      control(tree.root, "Delete account")?.props.onPress();
    });
    act(() => {
      confirmButtons().find((b) => b.style === "destructive")?.onPress?.();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Still signed in — the endpoint is idempotent and the instruction is
    // retry, which a signed-out user could not follow.
    expect(signOut).not.toHaveBeenCalled();
    // Two alerts: the confirm, then the failure. The failure deliberately does
    // NOT go to this screen's `error` slot — that slot is cleared on every
    // keystroke and every join attempt, so the retry instruction would be
    // erased by the user's next tap. It also has to announce itself, which a
    // plain Text does not.
    const calls = vi.mocked(Alert.alert).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[0]).toBe(DELETE_ACCOUNT_FAILURE_TITLE);
    expect(calls[1]?.[1]).toBe(DELETE_ACCOUNT_FAILURE_BODY);
    // The screen's own error slot stays empty — no delete copy leaked into it.
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/didn't finish/i);
  });

  it("locks every control on the screen while the delete is in flight", () => {
    isPending = true;
    const tree = render();

    // Not just the delete row: navigating away unmounts this screen, and a
    // per-call mutate callback does not fire after unmount — the account would
    // be erased with `handleSignOut` never running. Redeeming an invite
    // mid-delete would strand the membership it just created.
    for (const label of ["Deleting account", "Sign out", "Create a chapter"]) {
      expect(control(tree.root, label)?.props.disabled).toBe(true);
    }
    // "Join chapter" is disabled too, but keeps its label: its spinner means
    // "a join is running", and what is running is the deletion.
    expect(control(tree.root, "Join chapter")?.props.disabled).toBe(true);
    expect(
      tree.root.findAllByType("ActivityIndicator" as never, { deep: true }),
    ).toHaveLength(0);
    // And the delete row says what it is doing, rather than looking tappable
    // and doing nothing.
    expect(JSON.stringify(tree.toJSON())).toMatch(/Deleting account/);
  });

  it("stays locked after a successful delete, while sign-out is in flight", () => {
    // The gap the mutation's own flags leave open: `isPending` is already false
    // here, but the user is still on this screen because `signOut()` has not
    // come back yet. Without `isSuccess` the row would re-enable mid-teardown
    // and a second tap would 401, reporting that a finished deletion "didn't
    // finish".
    isPending = false;
    isSuccess = true;
    const tree = render();

    // `disabled` is the assertion, not "pressing does nothing":
    // react-test-renderer calls `onPress` regardless of `disabled`, so driving
    // the handler here would prove nothing. React Native honours it at runtime.
    for (const label of ["Deleting account", "Sign out", "Create a chapter"]) {
      expect(control(tree.root, label)?.props.disabled).toBe(true);
    }
  });
});
