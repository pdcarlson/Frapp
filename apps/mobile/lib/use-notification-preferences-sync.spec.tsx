/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";

const asyncStorageMap = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageMap.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorageMap.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      asyncStorageMap.delete(key);
    }),
  },
}));

let secureStoreToken: string | null = null;

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => secureStoreToken),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    secureStoreToken = value;
  }),
  deleteItemAsync: vi.fn(async () => {
    secureStoreToken = null;
  }),
}));

import {
  PREFERENCE_STORAGE_KEY,
  useNotificationPreferencesSync,
} from "./use-notification-preferences-sync";

type MockClient = {
  GET: ReturnType<typeof vi.fn>;
  PATCH: ReturnType<typeof vi.fn>;
};

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
  return {
    GET: vi.fn().mockResolvedValue({ data: null, error: null }),
    PATCH: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
    ...overrides,
  };
}

function createWrapper(
  client: MockClient,
  chapterId: string | null,
  queryClient: QueryClient,
) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={client as unknown as ReturnType<typeof createFrappClient>}
      chapterId={chapterId}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "PreferencesSyncWrapper";
  return Wrapper;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

describe("useNotificationPreferencesSync", () => {
  beforeEach(() => {
    asyncStorageMap.clear();
    secureStoreToken = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates from AsyncStorage when no auth token is present", async () => {
    asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        quietHoursEnabled: false,
        dmAlertsEnabled: false,
        eventRemindersEnabled: true,
      }),
    );

    const client = createMockClient();
    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, null, makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    expect(result.current.preferences).toEqual({
      quietHoursEnabled: false,
      dmAlertsEnabled: false,
      eventRemindersEnabled: true,
    });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.quietHoursSync).toBe("cached");
    expect(result.current.categorySync).toBe("cached");
  });

  it("prefers server settings over AsyncStorage when both are available", async () => {
    secureStoreToken = "test-token";
    asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        quietHoursEnabled: false,
        dmAlertsEnabled: true,
        eventRemindersEnabled: true,
      }),
    );

    const client = createMockClient({
      GET: vi.fn(async (path: string) => {
        if (path === "/v1/settings") {
          return {
            data: {
              quiet_hours_start: "22:00",
              quiet_hours_end: "08:00",
              quiet_hours_tz: "America/New_York",
            },
            error: null,
          };
        }
        if (path === "/v1/notifications/preferences") {
          return {
            data: [
              { category: "chat", is_enabled: false },
              { category: "events", is_enabled: true },
            ],
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.preferences.quietHoursEnabled).toBe(true);
      expect(result.current.preferences.dmAlertsEnabled).toBe(false);
    });

    expect(result.current.preferences.eventRemindersEnabled).toBe(true);
    expect(result.current.quietHoursSync).toBe("synced");
    expect(result.current.categorySync).toBe("synced");
  });

  it("PATCHes category 'chat' when toggling DM alerts with auth + chapter", async () => {
    secureStoreToken = "test-token";

    const patch = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = createMockClient({ PATCH: patch });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-42", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isAuthenticated).toBe(true);
    });

    act(() => {
      result.current.setPreference("dmAlertsEnabled", false);
    });

    expect(result.current.preferences.dmAlertsEnabled).toBe(false);

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith("/v1/notifications/preferences", {
        body: {
          chapter_id: "chapter-42",
          category: "chat",
          is_enabled: false,
        },
      });
    });

    await waitFor(() => {
      expect(asyncStorageMap.get(PREFERENCE_STORAGE_KEY)).toContain(
        '"dmAlertsEnabled":false',
      );
    });
  });

  it("PATCHes /v1/settings with quiet-hour defaults when enabling quiet hours", async () => {
    secureStoreToken = "test-token";

    const patch = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = createMockClient({ PATCH: patch });

    asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        quietHoursEnabled: false,
        dmAlertsEnabled: true,
        eventRemindersEnabled: true,
      }),
    );

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.preferences.quietHoursEnabled).toBe(false);
    });

    act(() => {
      result.current.setPreference("quietHoursEnabled", true);
    });

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith("/v1/settings", {
        body: {
          quiet_hours_start: "22:00",
          quiet_hours_end: "08:00",
          quiet_hours_tz: "America/New_York",
        },
      });
    });
  });

  it("surfaces retry state when server PATCH fails", async () => {
    secureStoreToken = "test-token";

    const patch = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("Network down"),
    });
    const client = createMockClient({ PATCH: patch });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isAuthenticated).toBe(true);
    });

    act(() => {
      result.current.setPreference("eventRemindersEnabled", false);
    });

    await waitFor(() => {
      expect(result.current.categorySync).toBe("retry");
    });

    expect(asyncStorageMap.get(PREFERENCE_STORAGE_KEY)).toContain(
      '"eventRemindersEnabled":false',
    );
  });

  it("does not call the server when toggling without auth", async () => {
    const patch = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = createMockClient({ PATCH: patch });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, null, makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    act(() => {
      result.current.setPreference("dmAlertsEnabled", false);
    });

    expect(result.current.preferences.dmAlertsEnabled).toBe(false);
    expect(patch).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(asyncStorageMap.get(PREFERENCE_STORAGE_KEY)).toContain(
        '"dmAlertsEnabled":false',
      );
    });
  });
});
