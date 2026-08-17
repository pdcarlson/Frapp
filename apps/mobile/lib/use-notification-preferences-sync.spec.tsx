/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { isSupportedTimeZone, MAX_TIME_ZONE_LENGTH } from "@repo/validation";

const mockState = vi.hoisted(() => ({
  asyncStorageMap: new Map<string, string>(),
  secureStoreToken: null as string | null,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(
      async (key: string) => mockState.asyncStorageMap.get(key) ?? null,
    ),
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
      if (path === "/v1/settings")
        return { data: { ...settings }, error: null };
      if (path === "/v1/notifications/preferences")
        return { data: [], error: null };
      return { data: null, error: null };
    }),
    PATCH: patch,
  };
  return { client, patch, settings };
}

/**
 * A client whose preference rows reflect prior PATCHes, so a toggle round-trips
 * the way it does in production. Without this the refetch that `onSettled`
 * triggers answers with the *original* rows and the toggle appears to revert
 * even on success — a mock artifact, but one that looks exactly like a bug.
 */
function createStatefulPreferencesClient(
  initial: { category: string; is_enabled: boolean }[] = [],
) {
  const rows = [...initial];
  const patch = vi.fn(
    async (path: string, options: { body: Record<string, unknown> }) => {
      if (path === "/v1/notifications/preferences") {
        const { category, is_enabled: isEnabled } = options.body as {
          category: string;
          is_enabled: boolean;
        };
        const existing = rows.find((row) => row.category === category);
        if (existing) existing.is_enabled = isEnabled;
        else rows.push({ category, is_enabled: isEnabled });
      }
      return { data: { ok: true }, error: null };
    },
  );
  const client: MockClient = {
    GET: vi.fn(async (path: string) => {
      if (path === "/v1/notifications/preferences")
        return { data: rows.map((row) => ({ ...row })), error: null };
      return { data: null, error: null };
    }),
    PATCH: patch,
  };
  return { client, patch, rows };
}

