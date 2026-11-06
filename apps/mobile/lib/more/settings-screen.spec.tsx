/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { signetDarkTokens } from "@repo/theme/signet";
import {
  defaultNotificationCategoryState,
  NOTIFICATION_CATEGORIES,
} from "@repo/validation";
import { PUSH_PRIMER_STORAGE_KEY } from "@/lib/notifications/primer";
import { reactNativeStub } from "@/test/react-native-stub";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";

/**
 * s16 Settings, rendered. It renders `app/(app)/preferences.tsx` but lives
 * here: a spec under `app/` ships as a route module (`lib/routes.spec.ts`).
 *
 * Everything below the screen is stubbed at its own seam: the preference
 * sync hook has its own spec (`lib/use-notification-preferences-sync.spec.tsx`),
 * and the session, push permission and delete-account prompt each sit behind
 * a module whose native half doesn't exist under vitest. The primer module is
 * real, so the push switch's accept runs the same `acceptPrimer()` as the s03
 * card, and its stored decision lands in the suite's AsyncStorage mock.
 */

type PushStatus = { granted: boolean; canAskAgain: boolean; status: string };

/**
 * What each test sets before it renders: the permission list, the push
 * module's answers, and the quiet-hours switch. Hoisted so the module mocks
 * below can read it.
 */
const state = vi.hoisted(() => ({
  permissions: [] as string[],
  pushReason: null as string | null,
  quietHoursEnabled: false,
  getPushPermission: (() =>
    new Promise(() => undefined)) as () => Promise<PushStatus | null>,
  isPushChannelBlocked: (async () => false) as () => Promise<boolean>,
  requestPushPermission: vi.fn<() => Promise<boolean>>(async () => true),
  openSettings: vi.fn(async () => undefined),
}));

// The suite's stub has no `Linking`; the push switch's fallback opens the OS
// settings through it.
// `@repo/validation`'s beta list, emptied so these specs draw every
// notification switch as they do with dues on. The beta's own case, dues
// off, sets `betaOff.keys`.
const betaOff = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@repo/validation/beta-off-modules", () => ({
  get BETA_OFF_MODULES() {
    return betaOff.keys;
  },
  isBetaOffModule: (key: string) => betaOff.keys.includes(key),
}));
afterEach(() => {
  betaOff.keys = [];
});

vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("@/test/react-native-stub");
  return {
    ...reactNativeStub,
    Linking: { openSettings: () => state.openSettings() },
  };
});

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useBlockedUserIds: () => ({ data: [], isPending: false, isError: false }),
  useCurrentChapter: () => ({
    data: undefined,
    isPending: true,
    isError: false,
  }),
  useDeleteAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGeofences: () => ({ data: [], isPending: false, isError: false }),
  usePermissionList: () => state.permissions,
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ signOut: vi.fn() }),
}));

vi.mock("@/lib/account/delete-account-prompt", () => ({
  confirmDeleteAccount: vi.fn(),
}));

vi.mock("@/lib/notifications/push", () => ({
  getPushPermission: () => state.getPushPermission(),
  isPushChannelBlocked: () => state.isPushChannelBlocked(),
  requestPushPermission: () => state.requestPushPermission(),
  pushUnavailableReason: () => state.pushReason,
}));

vi.mock("@/lib/use-notification-preferences-sync", () => ({
  useNotificationPreferencesSync: () => ({
    quietHoursEnabled: state.quietHoursEnabled,
    setQuietHoursEnabled: vi.fn(),
    categories: defaultNotificationCategoryState(),
    setCategory: vi.fn(),
    quietHoursWindow: { start: "22:00", end: "07:00", tz: "America/New_York" },
    setQuietHoursWindow: vi.fn(),
    isHydrated: true,
    hydrationRecovered: false,
    persistenceFailed: false,
    isAuthenticated: true,
    chapterId: "chapter-1",
    quietHoursSync: "synced",
    categorySync: "synced",
  }),
}));

vi.mock("@/components/settings/blocked-members-sheet", () => ({
  BlockedMembersSheet: "BlockedMembersSheet",
}));

