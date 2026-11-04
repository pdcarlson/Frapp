/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert, BackHandler } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
 *
 * It renders `app/(auth)/join.tsx` but lives here, not beside it: a spec under
 * `app/` is a route module and ships in the production bundle, which is what
 * broke the iOS build after #2347. `docs/mobile/testing.md`
 * § Gotchas has the mechanism; `lib/routes.spec.ts` enforces it.
 */

const signOut = vi.fn().mockResolvedValue(undefined);
const mutateAsync = vi.fn();
let isPending = false;
let isSuccess = false;

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: "authenticated",
    email: "brother@westfield.edu",
    signOut,
  }),
}));

vi.mock("@/lib/select-chapter", () => ({
  useSelectChapter: () => vi.fn().mockResolvedValue(true),
}));

const redeemMutateAsync = vi.fn();
let legalRequired: boolean | undefined = false;

// The Terms checkbox runs the real `useJoinTermsCheckbox`, against a mock API
// client (`statusClient` below), so this pins the screen and the shared rule
// together rather than a stand-in for the rule.
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRedeemInvite: () => ({
    isPending: false,
    isSuccess: false,
    mutateAsync: redeemMutateAsync,
  }),
  useDeleteAccount: () => ({ isPending, isSuccess, mutateAsync }),
}));

/** Answers `GET /v1/users/me/legal-acceptance`; `undefined` never answers. */
const statusClient = {
  GET: () =>
    legalRequired === undefined
      ? new Promise(() => {})
      : Promise.resolve({
          data: { required: legalRequired },
          error: undefined,
        }),
};

vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { FrappClientProvider } from "@repo/hooks";
import { LEGAL_ACCEPTANCE_REQUIRED_MESSAGE } from "@repo/validation";
import { OAUTH_MEMBERSHIP_HINT } from "@/lib/auth-providers";
import { consumeRememberedInviteToken } from "@/lib/onboarding/invite-token";
import JoinChapter, {
  JOIN_CHOICE_TITLE,
  JOIN_INVITE_TITLE,
} from "@/app/(auth)/join";

type Node = ReactTestRenderer["root"];
type AlertButton = { text: string; style?: string; onPress?: () => void };

function render(): ReactTestRenderer {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <FrappClientProvider
          client={
            statusClient as unknown as ComponentProps<
              typeof FrappClientProvider
            >["client"]
          }
          chapterId={null}
        >
          <FrappThemeProvider>
            <JoinChapter />
          </FrappThemeProvider>
        </FrappClientProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
}

/** Let the status read settle, so the screen shows what the server said. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
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

/** Opens the Account menu in the corner, where Sign out and Delete live. */
function openAccount(root: Node): void {
  act(() => {
    control(root, "Account")?.props.onPress();
  });
}

/** Answers the question with "I have an invite". */
function openInvite(root: Node): void {
  act(() => {
    control(root, "I have an invite")?.props.onPress();
  });
}

function allText(root: Node): string {
  return JSON.stringify(
    root
      .findAllByType("Text" as never, { deep: true })
      .map((t) => t.props.children ?? ""),
  );
}

// An opened invite link is remembered across mounts (`lib/onboarding/
// invite-token.ts`), so a spec that opens one would otherwise send every later
// render straight to the invite step.
beforeEach(() => {
  consumeRememberedInviteToken();
});

function confirmButtons(): AlertButton[] {
  const calls = vi.mocked(Alert.alert).mock.calls;
  return (calls[calls.length - 1]?.[2] ?? []) as AlertButton[];
}

