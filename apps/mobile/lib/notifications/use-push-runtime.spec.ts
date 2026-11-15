/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushTokenRow } from "./push-registration";

const mockRegisterCategories = vi.hoisted(() => vi.fn());

const mockState = vi.hoisted(() => ({
  isAuthenticated: false,
  status: "unauthenticated" as
    "hydrating" | "authenticated" | "unauthenticated",
  isChapterResolving: false,
  pushAvailable: true,
  token: "ExponentPushToken[abc]",
  deviceName: undefined as string | undefined,
  stored: null as PushTokenRow | null,
  register: vi.fn(async (body: { token: string }) => ({
    id: `row-${body.token}`,
    token: body.token,
  })),
  remove: vi.fn(async () => undefined),
  tokenListeners: [] as Array<() => void>,
  launchResponse: null as unknown,
  responseListeners: [] as Array<(response: unknown) => void>,
  markRead: vi.fn(),
  decide: vi.fn<(vars: unknown) => Promise<unknown>>(async () => ({})),
  dismissed: [] as string[],
  activeChapterId: "chap-1" as string | null,
  pathname: "/",
  searchParams: {} as Record<string, string>,
  router: {
    push: vi.fn(),
    replace: vi.fn(),
    navigate: vi.fn(),
    dismissTo: vi.fn(),
  },
}));

vi.mock("expo-router", () => ({
  useRouter: () => mockState.router,
  usePathname: () => mockState.pathname,
  useGlobalSearchParams: () => mockState.searchParams,
}));

vi.mock("../auth-session", () => ({
  useAuthSession: () => ({
    status: mockState.status,
    isChapterResolving: mockState.isChapterResolving,
  }),
}));

vi.mock("../use-is-api-authenticated", () => ({
  useIsApiAuthenticated: () => mockState.isAuthenticated,
}));

vi.mock("@repo/hooks", () => ({
  useRegisterPushToken: () => ({ mutateAsync: mockState.register }),
  useRemovePushToken: () => ({ mutateAsync: mockState.remove }),
  useMarkNotificationRead: () => ({ mutate: mockState.markRead }),
  useDecideEventExcuse: () => ({ mutateAsync: mockState.decide }),
  useActiveChapterId: () => mockState.activeChapterId,
}));

vi.mock("./push", () => ({
  isPushAvailable: () => mockState.pushAvailable,
  getExpoPushToken: async () => mockState.token,
  addPushTokenListener: (listener: () => void) => {
    if (!mockState.pushAvailable) return null;
    mockState.tokenListeners.push(listener);
    return {
      remove: () => {
        mockState.tokenListeners = mockState.tokenListeners.filter(
          (l) => l !== listener,
        );
      },
    };
  },
  addNotificationResponseListener: (listener: (response: unknown) => void) => {
    mockState.responseListeners.push(listener);
    return {
      remove: () => {
        mockState.responseListeners = mockState.responseListeners.filter(
          (l) => l !== listener,
        );
      },
    };
  },
  takeLastNotificationResponse: () => {
    const response = mockState.launchResponse;
    mockState.launchResponse = null;
    return response;
  },
  hasLaunchNotificationTap: () => mockState.launchResponse !== null,
  configureForegroundPresentation: vi.fn(),
  ensureAndroidChannel: vi.fn(),
  registerPushActionCategories: mockRegisterCategories,
  clearLocalNotification: async (identifier: string) => {
    mockState.dismissed.push(identifier);
  },
}));

vi.mock("./push-device-name", () => ({
  readPushDeviceName: () => mockState.deviceName,
}));

vi.mock("./push-registration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./push-registration")>();
  return {
    ...actual,
    readStoredPushTokenRow: async () => mockState.stored,
    writeStoredPushTokenRow: async (row: PushTokenRow) => {
      mockState.stored = row;
    },
    clearStoredPushTokenRow: async () => {
      mockState.stored = null;
    },
  };
});

const { usePushRuntime } = await import("./use-push-runtime");
const { Alert } = await import("react-native");
const { notifyPushPermissionGranted } = await import("./push-token-lifecycle");
const { claimChatLaunch, resetChatLaunchForTests } =
  await import("@/lib/chat/last-channel");