/** A PATCH held open until the test releases it, so the optimistic window is stable. */
function deferredPatch(outcome: "success" | "failure") {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const patch = vi.fn(async () => {
    await gate;
    return outcome === "success"
      ? { data: { ok: true }, error: null }
      : { data: null, error: new Error("Network down") };
  });
  return { patch, release: () => release() };
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

/** The persisted blob, parsed. */
function persistedPreferences() {
  const raw = mockState.asyncStorageMap.get(PREFERENCE_STORAGE_KEY);
  return raw ? JSON.parse(raw) : undefined;
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
        categories: { chat: false, events: true },
      }),
    );

    const client = createMockClient();
    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, null, makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    expect(result.current.quietHoursEnabled).toBe(false);
    expect(result.current.categories.chat).toBe(false);
    expect(result.current.categories.events).toBe(true);
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
        categories: { chat: true, events: true },
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
      expect(result.current.quietHoursEnabled).toBe(true);
      expect(result.current.categories.chat).toBe(false);
    });

    expect(result.current.categories.events).toBe(true);
    expect(result.current.quietHoursSync).toBe("synced");
    expect(result.current.categorySync).toBe("synced");
  });

  // The server only stores rows for categories a member has changed, and it
  // treats an absent row as enabled — so its answer has to be read as complete,
  // not as a patch over whatever this device last cached.
  it("reads an absent server row as enabled, overriding a stale cached false", async () => {
    mockState.secureStoreToken = "test-token";
    mockState.asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        quietHoursEnabled: true,
        categories: { billing: false },
      }),
    );

    const client = createMockClient({
      GET: vi.fn(async (path: string) => {
        if (path === "/v1/notifications/preferences") {
          return { data: [{ category: "chat", is_enabled: false }], error: null };
        }
        return { data: null, error: null };
      }),
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.categorySync).toBe("synced");
    });

    expect(result.current.categories.chat).toBe(false);
    expect(result.current.categories.billing).toBe(true);
  });

  it("PATCHes category 'chat' when toggling DM alerts with auth + chapter", async () => {
    mockState.secureStoreToken = "test-token";

    const { client, patch } = createStatefulPreferencesClient();

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-42", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.categorySync).toBe("synced");
    });

    act(() => {
      result.current.setCategory("chat", false);
    });

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith("/v1/notifications/preferences", {
        body: {
          chapter_id: "chapter-42",
          category: "chat",
          is_enabled: false,
        },
      });
    });

    // Still false once the settled refetch has confirmed it — the round trip,
    // not just the optimistic flash.
    await waitFor(() => {
      expect(result.current.categories.chat).toBe(false);
    });

    await waitFor(() => {
      expect(persistedPreferences()?.categories?.chat).toBe(false);
    });
  });

  it("PATCHes quiet-hour defaults when the member has never had a window", async () => {
    mockState.secureStoreToken = "test-token";

    const patch = vi
      .fn()
      .mockResolvedValue({ data: { ok: true }, error: null });
    const client = createMockClient({ PATCH: patch });

    mockState.asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({ quietHoursEnabled: false, categories: {} }),
    );

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.quietHoursEnabled).toBe(false);
    });

    act(() => {
      result.current.setQuietHoursEnabled(true);
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
      expect(result.current.quietHoursEnabled).toBe(true);
      expect(result.current.quietHoursWindow).toEqual({
        start: "21:00",
        end: "07:00",
        tz: "America/Chicago",
      });
    });

    act(() => {
      result.current.setQuietHoursEnabled(false);
    });

    await waitFor(() => {
      expect(settings.quiet_hours_start).toBeNull();
    });

    act(() => {
      result.current.setQuietHoursEnabled(true);
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

  // #687. The substitution rule here is a data-safety decision, not a display
  // one: whatever `normalizeTimeZone` returns is shown to the member AND
  // replayed into the PATCH when quiet hours are toggled back on, so an
  // over-eager repair overwrites the member's row on every device.
  //
  // The trap is that a device's ICU tzdata is routinely older than the server's,
  // so asking the device "can you resolve this?" produces confident false
  // negatives for zones the server accepted (`Europe/Kyiv` on a build that only
  // knows `Europe/Kiev`). Only device-independent defects may be repaired.
  it("preserves a stored zone this device cannot resolve, rather than overwriting it", async () => {
    mockState.secureStoreToken = "test-token";

    // Stands in for any zone newer than this runtime's tzdata. It is well
    // formed and within length, so only the server may judge it.
    const { client, patch, settings } = createStatefulClient({
      quiet_hours_start: "21:00:00",
      quiet_hours_end: "07:00:00",
      quiet_hours_tz: "Mars/Olympus",
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.quietHoursEnabled).toBe(true);
      expect(result.current.quietHoursWindow.start).toBe("21:00");
    });

    expect(result.current.quietHoursWindow.tz).toBe("Mars/Olympus");

    act(() => {
      result.current.setQuietHoursEnabled(false);
    });
    await waitFor(() => {
      expect(settings.quiet_hours_start).toBeNull();
    });

    act(() => {
      result.current.setQuietHoursEnabled(true);
    });
    await waitFor(() => {
      expect(settings.quiet_hours_start).toBe("21:00");
    });

    // Replayed untouched. If the server really does reject it, that surfaces as
    // the retry state — a visible error on an already-broken row, which is the
    // accepted cost of never corrupting a correct one.
    const body = lastSettingsPatchBody(patch);
    expect(body.quiet_hours_start).toBe("21:00");
    expect(body.quiet_hours_end).toBe("07:00");
    expect(body.quiet_hours_tz).toBe("Mars/Olympus");
  });

  it("repairs a blank stored zone, which no device can mistake for valid", async () => {
    mockState.secureStoreToken = "test-token";

    const { client } = createStatefulClient({
      quiet_hours_start: "21:00:00",
      quiet_hours_end: "07:00:00",
      quiet_hours_tz: "   ",
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.quietHoursWindow.start).toBe("21:00");
    });

    expect(result.current.quietHoursWindow.tz.trim().length).toBeGreaterThan(0);
    expect(isSupportedTimeZone(result.current.quietHoursWindow.tz)).toBe(true);
  });

  it("repairs an over-length cached zone the column could never hold", async () => {
    mockState.secureStoreToken = null;
    mockState.asyncStorageMap.set(
      QUIET_HOURS_WINDOW_STORAGE_KEY,
      JSON.stringify({
        start: "23:00",
        end: "06:00",
        tz: "A".repeat(MAX_TIME_ZONE_LENGTH + 1),
      }),
    );

    const client = createMockClient();

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    expect(result.current.quietHoursWindow.start).toBe("23:00");
    expect(result.current.quietHoursWindow.tz.length).toBeLessThanOrEqual(
      MAX_TIME_ZONE_LENGTH,
    );
    expect(isSupportedTimeZone(result.current.quietHoursWindow.tz)).toBe(true);
  });

  it("reads a window whose Postgres time carries fractional seconds", async () => {
    mockState.secureStoreToken = "test-token";

    const { client } = createStatefulClient({
      quiet_hours_start: "21:30:00.5",
      quiet_hours_end: "07:15:00",
      quiet_hours_tz: "America/Chicago",
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.quietHoursSync).toBe("synced");
      expect(result.current.quietHoursWindow).toEqual({
        start: "21:30",
        end: "07:15",
        tz: "America/Chicago",
      });
    });

    expect(result.current.quietHoursEnabled).toBe(true);
  });

  it("treats an out-of-range stored time as no window", async () => {
    mockState.secureStoreToken = "test-token";

    const { client } = createStatefulClient({
      quiet_hours_start: "24:00:00",
      quiet_hours_end: "07:00:00",
      quiet_hours_tz: "America/Chicago",
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.quietHoursSync).toBe("synced");
    });

    // The server cannot enforce hour 24, so reporting it as "on" would be a lie.
    await waitFor(() => {
      expect(result.current.quietHoursEnabled).toBe(false);
    });
    expect(result.current.quietHoursWindow).toEqual({
      start: "22:00",
      end: "08:00",
      tz: expect.any(String),
    });
  });

  it("restores a window cached from a previous app run when the server has none", async () => {
    mockState.secureStoreToken = "test-token";
    mockState.asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({ quietHoursEnabled: false, categories: {} }),
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
      result.current.setQuietHoursEnabled(true);
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
      result.current.setQuietHoursEnabled(false);
    });

    await waitFor(() => {
      const persisted = mockState.asyncStorageMap.get(
        QUIET_HOURS_WINDOW_STORAGE_KEY,
      );
      expect(persisted).toBeDefined();
      expect(JSON.parse(persisted ?? "{}")).toEqual({
        start: "21:00",
        end: "07:00",
        tz: "America/Chicago",
      });
    });

    await waitFor(() => {
      expect(result.current.quietHoursEnabled).toBe(false);
    });
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
      expect(result.current.quietHoursEnabled).toBe(true);
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
      JSON.stringify({ quietHoursEnabled: false, categories: {} }),
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
      expect(result.current.quietHoursEnabled).toBe(false);
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
    expect(result.current.quietHoursEnabled).toBe(false);
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
      result.current.setCategory("events", false);
    });

    await waitFor(() => {
      expect(result.current.categorySync).toBe("retry");
    });
  });

  it("does not call the server when toggling without auth", async () => {
    const patch = vi
      .fn()
      .mockResolvedValue({ data: { ok: true }, error: null });
    const client = createMockClient({ PATCH: patch });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, null, makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    act(() => {
      result.current.setCategory("chat", false);
    });

    expect(result.current.categories.chat).toBe(false);
    expect(patch).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(persistedPreferences()?.categories?.chat).toBe(false);
    });
  });

  it("PATCHes /v1/settings with nulls when disabling quiet hours", async () => {
    mockState.secureStoreToken = "test-token";

    const patch = vi
      .fn()
      .mockResolvedValue({ data: { ok: true }, error: null });
    const client = createMockClient({ PATCH: patch });

    mockState.asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({ quietHoursEnabled: true, categories: {} }),
    );

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.quietHoursEnabled).toBe(true);
    });

    act(() => {
      result.current.setQuietHoursEnabled(false);
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
  });

  // The successor to the `digestEmailsEnabled` case from #266: the blob is
  // rewritten on every change, so a key nothing reads would live on that device
  // forever. The two pre-catalog toggles are the exception — they carry a real
  // choice a member made offline, so they migrate to their categories instead
  // of being dropped with the rest.
  it("migrates the legacy blob's toggles and strips keys nothing reads", async () => {
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

    expect(result.current.categories.chat).toBe(false);
    expect(result.current.categories.events).toBe(true);

    await waitFor(() => {
      const parsed = persistedPreferences();
      expect(parsed).toBeDefined();
      expect(Object.keys(parsed).sort()).toEqual([
        "categories",
        "quietHoursEnabled",
      ]);
      expect(parsed.categories.digestEmailsEnabled).toBeUndefined();
      expect(parsed.categories.dmAlertsEnabled).toBeUndefined();
    });
  });

  // The category column is unconstrained server-side, so a blob (or a server
  // row) can name a category this build has no switch for. Widening state to
  // match would render nothing and persist forever.
  it("ignores a cached category the catalog does not expose", async () => {
    mockState.asyncStorageMap.set(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        quietHoursEnabled: true,
        categories: { chat: false, announcements: false, whatever: true },
      }),
    );

    const client = createMockClient();
    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, null, makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    expect(result.current.categories.chat).toBe(false);
    expect(
      (result.current.categories as Record<string, unknown>).announcements,
    ).toBeUndefined();
    expect(
      (result.current.categories as Record<string, unknown>).whatever,
    ).toBeUndefined();
  });
});

