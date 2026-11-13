/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText } from "@/test/screen-text";
import { flatStyle } from "@/test/flat-style";

/**
 * s03 is what comes right after joining a chapter, for a new member and for an
 * App Reviewer alike, in up to three beats: the profile beat (no photo or no
 * real name), the chat display pick (always, #3787), then "Turn on
 * notifications" when this build can push and push is off. In a build that
 * cannot push (#2299; `isPushAvailable()` false, `spec/ui/mobile/patterns.md`
 * § Push notifications lists the causes) there is no notifications beat at
 * all, rather than a dead "Turn on" and an apology. After the last beat, s03
 * goes to chat, where the first-run tour takes over
 * (`lib/onboarding/tour.ts`); the static "You're in." card is gone.
 * `lib/notifications/primer.spec.ts` covers the rules; this covers the screen
 * wiring them.
 *
 * It renders `app/(auth)/welcome.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

interface Permission {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}
let pushAvailable = false;
let permission: Permission | null = null;
const OFF: Permission = {
  granted: false,
  canAskAgain: true,
  status: "undetermined",
};

vi.mock("@/lib/notifications/push", () => ({
  isPushAvailable: () => pushAvailable,
  getPushPermission: () => Promise.resolve(permission),
  isPushChannelBlocked: () => Promise.resolve(false),
  requestPushPermission: vi.fn().mockResolvedValue(true),
}));

/** `Linking` isn't in the suite's `react-native` stub; this spec adds it. */
const { openSettings } = vi.hoisted(() => ({
  openSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("@/test/react-native-stub");
  return { ...reactNativeStub, Linking: { openSettings } };
});

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ status: "authenticated", chapterId: null }),
}));

const completeOnboarding = vi.fn().mockResolvedValue(undefined);
const updateUser = vi.fn().mockResolvedValue({});
/** `/v1/users/me`. A full profile by default, so the profile beat is skipped. */
const COMPLETE_USER = {
  id: "u-1",
  display_name: "Ada Lovelace",
  avatar_url: "https://example.test/ada.jpg",
};
let currentUser: Record<string, unknown> | undefined = COMPLETE_USER;

const track = vi.fn();
vi.mock("@/lib/use-latest-track", () => ({ useLatestTrack: () => track }));

/** The photo control has its own spec; here it only has to be there. */
vi.mock("@/components/profile/profile-photo", () => ({
  ProfilePhoto: (props: { initials: string }) =>
    React.createElement("ProfilePhoto", props),
}));

// Meet Frapp AI's answers (#4790). AI is off unless a spec turns it on, so
// the other beats' specs run as before.
const aiChoice = vi.hoisted(() => ({
  consent: null as unknown,
  consentFailed: false,
  readConsent: () => Promise.resolve(null),
  providers: ["Anthropic", "Google"],
  forChapter: false,
  turnOn: vi.fn(() => Promise.resolve(true)),
  notNow: vi.fn(() => Promise.resolve()),
  pending: false,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useFrappAiChoice: () => aiChoice,
  useListChapters: () => ({
    data: [
      {
        chapter: {
          id: "ch-1",
          name: "FIJI Tau Nu",
          university: "Rensselaer Polytechnic Institute",
        },
      },
    ],
  }),
  useChannels: () => ({ isPending: false, isError: false, data: [] }),
  // The display beat's cards paint in the chapter accent (`useChapterBranding`).
  useCurrentChapter: () => ({ data: undefined }),
  useUpdateOnboarding: () => ({ mutateAsync: completeOnboarding }),
  useCurrentUser: () => ({ data: currentUser, dataUpdatedAt: 1 }),
  useUpdateUser: () => ({ mutateAsync: updateUser }),
}));

import { useRouter } from "expo-router";
import Welcome from "@/app/(auth)/welcome";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requestPushPermission } from "@/lib/notifications/push";
import {
  PUSH_PRIMER_DECLINED_AT_KEY,
  PUSH_PRIMER_STORAGE_KEY,
} from "@/lib/notifications/primer";
import { TOUR_DUE_STORAGE_KEY } from "@/lib/onboarding/tour";
import { DISPLAY_STEP_TITLE } from "@/lib/onboarding/display-step";
import { CHAT_DENSITY_STORAGE_KEY } from "@repo/chat-core/density";

type Node = ReactTestRenderer["root"];

/**
 * Renders s03. By default it also answers the display beat (#3787) when that
 * is the first beat, so a spec about the notifications beat starts on it.
 */
