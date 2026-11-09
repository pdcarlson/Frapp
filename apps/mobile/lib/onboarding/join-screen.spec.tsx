/** @vitest-environment jsdom */
import { backArrowColor } from "@/test/back-row";
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { AccessibilityInfo, Alert, BackHandler } from "react-native";
import * as expoRouter from "expo-router";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as Haptics from "expo-haptics";
import { ReduceMotion } from "react-native-reanimated";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import {
  DELETE_ACCOUNT_FAILURE_BODY,
  DELETE_ACCOUNT_FAILURE_TITLE,
} from "@/lib/account/delete-account-prompt";
import { flatStyle } from "@/test/flat-style";

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

/** The session's status; a spec sets it before rendering. */
let authStatus: "authenticated" | "unauthenticated" = "authenticated";
/** The session's email; `null` for an account with none. */
let sessionEmail: string | null = "brother@westfield.edu";

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: authStatus,
    email: sessionEmail,
    userId: "user-1",
    signOut,
  }),
}));

vi.mock("@/lib/select-chapter", () => ({
  useSelectChapter: () => vi.fn().mockResolvedValue(true),
}));

const redeemMutateAsync = vi.fn();
/** A redeem in flight, as `useRedeemInvite` reports it. */
let redeemPending = false;
/** A redeem that succeeded while the chapter it joined opens. */
let redeemSuccess = false;
let legalRequired: boolean | undefined = false;

// The Terms checkbox runs the real `useJoinTermsCheckbox`, against a mock API
// client (`statusClient` below), so this pins the screen and the shared rule
// together rather than a stand-in for the rule.
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRedeemInvite: () => ({
    isPending: redeemPending,
    isSuccess: redeemSuccess,
    mutateAsync: redeemMutateAsync,
  }),
  useDeleteAccount: () => ({ isPending, isSuccess, mutateAsync }),
}));

/**
 * What `POST /v1/invites/preview` answers (#3352). `null` fails the read the
 * way a network error does, which leaves the card showing the bare invite.
 */
let previewAnswer: { data?: unknown; error?: unknown } | null = null;
const previewPost = vi.fn(() =>
  previewAnswer
    ? Promise.resolve(previewAnswer)
    : Promise.reject(new Error("offline")),
);

/**
 * Answers `GET /v1/users/me/legal-acceptance`, where `undefined` never
 * answers, and the invite preview above.
 */
/**
 * What `GET /v1/invites/mine` answers (#3782): the invites emailed to this
 * account. Empty unless a spec offers some.
 */
let pendingInvites: unknown[] = [];
const pendingGet = vi.fn(() =>
  Promise.resolve({ data: pendingInvites, error: undefined }),
);

const statusClient = {
  POST: previewPost,
  GET: (path: string) =>
    path === "/v1/invites/mine"
      ? pendingGet()
      : legalRequired === undefined
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
import {
  consumeRememberedInviteToken,
  rememberInviteToken,
} from "@/lib/onboarding/invite-token";
import { ChapterMarkTile } from "@/components/onboarding/chapter-mark-tile";
import JoinChapter, {
  JOIN_CHOICE_TITLE,
  JOIN_CONFIRM_TITLE,
  JOIN_INVITE_TITLE,
  confirmTitle,
  offerTitle,
} from "@/app/(auth)/join";

type Node = ReactTestRenderer["root"];
type AlertButton = { text: string; style?: string; onPress?: () => void };

/** The screen under its providers. A new element each call, so a rerender renders. */
function app(queryClient: QueryClient) {
  return (
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
    </QueryClientProvider>
  );
}

/** The client the latest `render()` used, for `rerender`. */
let lastQueryClient: QueryClient | null = null;

function render(): ReactTestRenderer {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  lastQueryClient = queryClient;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      app(queryClient),
      // A host ref is null under the test renderer without this; with it, a
      // focus event's target names the element it was sent to. Not
      // enumerable, so `tree.toJSON()` still serializes.
      {
        createNodeMock: (element) =>
          Object.defineProperty({}, "element", { value: element }),
      },
    );
  });
  return tree;
}

