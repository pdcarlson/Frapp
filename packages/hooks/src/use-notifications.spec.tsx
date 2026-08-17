/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "./use-frapp-client";
import {
  notificationKeys,
  useUpdateNotificationPreference,
  useUpdateUserSettings,
  userSettingsKey,
} from "./use-notifications";

/**
 * These cover the optimistic half of #312. The bug they guard against is not
 * "the toggle looks slow" — it is that the mobile screen used to hold its own
 * copy of preference state and latch it after the first server payload, so
 * every later payload was dropped. Moving the optimistic story into the cache
 * is what lets the query be the single source of truth, and that only works if
 * the write, the rollback and the reconciliation all land on the same key.
 */

// Note the absence of `gcTime: 0`, which the other specs in this package use:
// these tests seed cache entries that no component observes, and a zero gc time
// collects an unobserved entry the moment it is written — so the mutation would
// find an empty cache and correctly decline to write, for the wrong reason.
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(client: unknown, queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={client as ReturnType<typeof createFrappClient>}
      chapterId="chapter-1"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "NotificationsHookWrapper";
  return Wrapper;
}

/** A PATCH that stays pending until the test resolves or rejects it. */
function deferredPatch() {
  let settle!: (value: { data: unknown; error: unknown }) => void;
  const pending = new Promise<{ data: unknown; error: unknown }>((resolve) => {
    settle = resolve;
  });
  const patch = vi.fn(() => pending);
  return {
    patch,
    succeed: () => settle({ data: { ok: true }, error: null }),
    fail: () => settle({ data: null, error: new Error("Network down") }),
  };
}