// A purple chapter, so a control painted house gold fails.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    logoUrl: null,
    chapterName: null,
  }),
}));

import SettingsScreen from "@/app/(app)/preferences";
import { AnalyticsContext } from "@/lib/analytics-provider";

const mounted: ReactTestRenderer[] = [];

function render(
  track: ((name: string, properties?: object) => void) | null = null,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <AnalyticsContext.Provider value={track}>
        <FrappThemeProvider>
          <SettingsScreen />
        </FrappThemeProvider>
      </AnalyticsContext.Provider>,
    );
  });
  mounted.push(tree);
  return tree;
}

beforeEach(() => {
  state.permissions = [];
  state.pushReason = null;
  state.quietHoursEnabled = false;
  state.getPushPermission = () => new Promise(() => undefined);
  state.isPushChannelBlocked = async () => false;
  state.requestPushPermission.mockReset().mockResolvedValue(true);
  state.openSettings.mockReset().mockResolvedValue(undefined);
  vi.mocked(AsyncStorage.setItem).mockClear();
});

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

/** Lets the permission reads and the tap handler's awaits settle. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

function pushSwitches(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Switch" &&
      String(node.props.accessibilityLabel).startsWith("Push notifications"),
  );
}

function pushSwitch(tree: ReactTestRenderer) {
  const found = pushSwitches(tree);
  expect(found).toHaveLength(1);
  return found[0];
}

/** The push row drawn while the permission is unread or unreadable. */
function pushFallbackRow(tree: ReactTestRenderer) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Push notifications",
  );
}

/** The stored primer decisions, in the order they were written. */
function primerWrites(): unknown[] {
  return vi
    .mocked(AsyncStorage.setItem)
    .mock.calls.filter(([key]) => key === PUSH_PRIMER_STORAGE_KEY)
    .map(([, value]) => value);
}

/** #3022. s16 opens from More's Settings row and draws `‹ More`. */
describe("Settings back row (#3022)", () => {
  it("draws ‹ More above the title", () => {
    const tree = render();

    expect(screenText(tree).startsWith("More\nSettings")).toBe(true);
    expectBackRow(tree, "More", "/more");
  });
});

/**
 * Inside a chapter every control takes the chapter's accent
 * (`spec/behavior/branding.md`, owner rule 2026-11-04), so Settings' switches
 * are the shared Toggle in the accent, never the platform's default or house
 * gold (components/toggle.tsx).
 */
describe("Settings switches", () => {
  it("paints every switch in the chapter's accent", async () => {
    // A read permission, so the push switch is drawn too: unread, its row
    // has no switch at all.
    state.getPushPermission = async () => ({
      granted: true,
      canAskAgain: true,
      status: "granted",
    });
    const tree = render();
    await settle();
    const switches = tree.root.findAll(
      (node) => (node.type as unknown) === "Switch",
    );

    // Push, quiet hours, then one per notification category.
    expect(pushSwitches(tree)).toHaveLength(1);
    expect(switches).toHaveLength(2 + NOTIFICATION_CATEGORIES.length);
    for (const node of switches) {
      expect(node.props.trackColor.true).toBe("#8E4EC6");
      expect(node.props.activeThumbColor).toBe("#FFFFFF");
    }
  });
});

/**
 * Settings states settings, not what they're for (the owner's Android test
 * feedback, 2026-11-04). The screen used to carry a two-line hint under every
 * category, a body-size sentence on quiet hours, and standing footnotes even
 * when there was nothing to report, where writing.md §1 asks for "the fewest
 * words that stay clear". A line stays only where it says what the control
 * can't: that a tap leaves the app, that a change reaches the whole chapter,
 * where a read-only value is changed, or what went wrong.
 */