/** Renders the same screen again, as a new route param or link would. */
function rerender(tree: ReactTestRenderer): void {
  act(() => {
    tree.update(app(lastQueryClient!));
  });
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

/** Types into the invite field. */
function typeToken(root: Node, value: string): void {
  act(() => {
    root.findByType("TextInput" as never).props.onChangeText(value);
  });
}

/** The field's Continue: on to the confirm step. */
function continueToConfirm(root: Node): void {
  act(() => {
    control(root, "Continue")?.props.onPress();
  });
}

/** The pressable with this accessibility label (the `‹ Back` row's). */
function labelled(root: Node, label: string) {
  return root
    .findAllByType("Pressable" as never, { deep: true })
    .find((p) => p.props.accessibilityLabel === label);
}

/**
 * The string parts of a `Text`'s children. A `Text` nested inside another is
 * an element here, and `findAllByType` reaches it on its own.
 */
function textOf(children: unknown): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

function allText(root: Node): string {
  return JSON.stringify(
    root
      .findAllByType("Text" as never, { deep: true })
      .map((t) => textOf(t.props.children)),
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
    // in the Account menu in the corner (#3350), one tap away on every view.
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
    expect(control(tree.root, "Continue")).toBeDefined();
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
    // The step button is disabled too, but keeps its label: its spinner means
    // "a join is running", and what is running is the deletion.
    openInvite(tree.root);
    expect(control(tree.root, "Continue")?.props.disabled).toBe(true);
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
  /** The confirm step for `invite-token-1`, where the checkbox lives. */
  const renderConfirm = () => {
    const tree = render();
    openInvite(tree.root);
    typeToken(tree.root, "invite-token-1");
    continueToConfirm(tree.root);
    return tree;
  };
  const checkbox = (root: Node) =>
    root
      .findAllByType("Pressable" as never, { deep: true })
      .find((pressable) => pressable.props.accessibilityRole === "checkbox");
  const texts = (root: Node) =>
    root
      .findAllByType("Text" as never, { deep: true })
      .map((text) => textOf(text.props.children));

  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
    redeemMutateAsync.mockResolvedValue({ chapterId: "ch-1", memberId: "m-1" });
  });

  it("doesn't ask a user who already accepted the current Terms", async () => {
    legalRequired = false;
    const tree = renderConfirm();
    await settle();
    expect(checkbox(tree.root)).toBeUndefined();

    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });

    expect(redeemMutateAsync).toHaveBeenCalledWith({ token: "invite-token-1" });
  });

  it("asks, and won't join until the box is ticked", async () => {
    legalRequired = true;
    const tree = renderConfirm();
    await settle();
    expect(checkbox(tree.root)).toBeDefined();

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
    const tree = renderConfirm();
    await settle();

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
    const tree = renderConfirm();
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
    const tree = renderConfirm();
    await settle();
    expect(checkbox(tree.root)).toBeUndefined();

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

  /** Back listeners not yet removed, as React Native would still call them. */
  function liveBackHandlers(): (() => boolean)[] {
    const results = (
      BackHandler.addEventListener as unknown as {
        mock: {
          results: { value: { remove: { mock: { calls: unknown[] } } } }[];
        };
      }
    ).mock.results;
    return addListener.mock.calls
      .map(([event, handler], index) => ({ event, handler, index }))
      .filter(
        ({ event, index }) =>
          event === "hardwareBackPress" &&
          results[index].value.remove.mock.calls.length === 0,
      )
      .map(({ handler }) => handler);
  }

  const { __blur, __refocus } = expoRouter as unknown as {
    __blur: () => void;
    __refocus: () => void;
  };

  const hasField = (root: Node) =>
    root.findAllByType("TextInput" as never, { deep: true }).length > 0;

  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
    legalRequired = false;
    redeemPending = false;
    addListener.mockClear();
  });

  afterEach(() => {
    params.mockReturnValue({});
    vi.mocked(Linking.useURL).mockReturnValue(null);
    redeemPending = false;
    consumeRememberedInviteToken();
  });

  it("asks how the member is getting in, with Delete account tucked away and Sign out on its face", () => {
    const tree = render();
    const text = allText(tree.root);

    expect(text).toContain(JOIN_CHOICE_TITLE);
    expect(control(tree.root, "I have an invite")).toBeDefined();
    expect(control(tree.root, "starting our chapter")).toBeDefined();
    expect(hasField(tree.root)).toBe(false);
    // The destructive control no longer leads the first screen; Sign out
    // sits on its face, beside the account it would sign out of (#3782).
    expect(control(tree.root, "Delete account")).toBeUndefined();
    expect(control(tree.root, "Sign out")).toBeDefined();
  });

  it("opens the invite step, with the Hide My Email hint, and comes back", () => {
    const tree = render();
    openInvite(tree.root);

    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);
    expect(hasField(tree.root)).toBe(true);
    expect(allText(tree.root)).toContain(OAUTH_MEMBERSHIP_HINT);

    act(() => {
      labelled(tree.root, "Back to the choices")?.props.onPress();
    });
    expect(allText(tree.root)).toContain(JOIN_CHOICE_TITLE);
    expect(hasField(tree.root)).toBe(false);
  });

  it("confirms the invite on a card before joining with it (#3352)", async () => {
    const tree = render();
    openInvite(tree.root);
    typeToken(tree.root, "https://app.frapp.live/join?token=invite-token-2a9f");

    continueToConfirm(tree.root);
    // Terms answered, so the join goes straight through.
    await settle();
    // Continue only moves on; nothing is used up yet.
    expect(redeemMutateAsync).not.toHaveBeenCalled();
    expect(allText(tree.root)).toContain(JOIN_CONFIRM_TITLE);
    expect(hasField(tree.root)).toBe(false);
    // The card names the invite by its tail, read out of the pasted link.
    expect(allText(tree.root)).toContain("2a9f");

    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });
    expect(redeemMutateAsync).toHaveBeenCalledWith({
      token: "invite-token-2a9f",
    });
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/welcome");
  });

  it("won't continue without an invite in the field", () => {
    const tree = render();
    openInvite(tree.root);

    continueToConfirm(tree.root);
    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);
    expect(allText(tree.root)).toContain("Paste the invite your officer sent");

    // The keyboard's own key does the same.
    act(() => {
      tree.root.findByType("TextInput" as never).props.onSubmitEditing();
    });
    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);
  });

  it("steps back from the card to the field with the invite kept, then to the question", () => {
    const tree = render();
    openInvite(tree.root);
    typeToken(tree.root, "invite-token-3");
    continueToConfirm(tree.root);

    act(() => {
      labelled(tree.root, "Back to the invite")?.props.onPress();
    });
    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);
    expect(tree.root.findByType("TextInput" as never).props.value).toBe(
      "invite-token-3",
    );

    // Android's back button walks the same steps.
    continueToConfirm(tree.root);
    let handled = false;
    act(() => {
      handled = latestBackHandler()();
    });
    expect(handled).toBe(true);
    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);
    act(() => {
      handled = latestBackHandler()();
    });
    expect(handled).toBe(true);
    expect(allText(tree.root)).toContain(JOIN_CHOICE_TITLE);
  });

  it("sends a founder to chapter setup", () => {
    const tree = render();
    act(() => {
      control(tree.root, "starting our chapter")?.props.onPress();
    });
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/create-chapter");
  });

  it("goes straight to the confirm card when an invite link opened the app", () => {
    params.mockReturnValue({ token: "invite-token-9" });
    const tree = render();

    expect(allText(tree.root)).toContain(JOIN_CONFIRM_TITLE);
    expect(allText(tree.root)).toContain("en-9");
    expect(control(tree.root, "Join chapter")).toBeDefined();

    // Back shows the field the link filled, keyboard down: the next step is
    // Continue, not typing.
    act(() => {
      labelled(tree.root, "Back to the invite")?.props.onPress();
    });
    const field = tree.root.findByType("TextInput" as never);
    expect(field.props.value).toBe("invite-token-9");
    expect(field.props.autoFocus).toBe(false);
  });

  it("steps back inside the screen on Android: the menu first, then the invite step", () => {
    const tree = render();
    openInvite(tree.root);
    openAccount(tree.root);
    expect(control(tree.root, "Delete account")).toBeDefined();

    let handled = false;
    act(() => {
      handled = latestBackHandler()();
    });
    expect(handled).toBe(true);
    expect(control(tree.root, "Delete account")).toBeUndefined();
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

  it("keeps the member on the confirm card while the join is running", () => {
    // A link lands on the card, then the redeem starts.
    params.mockReturnValue({ token: "invite-token-10" });
    const tree = render();
    redeemPending = true;
    rerender(tree);
    expect(allText(tree.root)).toContain(JOIN_CONFIRM_TITLE);

    expect(labelled(tree.root, "Back to the invite")?.props.disabled).toBe(
      true,
    );

    let handled = false;
    act(() => {
      handled = latestBackHandler()();
    });
    expect(handled).toBe(true);
    expect(allText(tree.root)).toContain(JOIN_CONFIRM_TITLE);
  });

  it("ignores a second Join while a join is running", async () => {
    params.mockReturnValue({ token: "invite-token-11" });
    const tree = render();
    // Terms answered, so only the guard can stop the send.
    await settle();
    redeemPending = true;
    rerender(tree);

    const join = tree.root
      .findAllByType("Pressable" as never, { deep: true })
      .find((p) => p.props.accessibilityState?.busy === true);
    expect(join?.props.disabled).toBe(true);
    await act(async () => {
      await join?.props.onPress();
    });
    expect(redeemMutateAsync).not.toHaveBeenCalled();
  });

  it("hides the screen from a screen reader under the Account menu, and focuses the menu's title", () => {
    vi.useFakeTimers();
    try {
      const tree = render();
      const focus = vi.mocked(AccessibilityInfo.sendAccessibilityEvent);
      focus.mockClear();
      const underlay = () =>
        tree.root
          .findAllByType("View" as never, { deep: true })
          .find(
            (view) =>
              view.props.collapsable === false &&
              view.findAllByType("ScrollView" as never, { deep: true }).length >
                0,
          );
      expect(underlay()?.props.accessibilityElementsHidden).toBe(false);
      expect(underlay()?.props.importantForAccessibility).toBe("auto");

      openAccount(tree.root);
      act(() => {
        vi.runAllTimers();
      });

      expect(underlay()?.props.accessibilityElementsHidden).toBe(true);
      expect(underlay()?.props.importantForAccessibility).toBe(
        "no-hide-descendants",
      );
      expect(focus).toHaveBeenCalledTimes(1);
      const [target, eventType] = focus.mock.calls[0] as unknown as [
        { element: { props: { children?: unknown } } },
        string,
      ];
      expect(eventType).toBe("focus");
      expect(target.element.props.children).toBe(
        "Signed in as brother@westfield.edu",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves Android back alone while another screen covers it", () => {
    // An opened link puts /join on its invite step; "I'm starting our
    // chapter" can't be reached from there, but any pushed screen blurs it.
    params.mockReturnValue({ token: "invite-token-12" });
    const tree = render();
    expect(liveBackHandlers()).toHaveLength(1);

    act(() => {
      __blur();
    });
    expect(liveBackHandlers()).toHaveLength(0);

    // Focus comes back. Other specs' screens stay mounted and refocus too,
    // but this one's listener is the newest, which is the one Android calls.
    act(() => {
      __refocus();
    });
    const live = liveBackHandlers();
    let handled = false;
    act(() => {
      handled = live[live.length - 1]();
    });
    expect(handled).toBe(true);
    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);

    // The same for the Account menu.
    openAccount(tree.root);
    act(() => {
      __blur();
    });
    expect(liveBackHandlers()).toHaveLength(0);
    act(() => {
      __refocus();
    });
    const menuLive = liveBackHandlers();
    act(() => {
      handled = menuLive[menuLive.length - 1]();
    });
    expect(handled).toBe(true);
    expect(control(tree.root, "Delete account")).toBeUndefined();
  });

  it("reads an opened link once, so a later visit asks the question again", () => {
    vi.mocked(Linking.useURL).mockReturnValue(
      "frapp://join?token=link-token-13",
    );
    const first = render();
    expect(allText(first.root)).toContain(JOIN_CONFIRM_TITLE);
    act(() => {
      first.unmount();
    });
    // The member backed out of that invite rather than redeeming it.
    consumeRememberedInviteToken();

    const second = render();
    expect(allText(second.root)).toContain(JOIN_CHOICE_TITLE);
  });

  it("forgets an invite the member backed out of", () => {
    params.mockReturnValue({ token: "invite-token-14" });
    const first = render();
    act(() => {
      labelled(first.root, "Back to the invite")?.props.onPress();
    });
    act(() => {
      labelled(first.root, "Back to the choices")?.props.onPress();
    });
    act(() => {
      first.unmount();
    });

    params.mockReturnValue({});
    const second = render();
    expect(allText(second.root)).toContain(JOIN_CHOICE_TITLE);
  });

  it("uses a remembered invite once, after the sign-in bounce, then asks again", () => {
    // Remembered by a signed-out visit that bounced to sign-in.
    rememberInviteToken("invite-token-15");
    const first = render();
    expect(allText(first.root)).toContain(JOIN_CONFIRM_TITLE);
    expect(allText(first.root)).toContain("n-15");
    act(() => {
      first.unmount();
    });

    const second = render();
    expect(allText(second.root)).toContain(JOIN_CHOICE_TITLE);
  });
});

/** The text the confirm card's chapter mark tile draws. */
function markText(root: Node): string | undefined {
  const tile = root.findAllByType(ChapterMarkTile, { deep: true })[0];
  return tile?.props.text;
}

/**
 * #3352. The confirm card names the chapter before the member joins, from a
 * read that doesn't use the invite up.
 */
describe("join screen — the confirm card's chapter (#3352)", () => {
  const params = vi.mocked(useLocalSearchParams);
  const checkbox = (root: Node) =>
    root
      .findAllByType("Pressable" as never, { deep: true })
      .find((pressable) => pressable.props.accessibilityRole === "checkbox");

  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
    redeemPending = false;
    redeemSuccess = false;
    legalRequired = true;
    redeemMutateAsync.mockResolvedValue({ chapterId: "ch-1", memberId: "m-1" });
  });

  afterEach(() => {
    params.mockReturnValue({});
    previewAnswer = null;
    consumeRememberedInviteToken();
  });

  it("names the chapter, who sent the invite and the role, before joining", async () => {
    previewAnswer = {
      data: {
        chapter_name: "FIJI Tau Nu",
        university: "Rensselaer Polytechnic Institute",
        mark_text: "FIJI",
        accent_color: "#5b2c83",
        invited_by: "Paul Carlson",
        role: "Member",
        expires_at: "2026-11-05T20:00:00.000Z",
      },
    };
    params.mockReturnValue({ token: "invite-token-20" });
    const tree = render();
    await settle();

    expect(previewPost).toHaveBeenCalledWith("/v1/invites/preview", {
      body: { token: "invite-token-20" },
    });
    const text = allText(tree.root);
    expect(text).toContain(confirmTitle("FIJI Tau Nu"));
    expect(text).toContain("Rensselaer Polytechnic Institute");
    expect(text).toContain("FIJI");
    expect(text).toContain("Invited by Paul Carlson");
    expect(text).toContain("Joining as Member");
    // The tile carries the chapter's own text mark, not its initials.
    expect(markText(tree.root)).toBe("FIJI");
    // Reading it used nothing up.
    expect(redeemMutateAsync).not.toHaveBeenCalled();

    act(() => {
      checkbox(tree.root)?.props.onPress();
    });
    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });
    expect(redeemMutateAsync).toHaveBeenCalledWith({
      token: "invite-token-20",
      accept_terms_privacy: true,
    });
  });

  it("says a dead invite is dead, and offers no Join", async () => {
    previewAnswer = {
      error: { statusCode: 410, message: "Invite expired" },
    };
    params.mockReturnValue({ token: "invite-token-21" });
    const tree = render();
    await settle();

    expect(allText(tree.root)).toContain("expired or already been used");
    expect(control(tree.root, "Join chapter")?.props.disabled).toBe(true);
    expect(checkbox(tree.root)).toBeUndefined();
    // Back still leads to the field, to paste another.
    expect(
      tree.root
        .findAllByType("Pressable" as never, { deep: true })
        .find((p) => p.props.accessibilityLabel === "Back to the invite")?.props
        .disabled,
    ).toBe(false);
  });

  it("still joins with the bare invite when the chapter can't be read", async () => {
    previewAnswer = null;
    params.mockReturnValue({ token: "invite-token-22" });
    const tree = render();
    await settle();

    expect(allText(tree.root)).toContain(JOIN_CONFIRM_TITLE);
    expect(allText(tree.root)).toContain("n-22");
    act(() => {
      checkbox(tree.root)?.props.onPress();
    });
    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });
    expect(redeemMutateAsync).toHaveBeenCalledWith({
      token: "invite-token-22",
      accept_terms_privacy: true,
    });
  });

  it("disables Join once the redeem itself finds the invite dead", async () => {
    previewAnswer = {
      data: {
        chapter_name: "FIJI Tau Nu",
        university: "Rensselaer Polytechnic Institute",
        mark_text: "FIJI",
        accent_color: null,
        invited_by: null,
        role: "Member",
        expires_at: "2026-11-05T20:00:00.000Z",
      },
    };
    legalRequired = false;
    // Live when previewed, used by someone else before the tap.
    redeemMutateAsync.mockRejectedValueOnce({
      statusCode: 410,
      message: "Invite already used",
    });
    params.mockReturnValue({ token: "invite-token-23" });
    const tree = render();
    await settle();
    expect(control(tree.root, "Join chapter")?.props.disabled).toBe(false);

    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });
    expect(allText(tree.root)).toContain("expired or already been used");
    expect(control(tree.root, "Join chapter")?.props.disabled).toBe(true);
  });

  it("joins the link just opened, not the invite the field already held", async () => {
    previewAnswer = null;
    const tree = render();
    openInvite(tree.root);
    typeToken(tree.root, "old-invite-24");

    params.mockReturnValue({ token: "new-invite-24" });
    rerender(tree);
    await settle();

    expect(allText(tree.root)).toContain(JOIN_CONFIRM_TITLE);
    expect(previewPost).toHaveBeenLastCalledWith("/v1/invites/preview", {
      body: { token: "new-invite-24" },
    });
  });

  it("reads the preview only on the confirm step, not while typing", async () => {
    const tree = render();
    openInvite(tree.root);
    typeToken(tree.root, "invite-token-25");
    await settle();
    expect(previewPost).not.toHaveBeenCalled();

    continueToConfirm(tree.root);
    await settle();
    expect(previewPost).toHaveBeenCalledTimes(1);
  });

  it("falls back to initials for a chapter with no text mark, and names no role it won't grant", async () => {
    previewAnswer = {
      data: {
        chapter_name: "Phi Gamma Delta Tau Nu",
        university: "Rensselaer Polytechnic Institute",
        // Letters hidden and no short name: the API sends no mark.
        mark_text: null,
        accent_color: null,
        invited_by: null,
        role: null,
        expires_at: "2026-11-05T20:00:00.000Z",
      },
    };
    params.mockReturnValue({ token: "invite-token-26" });
    const tree = render();
    await settle();

    expect(markText(tree.root)).toBe("PG");
    expect(allText(tree.root)).not.toContain("Joining as");
    expect(allText(tree.root)).not.toContain("Invited by");
  });

  it("lets a fresh invite join after the last one came back dead", async () => {
    previewAnswer = null;
    legalRequired = false;
    redeemMutateAsync.mockRejectedValueOnce({
      statusCode: 410,
      message: "Invite already used",
    });
    params.mockReturnValue({ token: "invite-token-27" });
    const tree = render();
    await settle();
    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });
    expect(control(tree.root, "Join chapter")?.props.disabled).toBe(true);

    // Back to the field, and a new invite from the officer.
    act(() => {
      labelled(tree.root, "Back to the invite")?.props.onPress();
    });
    typeToken(tree.root, "invite-token-28");
    continueToConfirm(tree.root);
    await settle();

    expect(allText(tree.root)).not.toContain("expired or already been used");
    expect(control(tree.root, "Join chapter")?.props.disabled).toBe(false);
  });

  it("holds a link opened while a join runs, then shows it once the join fails", async () => {
    previewAnswer = null;
    params.mockReturnValue({ token: "invite-token-29" });
    const tree = render();
    await settle();
    redeemPending = true;
    rerender(tree);

    params.mockReturnValue({ token: "invite-token-30" });
    rerender(tree);
    // Still the invite being joined.
    expect(allText(tree.root)).toContain("n-29");

    redeemPending = false;
    rerender(tree);
    expect(allText(tree.root)).toContain("n-30");
  });

  it("keeps an invite the member pasted when the screen re-renders with the old link's param", async () => {
    previewAnswer = null;
    params.mockReturnValue({ token: "invite-token-31" });
    const tree = render();
    act(() => {
      labelled(tree.root, "Back to the invite")?.props.onPress();
    });
    typeToken(tree.root, "invite-token-32");

    // Anything that re-runs the link check, with the launch param still set.
    vi.mocked(Linking.useURL).mockReturnValue("frapp://other");
    rerender(tree);
    expect(tree.root.findByType("TextInput" as never).props.value).toBe(
      "invite-token-32",
    );
    vi.mocked(Linking.useURL).mockReturnValue(null);
  });

  it("keeps a failed join's error when the screen's only invite came from a link", async () => {
    previewAnswer = null;
    legalRequired = false;
    vi.mocked(Linking.useURL).mockReturnValue(
      "frapp://join?token=link-token-34",
    );
    try {
      const tree = render();
      await settle();
      // The opened link stays remembered for a sign-in bounce. Said again
      // here because this harness can mount the screen twice, and the second
      // mount takes it back out.
      rememberInviteToken("link-token-34");
      redeemMutateAsync.mockRejectedValueOnce({
        statusCode: 409,
        message: "Already a member of this chapter",
      });
      await act(async () => {
        await control(tree.root, "Join chapter")?.props.onPress();
      });
      expect(allText(tree.root)).toContain("already a member of this chapter");
      // The join's pending flag rises and falls around it.
      redeemPending = true;
      rerender(tree);
      // The join ends, which lets links through again: nothing new arrived,
      // so the error the member needs stays.
      redeemPending = false;
      rerender(tree);

      expect(allText(tree.root)).toContain("already a member of this chapter");
      expect(allText(tree.root)).toContain("n-34");
    } finally {
      vi.mocked(Linking.useURL).mockReturnValue(null);
    }
  });

  it("doesn't bring back a launch param a link replaced", async () => {
    previewAnswer = null;
    params.mockReturnValue({ token: "invite-token-35" });
    const tree = render();
    await settle();
    vi.mocked(Linking.useURL).mockReturnValue(
      "frapp://join?token=link-token-36",
    );
    try {
      rerender(tree);
      expect(allText(tree.root)).toContain("n-36");

      // A join that failed, then anything else that re-runs the link check
      // with the launch param still set.
      redeemPending = true;
      rerender(tree);
      redeemPending = false;
      rerender(tree);
      vi.mocked(Linking.useURL).mockReturnValue("frapp://other");
      rerender(tree);

      expect(allText(tree.root)).toContain("n-36");
      expect(allText(tree.root)).not.toContain("n-35");
    } finally {
      vi.mocked(Linking.useURL).mockReturnValue(null);
    }
  });

  it("holds a link opened while the account is being deleted", () => {
    params.mockReturnValue({ token: "invite-token-37" });
    const tree = render();
    isPending = true;
    rerender(tree);

    params.mockReturnValue({ token: "invite-token-38" });
    rerender(tree);
    expect(allText(tree.root)).toContain("n-37");

    // The deletion failed: the link applies now.
    isPending = false;
    rerender(tree);
    expect(allText(tree.root)).toContain("n-38");
  });

  it("holds a link opened after a join succeeded, while the chapter opens", () => {
    params.mockReturnValue({ token: "invite-token-39" });
    const tree = render();
    redeemSuccess = true;
    rerender(tree);

    params.mockReturnValue({ token: "invite-token-40" });
    rerender(tree);
    expect(allText(tree.root)).toContain("n-39");
    expect(allText(tree.root)).not.toContain("n-40");
  });

  it("leaves the member on the field after a deletion fails", () => {
    vi.mocked(Linking.useURL).mockReturnValue(
      "frapp://join?token=link-token-43",
    );
    try {
      const tree = render();
      act(() => {
        labelled(tree.root, "Back to the invite")?.props.onPress();
      });
      typeToken(tree.root, "invite-token-44");

      isPending = true;
      rerender(tree);
      isPending = false;
      rerender(tree);

      expect(allText(tree.root)).not.toContain(JOIN_CONFIRM_TITLE);
      expect(tree.root.findByType("TextInput" as never).props.value).toBe(
        "invite-token-44",
      );
    } finally {
      vi.mocked(Linking.useURL).mockReturnValue(null);
    }
  });

  it("reads no preview while signed out", async () => {
    authStatus = "unauthenticated";
    try {
      params.mockReturnValue({ token: "invite-token-33" });
      render();
      await settle();
      expect(previewPost).not.toHaveBeenCalled();
    } finally {
      authStatus = "authenticated";
    }
  });
});