describe("useUpdateNotificationPreference", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("writes the toggle into the cache before the PATCH resolves", async () => {
    const key = notificationKeys.preferences("chapter-1");
    queryClient.setQueryData(key, [
      { category: "chat", is_enabled: true },
      { category: "events", is_enabled: true },
    ]);

    const { patch, succeed } = deferredPatch();
    const { result } = renderHook(() => useUpdateNotificationPreference(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        chapter_id: "chapter-1",
        category: "chat",
        is_enabled: false,
      });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(key)).toEqual([
        { category: "chat", is_enabled: false },
        { category: "events", is_enabled: true },
      ]);
    });

    await act(async () => {
      succeed();
    });
  });

  // A category the member has never touched has no row at all — the server
  // reads that absence as enabled — so the first toggle has nothing to update.
  it("appends a row for a category that has none yet", async () => {
    const key = notificationKeys.preferences("chapter-1");
    queryClient.setQueryData(key, [{ category: "chat", is_enabled: true }]);

    const { patch, succeed } = deferredPatch();
    const { result } = renderHook(() => useUpdateNotificationPreference(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        chapter_id: "chapter-1",
        category: "billing",
        is_enabled: false,
      });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(key)).toEqual([
        { category: "chat", is_enabled: true },
        { category: "billing", is_enabled: false },
      ]);
    });

    await act(async () => {
      succeed();
    });
  });

  it("restores the previous rows when the PATCH fails", async () => {
    const key = notificationKeys.preferences("chapter-1");
    const original = [{ category: "chat", is_enabled: true }];
    queryClient.setQueryData(key, original);

    const { patch, fail } = deferredPatch();
    const { result } = renderHook(() => useUpdateNotificationPreference(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        chapter_id: "chapter-1",
        category: "chat",
        is_enabled: false,
      });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(key)).toEqual([
        { category: "chat", is_enabled: false },
      ]);
    });

    await act(async () => {
      fail();
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(queryClient.getQueryData(key)).toEqual(original);
  });

  // A member who has never set a preference has no rows, and the endpoint
  // answers that with `[]` — so seeding the list is predicting what the server
  // will actually return, not inventing it. Without this the very first toggle
  // a member ever makes would not show until the refetch landed.
  it("seeds the row list when the member has no preferences yet", async () => {
    const key = notificationKeys.preferences("chapter-1");
    queryClient.setQueryData(key, null);

    const { patch, succeed } = deferredPatch();
    const { result } = renderHook(() => useUpdateNotificationPreference(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        chapter_id: "chapter-1",
        category: "chat",
        is_enabled: false,
      });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(key)).toEqual([
        { category: "chat", is_enabled: false },
      ]);
    });

    await act(async () => {
      succeed();
    });
  });

  // `GET /v1/notifications/preferences` has no response schema, so a payload
  // this function does not understand cannot be ruled out by types. Appending
  // to one would corrupt it.
  it("leaves a cached payload of unknown shape alone", async () => {
    const key = notificationKeys.preferences("chapter-1");
    const envelope = { items: [{ category: "chat", is_enabled: true }] };
    queryClient.setQueryData(key, envelope);

    const { patch, succeed } = deferredPatch();
    const { result } = renderHook(() => useUpdateNotificationPreference(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        chapter_id: "chapter-1",
        category: "chat",
        is_enabled: false,
      });
    });

    await waitFor(() => {
      expect(patch).toHaveBeenCalled();
    });
    expect(queryClient.getQueryData(key)).toBe(envelope);

    await act(async () => {
      succeed();
    });
  });

  // The write is skipped when the query has never resolved, because there is no
  // server answer to predict against — and because it would be unrollbackable:
  // query-core ignores a `setQueryData` of `undefined`, so `onError` could not
  // put an unfetched entry back. Seeding one row would also flip the entry to
  // `success`, and a consumer folding rows over catalog defaults would show
  // every *other* category snapping to its default.
  it("writes nothing when the query has never resolved", async () => {
    const key = notificationKeys.preferences("chapter-1");

    const { patch, fail } = deferredPatch();
    const { result } = renderHook(() => useUpdateNotificationPreference(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        chapter_id: "chapter-1",
        category: "chat",
        is_enabled: false,
      });
    });

    await waitFor(() => {
      expect(patch).toHaveBeenCalled();
    });
    expect(queryClient.getQueryData(key)).toBeUndefined();

    await act(async () => {
      fail();
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });

  // Mutation-level callbacks always fire, unlike the per-`mutate()` options they
  // replaced, so a slow failure can land after a fast success. Restoring the
  // whole snapshot would undo the *newer* toggle — the race the mobile hook's
  // deleted generation counters used to guard.
  it("reverts only its own category when a newer toggle has since succeeded", async () => {
    const key = notificationKeys.preferences("chapter-1");
    queryClient.setQueryData(key, [
      { category: "chat", is_enabled: true },
      { category: "events", is_enabled: true },
    ]);

    const slow = deferredPatch();
    const { result } = renderHook(() => useUpdateNotificationPreference(), {
      wrapper: createWrapper({ PATCH: slow.patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        chapter_id: "chapter-1",
        category: "chat",
        is_enabled: false,
      });
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(key)).toEqual([
        { category: "chat", is_enabled: false },
        { category: "events", is_enabled: true },
      ]);
    });

    // A second toggle lands and sticks while the first is still in flight.
    act(() => {
      queryClient.setQueryData(key, [
        { category: "chat", is_enabled: false },
        { category: "events", is_enabled: false },
      ]);
    });

    await act(async () => {
      slow.fail();
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    // `chat` goes back; `events` keeps the value the member just set.
    expect(queryClient.getQueryData(key)).toEqual([
      { category: "chat", is_enabled: true },
      { category: "events", is_enabled: false },
    ]);
  });

  it("invalidates the preferences cache once settled, on success and on failure", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const failing = deferredPatch();
    const { result } = renderHook(() => useUpdateNotificationPreference(), {
      wrapper: createWrapper({ PATCH: failing.patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        chapter_id: "chapter-1",
        category: "chat",
        is_enabled: false,
      });
    });
    await act(async () => {
      failing.fail();
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: notificationKeys.preferencesRoot,
    });
  });
});