async function render({
  passDisplay = true,
}: { passDisplay?: boolean } = {}): Promise<ReactTestRenderer> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <FrappThemeProvider>
          <Welcome />
        </FrappThemeProvider>
      </QueryClientProvider>,
    );
  });
  // Let the primer-decision and permission reads resolve, so the screen shows
  // what they said rather than its first frame.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  if (passDisplay) await answerDisplay(tree.root);
  return tree;
}

const onDisplayBeat = (root: Node) =>
  root
    .findAllByType("Text" as never, { deep: true })
    .some((text) => text.props.children === DISPLAY_STEP_TITLE);

/** Moves on from the display beat, keeping the preselected display. */
async function answerDisplay(root: Node) {
  if (!onDisplayBeat(root)) return;
  const next =
    button(root, "Continue") ?? button(root, "Go to chat") ?? undefined;
  await press(next);
}

const texts = (root: Node) =>
  root
    .findAllByType("Text" as never, { deep: true })
    .map((text) => JSON.stringify(text.props.children ?? ""));

const turnOn = (root: Node) =>
  root
    .findAllByType("Pressable" as never, { deep: true })
    .find(
      (pressable) =>
        pressable.props.accessibilityLabel === "Turn on notifications",
    );

const pressables = (root: Node) =>
  root.findAllByType("Pressable" as never, { deep: true });

/** The Pressable whose own text reads `label`. */
const button = (root: Node, label: string) =>
  pressables(root).find((pressable) =>
    pressable
      .findAllByType("Text" as never, { deep: true })
      .some((text) => text.props.children === label),
  );

