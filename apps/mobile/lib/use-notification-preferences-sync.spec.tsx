/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";

const mockState = vi.hoisted(() => ({
  asyncStorageMap: new Map<string, string>(),
  secureStoreToken: null as string | null,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => mockState.asyncStorageMap.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      mockState.asyncStorageMap.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      mockState.asyncStorageMap.delete(key);
    }),
  },
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => mockState.secureStoreToken),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    mockState.secureStoreToken = value;
  }),
  deleteItemAsync: vi.fn(async () => {
    mockState.secureStoreToken = null;
  }),
}));

import {
  PREFERENCE_STORAGE_KEY,
  QUIET_HOURS_WINDOW_STORAGE_KEY,
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

type ServerQuietHours = {
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_tz: string | null;
};

/**
 * A client whose GET /v1/settings reflects prior PATCHes, so an off -> on toggle
 * exercises the real cross-device round trip (disable nulls the window server-side).
 */
function createStatefulClient(initial: ServerQuietHours) {
  const settings: ServerQuietHours = { ...initial };
  const patch = vi.fn(
    async (path: string, options: { body: Record<string, unknown> }) => {
      if (path === "/v1/settings") {
        Object.assign(settings, options.body);
      }
      return { data: { ok: true }, error: null };
    },
  );
  const client: MockClient = {
    GET: vi.fn(async (path: string) => {
      if (path === "/v1/settings") return { data: { ...settings }, error: null };
      if (path === "/v1/notifications/preferences") return { data: [], error: null };
      return { data: null, error: null };
    }),
    PATCH: patch,
  };
  return { client, patch, settings };
}

function lastSettingsPatchBody(patch: ReturnType<typeof vi.fn>) {
  const calls = patch.mock.calls.filter((call) => call[0] === "/v1/settings");
  return calls[calls.length - 1]?.[1]?.body;
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
    mockState.asyncStorageMap.clear();
    mockState.secureStoreToken = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates from AsyncStorage when no auth token is present", async () => {
    mockState.asyncStorageMap.set(
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
    mockState.secureStoreToken = "test-token";
    mockState.asyncStorageMap.set(
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
    mockState.secureStoreToken = "test-token";

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
      expect(mockState.asyncStorageMap.get(PREFERENCE_STORAGE_KEY)).toContain(
        '"dmAlertsEnabled":false',
      );
    });
  });

  it("PATCHes quiet-hour defaults when the member has never had a window", async () => {
    mockState.secureStoreToken = "test-token";

    const patch = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = createMockClient({ PATCH: patch });

    mockState.asyncStorageMap.set(
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
        body: expect.objectContaining({
          quiet_hours_start: "22:00",
          quiet_hours_end: "08:00",
          quiet_hours_tz: expect.any(String),
        }),
      });
    });
    const tz = patch.mock.calls[0]?.[1]?.body?.quiet_hours_tz;
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });

  it("restores the member's custom window on re-enable instead of the defaults", async () => {
    mockState.secureStoreToken = "test-token";

    // Window configured on web: 9:00 PM - 7:00 AM, Chicago.
    const { client, patch, settings } = createStatefulClient({
      quiet_hours_start: "21:00:00",
      quiet_hours_end: "07:00:00",
      quiet_hours_tz: "America/Chicago",
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.preferences.quietHoursEnabled).toBe(true);
      expect(result.current.quietHoursWindow).toEqual({
        start: "21:00",
        end: "07:00",
        tz: "America/Chicago",
      });
    });

    act(() => {
      result.current.setPreference("quietHoursEnabled", false);
    });

    await waitFor(() => {
      expect(settings.quiet_hours_start).toBeNull();
    });

    act(() => {
      result.current.setPreference("quietHoursEnabled", true);
    });

    await waitFor(() => {
      expect(settings.quiet_hours_start).toBe("21:00");
    });

    // The regression this issue is about: NOT 22:00/08:00.
    expect(lastSettingsPatchBody(patch)).toEqual({
      quiet_hours_start: "21:00",
      quiet_hours_end: "07:00",
      quiet_hours_tz: "America/Chicago",
    });
    expect(settings.quiet_hours_end).toBe("07:00");
    expect(settings.quiet_hours_tz).toBe("America/Chicago");
  });

  it("restores a window cached from a previous app run when the server has none", async () => {
    mockState.secureStoreToken = "test-token";
    mockState.asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        quietHoursEnabled: false,
        dmAlertsEnabled: true,
        eventRemindersEnabled: true,
      }),
    );
    mockState.asyncStorageMap.set(
      QUIET_HOURS_WINDOW_STORAGE_KEY,
      JSON.stringify({ start: "23:30", end: "06:15", tz: "Europe/Berlin" }),
    );

    const { client, patch } = createStatefulClient({
      quiet_hours_start: null,
      quiet_hours_end: null,
      quiet_hours_tz: null,
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.quietHoursWindow).toEqual({
        start: "23:30",
        end: "06:15",
        tz: "Europe/Berlin",
      });
    });

    act(() => {
      result.current.setPreference("quietHoursEnabled", true);
    });

    await waitFor(() => {
      expect(lastSettingsPatchBody(patch)).toEqual({
        quiet_hours_start: "23:30",
        quiet_hours_end: "06:15",
        quiet_hours_tz: "Europe/Berlin",
      });
    });
  });

  it("remembers the window locally after disabling so it survives a restart", async () => {
    mockState.secureStoreToken = "test-token";

    const { client } = createStatefulClient({
      quiet_hours_start: "21:00:00",
      quiet_hours_end: "07:00:00",
      quiet_hours_tz: "America/Chicago",
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    // `quietHoursEnabled` defaults to true, so it is not a hydration signal —
    // wait for the server window itself to land.
    await waitFor(() => {
      expect(result.current.quietHoursSync).toBe("synced");
      expect(result.current.quietHoursWindow).toEqual({
        start: "21:00",
        end: "07:00",
        tz: "America/Chicago",
      });
    });

    act(() => {
      result.current.setPreference("quietHoursEnabled", false);
    });

    await waitFor(() => {
      const persisted = mockState.asyncStorageMap.get(QUIET_HOURS_WINDOW_STORAGE_KEY);
      expect(persisted).toBeDefined();
      expect(JSON.parse(persisted ?? "{}")).toEqual({
        start: "21:00",
        end: "07:00",
        tz: "America/Chicago",
      });
    });

    expect(result.current.preferences.quietHoursEnabled).toBe(false);
    expect(result.current.quietHoursWindow.start).toBe("21:00");
  });

  it("PATCHes an edited window while quiet hours are on", async () => {
    mockState.secureStoreToken = "test-token";

    const { client, patch } = createStatefulClient({
      quiet_hours_start: "22:00:00",
      quiet_hours_end: "08:00:00",
      quiet_hours_tz: "America/New_York",
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.quietHoursSync).toBe("synced");
      expect(result.current.preferences.quietHoursEnabled).toBe(true);
    });

    act(() => {
      result.current.setQuietHoursWindow({
        start: "20:45",
        end: "06:30",
        tz: "America/Denver",
      });
    });

    await waitFor(() => {
      expect(lastSettingsPatchBody(patch)).toEqual({
        quiet_hours_start: "20:45",
        quiet_hours_end: "06:30",
        quiet_hours_tz: "America/Denver",
      });
    });

    expect(result.current.quietHoursWindow).toEqual({
      start: "20:45",
      end: "06:30",
      tz: "America/Denver",
    });
  });

  it("does not PATCH an edited window while quiet hours are off", async () => {
    mockState.secureStoreToken = "test-token";
    mockState.asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        quietHoursEnabled: false,
        dmAlertsEnabled: true,
        eventRemindersEnabled: true,
      }),
    );

    const { client, patch } = createStatefulClient({
      quiet_hours_start: null,
      quiet_hours_end: null,
      quiet_hours_tz: null,
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.preferences.quietHoursEnabled).toBe(false);
    });

    act(() => {
      result.current.setQuietHoursWindow({
        start: "20:45",
        end: "06:30",
        tz: "America/Denver",
      });
    });

    // Writing a window server-side would silently switch enforcement back on,
    // because "enabled" is derived from the window being non-null.
    await waitFor(() => {
      expect(result.current.quietHoursWindow.start).toBe("20:45");
    });
    expect(
      patch.mock.calls.filter((call) => call[0] === "/v1/settings"),
    ).toHaveLength(0);
    expect(result.current.preferences.quietHoursEnabled).toBe(false);
  });

  it("ignores an invalid window edit", async () => {
    mockState.secureStoreToken = "test-token";

    const { client, patch } = createStatefulClient({
      quiet_hours_start: "21:00:00",
      quiet_hours_end: "07:00:00",
      quiet_hours_tz: "America/Chicago",
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.quietHoursSync).toBe("synced");
      expect(result.current.quietHoursWindow.start).toBe("21:00");
    });

    act(() => {
      result.current.setQuietHoursWindow({
        start: "9pm",
        end: "07:00",
        tz: "America/Chicago",
      });
    });

    expect(result.current.quietHoursWindow.start).toBe("21:00");
    expect(
      patch.mock.calls.filter((call) => call[0] === "/v1/settings"),
    ).toHaveLength(0);
  });

  it("surfaces retry state when server PATCH fails", async () => {
    mockState.secureStoreToken = "test-token";

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

    expect(mockState.asyncStorageMap.get(PREFERENCE_STORAGE_KEY)).toContain(
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
      expect(mockState.asyncStorageMap.get(PREFERENCE_STORAGE_KEY)).toContain(
        '"dmAlertsEnabled":false',
      );
    });
  });

  it("PATCHes /v1/settings with nulls when disabling quiet hours", async () => {
    mockState.secureStoreToken = "test-token";

    const patch = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = createMockClient({ PATCH: patch });

    mockState.asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        quietHoursEnabled: true,
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
      expect(result.current.preferences.quietHoursEnabled).toBe(true);
    });

    act(() => {
      result.current.setPreference("quietHoursEnabled", false);
    });

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith("/v1/settings", {
        body: {
          quiet_hours_start: null,
          quiet_hours_end: null,
          quiet_hours_tz: null,
        },
      });
    });

    expect(result.current.preferences.quietHoursEnabled).toBe(false);
  });

  it("strips legacy keys (e.g. digestEmailsEnabled) from hydrated state and persisted blob", async () => {
    mockState.asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        quietHoursEnabled: true,
        dmAlertsEnabled: false,
        eventRemindersEnabled: true,
        digestEmailsEnabled: true,
      }),
    );

    const client = createMockClient();
    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, null, makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    expect(Object.keys(result.current.preferences).sort()).toEqual([
      "dmAlertsEnabled",
      "eventRemindersEnabled",
      "quietHoursEnabled",
    ]);
    expect(
      (result.current.preferences as Record<string, unknown>).digestEmailsEnabled,
    ).toBeUndefined();

    await waitFor(() => {
      const persisted = mockState.asyncStorageMap.get(PREFERENCE_STORAGE_KEY);
      expect(persisted).toBeDefined();
      const parsed = JSON.parse(persisted ?? "{}");
      expect(Object.keys(parsed).sort()).toEqual([
        "dmAlertsEnabled",
        "eventRemindersEnabled",
        "quietHoursEnabled",
      ]);
    });
  });
});