/**
 * The onboarding polish pass: s02 draws the board's `‹ Back` row in house
 * gold (the shared `BackRow`, not a bare chevron), the question carries no
 * line narrating its own two choices, each view fades in (but not for a
 * member who reduces motion), and a join that lands marks it with the same
 * success tap a chapter going live gets.
 */
/**
 * #3782. Signed in and not opened by an invite link, the question offers each
 * invite emailed to the account, as web `/join` does (#3776). An offer opens
 * the same confirm step a pasted invite does, so Terms and Join run unchanged.
 */
describe("join screen — invites for this account (#3782)", () => {
  const params = vi.mocked(useLocalSearchParams);
  const FIJI_OFFER = {
    chapter_name: "FIJI Tau Nu",
    university: "Rensselaer Polytechnic Institute",
    mark_text: "FIJI",
    accent_color: "#5b2c83",
    invited_by: "Paul Carlson",
    role: "Member",
    expires_at: "2026-11-10T20:00:00.000Z",
    token: "offer-token-fiji",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
    redeemPending = false;
    redeemSuccess = false;
    legalRequired = false;
    pendingInvites = [FIJI_OFFER];
    redeemMutateAsync.mockResolvedValue({ chapterId: "ch-1", memberId: "m-1" });
  });

  afterEach(() => {
    params.mockReturnValue({});
    vi.mocked(Linking.useURL).mockReturnValue(null);
    pendingInvites = [];
    consumeRememberedInviteToken();
  });

  it("offers each invite above the two answers, with its school, sender and role", async () => {
    const tree = render();
    await settle();

    expect(pendingGet).toHaveBeenCalled();
    const text = allText(tree.root);
    expect(text).toContain(JOIN_CHOICE_TITLE);
    expect(text).toContain(offerTitle("FIJI Tau Nu"));
    expect(text).toContain(
      "Rensselaer Polytechnic Institute · from Paul Carlson · Member",
    );
    // Above the answers, not instead of them.
    const order = text.indexOf(offerTitle("FIJI Tau Nu"));
    expect(order).toBeGreaterThan(-1);
    expect(order).toBeLessThan(text.indexOf("I have an invite"));
    expect(control(tree.root, "I have an invite")).toBeDefined();
    expect(markText(tree.root)).toBe("FIJI");
  });

  it("offers nothing when there are no invites for this account", async () => {
    pendingInvites = [];
    const tree = render();
    await settle();
    expect(allText(tree.root)).not.toContain("You've been invited");
  });

  it("offers none when an invite link opened the screen, even back on the question", async () => {
    params.mockReturnValue({ token: "invite-token-30" });
    const tree = render();
    await settle();
    expect(allText(tree.root)).toContain(JOIN_CONFIRM_TITLE);

    act(() => {
      labelled(tree.root, "Back to the invite")?.props.onPress();
    });
    act(() => {
      labelled(tree.root, "Back to the choices")?.props.onPress();
    });
    await settle();
    expect(allText(tree.root)).toContain(JOIN_CHOICE_TITLE);
    expect(allText(tree.root)).not.toContain("You've been invited");
  });

  it("opens the confirm step on the offer's invite, and Join redeems that invite", async () => {
    const tree = render();
    await settle();

    act(() => {
      control(tree.root, offerTitle("FIJI Tau Nu"))?.props.onPress();
    });
    await settle();
    // The confirm step, on the offer's invite: nothing joined yet.
    expect(hasConfirmButton(tree.root)).toBe(true);
    expect(allText(tree.root)).toContain(inviteTailOf(FIJI_OFFER.token));
    expect(redeemMutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });
    expect(redeemMutateAsync).toHaveBeenCalledWith({
      token: FIJI_OFFER.token,
    });
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/welcome");
  });

  it("steps back from an offer to the question, not to a field it never filled", async () => {
    const tree = render();
    await settle();
    act(() => {
      control(tree.root, offerTitle("FIJI Tau Nu"))?.props.onPress();
    });

    act(() => {
      labelled(tree.root, "Back to the choices")?.props.onPress();
    });
    expect(allText(tree.root)).toContain(JOIN_CHOICE_TITLE);
    expect(allText(tree.root)).toContain(offerTitle("FIJI Tau Nu"));

    openInvite(tree.root);
    expect(tree.root.findByType("TextInput" as never).props.value).toBe("");
  });

  /** Whether the confirm step's Join is on screen. */
  function hasConfirmButton(root: Node): boolean {
    return control(root, "Join chapter") !== undefined;
  }

  /** The tail the bare invite card names an invite by. */
  function inviteTailOf(token: string): string {
    return token.slice(-4);
  }
});

