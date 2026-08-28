/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "./use-frapp-client";
import {
  deriveDisplayStatus,
  taskKeys,
  useConfirmTask,
  useRejectTask,
  useUpdateTaskStatus,
} from "./use-tasks";

/**
 * These cover #560 — promoting the optimistic task writes out of
 * `apps/web/components/chat/renderers/task-card.tsx` and into the shared hooks,
 * so the dashboard board, the chat card and the mobile board all get one
 * behaviour instead of three.
 *
 * Two of the cases below guard defects that type-check and read fine:
 * the `OVERDUE` prediction (a raw status write silently flips back on the next
 * refetch) and the surgical revert (a whole-snapshot restore silently undoes a
 * newer write).
 */

const CHAPTER = "chapter-1";
const TASK = "task-1";
const listKey = taskKeys.lists(CHAPTER);
const detailKey = taskKeys.detail(CHAPTER, TASK);

/** A future due date, so nothing derives to OVERDUE unless a test wants it. */
const FUTURE = "2999-01-01";

// Note the absence of `gcTime: 0`, which some specs in this package use: these
// tests seed cache entries that no component observes, and a zero gc time
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
      chapterId={CHAPTER}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "TasksHookWrapper";
  return Wrapper;
}

/**
 * A request fn whose calls stay pending until the test settles them by index,
 * so two overlapping mutations can be resolved out of order.
 */
function deferredCalls() {
  const settles: ((value: { data: unknown; error: unknown }) => void)[] = [];
  const fn = vi.fn(
    () =>
      new Promise<{ data: unknown; error: unknown }>((resolve) => {
        settles.push(resolve);
      }),
  );
  // `onMutate` awaits `cancelQueries`, so the request fn is not called until a
  // later microtask — settling by index has to wait for the call to exist.
  const settled = async (index: number) => {
    await waitFor(() => expect(settles.length).toBeGreaterThan(index));
    return settles[index]!;
  };
  return {
    fn,
    succeed: async (index = 0) =>
      (await settled(index))({ data: { ok: true }, error: null }),
    fail: async (index = 0, error: unknown = new Error("Network down")) =>
      (await settled(index))({ data: null, error }),
  };
}

function seedTask(
  queryClient: QueryClient,
  overrides: Record<string, unknown> = {},
) {
  const row = {
    id: TASK,
    title: "Submit ride-share list",
    status: "TODO",
    due_date: FUTURE,
    completed_at: null,
    points_awarded: false,
    ...overrides,
  };
  queryClient.setQueryData(detailKey, { ...row });
  queryClient.setQueryData(listKey, [
    { ...row },
    { id: "task-2", title: "Other", status: "TODO", due_date: FUTURE },
  ]);
  return row;
}

function cachedDetail(queryClient: QueryClient) {
  return queryClient.getQueryData(detailKey) as Record<string, unknown>;
}

function cachedListRow(queryClient: QueryClient) {
  const list = queryClient.getQueryData(listKey) as Record<string, unknown>[];
  return list.find((row) => row.id === TASK)!;
}

describe("deriveDisplayStatus", () => {
  // Mirrors `toDisplayStatus` in apps/api/src/application/services/task.service.ts.
  it.each([
    ["TODO", "2026-08-16", "2026-08-17", "OVERDUE"],
    ["IN_PROGRESS", "2026-08-16", "2026-08-17", "OVERDUE"],
    // Due *today* is not overdue — the server compares strictly less-than.
    ["TODO", "2026-08-17", "2026-08-17", "TODO"],
    ["IN_PROGRESS", "2026-08-18", "2026-08-17", "IN_PROGRESS"],
    // Only TODO and IN_PROGRESS derive; the others pass through untouched.
    ["COMPLETED", "2026-08-16", "2026-08-17", "COMPLETED"],
    ["OVERDUE", "2026-08-16", "2026-08-17", "OVERDUE"],
  ] as const)(
    "%s due %s on %s → %s",
    (stored, dueDate, today, expected) => {
      expect(deriveDisplayStatus(stored, dueDate, today)).toBe(expected);
    },
  );

  it("passes through when the due date is missing or blank", () => {
    expect(deriveDisplayStatus("TODO", undefined, "2026-08-17")).toBe("TODO");
    expect(deriveDisplayStatus("TODO", "", "2026-08-17")).toBe("TODO");
  });
});