describe("join screen — account deletion (5.1.1(v))", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
    legalRequired = false;
  });

  it("offers account deletion on the screen a zero-membership account is pinned to", () => {
    const tree = render();
    // The trap itself: the same account cannot reach Settings, so this control
    // being reachable here is the whole of the 5.1.1(v) compliance. It lives
    // in the Account menu in the corner (#3350), one tap away on both views.
    openAccount(tree.root);
    expect(control(tree.root, "Delete account")).toBeDefined();
    expect(control(tree.root, "Sign out")).toBeDefined();
    expect(allText(tree.root)).toContain("brother@westfield.edu");

    // Still one tap away from the invite step.
    openAccount(tree.root);
    openInvite(tree.root);
    openAccount(tree.root);
    expect(control(tree.root, "Delete account")).toBeDefined();
    // And the screen still does its own job.
    expect(control(tree.root, "Join chapter")).toBeDefined();
  });

  it("confirms before deleting, and does not delete on cancel", () => {
    const tree = render();
    openAccount(tree.root);

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
    openAccount(tree.root);

    act(() => {
      control(tree.root, "Delete account")?.props.onPress();
    });
    act(() => {
      confirmButtons()
        .find((b) => b.style === "destructive")
        ?.onPress?.();
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
    openAccount(tree.root);

    act(() => {
      control(tree.root, "Delete account")?.props.onPress();
    });
    act(() => {
      confirmButtons()
        .find((b) => b.style === "destructive")
        ?.onPress?.();
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
    // mid-delete would strand the membership it just created. The menu stays
    // open by itself while the deletion runs, so its progress stays on screen.
    for (const label of [
      "Deleting account",
      "Sign out",
      "Account",
      "I have an invite",
      "starting our chapter",
    ]) {
      expect(control(tree.root, label)?.props.disabled).toBe(true);
    }
    const backdrop = tree.root
      .findAllByType("Pressable" as never, { deep: true })
      .find((p) => p.props.accessibilityLabel === "Close account menu");
    expect(backdrop?.props.disabled).toBe(true);
    // "Join chapter" is disabled too, but keeps its label: its spinner means
    // "a join is running", and what is running is the deletion.
    openInvite(tree.root);
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
    for (const label of [
      "Deleting account",
      "Sign out",
      "starting our chapter",
    ]) {
      expect(control(tree.root, label)?.props.disabled).toBe(true);
    }
  });
});

/**
 * #2302. A user who hasn't accepted the current Terms can't join without
 * ticking the box, and one who has isn't asked again.
 */
describe("join screen — the Terms checkbox (#2302)", () => {
  const renderInvite = () => {
    const tree = render();
    openInvite(tree.root);
    return tree;
  };
  const checkbox = (root: Node) =>
    root
      .findAllByType("Pressable" as never, { deep: true })
      .find((pressable) => pressable.props.accessibilityRole === "checkbox");
  const typeToken = (root: Node, value: string) => {
    act(() => {
      root.findByType("TextInput" as never).props.onChangeText(value);
    });
  };
  const texts = (root: Node) =>
    root
      .findAllByType("Text" as never, { deep: true })
      .map((text) => JSON.stringify(text.props.children ?? ""));

  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
    redeemMutateAsync.mockResolvedValue({ chapterId: "ch-1", memberId: "m-1" });
  });

  it("doesn't ask a user who already accepted the current Terms", async () => {
    legalRequired = false;
    const tree = renderInvite();
    await settle();
    expect(checkbox(tree.root)).toBeUndefined();

    typeToken(tree.root, "invite-token-1");
    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });

    expect(redeemMutateAsync).toHaveBeenCalledWith({ token: "invite-token-1" });
  });

  it("asks, and won't join until the box is ticked", async () => {
    legalRequired = true;
    const tree = renderInvite();
    await settle();
    expect(checkbox(tree.root)).toBeDefined();

    typeToken(tree.root, "invite-token-1");
    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });

    expect(redeemMutateAsync).not.toHaveBeenCalled();
    expect(texts(tree.root).some((t) => t.includes("Agree to the Terms"))).toBe(
      true,
    );
  });

  it("sends the checkbox once it is ticked", async () => {
    legalRequired = true;
    const tree = renderInvite();
    await settle();

    typeToken(tree.root, "invite-token-1");
    act(() => {
      checkbox(tree.root)?.props.onPress();
    });
    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });

    expect(redeemMutateAsync).toHaveBeenCalledWith({
      token: "invite-token-1",
      accept_terms_privacy: true,
    });
  });

  it("asks while the status is still unknown, rather than earn a refusal", () => {
    legalRequired = undefined;
    const tree = renderInvite();
    expect(checkbox(tree.root)).toBeDefined();
  });

  it("shows the checkbox when the server refuses a join for want of it", async () => {
    legalRequired = false;
    // No `code`, as an API older than #1020 sends it: the message fallback.
    redeemMutateAsync.mockRejectedValueOnce({
      statusCode: 403,
      error: "FORBIDDEN",
      message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
      requestId: "req_1",
    });
    const tree = renderInvite();
    await settle();
    expect(checkbox(tree.root)).toBeUndefined();

    typeToken(tree.root, "invite-token-1");
    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });

    expect(checkbox(tree.root)).toBeDefined();
  });
});