/**
 * #3782. Every view of s02 shows the account it is signed in as, with Sign
 * out beside it, as web `/join` does (#3776): signing out no longer hides in
 * the Account menu.
 */
describe("join screen — signed in as (#3782)", () => {
  const params = vi.mocked(useLocalSearchParams);

  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
    redeemPending = false;
    redeemSuccess = false;
    legalRequired = false;
    sessionEmail = "brother@westfield.edu";
  });

  afterEach(() => {
    params.mockReturnValue({});
    sessionEmail = "brother@westfield.edu";
    consumeRememberedInviteToken();
  });

  /** The account line, with Sign out, is on the face of the screen. */
  function expectAccountLine(root: Node): void {
    const text = allText(root);
    expect(text).toContain("Signed in as");
    expect(text).toContain("brother@westfield.edu");
    expect(control(root, "Sign out")).toBeDefined();
    // Not inside the Account menu: the menu is closed.
    expect(control(root, "Delete account")).toBeUndefined();
  }

  it("shows the account and Sign out on the question, the field and the confirm step", () => {
    const tree = render();
    expect(allText(tree.root)).toContain(JOIN_CHOICE_TITLE);
    expectAccountLine(tree.root);

    openInvite(tree.root);
    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);
    expectAccountLine(tree.root);

    typeToken(tree.root, "invite-token-40");
    continueToConfirm(tree.root);
    expect(allText(tree.root)).toContain(JOIN_CONFIRM_TITLE);
    expectAccountLine(tree.root);
  });

  it("signs out to sign-in, forgetting a remembered invite", async () => {
    const tree = render();
    // An invite remembered for this account, as a link opened while signed
    // out leaves one for the sign-in bounce.
    rememberInviteToken("invite-token-41");

    await act(async () => {
      control(tree.root, "Sign out")?.props.onPress();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith(
      "/(auth)/sign-in",
    );
    // The invite was this account's, not the next one's.
    expect(consumeRememberedInviteToken()).toBeNull();
  });

  it("says only Signed in when the session has no email", () => {
    sessionEmail = null;
    const tree = render();
    const text = allText(tree.root);
    expect(text).toContain("Signed in");
    expect(text).not.toContain("Signed in as");
    expect(control(tree.root, "Sign out")).toBeDefined();
  });

  it("holds Sign out while a join is running", () => {
    redeemPending = true;
    const tree = render();
    expect(control(tree.root, "Sign out")?.props.disabled).toBe(true);
  });
});