describe("useUpdateTaskStatus", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("writes the predicted status into both the detail and the list entry", async () => {
    seedTask(queryClient);
    const { fn, succeed } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK, body: { status: "IN_PROGRESS" } });
    });

    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("IN_PROGRESS");
      expect(cachedListRow(queryClient).status).toBe("IN_PROGRESS");
    });

    await act(async () => {
      await succeed();
    });
  });

  // The defect this guards: writing the raw next status onto an overdue row
  // lands in the cache, then the refetch correctly returns OVERDUE and the row
  // visibly reverts — reading to the member as a failed tap.
  // Seeded with the *stored* status rather than the rendered `OVERDUE`, so the
  // assertion discriminates three ways: `OVERDUE` only if the derivation ran,
  // `IN_PROGRESS` if the raw status was written, `TODO` if nothing was written.
  // Seeding `OVERDUE` here would pass on a no-op, which is the vacuous version.
  it("predicts OVERDUE for a task past its due date, not the raw status", async () => {
    seedTask(queryClient, { status: "TODO", due_date: "2020-01-01" });
    const { fn, succeed } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK, body: { status: "IN_PROGRESS" } });
    });

    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("OVERDUE");
    });

    await act(async () => {
      await succeed();
    });
  });

  /**
   * Both surfaces decide which action to offer from `stored_status` (#1051), so
   * an optimistic write that patches only `status` leaves the button unchanged
   * after a successful write. The member taps again and collects a 400 for an
   * action that already succeeded — which is exactly the failed-tap experience
   * `deriveDisplayStatus` exists to prevent, arriving by the other door.
   */
  it("patches stored_status alongside the rendered status", async () => {
    seedTask(queryClient, { status: "TODO", due_date: "2020-01-01" });
    const { fn, succeed } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK, body: { status: "IN_PROGRESS" } });
    });

    await waitFor(() => {
      // Still renders as overdue...
      expect(cachedDetail(queryClient).status).toBe("OVERDUE");
      // ...but the action authority has moved on, so the button changes.
      expect(cachedDetail(queryClient).stored_status).toBe("IN_PROGRESS");
      expect(cachedListRow(queryClient).stored_status).toBe("IN_PROGRESS");
    });

    await act(async () => {
      await succeed();
    });
  });

  it("reverts stored_status too when the write fails", async () => {
    seedTask(queryClient, { status: "TODO", stored_status: "TODO" });
    const { fn, fail } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK, body: { status: "IN_PROGRESS" } });
    });
    await waitFor(() => {
      expect(cachedDetail(queryClient).stored_status).toBe("IN_PROGRESS");
    });

    await act(async () => {
      await fail();
    });

    await waitFor(() => {
      expect(cachedDetail(queryClient).stored_status).toBe("TODO");
      expect(cachedDetail(queryClient).status).toBe("TODO");
    });
  });

  it("stamps completed_at when completing, mirroring the server", async () => {
    seedTask(queryClient, { status: "IN_PROGRESS" });
    const { fn, succeed } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK, body: { status: "COMPLETED" } });
    });

    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("COMPLETED");
      expect(typeof cachedDetail(queryClient).completed_at).toBe("string");
    });

    await act(async () => {
      await succeed();
    });
  });

  it("rolls back on failure", async () => {
    seedTask(queryClient);
    const { fn, fail } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK, body: { status: "IN_PROGRESS" } });
    });
    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("IN_PROGRESS");
    });

    await act(async () => {
      await fail();
    });

    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("TODO");
      expect(cachedListRow(queryClient).status).toBe("TODO");
    });
  });

  // An illegal transition is a 400, and it takes exactly the same path as a
  // network failure — one path, not two. The server owns the transition table;
  // a client-side copy would be a second, wrong authority.
  it("rolls back a rejected transition exactly like a network failure", async () => {
    seedTask(queryClient);
    const { fn, fail } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK, body: { status: "COMPLETED" } });
    });
    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("COMPLETED");
    });

    await act(async () => {
      await fail(0, { message: "Invalid status transition from TODO to COMPLETED" });
    });

    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("TODO");
      expect(cachedDetail(queryClient).completed_at).toBeNull();
    });
  });

  /**
   * The race the surgical revert exists for. Mutation-level callbacks always
   * fire in v5, so a slow failure can land after a fast success on the same
   * task — rapid start-then-complete taps are the ordinary way to get there. A
   * whole-snapshot restore would undo the newer write; reverting field-by-field,
   * only while the cache still holds what this mutation wrote, does not.
   */
  it("leaves a newer write intact when an older mutation fails late", async () => {
    seedTask(queryClient);
    const { fn, succeed, fail } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    // Tap 1: start. Stays in flight.
    act(() => {
      result.current.mutate({ id: TASK, body: { status: "IN_PROGRESS" } });
    });
    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("IN_PROGRESS");
    });

    // Tap 2: complete. Also in flight, and it wins.
    act(() => {
      result.current.mutate({ id: TASK, body: { status: "COMPLETED" } });
    });
    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("COMPLETED");
    });

    await act(async () => {
      await succeed(1);
    });
    await act(async () => {
      await fail(0);
    });

    // The failure belongs to a value nothing holds any more, so it says nothing.
    expect(cachedDetail(queryClient).status).toBe("COMPLETED");
  });

  /**
   * The detail and the list can legitimately hold different values for the same
   * task: `invalidateQueries` defaults to `refetchType: "active"`, so an
   * unmounted board's list entry goes stale while a mounted card refetches the
   * detail. Each entry therefore has to roll back to *its own* prior value —
   * replaying one entry's history into the other writes a row that entry never
   * held, and offline nothing ever repairs it.
   */
  it("rolls each entry back to its own prior value when the two disagree", async () => {
    queryClient.setQueryData(detailKey, {
      id: TASK,
      status: "IN_PROGRESS",
      due_date: FUTURE,
      completed_at: null,
    });
    queryClient.setQueryData(listKey, [
      {
        id: TASK,
        status: "COMPLETED",
        due_date: FUTURE,
        completed_at: "2026-08-16T10:00:00.000Z",
      },
    ]);

    const { fn, fail } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK, body: { status: "COMPLETED" } });
    });
    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("COMPLETED");
    });

    await act(async () => {
      await fail();
    });

    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("IN_PROGRESS");
      expect(cachedDetail(queryClient).completed_at).toBeNull();
    });
    // The seed carried no `stored_status`, so the revert removes the key rather
    // than writing a value the row never held — the `delete` branch of `undo`.
    expect(cachedDetail(queryClient).stored_status).toBeUndefined();
    // The list keeps what *it* held, not the detail's history.
    expect(cachedListRow(queryClient).status).toBe("COMPLETED");
    expect(cachedListRow(queryClient).completed_at).toBe(
      "2026-08-16T10:00:00.000Z",
    );
  });

  // Query-core ignores `setQueryData(undefined)`, so writing into an entry that
  // never resolved would be unrollbackable — and would flip the entry to
  // "success" with a payload the server never sent. What this asserts is the
  // observable half: no entry is *created*, on either key.
  it("creates no cache entry when neither the detail nor the list has resolved", async () => {
    const { fn, fail } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK, body: { status: "IN_PROGRESS" } });
    });

    await act(async () => {
      await fail();
    });

    expect(queryClient.getQueryData(detailKey)).toBeUndefined();
    expect(queryClient.getQueryData(listKey)).toBeUndefined();
  });

  it("leaves an envelope shape it does not understand byte-identical", async () => {
    const envelope = { items: [{ id: TASK, status: "TODO" }] };
    queryClient.setQueryData(listKey, envelope);
    const { fn, fail } = deferredCalls();
    const { result } = renderHook(() => useUpdateTaskStatus(), {
      wrapper: createWrapper({ PATCH: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK, body: { status: "IN_PROGRESS" } });
    });

    await act(async () => {
      await fail();
    });

    expect(queryClient.getQueryData(listKey)).toBe(envelope);
  });
});