beforeEach(() => {
  mockState.isAuthenticated = false;
  mockState.status = "unauthenticated";
  mockState.isChapterResolving = false;
  mockState.pushAvailable = true;
  mockState.token = "ExponentPushToken[abc]";
  mockState.deviceName = undefined;
  mockState.stored = null;
  mockState.tokenListeners = [];
  mockState.launchResponse = null;
  mockState.responseListeners = [];
  mockState.markRead.mockClear();
  mockState.decide.mockReset();
  mockState.decide.mockResolvedValue({});
  mockState.dismissed = [];
  mockState.activeChapterId = "chap-1";
  mockState.pathname = "/";
  mockState.searchParams = {};
  mockState.register.mockClear();
  mockState.remove.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePushRuntime token lifecycle", () => {
  it("registers on the authenticated edge", async () => {
    mockState.isAuthenticated = true;
    mockState.status = "authenticated";
    renderHook(() => usePushRuntime());

    await waitFor(() => {
      expect(mockState.register).toHaveBeenCalledWith({
        token: "ExponentPushToken[abc]",
      });
    });
  });

  it("sends the token and this device's platform label to the register route (#4563)", async () => {
    mockState.isAuthenticated = true;
    mockState.status = "authenticated";
    mockState.deviceName = "android 15 · Pixel 9";
    renderHook(() => usePushRuntime());

    await waitFor(() => {
      expect(mockState.register).toHaveBeenCalledTimes(1);
    });
    expect(mockState.register.mock.calls[0]).toEqual([
      { token: "ExponentPushToken[abc]", device_name: "android 15 · Pixel 9" },
    ]);
  });

  it("subscribes to token rotation and re-registers a rotated token", async () => {
    mockState.isAuthenticated = true;
    mockState.status = "authenticated";
    mockState.stored = {
      id: "row-ExponentPushToken[abc]",
      token: "ExponentPushToken[abc]",
    };
    renderHook(() => usePushRuntime());

    await waitFor(() => expect(mockState.tokenListeners).toHaveLength(1));
    // The sign-in register POSTs too (#2617); let it settle first.
    await waitFor(() => expect(mockState.register).toHaveBeenCalled());
    await act(async () => {});
    mockState.register.mockClear();

    mockState.token = "ExponentPushToken[rotated]";
    await act(async () => {
      mockState.tokenListeners[0]?.();
    });

    await waitFor(() => {
      expect(mockState.register).toHaveBeenCalledWith({
        token: "ExponentPushToken[rotated]",
      });
    });
    expect(mockState.remove).toHaveBeenCalledWith("row-ExponentPushToken[abc]");
  });

  it("does not POST when a rotation fires while signed out", async () => {
    mockState.isAuthenticated = false;
    mockState.status = "unauthenticated";
    renderHook(() => usePushRuntime());

    await waitFor(() => expect(mockState.tokenListeners).toHaveLength(1));
    mockState.register.mockClear();
    mockState.remove.mockClear();

    await act(async () => {
      mockState.tokenListeners[0]?.();
    });

    expect(mockState.register).not.toHaveBeenCalled();
  });

  it("registers again when the member grants permission mid-session (#2617)", async () => {
    mockState.isAuthenticated = true;
    mockState.status = "authenticated";
    renderHook(() => usePushRuntime());

    await waitFor(() => expect(mockState.register).toHaveBeenCalled());
    await act(async () => {});
    mockState.register.mockClear();

    await act(async () => {
      notifyPushPermissionGranted();
    });

    await waitFor(() => {
      expect(mockState.register).toHaveBeenCalledWith({
        token: "ExponentPushToken[abc]",
      });
    });
  });

  it("does not POST on a grant while signed out", async () => {
    renderHook(() => usePushRuntime());
    await act(async () => {
      notifyPushPermissionGranted();
    });
    expect(mockState.register).not.toHaveBeenCalled();
  });

  it("does not subscribe a rotation listener when push is unavailable", () => {
    mockState.pushAvailable = false;
    mockState.isAuthenticated = true;
    mockState.status = "authenticated";
    renderHook(() => usePushRuntime());
    expect(mockState.tokenListeners).toHaveLength(0);
  });
});

