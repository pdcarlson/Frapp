import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushNotificationResponse } from "./push-types";

// The module caches its load attempt, so each test re-imports a fresh copy.
// `vi.hoisted`, because the factory below is lifted to the top of the file —
// the pattern `lib/keyboard.spec.ts` established and `lib/payments/stripe.spec.ts`
// copied for the sibling isolation module.
const constantsState = vi.hoisted(() => ({
  executionEnvironment: "bare",
  projectId: "00000000-0000-4000-8000-000000000000" as string | undefined,
}));

vi.mock("expo-constants", () => ({
  default: {
    get executionEnvironment() {
      return constantsState.executionEnvironment;
    },
    get expoConfig() {
      return { extra: { eas: { projectId: constantsState.projectId } } };
    },
  },
  ExecutionEnvironment: {
    Bare: "bare",
    Standalone: "standalone",
    StoreClient: "storeClient",
  },
}));

function fakeModule() {
  return {
    setNotificationChannelAsync: vi.fn().mockResolvedValue(null),
    getPermissionsAsync: vi
      .fn()
      .mockResolvedValue({
        granted: false,
        canAskAgain: true,
        status: "undetermined",
      }),
    requestPermissionsAsync: vi
      .fn()
      .mockResolvedValue({
        granted: true,
        canAskAgain: false,
        status: "granted",
      }),
    getExpoPushTokenAsync: vi
      .fn()
      .mockResolvedValue({ type: "expo", data: "ExponentPushToken[abc]" }),
    getLastNotificationResponse: vi.fn<() => PushNotificationResponse | null>(
      () => null,
    ),
    clearLastNotificationResponse: vi.fn(),
    addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
    scheduleNotificationAsync: vi.fn().mockResolvedValue("local-1"),
    cancelScheduledNotificationAsync: vi.fn().mockResolvedValue(undefined),
    dismissNotificationAsync: vi.fn().mockResolvedValue(undefined),
    setNotificationHandler: vi.fn(),
  };
}

async function importPush() {
  return await import("./push");
}

