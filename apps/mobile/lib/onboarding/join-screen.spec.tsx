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

/** Where the routing gate would send this session. */
let gateDestination = "join";

const signInWithOAuthProvider = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: authStatus,
    email: sessionEmail,
    userId: "user-1",
    signOut,
    signInWithOAuthProvider,
    sendMagicLink: vi.fn().mockResolvedValue(undefined),
    verifyEmailCode: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lib/onboarding/use-auth-gate", () => ({
  useAuthGateDestination: () => gateDestination,
}));

const selectChapter = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/select-chapter", () => ({
  useSelectChapter: () => selectChapter,
}));

const redeemMutateAsync = vi.fn();
/** The invite card funnel's recorder (#5663). */
const recordInviteStep = vi.fn();

// The invite card's visit id (#5663): a fixed one, since the native module
// isn't in a test run.
vi.mock("expo-crypto", () => ({
  randomUUID: () => "6f1c2a34-9b8d-4e5f-a1b2-c3d4e5f60718",
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRedeemInvite: () => ({ mutateAsync: redeemMutateAsync }),
  useInviteFunnel: () => recordInviteStep,
  useDeleteAccount: () => ({ isPending, isSuccess, mutateAsync }),
}));

/** A live invite's card, named after its token so a spec can tell them apart. */
function liveDetails(token: string) {
  return {
    chapter_name: `Chapter ${token}`,
    university: "Rensselaer Polytechnic Institute",
    mark_text: "FIJI",
    accent_color: "#5b2c83",
    invited_by: "Paul Carlson",
    role: "Member",
    expires_at: "2026-11-26T20:00:00.000Z",
    state: "live",
    chapter_id: "ch-1",
    member_count: 41,
    // Noon UTC: the same calendar day from Hawaii to Tokyo, so the date line
    // reads the same in every CI time zone.
    sent_at: "2026-11-19T12:00:00.000Z",
  };
}

/**
 * What `POST /v1/invites/details` answers (#5625), by token. Unset, a live
 * card for that token.
 */
let detailsAnswer: (token: string) => { data?: unknown; error?: unknown } = (
  token,
) => ({ data: liveDetails(token) });
let askAnswer: { error?: unknown } = {};
const invitePost = vi.fn((path: string, init: { body: { token: string } }) =>
  Promise.resolve(
    path === "/v1/invites/details"
      ? detailsAnswer(init.body.token)
      : path === "/v1/invites/ask-for-new-link"
        ? askAnswer
        : { error: { statusCode: 404 } },
  ),
);
/** The chapters this account is in, as `GET /v1/chapters` answers. */
let memberChapters: unknown[] = [];

/**
 * What `GET /v1/invites/mine` answers (#3782): the invites emailed to this
 * account. Empty unless a spec offers some.
 */
let pendingInvites: unknown[] = [];
const pendingGet = vi.fn(() =>
  Promise.resolve({ data: pendingInvites, error: undefined }),
);

/** Answers the invite reads above, the chapters list, and nothing else. */
const statusClient = {
  POST: invitePost,
  GET: (path: string) =>
    path === "/v1/invites/mine"
      ? pendingGet()
      : path === "/v1/chapters"
        ? Promise.resolve({ data: memberChapters, error: undefined })
        : Promise.resolve({ data: undefined, error: undefined }),
};

vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import {
  FrappClientProvider,
  pendingInviteTitle as offerTitle,
} from "@repo/hooks";
import { OTHER_ACCOUNT_ACTION, OTHER_ACCOUNT_PROMPT } from "@repo/validation";
import { OAUTH_MEMBERSHIP_HINT } from "@repo/hooks/auth-error-copy";
import {
  consumeRememberedInviteToken,
  peekRememberedInviteThen,
  peekRememberedInviteToken,
  rememberInviteToken,
} from "@/lib/onboarding/invite-token";
import { ChapterMarkTile } from "@/components/onboarding/chapter-mark-tile";
import { JoinWithInvite } from "@/components/onboarding/join-with-invite";
import JoinChapter, {
  JOIN_CHOICE_TITLE,
  JOIN_INVITE_TITLE,
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
        .some((text) => textOf(text.props.children).includes(label)),
    );
}

/**
 * Opens the Account menu in the corner, where Delete account lives (Sign out
 * is on the screen's face, #3782).
 */
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

