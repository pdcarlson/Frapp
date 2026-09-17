/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * #2295 — Apple 5.1.1(v).
 *
 * An account with zero chapter memberships is pinned to this screen:
 * `resolveAuthGate` returns `"join"` (covered in `lib/auth-gate.spec.ts`) and
 * `(auth)/_layout.tsx` redirects every other path back here. Settings — the
 * other place account deletion is offered — is therefore unreachable, so if the
 * control is not on *this* screen it does not exist for that account at all.
 *
 * That is what these pin: the affordance is rendered here, it is destructive
 * and confirmed, it actually calls the endpoint, and a failure neither signs
 * the user out nor disappears.
 */

const signOut = vi.fn().mockResolvedValue(undefined);
const mutate = vi.fn();

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ status: "authenticated", signOut }),
}));

vi.mock("@/lib/select-chapter", () => ({
  useSelectChapter: () => vi.fn().mockResolvedValue(true),
}));

vi.mock("@repo/hooks", () => ({
  useRedeemInvite: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteAccount: () => ({ isPending: false, mutate }),
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

/** The pressable whose rendered text is `label`, by walking its subtree. */
function control(root: Node, label: string) {
  return root
    .findAll(
      (node) =>
        typeof node.type === "string" && node.type === "Pressable",
      { deep: true },
    )
    .find((pressable) =>
      pressable
        .findAll((node) => node.type === "Text", { deep: true })
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
    expect(mutate).not.toHaveBeenCalled();
    expect(confirmButtons().map((button) => button.style)).toEqual([
      "cancel",
      "destructive",
    ]);
  });

  it("deletes and signs out once confirmed", () => {
    mutate.mockImplementation((_variables, options) => options.onSuccess());
    const tree = render();

    act(() => {
      control(tree.root, "Delete account")?.props.onPress();
    });
    act(() => {
      confirmButtons().find((b) => b.style === "destructive")?.onPress?.();
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failure in the screen's error slot and stays signed in", () => {
    mutate.mockImplementation((_variables, options) => options.onError());
    const tree = render();

    act(() => {
      control(tree.root, "Delete account")?.props.onPress();
    });
    act(() => {
      confirmButtons().find((b) => b.style === "destructive")?.onPress?.();
    });

    // Still signed in — the endpoint is idempotent and the instruction is
    // retry, which a signed-out user could not follow.
    expect(signOut).not.toHaveBeenCalled();
    // One alert total: the confirm. The failure lands in the error slot this
    // screen already renders, not a second stacked dialog.
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toMatch(/didn't finish/i);
    expect(rendered).toMatch(/running it again is safe/i);
  });
});