/**
 * The three cases #312 asks for by name. Each one is a failure mode the old
 * applied-ref latch produced and no existing test could catch, because the
 * latch made every one of them invisible until a cold remount.
 */
describe("useNotificationPreferencesSync — server reconciliation (#312)", () => {
  beforeEach(() => {
    mockState.asyncStorageMap.clear();
    mockState.secureStoreToken = "test-token";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("follows the server when a refetch normalizes what we sent", async () => {
    // The server's answer disagrees with the toggle — an admin override, a
    // chapter-level default, anything. Its value is the real one. The PATCH is
    // held open so the optimistic window is observable rather than a race.
    const { patch, release } = deferredPatch("success");
    const client = createMockClient({
      GET: vi.fn(async (path: string) => {
        if (path === "/v1/notifications/preferences") {
          return { data: [{ category: "chat", is_enabled: true }], error: null };
        }
        return { data: null, error: null };
      }),
      PATCH: patch,
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.categorySync).toBe("synced");
    });

    act(() => {
      result.current.setCategory("chat", false);
    });

    // Optimistic first…
    await waitFor(() => {
      expect(result.current.categories.chat).toBe(false);
    });

    // …then the settled refetch corrects it. Under the applied-ref latch this
    // payload was dropped and the screen showed `false` for the rest of the
    // session.
    await act(async () => {
      release();
    });
    await waitFor(() => {
      expect(result.current.categories.chat).toBe(true);
    });
  });

  it("follows a quiet-hours window changed on another device", async () => {
    let serverSettings: ServerQuietHours = {
      quiet_hours_start: "22:00:00",
      quiet_hours_end: "08:00:00",
      quiet_hours_tz: "America/New_York",
    };
    const queryClient = makeQueryClient();
    const client = createMockClient({
      GET: vi.fn(async (path: string) => {
        if (path === "/v1/settings") return { data: serverSettings, error: null };
        if (path === "/v1/notifications/preferences")
          return { data: [], error: null };
        return { data: null, error: null };
      }),
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", queryClient),
    });

    await waitFor(() => {
      expect(result.current.quietHoursWindow.start).toBe("22:00");
    });

    // Changed on web, then this device refetches — on focus, on foreground, or
    // after any mutation settles.
    serverSettings = {
      quiet_hours_start: "23:00:00",
      quiet_hours_end: "07:00:00",
      quiet_hours_tz: "America/Chicago",
    };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    });

    await waitFor(() => {
      expect(result.current.quietHoursWindow).toEqual({
        start: "23:00",
        end: "07:00",
        tz: "America/Chicago",
      });
    });
  });

  it("reverts an optimistic toggle when the PATCH fails", async () => {
    const { patch, release } = deferredPatch("failure");
    const client = createMockClient({
      GET: vi.fn(async (path: string) => {
        if (path === "/v1/notifications/preferences") {
          return { data: [{ category: "chat", is_enabled: true }], error: null };
        }
        return { data: null, error: null };
      }),
      PATCH: patch,
    });

    const { result } = renderHook(() => useNotificationPreferencesSync(), {
      wrapper: createWrapper(client, "chapter-1", makeQueryClient()),
    });

    // Wait for the *server's* answer, not the catalog default — `chat` is
    // enabled by default, so asserting `true` alone would pass at first render
    // and the toggle below would fire before auth resolved.
    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.categorySync).toBe("synced");
    });

    act(() => {
      result.current.setCategory("chat", false);
    });

    await waitFor(() => {
      expect(result.current.categories.chat).toBe(false);
    });

    await act(async () => {
      release();
    });

    await waitFor(() => {
      expect(result.current.categorySync).toBe("retry");
    });

    // The switch springs back rather than sitting on a value the server never
    // accepted. This is a deliberate change from the pre-#312 behaviour, where
    // the failed value stuck for the rest of the session.
    await waitFor(() => {
      expect(result.current.categories.chat).toBe(true);
    });
  });
});