describe("Settings copy", () => {
  it("draws the category switches with their labels only", () => {
    const text = screenText(render());

    for (const category of NOTIFICATION_CATEGORIES) {
      expect(text).toContain(category.label);
      expect(text).not.toContain(category.description);
    }
  });

  it("draws no Billing switch while dues is beta-off", () => {
    betaOff.keys = ["dues"];
    const text = screenText(render());

    expect(text).not.toContain("Billing");
    expect(text).toContain("Tasks");
  });

  it("says nothing about sync once the preferences are synced", () => {
    const text = screenText(render());

    expect(text).not.toContain("Synced with your account.");
  });

  it("scopes the announcements footnote to this screen, never promising delivery", () => {
    // A channel level or a block can still stop an announcement push
    // (spec/behavior/chat/README.md), so "always arrive" claimed too much.
    const text = screenText(render());

    expect(text).toContain("Chapter announcements can't be switched off here.");
    expect(text).not.toContain("always arrive");
  });

  it("says what's wrong with a quiet-hours time that isn't 24-hour HH:mm", () => {
    const tree = render();
    expect(screenText(tree)).not.toContain("Use 24-hour HH:mm times");

    const start = tree.root.find(
      (node) =>
        (node.type as unknown) === "TextInput" &&
        node.props.accessibilityLabel === "Quiet hours start time",
    );
    act(() => start.props.onChangeText("25:99"));

    expect(screenText(tree)).toContain("Use 24-hour HH:mm times (e.g. 21:00).");
    expect(screenText(tree)).not.toContain("Enter a timezone name");
  });

  it("says what's wrong with a quiet-hours timezone that isn't a zone name", () => {
    const tree = render();
    expect(screenText(tree)).not.toContain("Enter a timezone name");

    const tz = tree.root.find(
      (node) =>
        (node.type as unknown) === "TextInput" &&
        node.props.accessibilityLabel === "Quiet hours timezone",
    );
    // A UTC offset, which every runtime rejects (`isUtcOffset`).
    act(() => tz.props.onChangeText("-05:00"));

    expect(screenText(tree)).toContain(
      "Enter a timezone name like America/Chicago.",
    );
    expect(screenText(tree)).not.toContain("Use 24-hour HH:mm times");
  });

  it("shows the quiet-hours window only while quiet hours are on", () => {
    const off = screenText(render());
    expect(off).not.toContain("10:00 PM");
    expect(off).not.toContain("Silence normal-priority pushes");
    expect(off).not.toContain("Saved for when you turn quiet hours back on.");

    state.quietHoursEnabled = true;
    const on = screenText(render());
    expect(on).toContain("10:00 PM – 7:00 AM");
    expect(on).not.toContain("Applies to this account on every device.");
  });

  it("gives an editor's accent row no narration, and no web footnote", () => {
    state.permissions = ["*"];
    const text = screenText(render());

    expect(text).toContain("Chapter accent");
    expect(text).not.toContain("Your organization's colors");
    expect(text).not.toContain("Set by an officer");
    expect(text).not.toContain(
      "Other chapter settings are edited on the web dashboard.",
    );
  });

  it("tells a member who can't edit the accent who can", () => {
    // Chapter config in view, without the manage half of
    // CHAPTER_PROFILE_PERMISSIONS: the row can't open, so it says why.
    state.permissions = ["chapter-config:view"];
    const tree = render();

    expect(screenText(tree)).toContain(
      "Set by an officer with chapter settings access.",
    );
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === "Chapter accent",
      ),
    ).toHaveLength(0);
  });

  it("says where study zones are changed, on their read-only row", () => {
    state.permissions = ["*"];

    // Label, its line, then the value: the line sits under this row's label.
    expect(screenText(render())).toContain(
      "Study zones\nManaged on the web dashboard.\n0 zones",
    );
  });

  it("fills the quiet-hours fields in the card's own tone", () => {
    const tree = render();
    const input = tree.root.find(
      (node) =>
        (node.type as unknown) === "TextInput" &&
        node.props.accessibilityLabel === "Quiet hours start time",
    );

    expect(input.props.style.backgroundColor).toBe(
      signetDarkTokens.color.surface.surface1,
    );
  });
});

/**
 * The push row is the drawn switch, on only when the OS will show a push. A
 * tap asks the OS while a prompt can still help, and opens the OS settings
 * when it can't, or to turn push off. Turning push on used to mean More, then
 * Settings, then Notifications, then the phone's settings on every tap (the
 * owner's Android test feedback, 2026-11-04).
 */