async function press(target: Node | undefined) {
  await act(async () => {
    await target?.props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("s03 welcome, notifications step", () => {
  beforeEach(() => {
    pushAvailable = false;
    permission = null;
    completeOnboarding.mockClear();
    openSettings.mockClear();
    vi.mocked(requestPushPermission).mockClear().mockResolvedValue(true);
    vi.mocked(vi.mocked(useRouter)().replace).mockClear();
  });

  it("has no notifications step when push is unavailable", async () => {
    permission = OFF;
    const { root } = await render();

    expect(turnOn(root)).toBeUndefined();
    expect(requestPushPermission).not.toHaveBeenCalled();
    // Nothing to ask: straight to chat.
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("has no notifications step when push is already on", async () => {
    pushAvailable = true;
    permission = { granted: true, canAskAgain: true, status: "granted" };
    const { root } = await render();

    expect(turnOn(root)).toBeUndefined();
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("opens on the notifications beat when it's the only thing to ask", async () => {
    pushAvailable = true;
    permission = OFF;
    const { root } = await render();

    // No "You're in." card first: the tour over chat says that now.
    expect(texts(root).some((t) => t.includes("in."))).toBe(false);
    // Its own title, both answers pinned under the scroll.
    expect(texts(root).some((t) => t.includes("Turn on notifications"))).toBe(
      true,
    );
    const scroll = root.findByType("ScrollView" as never);
    expect(
      scroll.findAllByType("Pressable" as never, { deep: true }),
    ).toHaveLength(0);
    expect(button(root, "Turn on notifications")).toBeDefined();
    expect(button(root, "Not now")).toBeDefined();
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("shows the OS prompt on Turn on, then goes to chat", async () => {
    pushAvailable = true;
    permission = OFF;
    const { root } = await render();

    await press(button(root, "Turn on notifications"));

    expect(requestPushPermission).toHaveBeenCalledTimes(1);
    expect(completeOnboarding).toHaveBeenCalledWith({
      has_completed_onboarding: true,
    });
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("goes to chat after a Don't Allow too", async () => {
    pushAvailable = true;
    permission = OFF;
    vi.mocked(requestPushPermission).mockResolvedValueOnce(false);
    const { root } = await render();

    await press(button(root, "Turn on notifications"));

    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("goes to chat on Not now, with no OS prompt, and keeps when it was said", async () => {
    pushAvailable = true;
    permission = OFF;
    const { root } = await render();

    await press(button(root, "Not now"));

    expect(requestPushPermission).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PUSH_PRIMER_STORAGE_KEY,
      "declined",
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PUSH_PRIMER_DECLINED_AT_KEY,
      expect.any(String),
    );
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  // iOS after an earlier Don't Allow, or Android after
  // a second one: no dialog can appear, so the button says where it goes.
  it("opens the phone's settings when no prompt can appear", async () => {
    pushAvailable = true;
    permission = { granted: false, canAskAgain: false, status: "denied" };
    const { root } = await render();

    expect(button(root, "Turn on notifications")).toBeUndefined();
    await press(button(root, "Open Settings"));

    expect(requestPushPermission).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("takes Android 13+ granted-but-blocked as off", async () => {
    pushAvailable = true;
    permission = { granted: true, canAskAgain: false, status: "denied" };
    const { root } = await render();

    expect(button(root, "Open Settings")).toBeDefined();
  });
  // The decision is stored before the OS prompt and before the PATCH that
  // ends onboarding. Neither may drop the member back on an earlier beat with
  // a live Continue while the answer finishes.
  it("keeps the step, with its buttons off, while an answer finishes", async () => {
    pushAvailable = true;
    permission = OFF;
    let finishPatch!: () => void;
    completeOnboarding.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishPatch = resolve)),
    );
    const { root } = await render();

    await press(button(root, "Not now"));

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(button(root, "Continue")).toBeUndefined();
    expect(button(root, "Not now")?.props.disabled).toBe(true);
    await press(button(root, "Not now"));
    expect(completeOnboarding).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishPatch();
    });
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("leaves Android back alone on the first beat, and walks back to it from notifications", async () => {
    const { BackHandler } = await import("react-native");
    const listen = vi.mocked(BackHandler.addEventListener);
    listen.mockClear();
    pushAvailable = true;
    permission = OFF;
    const { root } = await render({ passDisplay: false });

    expect(onDisplayBeat(root)).toBe(true);
    expect(
      listen.mock.calls.filter(([event]) => event === "hardwareBackPress"),
    ).toHaveLength(0);

    await answerDisplay(root);
    expect(button(root, "Not now")).toBeDefined();
    const calls = listen.mock.calls as unknown as [string, () => boolean][];
    const handler = calls.filter(([e]) => e === "hardwareBackPress").at(-1);
    act(() => {
      handler![1]();
    });
    expect(onDisplayBeat(root)).toBe(true);
  });
});

/**
 * A member with a name, a photo and push on is asked only for their chat
 * display (#3787), then handed over to chat, marking the first-run tour due
 * for that member on the way out.
 */
/**
 * Meet Frapp AI (#4790): after the display beat, for a member who has never
 * answered it on a server with AI. Continue turns it on, Not now leaves it
 * off, and either moves on.
 */
describe("s03 welcome, Meet Frapp AI beat", () => {
  const UNANSWERED = {
    answer: null,
    answered_at: null,
    sheet_changed: false,
    sheet: { version: 2, providers: [], data: [] },
  };
  const allText = (root: Node) =>
    root
      .findAllByType("Text" as never, { deep: true })
      .map((text) => drawnText(text))
      .join("\n");
  const onAiBeat = (root: Node) => allText(root).includes("Meet Frapp AI");

  beforeEach(() => {
    pushAvailable = false;
    permission = null;
    currentUser = COMPLETE_USER;
    aiChoice.consent = UNANSWERED;
    aiChoice.turnOn.mockClear().mockResolvedValue(true);
    aiChoice.notNow.mockClear().mockResolvedValue(undefined);
    completeOnboarding.mockClear();
    vi.mocked(vi.mocked(useRouter)().replace).mockClear();
  });

  afterEach(() => {
    aiChoice.consent = null;
  });

  it("follows the display beat, naming the companies, then goes to chat on Continue", async () => {
    const { root } = await render();

    expect(onAiBeat(root)).toBe(true);
    expect(allText(root)).toContain(
      "Frapp AI works with Anthropic and Google.",
    );
    expect(completeOnboarding).not.toHaveBeenCalled();

    await press(button(root, "Continue"));
    expect(aiChoice.turnOn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("records Not now and moves on", async () => {
    const { root } = await render();

    await press(button(root, "Not now"));
    expect(aiChoice.notNow).toHaveBeenCalledTimes(1);
    expect(aiChoice.turnOn).not.toHaveBeenCalled();
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("comes before the notifications beat", async () => {
    pushAvailable = true;
    permission = OFF;
    const { root } = await render();

    expect(onAiBeat(root)).toBe(true);
    await press(button(root, "Continue"));
    expect(button(root, "Turn on notifications")).toBeDefined();
  });

  it("stays, with the reason, when Continue can't be saved", async () => {
    aiChoice.turnOn.mockRejectedValue(new Error("offline"));
    const { root } = await render();

    await press(button(root, "Continue"));
    expect(onAiBeat(root)).toBe(true);
    expect(allText(root)).toMatch(/try again/i);
    expect(vi.mocked(useRouter)().replace).not.toHaveBeenCalled();
  });

  it.each([
    ["the server has no AI", null],
    ["the member already answered", { ...UNANSWERED, answer: "no" }],
  ])("isn't shown when %s", async (_why, consent) => {
    aiChoice.consent = consent;
    const { root } = await render();

    expect(onAiBeat(root)).toBe(false);
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });
});

describe("s03 welcome, only the display to pick", () => {
  beforeEach(() => {
    pushAvailable = false;
    permission = null;
    currentUser = COMPLETE_USER;
    completeOnboarding.mockClear();
    vi.mocked(AsyncStorage.setItem).mockClear();
    vi.mocked(vi.mocked(useRouter)().replace).mockClear();
  });

  it("asks for the display, with Cozy picked, then goes to chat and marks the tour due", async () => {
    const { root } = await render({ passDisplay: false });

    expect(onDisplayBeat(root)).toBe(true);
    const cozy = pressables(root).find(
      (p) => p.props.accessibilityLabel === "Cozy",
    );
    expect(cozy?.props.accessibilityState).toEqual({ checked: true });
    expect(completeOnboarding).not.toHaveBeenCalled();

    await press(button(root, "Go to chat"));
    expect(completeOnboarding).toHaveBeenCalledWith({
      has_completed_onboarding: true,
    });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      TOUR_DUE_STORAGE_KEY,
      "u-1",
    );
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("saves a picked display on this phone", async () => {
    const { root } = await render({ passDisplay: false });
    vi.mocked(AsyncStorage.setItem).mockClear();

    await press(
      pressables(root).find((p) => p.props.accessibilityLabel === "Bubbles"),
    );

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      CHAT_DENSITY_STORAGE_KEY,
      "bubbles",
    );
    expect(
      pressables(root).find((p) => p.props.accessibilityLabel === "Bubbles")
        ?.props.accessibilityState,
    ).toEqual({ checked: true });
  });
});

/**
 * One gold button on each beat of s03: Continue or Go to chat on the profile
 * beat, Turn on notifications on the notifications beat, with Not now as a
 * quiet line.
 */
describe("s03 welcome, one gold button", () => {
  const goToChat = (root: Node) =>
    root
      .findAllByType("Pressable" as never, { deep: true })
      .find((pressable) =>
        pressable
          .findAllByType("Text" as never, { deep: true })
          .some((text) => text.props.children === "Go to chat"),
      );

  /** A Pressable's resting fill. */
  const fill = (pressable: Node | undefined): unknown =>
    flatStyle(pressable?.props.style).backgroundColor;

  beforeEach(() => {
    pushAvailable = false;
    permission = null;
    // No photo, so there is a profile beat to hold the button.
    currentUser = { ...COMPLETE_USER, avatar_url: null };
  });

  it("makes Turn on notifications the gold button on the second beat", async () => {
    pushAvailable = true;
    permission = OFF;
    const { root } = await render();
    expect(fill(button(root, "Continue"))).toBe(
      signetDarkTokens.color.gold.house,
    );
    await press(button(root, "Continue"));
    await answerDisplay(root);

    expect(fill(button(root, "Turn on notifications"))).toBe(
      signetDarkTokens.color.gold.house,
    );
    expect(fill(button(root, "Not now"))).not.toBe(
      signetDarkTokens.color.gold.house,
    );
  });

  it("makes Go to chat the gold button when there is no primer", async () => {
    const { root } = await render();
    await press(button(root, "Continue"));

    expect(fill(goToChat(root))).toBe(signetDarkTokens.color.gold.house);
  });

  it("spins under the same label while it leaves, rather than renaming itself", async () => {
    completeOnboarding.mockReturnValueOnce(new Promise(() => {}));
    const { root } = await render();
    await press(button(root, "Continue"));
    act(() => {
      void goToChat(root)?.props.onPress();
    });

    const leaving = root
      .findAllByType("Pressable" as never, { deep: true })
      .find((pressable) => pressable.props.accessibilityLabel === "Go to chat");
    expect(leaving?.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(texts(root).some((t) => t.includes("Opening chat"))).toBe(false);
  });
});

/**
 * The profile beat: shown when the member has no photo or no real name, before
 * the notifications beat. The name is checked on Continue and
 * saved only when it changed; the photo is optional.
 */
describe("s03 welcome, profile beat", () => {
  const field = (root: Node) =>
    root
      .findAllByType("TextInput" as never, { deep: true })
      .find((input) => input.props.accessibilityLabel === "Your name");

  beforeEach(() => {
    pushAvailable = false;
    permission = null;
    currentUser = COMPLETE_USER;
    completeOnboarding.mockClear();
    updateUser.mockClear().mockResolvedValue({});
    track.mockClear();
    vi.mocked(vi.mocked(useRouter)().replace).mockClear();
  });

  const profileEvents = () =>
    track.mock.calls.filter(
      ([event]) => event === "onboarding-profile-answered",
    );

  it("is skipped for a member with a name and a photo", async () => {
    const { root } = await render();

    expect(
      texts(root).some((t) => t.includes("How the chapter sees you")),
    ).toBe(false);
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("asks for a photo with the name filled in, and doesn't resend the name", async () => {
    currentUser = { ...COMPLETE_USER, avatar_url: null };
    const { root } = await render();

    expect(
      texts(root).some((t) => t.includes("How the chapter sees you")),
    ).toBe(true);
    expect(root.findAllByType("ProfilePhoto" as never)).toHaveLength(1);
    expect(field(root)?.props.value).toBe("Ada Lovelace");

    await press(button(root, "Continue"));
    expect(updateUser).not.toHaveBeenCalled();
    await answerDisplay(root);
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
    expect(profileEvents()).toEqual([
      ["onboarding-profile-answered", { photo: "none", name_step: "kept" }],
    ]);
  });

  it("never pre-fills the Member stand-in, and needs a name before moving on", async () => {
    currentUser = { ...COMPLETE_USER, display_name: "Member" };
    const { root } = await render();

    expect(field(root)?.props.value).toBe("");
    await press(button(root, "Continue"));
    expect(
      texts(root).some((t) => t.includes("so the chapter knows who")),
    ).toBe(true);
    expect(updateUser).not.toHaveBeenCalled();
    expect(completeOnboarding).not.toHaveBeenCalled();

    act(() => field(root)?.props.onChangeText("  Grace Hopper "));
    expect(
      texts(root).some((t) => t.includes("so the chapter knows who")),
    ).toBe(false);
    await press(button(root, "Continue"));

    expect(updateUser).toHaveBeenCalledWith({ display_name: "Grace Hopper" });
    // Shape only: never the name itself.
    expect(profileEvents()).toEqual([
      ["onboarding-profile-answered", { photo: "had", name_step: "added" }],
    ]);
    await answerDisplay(root);
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("stays, with the reason, when the name can't be saved", async () => {
    currentUser = { ...COMPLETE_USER, display_name: "" };
    updateUser.mockRejectedValueOnce(new Error("offline"));
    const { root } = await render();
    act(() => field(root)?.props.onChangeText("Grace Hopper"));

    await press(button(root, "Continue"));

    expect(texts(root).some((t) => t.includes("Couldn't save your name"))).toBe(
      true,
    );
    expect(completeOnboarding).not.toHaveBeenCalled();
    expect(field(root)?.props.value).toBe("Grace Hopper");
    expect(profileEvents()).toEqual([]);
  });

  it("comes before the notifications beat, and Android back walks back through it", async () => {
    const { BackHandler } = await import("react-native");
    const listen = vi.mocked(BackHandler.addEventListener);
    listen.mockClear();
    pushAvailable = true;
    permission = OFF;
    currentUser = { ...COMPLETE_USER, avatar_url: null };
    const { root } = await render();

    expect(field(root)).toBeDefined();
    await press(button(root, "Continue"));
    expect(onDisplayBeat(root)).toBe(true);
    await answerDisplay(root);
    expect(button(root, "Not now")).toBeDefined();

    const back = () => {
      const calls = listen.mock.calls as unknown as [string, () => boolean][];
      const handler = calls.filter(([e]) => e === "hardwareBackPress").at(-1);
      act(() => {
        handler![1]();
      });
    };
    back();
    expect(onDisplayBeat(root)).toBe(true);
    expect(button(root, "Not now")).toBeUndefined();
    back();
    expect(field(root)).toBeDefined();
  });
});