describe("useUpdateUserSettings", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("merges the patch into cached settings before the PATCH resolves", async () => {
    queryClient.setQueryData(userSettingsKey, {
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      quiet_hours_tz: "America/New_York",
      theme: "dark",
    });

    const { patch, succeed } = deferredPatch();
    const { result } = renderHook(() => useUpdateUserSettings(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        quiet_hours_start: "21:00",
        quiet_hours_end: "07:00",
        quiet_hours_tz: "America/Chicago",
      });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(userSettingsKey)).toEqual({
        quiet_hours_start: "21:00",
        quiet_hours_end: "07:00",
        quiet_hours_tz: "America/Chicago",
        theme: "dark",
      });
    });

    await act(async () => {
      succeed();
    });
  });

  // Omission means "preserve" on this endpoint, and web relies on it: it sends
  // `quiet_hours_tz: undefined` for a zone the member never edited, because
  // this browser's tzdata may be older than the server's. A plain spread would
  // write `undefined` over the stored zone and blank the field on screen.
  it("leaves omitted keys alone instead of writing undefined over them", async () => {
    queryClient.setQueryData(userSettingsKey, {
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      quiet_hours_tz: "Europe/Kyiv",
      theme: "dark",
    });

    const { patch, succeed } = deferredPatch();
    const { result } = renderHook(() => useUpdateUserSettings(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        quiet_hours_start: "23:00",
        quiet_hours_tz: undefined,
        theme: undefined,
      });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(userSettingsKey)).toEqual({
        quiet_hours_start: "23:00",
        quiet_hours_end: "08:00",
        quiet_hours_tz: "Europe/Kyiv",
        theme: "dark",
      });
    });

    await act(async () => {
      succeed();
    });
  });

  // Disabling quiet hours clears the window server-side, so an explicit null
  // has to reach the cache — it is the difference between "on" and "off".
  it("writes an explicit null through", async () => {
    queryClient.setQueryData(userSettingsKey, {
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      quiet_hours_tz: "America/New_York",
    });

    const { patch, succeed } = deferredPatch();
    const { result } = renderHook(() => useUpdateUserSettings(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({
        quiet_hours_start: null,
        quiet_hours_end: null,
        quiet_hours_tz: null,
      });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(userSettingsKey)).toEqual({
        quiet_hours_start: null,
        quiet_hours_end: null,
        quiet_hours_tz: null,
      });
    });

    await act(async () => {
      succeed();
    });
  });

  it("restores the previous settings when the PATCH fails", async () => {
    const original = {
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      quiet_hours_tz: "America/New_York",
    };
    queryClient.setQueryData(userSettingsKey, original);

    const { patch, fail } = deferredPatch();
    const { result } = renderHook(() => useUpdateUserSettings(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({ quiet_hours_start: "21:00" });
    });

    await waitFor(() => {
      expect(
        (queryClient.getQueryData(userSettingsKey) as { quiet_hours_start: string })
          .quiet_hours_start,
      ).toBe("21:00");
    });

    await act(async () => {
      fail();
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(queryClient.getQueryData(userSettingsKey)).toEqual(original);
  });

  // `useUserSettings` has no `enabled` gate, so this entry can be empty while
  // signed out. Predicting a settings row from a PATCH body would invent one.
  it("writes nothing when settings have never been fetched", async () => {
    const { patch, succeed } = deferredPatch();
    const { result } = renderHook(() => useUpdateUserSettings(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({ quiet_hours_start: "21:00" });
    });

    await waitFor(() => {
      expect(patch).toHaveBeenCalled();
    });
    expect(queryClient.getQueryData(userSettingsKey)).toBeUndefined();

    await act(async () => {
      succeed();
    });
  });

  it("invalidates settings once settled so the server gets the last word", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    queryClient.setQueryData(userSettingsKey, { quiet_hours_start: "22:00" });

    const { patch, succeed } = deferredPatch();
    const { result } = renderHook(() => useUpdateUserSettings(), {
      wrapper: createWrapper({ PATCH: patch }, queryClient),
    });

    act(() => {
      result.current.mutate({ quiet_hours_start: "21:00" });
    });
    await act(async () => {
      succeed();
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userSettingsKey });
  });
});