describe("Settings push switch", () => {
  it("asks the OS when it hasn't asked yet, then shows the answer", async () => {
    let granted = false;
    state.getPushPermission = async () => ({
      granted,
      canAskAgain: !granted,
      status: granted ? "granted" : "undetermined",
    });
    state.requestPushPermission.mockImplementation(async () => {
      granted = true;
      return true;
    });
    const tree = render();
    await settle();

    expect(pushSwitch(tree).props.value).toBe(false);
    expect(pushSwitch(tree).props.accessibilityLabel).toBe(
      "Push notifications",
    );
    // A tap that asks needs no line: the switch moving says it.
    expect(screenText(tree)).not.toContain("in your phone's settings.");

    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();

    expect(primerWrites()).toEqual(["accepted"]);
    expect(state.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(state.openSettings).not.toHaveBeenCalled();
    expect(pushSwitch(tree).props.value).toBe(true);
    expect(screenText(tree)).toContain("Turn off in your phone's settings.");
  });

  it("records the primer decision before it shows the OS prompt", async () => {
    // So an app killed while the prompt is up still counts as asked, and the
    // s03 card isn't offered again with a "Turn on" the OS would ignore.
    state.getPushPermission = async () => ({
      granted: false,
      canAskAgain: true,
      status: "undetermined",
    });
    const tree = render();
    await settle();

    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();

    const setItem = vi.mocked(AsyncStorage.setItem);
    const record = setItem.mock.calls.findIndex(
      ([key, value]) => key === PUSH_PRIMER_STORAGE_KEY && value === "accepted",
    );
    expect(record).toBeGreaterThanOrEqual(0);
    expect(state.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(setItem.mock.invocationCallOrder[record]).toBeLessThan(
      state.requestPushPermission.mock.invocationCallOrder[0],
    );
  });

  it.each([
    [true, "allowed"],
    [false, "denied"],
  ])("records the OS answer (%s) as push-prompt-answered from settings", async (granted, answer) => {
    state.getPushPermission = async () => ({
      granted: false,
      canAskAgain: true,
      status: "undetermined",
    });
    state.requestPushPermission.mockResolvedValue(granted);
    const track = vi.fn();
    const tree = render(track);
    await settle();

    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("push-prompt-answered", {
      answer,
      surface: "settings",
    });
  });

  it("stays off after the member denies the OS prompt, and says where to turn it on", async () => {
    let asked = false;
    state.getPushPermission = async () =>
      asked
        ? { granted: false, canAskAgain: false, status: "denied" }
        : { granted: false, canAskAgain: true, status: "undetermined" };
    state.requestPushPermission.mockImplementation(async () => {
      asked = true;
      return false;
    });
    const tree = render();
    await settle();

    expect(screenText(tree)).not.toContain("Turn on in your phone's settings.");
    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();

    expect(state.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(state.openSettings).not.toHaveBeenCalled();
    expect(pushSwitch(tree).props.value).toBe(false);
    expect(pushSwitch(tree).props.accessibilityLabel).toBe(
      "Push notifications, turn on in your phone's settings",
    );
    expect(screenText(tree)).toContain("Turn on in your phone's settings.");
  });

  it("asks on Android 13+ after a first Don't Allow, where the OS still will", async () => {
    // On Android 13+ one "Don't allow" reads `status: "denied"` while
    // `canAskAgain` stays true until a second one (expo-modules-core's
    // `PermissionsService.kt`). The OS still shows its prompt then, so the
    // tap must ask rather than key on `status`.
    state.getPushPermission = async () => ({
      granted: false,
      canAskAgain: true,
      status: "denied",
    });
    const tree = render();
    await settle();

    expect(pushSwitch(tree).props.value).toBe(false);
    expect(pushSwitch(tree).props.accessibilityLabel).toBe(
      "Push notifications",
    );
    expect(screenText(tree)).not.toContain("Turn on in your phone's settings.");

    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();

    expect(primerWrites()).toEqual(["accepted"]);
    expect(state.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(state.openSettings).not.toHaveBeenCalled();
  });

  it("asks once when a second tap lands while the OS prompt is up", async () => {
    // The first tap's permission read settles and its request stays pending,
    // which is the OS prompt on screen. Only then does the second tap land.
    state.getPushPermission = async () => ({
      granted: false,
      canAskAgain: true,
      status: "undetermined",
    });
    let answer!: (granted: boolean) => void;
    state.requestPushPermission.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const tree = render();
    await settle();

    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();
    expect(state.requestPushPermission).toHaveBeenCalledTimes(1);

    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();

    expect(state.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(primerWrites()).toEqual(["accepted"]);
    expect(state.openSettings).not.toHaveBeenCalled();

    answer(false);
    await settle();
    expect(state.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(state.openSettings).not.toHaveBeenCalled();
  });

  it("asks once when a quick double tap lands before the permission read settles", async () => {
    // Both taps arrive in one frame, while the first tap is still reading the
    // permission, so the guard has to be taken before that read.
    state.getPushPermission = async () => ({
      granted: false,
      canAskAgain: true,
      status: "undetermined",
    });
    state.requestPushPermission.mockImplementation(
      () => new Promise<boolean>(() => undefined),
    );
    const tree = render();
    await settle();

    act(() => {
      pushSwitch(tree).props.onValueChange(true);
      pushSwitch(tree).props.onValueChange(true);
    });
    await settle();

    expect(state.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(primerWrites()).toEqual(["accepted"]);
    expect(state.openSettings).not.toHaveBeenCalled();
  });

  it("re-reads the channel when the app comes back from the OS settings", async () => {
    // The member switches the app's channel off in the phone's settings and
    // returns: the foreground re-read is the only thing that sees it.
    state.getPushPermission = async () => ({
      granted: true,
      canAskAgain: true,
      status: "granted",
    });
    // The stub's listener is typed without arguments; the screen passes the
    // event name and its callback.
    const calls = vi.mocked(reactNativeStub.AppState.addEventListener).mock
      .calls as unknown as Array<[string, (next: string) => void]>;
    const before = calls.length;
    const tree = render();
    await settle();
    expect(pushSwitch(tree).props.value).toBe(true);

    const onChange = calls
      .slice(before)
      .find(([event]) => event === "change")?.[1];
    expect(onChange).toBeDefined();

    state.isPushChannelBlocked = async () => true;
    act(() => onChange?.("active"));
    await settle();

    expect(pushSwitch(tree).props.value).toBe(false);
    expect(pushSwitch(tree).props.accessibilityLabel).toBe(
      "Push notifications, turn on in your phone's settings",
    );
  });

  it("reads off on Android 13+ when the permission is granted but the app's notifications are blocked", async () => {
    // expo-notifications 57 sets `granted` from POST_NOTIFICATIONS alone and
    // reports the blocked app only in `status`. No prompt can fix that state
    // (Android answers the request at once), so a tap opens the OS settings.
    state.getPushPermission = async () => ({
      granted: true,
      canAskAgain: true,
      status: "denied",
    });
    const track = vi.fn();
    const tree = render(track);
    await settle();

    expect(pushSwitch(tree).props.value).toBe(false);
    expect(pushSwitch(tree).props.accessibilityLabel).toBe(
      "Push notifications, turn on in your phone's settings",
    );
    expect(screenText(tree)).toContain("Turn on in your phone's settings.");

    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();

    expect(state.requestPushPermission).not.toHaveBeenCalled();
    expect(primerWrites()).toEqual([]);
    expect(state.openSettings).toHaveBeenCalledTimes(1);
    // Opening the OS settings answers no prompt.
    expect(track).not.toHaveBeenCalled();
  });

  it("reads off on Android when the app's channel is switched off, though the permission is granted", async () => {
    // Turning off the "Chapter notifications" category leaves the permission
    // reading granted, and that channel is where the API's pushes show. No
    // prompt turns a channel back on, so a tap opens the OS settings.
    state.getPushPermission = async () => ({
      granted: true,
      canAskAgain: true,
      status: "granted",
    });
    state.isPushChannelBlocked = async () => true;
    const tree = render();
    await settle();

    expect(pushSwitch(tree).props.value).toBe(false);
    expect(pushSwitch(tree).props.accessibilityLabel).toBe(
      "Push notifications, turn on in your phone's settings",
    );
    expect(screenText(tree)).toContain("Turn on in your phone's settings.");

    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();

    expect(state.requestPushPermission).not.toHaveBeenCalled();
    expect(primerWrites()).toEqual([]);
    expect(state.openSettings).toHaveBeenCalledTimes(1);
  });

  it("opens the OS settings rather than asking while the app's channel is switched off", async () => {
    // A grant would leave the channel off and the switch with it.
    state.getPushPermission = async () => ({
      granted: false,
      canAskAgain: true,
      status: "denied",
    });
    state.isPushChannelBlocked = async () => true;
    const tree = render();
    await settle();

    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();

    expect(state.requestPushPermission).not.toHaveBeenCalled();
    expect(state.openSettings).toHaveBeenCalledTimes(1);
  });

  it("opens the OS settings once the OS won't ask again", async () => {
    state.getPushPermission = async () => ({
      granted: false,
      canAskAgain: false,
      status: "denied",
    });
    const tree = render();
    await settle();

    expect(pushSwitch(tree).props.accessibilityLabel).toBe(
      "Push notifications, turn on in your phone's settings",
    );
    act(() => pushSwitch(tree).props.onValueChange(true));
    await settle();

    expect(state.requestPushPermission).not.toHaveBeenCalled();
    expect(state.openSettings).toHaveBeenCalledTimes(1);
  });

  it("sends a member turning push off to the OS settings", async () => {
    state.getPushPermission = async () => ({
      granted: true,
      canAskAgain: true,
      status: "granted",
    });
    const tree = render();
    await settle();

    expect(pushSwitch(tree).props.value).toBe(true);
    expect(pushSwitch(tree).props.accessibilityLabel).toBe(
      "Push notifications, turn off in your phone's settings",
    );
    // A sighted member is told too: the switch snaps back and the phone's
    // settings open, which nothing else on screen would explain.
    expect(screenText(tree)).toContain(
      "Push notifications\nTurn off in your phone's settings.",
    );
    act(() => pushSwitch(tree).props.onValueChange(false));
    await settle();

    expect(state.requestPushPermission).not.toHaveBeenCalled();
    expect(state.openSettings).toHaveBeenCalledTimes(1);
  });

  it("draws no switch until the permission has been read", () => {
    const tree = render();

    expect(pushSwitches(tree)).toHaveLength(0);
  });

  it("keeps a row that acts on a tap while the permission is unread", async () => {
    // The mount read never answers; the tap's own reads do.
    let reads = 0;
    let granted = false;
    state.getPushPermission = () => {
      reads += 1;
      if (reads === 1) return new Promise(() => undefined);
      return Promise.resolve({
        granted,
        canAskAgain: !granted,
        status: granted ? "granted" : "undetermined",
      });
    };
    state.requestPushPermission.mockImplementation(async () => {
      granted = true;
      return true;
    });
    const tree = render();
    await settle();

    const row = pushFallbackRow(tree);
    expect(row.props.accessibilityValue).toEqual({ text: "—" });
    act(() => row.props.onPress());
    await settle();

    expect(state.requestPushPermission).toHaveBeenCalledTimes(1);
    expect(pushSwitch(tree).props.value).toBe(true);
  });

  it("opens the OS settings when the permission can't be read, without an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      state.getPushPermission = () => Promise.reject(new Error("unreadable"));
      const tree = render();
      await settle();

      expect(pushSwitches(tree)).toHaveLength(0);
      act(() => pushFallbackRow(tree).props.onPress());
      await settle();
      // Unhandled rejections are reported after the microtasks drain.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(state.requestPushPermission).not.toHaveBeenCalled();
      expect(state.openSettings).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("states why in a build that can't push, with nothing to tap", async () => {
    state.pushReason = "Notifications need the installed Frapp build.";
    const tree = render();
    await settle();

    const text = screenText(tree);
    expect(text).toContain("Unavailable");
    expect(text).toContain("Notifications need the installed Frapp build.");
    expect(pushSwitches(tree)).toHaveLength(0);
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === "Push notifications",
      ),
    ).toHaveLength(0);
  });
});