describe("usePushRuntime and the chat launch jump", () => {
  beforeEach(() => resetChatLaunchForTests());

  it("a tap that launched the app settles the jump before chat home can claim it", () => {
    /*
      `takeLastNotificationResponse` clears the launch response, so by the time
      chat home's list answers, `hasLaunchNotificationTap` already reads false.
      The settle in `handleResponse` is then the only thing keeping the last
      channel from opening on top of the tap's own target.
    */
    mockState.launchResponse = {
      notification: { request: { content: { data: {} } } },
    };
    renderHook(() => usePushRuntime());
    expect(mockState.launchResponse).toBeNull();
    expect(claimChatLaunch()).toBe(false);
  });

  it("leaves the jump to chat home when no tap launched the app", () => {
    renderHook(() => usePushRuntime());
    expect(claimChatLaunch()).toBe(true);
  });
});

/**
 * #3788. Opening a notification from a push tap marks its in-app row read,
 * whether the tap launched the app or arrived while it was running, and only
 * once the session can authenticate the write.
 */
describe("usePushRuntime marks a tapped notification read", () => {
  const tap = (notificationId: string) => ({
    notification: {
      request: {
        content: {
          data: { notificationId, target: { screen: "events" } },
        },
      },
    },
  });

  function signIn() {
    mockState.isAuthenticated = true;
    mockState.status = "authenticated";
  }

  it("on a tap that launched the app", () => {
    signIn();
    mockState.launchResponse = tap("notif-cold");
    renderHook(() => usePushRuntime());
    expect(mockState.markRead).toHaveBeenCalledWith("notif-cold");
  });

  it("on a tap while the app is running", () => {
    signIn();
    renderHook(() => usePushRuntime());
    expect(mockState.markRead).not.toHaveBeenCalled();

    act(() => {
      for (const listener of mockState.responseListeners) {
        listener(tap("notif-warm"));
      }
    });

    expect(mockState.markRead).toHaveBeenCalledWith("notif-warm");
  });

  it("holds the receipt until the session is restored, then sends it", () => {
    mockState.status = "hydrating";
    mockState.launchResponse = tap("notif-held");
    const { rerender } = renderHook(() => usePushRuntime());
    expect(mockState.markRead).not.toHaveBeenCalled();

    signIn();
    rerender();

    expect(mockState.markRead).toHaveBeenCalledTimes(1);
    expect(mockState.markRead).toHaveBeenCalledWith("notif-held");
  });
});

describe("usePushRuntime opens a tapped thread reply (#4054)", () => {
  const threadTap = (threadRootId: string) => ({
    notification: {
      request: {
        content: {
          data: {
            notificationId: "n-thread",
            target: { screen: "chat", channelId: "c1", threadRootId },
          },
        },
      },
    },
  });

  beforeEach(() => {
    mockState.isAuthenticated = true;
    mockState.status = "authenticated";
  });

  it("pushes the thread's channel, then the thread over it", () => {
    mockState.launchResponse = threadTap("m1");
    renderHook(() => usePushRuntime());

    expect(mockState.router.push.mock.calls).toEqual([
      ["/chat-thread?channelId=c1"],
      ["/chat-thread?channelId=c1&threadRootId=m1"],
    ]);
  });

  it("stays on the thread when the tap is for the one already open", () => {
    mockState.pathname = "/chat-thread";
    mockState.searchParams = { channelId: "c1", threadRootId: "m1" };
    mockState.launchResponse = threadTap("m1");
    renderHook(() => usePushRuntime());

    expect(mockState.router.push).not.toHaveBeenCalled();
    expect(mockState.router.replace).not.toHaveBeenCalled();
    // It was still seen, so it is still marked read.
    expect(mockState.markRead).toHaveBeenCalledWith("n-thread");
  });

  it("stacks another thread's reply over the open one", () => {
    mockState.pathname = "/chat-thread";
    mockState.searchParams = { channelId: "c1", threadRootId: "m0" };
    mockState.launchResponse = threadTap("m1");
    renderHook(() => usePushRuntime());

    expect(mockState.router.push.mock.calls).toEqual([
      ["/chat-thread?channelId=c1"],
      ["/chat-thread?channelId=c1&threadRootId=m1"],
    ]);
  });
});

