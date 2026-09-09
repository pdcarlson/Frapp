/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushTokenRow } from "./push-registration";

const mockState = vi.hoisted(() => ({
  isAuthenticated: false,
  status: "unauthenticated" as "hydrating" | "authenticated" | "unauthenticated",
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
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
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
  addNotificationResponseListener: () => ({ remove: vi.fn() }),
  takeLastNotificationResponse: () => null,
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

beforeEach(() => {
  mockState.isAuthenticated = false;
  mockState.status = "unauthenticated";
  mockState.isChapterResolving = false;
  mockState.pushAvailable = true;
  mockState.token = "ExponentPushToken[abc]";
  mockState.stored = null;
  mockState.tokenListeners = [];
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
    expect(mockState.remove).toHaveBeenCalledWith(
      "row-ExponentPushToken[abc]",
    );
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

  it("does not subscribe a rotation listener when push is unavailable", () => {
    mockState.pushAvailable = false;
    mockState.isAuthenticated = true;
    mockState.status = "authenticated";
    renderHook(() => usePushRuntime());
    expect(mockState.tokenListeners).toHaveLength(0);
  });
});