/** The invite card on screen, if there is one (#5625). */
function card(root: Node) {
  return root.findAllByType(JoinWithInvite, { deep: true })[0];
}

/** The invite the card is showing, or null off the card. */
function cardToken(root: Node): string | null {
  return card(root)?.props.token ?? null;
}

/** Joining is pressed from the card once its chapter has been read. */
async function pressJoin(root: Node): Promise<void> {
  await act(async () => {
    await control(root, "Join chapter")?.props.onPress();
  });
}

// An opened invite link is remembered across mounts (`lib/onboarding/
// invite-token.ts`), so a spec that opens one would otherwise send every later
// render straight to the invite card.
beforeEach(() => {
  consumeRememberedInviteToken();
  detailsAnswer = (token) => ({ data: liveDetails(token) });
  askAnswer = {};
  memberChapters = [];
  redeemMutateAsync.mockReset();
  redeemMutateAsync.mockResolvedValue({ chapterId: "ch-1", memberId: "m-1" });
  selectChapter.mockClear();
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
  });

  it("offers account deletion on the screen a zero-membership account is pinned to", () => {
    const tree = render();
    // The trap itself: the same account cannot reach Settings, so this control
    // being reachable here is the whole of the 5.1.1(v) compliance. It lives
    // in the Account menu in the corner (#3350), one tap away on every view.
    // Sign out sits on the screen's face, outside the menu (#3782).
    expect(control(tree.root, "Sign out")).toBeDefined();
    expect(control(tree.root, "Delete account")).toBeUndefined();
    openAccount(tree.root);
    expect(control(tree.root, "Delete account")).toBeDefined();
    // The menu names the account it would delete.
    const menuTitle = tree.root
      .findAllByType("Text" as never, { deep: true })
      .find((t) => t.props.accessibilityRole === "header");
    expect(textOf(menuTitle?.props.children)).toBe(
      "Signed in as brother@westfield.edu",
    );

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
 * #5625. The Terms line under Join replaced the checkbox (Paul, 2026-11-19):
 * the tap is the acceptance, so every join carries it.
 */
describe("join screen — the Terms line (#5625)", () => {
  const params = vi.mocked(useLocalSearchParams);

  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
  });

  afterEach(() => {
    params.mockReturnValue({});
  });

  it("joins with the acceptance, under a line that says so, and no checkbox", async () => {
    params.mockReturnValue({ token: "invite-token-1" });
    const tree = render();
    await settle();

    expect(allText(tree.root)).toContain("By joining you agree to the ");
    expect(
      tree.root
        .findAllByType("Pressable" as never, { deep: true })
        .some((p) => p.props.accessibilityRole === "checkbox"),
    ).toBe(false);

    await pressJoin(tree.root);
    expect(redeemMutateAsync).toHaveBeenCalledWith({
      token: "invite-token-1",
      accept_terms_privacy: true,
    });    // The invite card funnel's last step (#5663).
    expect(recordInviteStep).toHaveBeenCalledWith({ step: "joined" });
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
    addListener.mockClear();
  });

  afterEach(() => {
    params.mockReturnValue({});
    vi.mocked(Linking.useURL).mockReturnValue(null);
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

  it("shows the invite's card before joining with it (#3352, #5625)", async () => {
    const tree = render();
    openInvite(tree.root);
    typeToken(tree.root, "https://app.frapp.live/join?token=invite-token-2a9f");

    continueToConfirm(tree.root);
    await settle();
    // Continue only moves on; nothing is used up yet.
    expect(redeemMutateAsync).not.toHaveBeenCalled();
    // The card, on the invite read out of the pasted link.
    expect(cardToken(tree.root)).toBe("invite-token-2a9f");
    expect(hasField(tree.root)).toBe(false);
    expect(allText(tree.root)).toContain("Chapter invite-token-2a9f");

    await pressJoin(tree.root);
    expect(redeemMutateAsync).toHaveBeenCalledWith({
      token: "invite-token-2a9f",
      accept_terms_privacy: true,
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

  it("goes straight to the invite card when an invite link opened the app", async () => {
    params.mockReturnValue({ token: "invite-token-9" });
    const tree = render();

    expect(cardToken(tree.root)).toBe("invite-token-9");
    await settle();
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

  it("keeps the member on the card while the join is running", async () => {
    // A link lands on the card, then the redeem starts and doesn't come back.
    params.mockReturnValue({ token: "invite-token-10" });
    redeemMutateAsync.mockReturnValue(new Promise(() => {}));
    const tree = render();
    await settle();
    await pressJoin(tree.root);
    expect(cardToken(tree.root)).toBe("invite-token-10");

    expect(labelled(tree.root, "Back to the invite")?.props.disabled).toBe(
      true,
    );

    let handled = false;
    act(() => {
      handled = latestBackHandler()();
    });
    expect(handled).toBe(true);
    expect(cardToken(tree.root)).toBe("invite-token-10");
  });

  it("ignores a second Join while a join is running", async () => {
    params.mockReturnValue({ token: "invite-token-11" });
    redeemMutateAsync.mockReturnValue(new Promise(() => {}));
    const tree = render();
    await settle();
    await pressJoin(tree.root);

    const join = tree.root
      .findAllByType("Pressable" as never, { deep: true })
      .find((p) => p.props.accessibilityState?.busy === true);
    expect(join?.props.disabled).toBe(true);
    await act(async () => {
      await join?.props.onPress();
    });
    expect(redeemMutateAsync).toHaveBeenCalledTimes(1);
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
    expect(cardToken(first.root)).toBe("link-token-13");
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

  it("keeps a remembered invite until it is joined or declined (#5625)", () => {
    // Remembered by the card before a sign-in left the screen.
    rememberInviteToken("invite-token-15");
    const first = render();
    expect(cardToken(first.root)).toBe("invite-token-15");
    act(() => {
      first.unmount();
    });

    // Back again (the sign-in finished, or the app was relaunched): the same
    // card, until the member backs out of it.
    const second = render();
    expect(cardToken(second.root)).toBe("invite-token-15");
    act(() => {
      labelled(second.root, "Back to the invite")?.props.onPress();
    });
    act(() => {
      labelled(second.root, "Back to the choices")?.props.onPress();
    });
    expect(peekRememberedInviteToken()).toBeNull();
    act(() => {
      second.unmount();
    });

    const third = render();
    expect(allText(third.root)).toContain(JOIN_CHOICE_TITLE);
  });
});

/** The text the confirm card's chapter mark tile draws. */
function markText(root: Node): string | undefined {
  const tile = root.findAllByType(ChapterMarkTile, { deep: true })[0];
  return tile?.props.text;
}

/**
 * #3352, #5625. The card names the chapter before the member joins, from a
 * read that needs no sign-in and doesn't use the invite up, and says what to
 * do about a link that died.
 */
describe("join screen — the invite card (#3352, #5625)", () => {
  const params = vi.mocked(useLocalSearchParams);

  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
  });

  afterEach(() => {
    params.mockReturnValue({});
    vi.mocked(Linking.useURL).mockReturnValue(null);
    authStatus = "authenticated";
    consumeRememberedInviteToken();
  });

  it("names the chapter, who sent it, how many are in, and the role, before joining", async () => {
    params.mockReturnValue({ token: "invite-token-20" });
    const tree = render();
    await settle();

    expect(invitePost).toHaveBeenCalledWith("/v1/invites/details", {
      body: { token: "invite-token-20" },
      signal: expect.any(AbortSignal),
    });
    const text = allText(tree.root);
    expect(text).toContain("You're invited to join");
    expect(text).toContain("Chapter invite-token-20");
    expect(text).toContain("Rensselaer Polytechnic Institute");
    expect(text).toContain("Paul Carlson invited you · 41 members");
    expect(text).toContain("You'll join as");
    expect(text).toContain("Member");
    // The tile carries the chapter's own text mark, not its initials.
    expect(markText(tree.root)).toBe("FIJI");
    // Reading it used nothing up.
    expect(redeemMutateAsync).not.toHaveBeenCalled();
  });

  it("says a dead invite is dead, names whom to ask, and asks in one tap", async () => {
    detailsAnswer = (token) => ({
      data: { ...liveDetails(token), state: "expired" },
    });
    params.mockReturnValue({ token: "invite-token-21" });
    const tree = render();
    await settle();

    const text = allText(tree.root);
    expect(text).toContain("This invite has expired");
    expect(text).toContain("Paul Carlson sent it on Thursday, November 19");
    expect(control(tree.root, "Join chapter")).toBeUndefined();
    expect(text).toContain("Paul gets a notification with your name.");

    await act(async () => {
      await control(tree.root, "Ask Paul for a new link")?.props.onPress();
    });
    await settle();
    expect(invitePost).toHaveBeenCalledWith("/v1/invites/ask-for-new-link", {
      body: { token: "invite-token-21" },
    });
    expect(allText(tree.root)).toContain(
      "Asked. Paul got a notification with your name",
    );
    expect(recordInviteStep).toHaveBeenCalledWith({
      step: "card-viewed",
      state: "expired",
      signed_in: true,
    });
    expect(recordInviteStep).toHaveBeenCalledWith({ step: "new-link-asked" });
    // Back still leads to the field, to paste another.
    expect(labelled(tree.root, "Back to the invite")?.props.disabled).toBe(
      false,
    );
  });

  it("turns into the dead card when the join itself finds the invite dead", async () => {
    params.mockReturnValue({ token: "invite-token-23" });
    const tree = render();
    await settle();

    // Live when read, used by someone else before the tap.
    detailsAnswer = (token) => ({
      data: { ...liveDetails(token), state: "used" },
    });
    redeemMutateAsync.mockRejectedValueOnce({
      statusCode: 410,
      message: "Invite already used",
    });
    await pressJoin(tree.root);
    await settle();
    expect(allText(tree.root)).toContain("This invite was already used");
    expect(control(tree.root, "Join chapter")).toBeUndefined();
    expect(recordInviteStep).toHaveBeenCalledWith({
      step: "join-failed",
      reason: "gone",
    });
    // The card is seen again in its new state.
    expect(recordInviteStep).toHaveBeenCalledWith({
      step: "card-viewed",
      state: "used",
      signed_in: true,
    });
  });

  it("says a link that isn't an invite doesn't work, and takes another", async () => {
    detailsAnswer = (token) =>
      token === "not-an-invite"
        ? { error: { statusCode: 404, message: "Invite not found" } }
        : { data: liveDetails(token) };
    params.mockReturnValue({ token: "not-an-invite" });
    const tree = render();
    await settle();

    expect(allText(tree.root)).toContain("This invite link doesn't work");
    act(() => {
      tree.root
        .findAllByType("TextInput" as never, { deep: true })[0]
        .props.onChangeText("https://app.frapp.live/join?token=good-token-1");
    });
    act(() => {
      control(tree.root, "Open invite")?.props.onPress();
    });
    await settle();
    expect(cardToken(tree.root)).toBe("good-token-1");
    expect(allText(tree.root)).toContain("Chapter good-token-1");
  });

  it("offers the chapter instead of a Join to someone already in it", async () => {
    memberChapters = [{ chapter_id: "ch-1", chapter_name: "FIJI" }];
    params.mockReturnValue({ token: "invite-token-22" });
    const tree = render();
    await settle();

    expect(allText(tree.root)).toContain("You're already in");
    expect(control(tree.root, "Join chapter")).toBeUndefined();
    await act(async () => {
      await control(tree.root, "Open chat")?.props.onPress();
    });
    expect(selectChapter).toHaveBeenCalledWith("ch-1");
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("opens the chapter when the join finds the member already in it", async () => {
    redeemMutateAsync.mockRejectedValueOnce({
      statusCode: 409,
      message: "Already a member of this chapter",
    });
    params.mockReturnValue({ token: "invite-token-24" });
    const tree = render();
    await settle();
    await pressJoin(tree.root);
    expect(selectChapter).toHaveBeenCalledWith("ch-1");
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("joins the link just opened, not the invite the field already held", async () => {
    const tree = render();
    openInvite(tree.root);
    typeToken(tree.root, "old-invite-24");

    params.mockReturnValue({ token: "new-invite-24" });
    rerender(tree);
    await settle();

    expect(cardToken(tree.root)).toBe("new-invite-24");
    expect(invitePost).toHaveBeenLastCalledWith("/v1/invites/details", {
      body: { token: "new-invite-24" },
      signal: expect.any(AbortSignal),
    });
  });

  it("reads the invite only on the card, not while typing", async () => {
    const tree = render();
    openInvite(tree.root);
    typeToken(tree.root, "invite-token-25");
    await settle();
    expect(invitePost).not.toHaveBeenCalled();

    continueToConfirm(tree.root);
    await settle();
    expect(invitePost).toHaveBeenCalledTimes(1);
  });

  it("falls back to initials for a chapter with no text mark, and names no role or sender it doesn't have", async () => {
    detailsAnswer = (token) => ({
      data: {
        ...liveDetails(token),
        chapter_name: "Phi Gamma Delta Tau Nu",
        // Letters hidden and no short name: the API sends no mark.
        mark_text: null,
        invited_by: null,
        role: null,
      },
    });
    params.mockReturnValue({ token: "invite-token-26" });
    const tree = render();
    await settle();

    expect(markText(tree.root)).toBe("PG");
    expect(allText(tree.root)).not.toContain("You'll join as");
    expect(allText(tree.root)).not.toContain("invited you");
    expect(allText(tree.root)).toContain("41 members");
  });

  it("holds a link opened while a join runs, then shows it once the join fails", async () => {
    params.mockReturnValue({ token: "invite-token-29" });
    let fail!: (error: unknown) => void;
    redeemMutateAsync.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const tree = render();
    await settle();
    await pressJoin(tree.root);

    params.mockReturnValue({ token: "invite-token-30" });
    rerender(tree);
    // Still the invite being joined.
    expect(cardToken(tree.root)).toBe("invite-token-29");

    await act(async () => {
      fail(new Error("offline"));
    });
    await settle();
    rerender(tree);
    expect(cardToken(tree.root)).toBe("invite-token-30");
  });

  it("keeps an invite the member pasted when the screen re-renders with the old link's param", async () => {
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
  });

  it("keeps a failed join's error when the screen's only invite came from a link", async () => {
    vi.mocked(Linking.useURL).mockReturnValue(
      "frapp://join?token=link-token-34",
    );
    const tree = render();
    await settle();
    redeemMutateAsync.mockRejectedValueOnce({ statusCode: 500 });
    await pressJoin(tree.root);
    const error = allText(tree.root);
    expect(error).toContain("Couldn't join that chapter");
    // The join ends, which lets links through again: nothing new arrived,
    // so the error the member needs stays.
    rerender(tree);
    expect(allText(tree.root)).toBe(error);
    expect(cardToken(tree.root)).toBe("link-token-34");
  });

  it("doesn't bring back a launch param a link replaced", async () => {
    params.mockReturnValue({ token: "invite-token-35" });
    const tree = render();
    await settle();
    vi.mocked(Linking.useURL).mockReturnValue(
      "frapp://join?token=link-token-36",
    );
    rerender(tree);
    expect(cardToken(tree.root)).toBe("link-token-36");

    // Anything else that re-runs the link check with the launch param set.
    vi.mocked(Linking.useURL).mockReturnValue("frapp://other");
    rerender(tree);
    expect(cardToken(tree.root)).toBe("link-token-36");
  });

  it("holds a link opened while the account is being deleted", () => {
    params.mockReturnValue({ token: "invite-token-37" });
    const tree = render();
    isPending = true;
    rerender(tree);

    params.mockReturnValue({ token: "invite-token-38" });
    rerender(tree);
    expect(cardToken(tree.root)).toBe("invite-token-37");

    // The deletion failed: the link applies now.
    isPending = false;
    rerender(tree);
    expect(cardToken(tree.root)).toBe("invite-token-38");
  });

  it("holds a link opened after a join succeeded, while the chapter opens", async () => {
    params.mockReturnValue({ token: "invite-token-39" });
    selectChapter.mockReturnValueOnce(new Promise(() => {}));
    const tree = render();
    await settle();
    await pressJoin(tree.root);

    params.mockReturnValue({ token: "invite-token-40" });
    rerender(tree);
    expect(cardToken(tree.root)).toBe("invite-token-39");
  });

  it("leaves the member on the field after a deletion fails", () => {
    vi.mocked(Linking.useURL).mockReturnValue(
      "frapp://join?token=link-token-43",
    );
    const tree = render();
    act(() => {
      labelled(tree.root, "Back to the invite")?.props.onPress();
    });
    typeToken(tree.root, "invite-token-44");

    isPending = true;
    rerender(tree);
    isPending = false;
    rerender(tree);

    expect(card(tree.root)).toBeUndefined();
    expect(tree.root.findByType("TextInput" as never).props.value).toBe(
      "invite-token-44",
    );
  });
});

/**
 * #5625. Signed out, an invite link opens the card, not sign-in: the chapter
 * first, then one tap that signs in and joins.
 */
describe("join screen — signed out with an invite (#5625)", () => {
  const params = vi.mocked(useLocalSearchParams);

  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
    authStatus = "unauthenticated";
  });

  afterEach(() => {
    authStatus = "authenticated";
    params.mockReturnValue({});
    consumeRememberedInviteToken();
  });

  it("shows the card and the ways in, with the Terms line, and no account chrome", async () => {
    params.mockReturnValue({ token: "invite-token-50" });
    const tree = render();
    await settle();

    const text = allText(tree.root);
    expect(text).toContain("Chapter invite-token-50");
    expect(control(tree.root, "Continue with Apple")).toBeDefined();
    expect(control(tree.root, "Continue with Google")).toBeDefined();
    expect(control(tree.root, "Continue with email")).toBeDefined();
    expect(text).toContain("By continuing you agree to the ");
    expect(text).toContain("Have a password?");
    expect(control(tree.root, "Account")).toBeUndefined();
    expect(control(tree.root, "Sign out")).toBeUndefined();
    expect(tree.root.findAllByType("Redirect" as never)).toHaveLength(0);
  });

  it("remembers the invite marked to join before the sign-in leaves the screen", async () => {
    params.mockReturnValue({ token: "invite-token-51" });
    const tree = render();
    await settle();

    await act(async () => {
      await control(tree.root, "Continue with Google")?.props.onPress();
    });
    expect(signInWithOAuthProvider).toHaveBeenCalledWith("google");
    expect(peekRememberedInviteToken()).toBe("invite-token-51");
    expect(peekRememberedInviteThen()).toBe("join");
    // The invite card funnel (#5663), the same steps web records.
    expect(recordInviteStep).toHaveBeenCalledWith({
      step: "card-viewed",
      state: "live",
      signed_in: false,
    });
    expect(recordInviteStep).toHaveBeenCalledWith({
      step: "sign-in-started",
      method: "google",
    });
  });

  it("records the email way in, the code sent and verified, and a password way in (#5663)", async () => {
    params.mockReturnValue({ token: "invite-token-57" });
    const tree = render();
    await settle();

    act(() => {
      control(tree.root, "Continue with email")?.props.onPress();
    });
    const field = (label: string) =>
      tree.root
        .findAllByType("TextInput" as never, { deep: true })
        .find((input) => input.props.accessibilityLabel === label);
    act(() => {
      field("Email")?.props.onChangeText("winston@rpi.edu");
    });
    await act(async () => {
      await control(tree.root, "Send code")?.props.onPress();
    });
    await settle();
    await act(async () => {
      field("6-digit code")?.props.onChangeText("123456");
    });
    await settle();

    expect(recordInviteStep).toHaveBeenCalledWith({
      step: "sign-in-started",
      method: "email",
    });
    expect(recordInviteStep).toHaveBeenCalledWith({ step: "email-code-sent" });
    expect(recordInviteStep).toHaveBeenCalledWith({
      step: "email-code-verified",
    });

    act(() => {
      control(tree.root, "Back")?.props.onPress();
    });
    act(() => {
      labelled(tree.root, "Have a password? Sign in")?.props.onPress();
    });
    expect(recordInviteStep).toHaveBeenCalledWith({
      step: "sign-in-started",
      method: "password",
    });
  });

  it("sends a visit with no invite to sign-in", () => {
    const tree = render();
    const redirect = tree.root.findAllByType("Redirect" as never)[0];
    expect(redirect?.props.href).toBe("/(auth)/sign-in");
  });

  it("joins on its own when the member comes back signed in from the card", async () => {
    rememberInviteToken("invite-token-52", "join");
    authStatus = "authenticated";
    render();
    await settle();

    expect(redeemMutateAsync).toHaveBeenCalledWith({
      token: "invite-token-52",
      accept_terms_privacy: true,
    });
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/welcome");
    // Joined: nothing is left to remember.
    expect(peekRememberedInviteToken()).toBeNull();
  });

  it("keeps the mark when the screen mounts again with the same invite in its route", async () => {
    // The sign-in leaves and comes back to /join?token=…: the route's invite
    // is the remembered one, so it must not be re-remembered without its mark.
    rememberInviteToken("invite-token-54", "join");
    params.mockReturnValue({ token: "invite-token-54" });
    authStatus = "authenticated";
    render();
    await settle();

    expect(redeemMutateAsync).toHaveBeenCalledWith({
      token: "invite-token-54",
      accept_terms_privacy: true,
    });
  });

  it("drops the mark when the route brings a different invite", async () => {
    rememberInviteToken("invite-token-55", "join");
    params.mockReturnValue({ token: "invite-token-56" });
    authStatus = "authenticated";
    render();
    await settle();

    expect(redeemMutateAsync).not.toHaveBeenCalled();
    expect(peekRememberedInviteToken()).toBe("invite-token-56");
    expect(peekRememberedInviteThen()).toBeNull();
  });

  it("doesn't join on its own for an invite remembered without the mark", async () => {
    rememberInviteToken("invite-token-53");
    authStatus = "authenticated";
    const tree = render();
    await settle();

    expect(redeemMutateAsync).not.toHaveBeenCalled();
    expect(control(tree.root, "Join chapter")).toBeDefined();
  });
});

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
    pendingInvites = [FIJI_OFFER];
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
    expect(cardToken(tree.root)).toBe("invite-token-30");

    act(() => {
      labelled(tree.root, "Back to the invite")?.props.onPress();
    });
    act(() => {
      labelled(tree.root, "Back to the choices")?.props.onPress();
    });
    await settle();
    expect(allText(tree.root)).toContain(JOIN_CHOICE_TITLE);
    expect(allText(tree.root)).not.toContain("You've been invited");
    // Not fetched and then hidden: never asked for at all, not even on the
    // first render, before the link was applied.
    expect(pendingGet).not.toHaveBeenCalled();
  });

  it("never reads the offers when a launch link alone opened the screen", async () => {
    // As on a device: `useURL` is null on its first render and reports the
    // launch URL only after its effect, while `getLinkingURL` has it at once.
    vi.mocked(Linking.getLinkingURL).mockReturnValue(
      "frapp://join?token=link-token-61",
    );
    vi.mocked(Linking.useURL)
      .mockReturnValueOnce(null)
      .mockReturnValue("frapp://join?token=link-token-61");
    try {
      const tree = render();
      await settle();
      rerender(tree);
      await settle();
      expect(cardToken(tree.root)).toBe("link-token-61");
      expect(pendingGet).not.toHaveBeenCalled();
    } finally {
      vi.mocked(Linking.getLinkingURL).mockReturnValue(null);
    }
  });

  it("never reads the offers when a remembered invite brought the member back", async () => {
    // The sign-in bounce: no params and no link, only the invite remembered.
    rememberInviteToken("remembered-token-62");
    const tree = render();
    await settle();
    expect(cardToken(tree.root)).toBe("remembered-token-62");
    expect(pendingGet).not.toHaveBeenCalled();
  });

  it("opens the confirm step on the offer's invite, and Join redeems that invite", async () => {
    const tree = render();
    await settle();

    act(() => {
      control(tree.root, offerTitle("FIJI Tau Nu"))?.props.onPress();
    });
    await settle();
    // The card, on the offer's invite: nothing joined yet.
    expect(hasConfirmButton(tree.root)).toBe(true);
    expect(cardToken(tree.root)).toBe(FIJI_OFFER.token);
    expect(redeemMutateAsync).not.toHaveBeenCalled();

    await pressJoin(tree.root);
    expect(redeemMutateAsync).toHaveBeenCalledWith({
      token: FIJI_OFFER.token,
      accept_terms_privacy: true,
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

  it("puts back an invite the member had pasted when they back out of an offer", async () => {
    const tree = render();
    await settle();
    openInvite(tree.root);
    typeToken(tree.root, "pasted-token-50");
    act(() => {
      labelled(tree.root, "Back to the choices")?.props.onPress();
    });

    act(() => {
      control(tree.root, offerTitle("FIJI Tau Nu"))?.props.onPress();
    });
    expect(cardToken(tree.root)).toBe(FIJI_OFFER.token);
    act(() => {
      labelled(tree.root, "Back to the choices")?.props.onPress();
    });

    openInvite(tree.root);
    expect(tree.root.findByType("TextInput" as never).props.value).toBe(
      "pasted-token-50",
    );
  });

  /** Whether the card's Join is on screen. */
  function hasConfirmButton(root: Node): boolean {
    return control(root, "Join chapter") !== undefined;
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

  it("shows the account and Sign out on the question, the field and the card", () => {
    const tree = render();
    expect(allText(tree.root)).toContain(JOIN_CHOICE_TITLE);
    expectAccountLine(tree.root);

    openInvite(tree.root);
    expect(allText(tree.root)).toContain(JOIN_INVITE_TITLE);
    expectAccountLine(tree.root);

    typeToken(tree.root, "invite-token-40");
    continueToConfirm(tree.root);
    expect(cardToken(tree.root)).toBe("invite-token-40");
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

  it("locks Join, Account and Back while the sign-out is on its way", async () => {
    // A sign-out that hasn't come back yet.
    signOut.mockReturnValueOnce(new Promise<void>(() => {}));
    const tree = render();
    openInvite(tree.root);
    typeToken(tree.root, "invite-token-42");
    continueToConfirm(tree.root);
    await settle();
    expect(control(tree.root, "Join chapter")?.props.disabled).toBe(false);

    await act(async () => {
      control(tree.root, "Sign out")?.props.onPress();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(control(tree.root, "Account")?.props.disabled).toBe(true);
    expect(control(tree.root, "Sign out")?.props.disabled).toBe(true);
    expect(labelled(tree.root, "Back to the invite")?.props.disabled).toBe(
      true,
    );
  });

  it("holds Sign out while a join is running", async () => {
    params.mockReturnValue({ token: "invite-token-43" });
    redeemMutateAsync.mockReturnValue(new Promise(() => {}));
    const tree = render();
    await settle();
    await pressJoin(tree.root);
    expect(control(tree.root, "Sign out")?.props.disabled).toBe(true);
  });
});

/**
 * The onboarding polish pass: s02 draws the board's `‹ Back` row in house
 * gold (the shared `BackRow`, not a bare chevron), the question carries no
 * line narrating its own two choices, each view fades in (but not for a
 * member who reduces motion), and a join that lands marks it with the same
 * success tap a chapter going live gets.
 */
describe("join screen — polish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    isSuccess = false;
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
    await pressJoin(tree.root);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();

    redeemMutateAsync.mockResolvedValueOnce({
      chapterId: "ch-1",
      memberId: "m-1",
    });
    await pressJoin(tree.root);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/welcome");
  });
});

describe("join screen — Already in a chapter? (replaced New account created)", () => {
  const params = vi.mocked(useLocalSearchParams);
  const LINE = `${OTHER_ACCOUNT_PROMPT} ${OTHER_ACCOUNT_ACTION}`;
  const line = (root: Node) => labelled(root, LINE);

  beforeEach(() => {
    vi.clearAllMocks();
    gateDestination = "join";
    pendingInvites = [];
  });

  afterEach(() => {
    gateDestination = "join";
    pendingInvites = [];
    params.mockReturnValue({});
    consumeRememberedInviteToken();
  });

  it("puts one quiet line under the two answers, and no card above them", async () => {
    const tree = render();
    await settle();
    const text = allText(tree.root);
    expect(line(tree.root)).toBeDefined();
    expect(text).not.toContain("New account created");
    expect(text).not.toContain("Continue with the new account");
    // Under the answers, not competing with the question.
    expect(text.indexOf(OTHER_ACCOUNT_PROMPT)).toBeGreaterThan(
      text.indexOf("I'm starting our chapter"),
    );
  });

  it("signs out in one tap", async () => {
    const tree = render();
    await settle();
    await act(async () => {
      line(tree.root)?.props.onPress();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("waits for the emailed-invites read, so it never shows and then vanishes", () => {
    const tree = render();
    expect(line(tree.root)).toBeUndefined();
  });

  it("isn't shown when an invite was emailed to this account", async () => {
    pendingInvites = [
      {
        chapter_name: "FIJI Tau Nu",
        university: "Rensselaer Polytechnic Institute",
        mark_text: "FIJI",
        accent_color: "#5b2c83",
        invited_by: "Paul Carlson",
        role: "Member",
        expires_at: "2026-11-10T20:00:00.000Z",
        token: "offer-token-fiji",
      },
    ];
    const tree = render();
    await settle();
    expect(line(tree.root)).toBeUndefined();
  });

  it("isn't shown when an invite link opened the screen", async () => {
    params.mockReturnValue({ token: "inv-abc123" });
    const tree = render();
    await settle();
    expect(allText(tree.root)).not.toContain(OTHER_ACCOUNT_PROMPT);
  });

  it("isn't shown to a member who opened Join from the picker", async () => {
    gateDestination = "tabs";
    const tree = render();
    await settle();
    expect(line(tree.root)).toBeUndefined();
  });
});