describe("usePushRuntime acts on Approve / Decline on an excuse push (#4686)", () => {
  let pressCount = 0;
  const press = (actionIdentifier: string) => ({
    actionIdentifier,
    notification: {
      request: {
        identifier: `excuse-push-${++pressCount}`,
        content: {
          data: {
            notificationId: "notif-excuse",
            target: { screen: "events", eventId: "evt-1" },
            excuseUserId: "user-sam",
            chapterId: "chap-1",
          },
        },
      },
    },
  });

  function signIn() {
    mockState.isAuthenticated = true;
    mockState.status = "authenticated";
  }

  it("decides from the launch press once the session is back, and opens the event", async () => {
    mockState.status = "hydrating";
    mockState.launchResponse = press("excuse-approve");
    const { rerender } = renderHook(() => usePushRuntime());
    expect(mockState.decide).not.toHaveBeenCalled();

    signIn();
    rerender();

    expect(mockState.decide).toHaveBeenCalledWith({
      eventId: "evt-1",
      userId: "user-sam",
      decision: "APPROVED",
    });
    expect(mockState.markRead).toHaveBeenCalledWith("notif-excuse");
    expect(mockState.dismissed).toEqual([`excuse-push-${pressCount}`]);
    const opened = [
      ...mockState.router.push.mock.calls,
      ...mockState.router.navigate.mock.calls,
      ...mockState.router.replace.mock.calls,
    ];
    expect(JSON.stringify(opened)).toContain("evt-1");
  });

  it("declines from a press while the app runs", () => {
    signIn();
    renderHook(() => usePushRuntime());

    act(() => {
      for (const listener of mockState.responseListeners) {
        listener(press("excuse-decline"));
      }
    });

    expect(mockState.decide).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "DECLINED" }),
    );
  });

  it("registers the action buttons once, at startup", async () => {
    // A fresh copy of the module: its once-per-process boot flag has
    // already been spent by the suites above.
    vi.resetModules();
    const fresh = await import("./use-push-runtime");
    mockRegisterCategories.mockClear();

    const first = renderHook(() => fresh.usePushRuntime());
    first.rerender();
    renderHook(() => fresh.usePushRuntime());

    expect(mockRegisterCategories).toHaveBeenCalledTimes(1);
  });

  // iOS can hand the launch press to the listener too, while the session is
  // still restoring: the repeat must not erase the held decision.
  it("keeps the decision when the press is handed over again before the session is back", () => {
    mockState.status = "hydrating";
    const same = press("excuse-decline");
    mockState.launchResponse = same;
    const { rerender } = renderHook(() => usePushRuntime());
    act(() => {
      for (const listener of mockState.responseListeners) listener(same);
    });
    expect(mockState.decide).not.toHaveBeenCalled();

    signIn();
    rerender();

    expect(mockState.decide).toHaveBeenCalledTimes(1);
    expect(mockState.decide).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "DECLINED" }),
    );
  });

  it("sends nothing for a press from another chapter, and says to switch", () => {
    signIn();
    mockState.activeChapterId = "chap-2";
    const alert = vi.mocked(Alert.alert);
    alert.mockClear();
    mockState.launchResponse = press("excuse-approve");
    renderHook(() => usePushRuntime());

    expect(mockState.decide).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      "In another chapter",
      expect.any(String),
    );
  });

  it("decides once when the same press is handed over twice", () => {
    signIn();
    const same = press("excuse-approve");
    mockState.launchResponse = same;
    renderHook(() => usePushRuntime());
    act(() => {
      for (const listener of mockState.responseListeners) listener(same);
    });

    expect(mockState.decide).toHaveBeenCalledTimes(1);
  });

  it("says a 409 was already handled", async () => {
    signIn();
    mockState.decide.mockRejectedValue({ status: 409 });
    const alert = vi.mocked(Alert.alert);
    alert.mockClear();
    mockState.launchResponse = press("excuse-approve");
    renderHook(() => usePushRuntime());

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith("Already handled", expect.any(String));
    });
  });

  it("only opens the event on a plain tap", () => {
    signIn();
    mockState.launchResponse = press(
      "expo.modules.notifications.actions.DEFAULT",
    );
    renderHook(() => usePushRuntime());

    expect(mockState.decide).not.toHaveBeenCalled();
    expect(mockState.dismissed).toEqual([]);
  });
});