describe("join screen — polish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
    legalRequired = false;
    redeemPending = false;
    redeemSuccess = false;
    previewAnswer = null;
  });

  it("asks the question with no line under it narrating the choices", () => {
    const tree = render();

    expect(allText(tree.root)).toContain(JOIN_CHOICE_TITLE);
    expect(allText(tree.root)).not.toContain("Members join with an invite");
    // Nothing to step back to from the question, so no back row.
    expect(labelled(tree.root, "Back to the choices")).toBeUndefined();
  });

  it("steps back with a house-gold ‹ Back row, under the label each step had", () => {
    const tree = render();
    openInvite(tree.root);

    const back = labelled(tree.root, "Back to the choices");
    const text = back?.findByType("Text" as never);
    expect(text?.props.children).toBe("Back");
    // `gold.askText`: `(auth)` has no chapter accent to follow.
    expect(backArrowColor(back!)).toBe("#F4CB63");

    typeToken(tree.root, "invite-token-9");
    continueToConfirm(tree.root);
    expect(labelled(tree.root, "Back to the invite")).toBeDefined();
  });

  it("lifts the Account menu's row a rung while held, and dims it to 0.5 while disabled", () => {
    const tree = render();
    openAccount(tree.root);
    const row = control(tree.root, "Delete account")!;
    // `ListRow`'s press on iOS (the suite's platform): one rung up the
    // surface ladder, with no dim.
    expect(flatStyle(row.props.style, true).backgroundColor).toBe(
      signetDarkTokens.color.surface.card,
    );
    expect(flatStyle(row.props.style, true).opacity).toBeUndefined();

    // A deletion running locks the row, dimmed whole to 0.5.
    isPending = true;
    const locked = render();
    const lockedRow = control(locked.root, "Deleting account")!;
    expect(lockedRow.props.disabled).toBe(true);
    expect(flatStyle(lockedRow.props.style, false).opacity).toBe(0.5);
  });

  it("fades each view in, and holds still for reduced motion", async () => {
    const tree = render();
    // The reanimated mock keeps the setting each builder was given.
    const entering = () =>
      tree.root
        .findAllByType("Animated.View" as never, { deep: true })
        .map((view) => view.props.entering as { reduceMotionMode?: string });
    const still = [
      expect.objectContaining({
        animation: "FadeIn",
        reduceMotionMode: ReduceMotion.System,
      }),
    ];

    expect(entering()).toEqual(still);
    openInvite(tree.root);
    expect(entering()).toEqual(still);
    typeToken(tree.root, "invite-token-3");
    continueToConfirm(tree.root);
    await settle();
    expect(entering()).toEqual(still);
  });

  it("taps once when the join lands, and not when it fails", async () => {
    const tree = render();
    openInvite(tree.root);
    typeToken(tree.root, "invite-token-7");
    continueToConfirm(tree.root);
    await settle();

    redeemMutateAsync.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();

    redeemMutateAsync.mockResolvedValueOnce({
      chapterId: "ch-1",
      memberId: "m-1",
    });
    await act(async () => {
      await control(tree.root, "Join chapter")?.props.onPress();
    });
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/welcome");
  });
});