describe("useConfirmTask", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("writes points_awarded and confirmed_at, leaving the status alone", async () => {
    seedTask(queryClient, { status: "COMPLETED" });
    const { fn, succeed } = deferredCalls();
    const { result } = renderHook(() => useConfirmTask(), {
      wrapper: createWrapper({ POST: fn }, queryClient),
    });

    act(() => {
      result.current.mutate(TASK);
    });

    await waitFor(() => {
      expect(cachedDetail(queryClient).points_awarded).toBe(true);
      expect(typeof cachedDetail(queryClient).confirmed_at).toBe("string");
      expect(cachedDetail(queryClient).status).toBe("COMPLETED");
    });

    await act(async () => {
      await succeed();
    });
  });

  // A confirm is the one task action that moves the ledger, and `onSettled`
  // means a failed confirm reconciles the balance too rather than leaving the
  // rolled-back value unverified.
  it("invalidates the points family even when the confirm fails", async () => {
    seedTask(queryClient, { status: "COMPLETED" });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { fn, fail } = deferredCalls();
    const { result } = renderHook(() => useConfirmTask(), {
      wrapper: createWrapper({ POST: fn }, queryClient),
    });

    act(() => {
      result.current.mutate(TASK);
    });
    await act(async () => {
      await fail();
    });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["points"] });
    });
    expect(cachedDetail(queryClient).points_awarded).toBe(false);
  });
});

describe("useRejectTask", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("predicts IN_PROGRESS and clears completed_at", async () => {
    seedTask(queryClient, {
      status: "COMPLETED",
      completed_at: "2026-08-16T10:00:00.000Z",
    });
    const { fn, succeed } = deferredCalls();
    const { result } = renderHook(() => useRejectTask(), {
      wrapper: createWrapper({ POST: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK });
    });

    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("IN_PROGRESS");
      expect(cachedDetail(queryClient).stored_status).toBe("IN_PROGRESS");
      expect(cachedDetail(queryClient).completed_at).toBeNull();
    });

    await act(async () => {
      await succeed();
    });
  });

  it("predicts OVERDUE when the rejected task is already past due", async () => {
    seedTask(queryClient, { status: "COMPLETED", due_date: "2020-01-01" });
    const { fn, succeed } = deferredCalls();
    const { result } = renderHook(() => useRejectTask(), {
      wrapper: createWrapper({ POST: fn }, queryClient),
    });

    act(() => {
      result.current.mutate({ id: TASK });
    });

    await waitFor(() => {
      expect(cachedDetail(queryClient).status).toBe("OVERDUE");
    });

    await act(async () => {
      await succeed();
    });
  });
});
