/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushTokenRow } from "./push-registration";

const mockState = vi.hoisted(() => ({
  isAuthenticated: false,
  status: "unauthenticated" as
    "hydrating" | "authenticated" | "unauthenticated",
  isChapterResolving: false,
  pushAvailable: true,
  token: "ExponentPushToken[abc]",
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
const { notifyPushPermissionGranted } = await import("./push-token-lifecycle");
const { claimChatLaunch, resetChatLaunchForTests } =
  await import("@/lib/chat/last-channel");

beforeEach(() => {
  mockState.isAuthenticated = false;
  mockState.status = "unauthenticated";
  mockState.isChapterResolving = false;
  mockState.pushAvailable = true;
  mockState.token = "ExponentPushToken[abc]";
  mockState.stored = null;
  mockState.tokenListeners = [];
  mockState.launchResponse = null;
  mockState.responseListeners = [];
  mockState.markRead.mockClear();
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