describe("push isolation module", () => {
  beforeEach(() => {
    vi.resetModules();
    constantsState.executionEnvironment = "bare";
    constantsState.projectId = "00000000-0000-4000-8000-000000000000";
  });

  it("never invokes the loader in Expo Go", async () => {
    constantsState.executionEnvironment = "storeClient";
    const push = await importPush();
    const loader = vi.fn(fakeModule);
    push.setPushLoaderForTests(loader);

    expect(push.isPushAvailable()).toBe(false);
    // The crash-prevention property itself: in Expo Go the package must never
    // be loaded, not merely reported as unavailable.
    expect(loader).not.toHaveBeenCalled();
  });

  it("is available outside Expo Go with a project id", async () => {
    const push = await importPush();
    push.setPushLoaderForTests(fakeModule);

    expect(push.isPushAvailable()).toBe(true);
    expect(push.pushUnavailableReason()).toBeNull();
  });

  it("gives a different reason for Expo Go than for a missing project id", async () => {
    constantsState.executionEnvironment = "storeClient";
    const inGo = await importPush();
    inGo.setPushLoaderForTests(fakeModule);
    const goReason = inGo.pushUnavailableReason();

    vi.resetModules();
    constantsState.executionEnvironment = "bare";
    constantsState.projectId = undefined;
    const noProject = await importPush();
    noProject.setPushLoaderForTests(fakeModule);
    const projectReason = noProject.pushUnavailableReason();

    expect(goReason).toBeTruthy();
    expect(projectReason).toBeTruthy();
    // §5's rule is that a disabled control names its blocker; two causes a
    // member can act on differently must not share one sentence.
    expect(goReason).not.toBe(projectReason);
  });

  it("has no token to register while no EAS project is configured (#938)", async () => {
    constantsState.projectId = undefined;
    const push = await importPush();
    push.setPushLoaderForTests(fakeModule);

    await expect(push.getExpoPushToken()).resolves.toBeNull();
  });

  it("loads the native module exactly once across calls", async () => {
    const push = await importPush();
    const loader = vi.fn(fakeModule);
    push.setPushLoaderForTests(loader);

    expect(push.isPushAvailable()).toBe(true);
    expect(push.isPushAvailable()).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("creates the Android channel before requesting permission", async () => {
    const push = await importPush();
    const mod = fakeModule();
    push.setPushLoaderForTests(() => mod);

    const order: string[] = [];
    mod.setNotificationChannelAsync.mockImplementation(async () => {
      order.push("channel");
      return null;
    });
    mod.requestPermissionsAsync.mockImplementation(async () => {
      order.push("permission");
      return { granted: true, canAskAgain: false, status: "granted" };
    });

    // Android only — on iOS the channel call is a no-op, so the ordering this
    // pins is unobservable there.
    const { Platform } = await import("react-native");
    const platform = Platform as { OS: string };
    const original = platform.OS;
    platform.OS = "android";
    try {
      await expect(push.requestPushPermission()).resolves.toBe(true);
    } finally {
      platform.OS = original;
    }

    // `spec/ui/mobile/patterns.md` § Push notifications: on Android 13+ the
    // prompt and delivery behave correctly only when the channel already
    // exists. The rule IS the ordering, so pin the ordering.
    expect(order).toEqual(["channel", "permission"]);
  });

  it("clears the cold-start response after reading it", async () => {
    const push = await importPush();
    const mod = fakeModule();
    const response = {
      actionIdentifier: "default",
      notification: {
        date: 0,
        request: {
          identifier: "n1",
          content: { title: null, body: null, data: {} },
        },
      },
    };
    mod.getLastNotificationResponse.mockReturnValue(response);
    push.setPushLoaderForTests(() => mod);

    expect(push.takeLastNotificationResponse()).toBe(response);
    // Without the clear the same tap re-navigates on every remount of the
    // handler (`patterns.md` § Push notifications).
    expect(mod.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it("does not clear when there was no cold-start response", async () => {
    const push = await importPush();
    const mod = fakeModule();
    push.setPushLoaderForTests(() => mod);

    expect(push.takeLastNotificationResponse()).toBeNull();
    expect(mod.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it("push.ts never imports the package statically, and never reaches for the device token", () => {
    // The suite-wide vi.mock of expo-notifications would make a static ESM
    // import invisible to every test while crashing Expo Go at launch, so pin
    // the source shape itself. The same argument `lib/keyboard.spec.ts` makes.
    const here = dirname(fileURLToPath(import.meta.url));
    const push = readFileSync(join(here, "push.ts"), "utf8");
    const types = readFileSync(join(here, "push-types.ts"), "utf8");
    const web = readFileSync(join(here, "push-module.ts"), "utf8");
    const native = readFileSync(join(here, "push-module.native.ts"), "utf8");

    // `export ... from` is a static import to Metro too, and subpath
    // specifiers load the package just the same — ban all of them.
    const staticImport =
      /^(import|export)[^;]*["']expo-notifications(\/[^"']*)?["']/m;
    expect(push).not.toMatch(staticImport);
    expect(types).not.toMatch(staticImport);
    // The web half must contain no *specifier* for the package — neither an
    // import nor a require. `expo export --platform web` evaluates a require
    // when the holding module loads, which is the whole reason for the split.
    // Prose in its docblock is fine and is in fact where the reasoning lives,
    // so this matches quoted specifiers rather than the bare word.
    expect(web).not.toMatch(staticImport);
    expect(web).not.toMatch(/require\(\s*["']expo-notifications/);
    expect(native).toMatch(/require\("expo-notifications"\)/);

    // `getDevicePushTokenAsync` is absent from the structural type on purpose,
    // which makes "never call it inside the token listener" unwriteable rather
    // than merely documented. Delivery uses Expo push tokens regardless.
    expect(types).not.toMatch(/getDevicePushTokenAsync\s*[(:]/);
    expect(push).not.toMatch(/getDevicePushTokenAsync\s*\(/);
  });
});