/**
 * #3350. An account with no chapter lands on one question with two answers,
 * instead of a card that led with an invite field and ended in Delete account.
 */
describe("join screen — the question (#3350)", () => {
  const params = vi.mocked(useLocalSearchParams);
  const addListener = BackHandler.addEventListener as unknown as {
    mock: { calls: [string, () => boolean][] };
    mockClear: () => void;
  };

  function latestBackHandler(): () => boolean {
    const calls = addListener.mock.calls.filter(
      ([event]) => event === "hardwareBackPress",
    );
    const last = calls[calls.length - 1];
    if (!last) throw new Error("no hardwareBackPress listener");
    return last[1];
  }

  const hasField = (root: Node) =>
    root.findAllByType("TextInput" as never, { deep: true }).length > 0;

  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
    legalRequired = false;
    addListener.mockClear();
  });

  afterEach(() => {
    params.mockReturnValue({});
  });

  it("asks how the member is getting in, with the account controls tucked away", () => {
    const tree = render();
    const text = allText(tree.root);

    expect(text).toContain(JOIN_CHOICE_TITLE);
    expect(control(tree.root, "I have an invite")).toBeDefined();
    expect(control(tree.root, "starting our chapter")).toBeDefined();
    expect(hasField(tree.root)).toBe(false);
    // Destructive controls no longer lead the first screen.
    expect(control(tree.root, "Delete account")).toBeUndefined();
    expect(control(tree.root, "Sign out")).toBeUndefined();
  });

  it("opens the invite step, with the Hide My Email hint, and comes back", () => {
    const tree = render();
    openInvite(tree.root);

    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);
    expect(hasField(tree.root)).toBe(true);
    expect(allText(tree.root)).toContain(OAUTH_MEMBERSHIP_HINT);

    const back = tree.root
      .findAllByType("Pressable" as never, { deep: true })
      .find((p) => p.props.accessibilityLabel === "Back to the choices");
    act(() => {
      back?.props.onPress();
    });
    expect(allText(tree.root)).toContain(JOIN_CHOICE_TITLE);
    expect(hasField(tree.root)).toBe(false);
  });

  it("sends a founder to chapter setup", () => {
    const tree = render();
    act(() => {
      control(tree.root, "starting our chapter")?.props.onPress();
    });
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/create-chapter");
  });

  it("goes straight to the invite step, filled in, when an invite link opened the app", () => {
    params.mockReturnValue({ token: "invite-token-9" });
    const tree = render();

    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);
    const field = tree.root.findByType("TextInput" as never);
    expect(field.props.value).toBe("invite-token-9");
    // The next step is Join, so the keyboard stays down.
    expect(field.props.autoFocus).toBe(false);
  });

  it("steps back inside the screen on Android: the menu first, then the invite step", () => {
    const tree = render();
    openInvite(tree.root);
    openAccount(tree.root);
    expect(control(tree.root, "Sign out")).toBeDefined();

    let handled = false;
    act(() => {
      handled = latestBackHandler()();
    });
    expect(handled).toBe(true);
    expect(control(tree.root, "Sign out")).toBeUndefined();
    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);

    act(() => {
      handled = latestBackHandler()();
    });
    expect(handled).toBe(true);
    expect(allText(tree.root)).toContain(JOIN_CHOICE_TITLE);
  });

  it("holds Android back while a deletion is running", () => {
    isPending = true;
    const tree = render();

    let handled = false;
    act(() => {
      handled = latestBackHandler()();
    });
    expect(handled).toBe(true);
    expect(allText(tree.root)).toContain("Deleting account");
  });
});
