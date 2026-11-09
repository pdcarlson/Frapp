"use client";

import { useMemo } from "react";
import {
  type QueryClient,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { throwUnlessOk, type components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Query keys for this module.
 *
 * Exported because the optimistic mutations below have to write into the same
 * cache entries the queries read, and inline literals in two places is how those
 * silently stop matching. The arrays are byte-identical to what the queries used
 * before the factory existed, so nothing outside this file moves.
 */
export const notificationKeys = {
  /** Prefix for every notification-scoped entry. */
  all: ["notifications"] as const,
  list: (chapterId: string | null, limit?: number) =>
    ["notifications", chapterId, limit] as const,
  /** One chapter's in-app lists, whatever their `limit`. */
  lists: (chapterId: string | null) => ["notifications", chapterId] as const,
  /**
   * Every chapter's preferences. Invalidating here rather than per chapter is
   * deliberate and pre-existing: it is one extra refetch on chapter switch, and
   * it cannot leave a stale chapter cached behind an active one.
   */
  preferencesRoot: ["notifications", "preferences"] as const,
  preferences: (chapterId: string) =>
    ["notifications", "preferences", chapterId] as const,
};

/** `GET /v1/settings` is user-scoped, not chapter-scoped — hence no chapter id. */
export const userSettingsKey = ["settings"] as const;

/**
 * What `GET` and `PATCH /v1/settings` answer: every field, always, including
 * for a member who has never saved (#2885).
 *
 * Taken from the contract, not restated, so a screen that derives its own
 * shape from it (`Pick<UserSettings, …>`) stops compiling when a field is
 * renamed. A hand-written all-optional copy would not: TypeScript accepts any
 * object sharing one property with it.
 */
export type UserSettings = components["schemas"]["UserSettingsDto"];

/**
 * The quiet-hour and theme fields `PATCH /v1/settings` accepts.
 *
 * `null` clears a field; **omitting** it preserves the stored value. Both
 * clients rely on that distinction — web omits an untouched `quiet_hours_tz`
 * rather than echoing a zone this browser's tzdata may not resolve — which is
 * why the optimistic merge below drops `undefined` instead of spreading it.
 */
export type UpdateUserSettingsBody =
  components["schemas"]["UpdateUserSettingsDto"];

export interface UpdateNotificationPreferenceBody {
  chapter_id: string;
  category: string;
  is_enabled: boolean;
}

/** One row of `GET /v1/notifications/preferences`, as much as we rely on. */
interface PreferenceRow {
  category?: string;
  is_enabled?: boolean;
}

/**
 * Merge a PATCH body over cached settings, ignoring keys the caller omitted.
 *
 * A plain spread would write `undefined` for every omitted key, which reads back
 * as "no quiet hours" and blanks the member's window in the UI until the
 * refetch lands. Since omission means *preserve* on this endpoint, the
 * optimistic value has to preserve too or it is not predicting the same result.
 */
function mergeDefinedSettings(
  previous: unknown,
  patch: UpdateUserSettingsBody,
): Record<string, unknown> {
  const base =
    previous && typeof previous === "object"
      ? { ...(previous as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) base[key] = value;
  }
  return base;
}

/**
 * Apply a preference toggle to the cached row array.
 *
 * A cached `null` is treated as an empty row list, not as "do not touch": a
 * member who has never set a preference genuinely has no rows, the endpoint
 * answers that with `[]` or `null`, and after this PATCH it would answer with
 * exactly the one row appended below. Predicting that is the point.
 *
 * **`undefined` is different and must not be written.** It means the query has
 * never resolved — offline, or errored — so there is no server answer to
 * predict against. Seeding a single row into it would flip the entry to
 * `status: "success"` with a one-row payload, and a consumer that folds those
 * rows over the catalog defaults would show *every other category* snapping to
 * its default in front of the member. It is also unrollbackable: query-core
 * ignores a `setQueryData` of `undefined`, so `onError` could not put it back.
 *
 * Anything else non-array — some envelope shape this function does not
 * understand — is left alone for the same reason.
 */
function applyPreferenceToRows(
  previous: unknown,
  patch: UpdateNotificationPreferenceBody,
): PreferenceRow[] | null {
  if (previous === undefined) return null;
  if (previous !== null && !Array.isArray(previous)) return null;
  const rows: PreferenceRow[] = Array.isArray(previous) ? previous : [];
  let replaced = false;
  const next = rows.map((row) => {
    if (row?.category !== patch.category) return row;
    replaced = true;
    return { ...row, is_enabled: patch.is_enabled };
  });
  // A category the member has never touched has no row — the server treats that
  // as enabled — so the first toggle appends rather than updates.
  if (!replaced) {
    next.push({ category: patch.category, is_enabled: patch.is_enabled });
  }
  return next;
}

/**
 * What `category` read in the cache before a toggle: a boolean, or `undefined`
 * for a category with no row (which the server reads as enabled).
 */
function previousEnabledFor(
  previous: unknown,
  category: string,
): boolean | undefined {
  if (!Array.isArray(previous)) return undefined;
  const row = (previous as PreferenceRow[]).find(
    (entry) => entry?.category === category,
  );
  return typeof row?.is_enabled === "boolean" ? row.is_enabled : undefined;
}

/**
 * Undo one category's optimistic write, leaving every other row as it stands.
 *
 * `restore === undefined` means the category had no row before, so the revert
 * removes the one this mutation appended rather than writing a value the server
 * never held.
 */
function revertCategory(
  current: unknown,
  category: string,
  restore: boolean | undefined,
): unknown {
  if (!Array.isArray(current)) return current;
  const rows = current as PreferenceRow[];
  if (restore === undefined) {
    return rows.filter((row) => row?.category !== category);
  }
  return rows.map((row) =>
    row?.category === category ? { ...row, is_enabled: restore } : row,
  );
}

/**
 * The member's in-app notifications in the active chapter.
 *
 * A row with a read receipt still in flight (`useMarkNotificationRead`, from
 * any caller in this app) is returned already read (#3788), so the dot and
 * every count drawn from this list clear on the tap rather than after the
 * PATCH and the refetch behind it. The overlay is a `select`, not a cache
 * write: a refetch that lands before the PATCH commits can't relight the row,
 * and a write that fails stops overlaying it with nothing to roll back.
 */
export function useNotifications(limit?: number) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  // Every pending receipt, the push tap's `on-open` ones included: mutation
  // filters match by key prefix.
  const pendingReads = useMutationState({
    filters: { mutationKey: markNotificationReadMutationKey, status: "pending" },
    select: (mutation) => {
      const id = mutation.state.variables;
      return typeof id === "string"
        ? `${id}\t${new Date(mutation.state.submittedAt).toISOString()}`
        : null;
    },
  });
  // Reduced to a string, so the `select` below keeps its identity (and the
  // query its memoized result) until the set of pending receipts changes.
  const pendingKey = pendingReads.filter(Boolean).sort().join("\n");
  const select = useMemo(() => {
    const pending = new Map<string, string>();
    for (const entry of pendingKey ? pendingKey.split("\n") : []) {
      const [id = "", sentAt = ""] = entry.split("\t");
      pending.set(id, sentAt);
    }
    return <T,>(data: T): T => withPendingReads(data, pending);
  }, [pendingKey]);
  return useQuery({
    queryKey: notificationKeys.list(chapterId, limit),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/notifications", {
        params: { query: { limit: limit ?? 50 } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 10_000,
    enabled: !!chapterId,
    select,
  });
}

export function useNotificationPreferences(chapterId: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: notificationKeys.preferences(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/notifications/preferences",
        { params: { query: { chapterId } } },
      );
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled: !!chapterId,
  });
}

/**
 * The caller's quiet hours and theme. Never resolves `undefined`.
 *
 * The API answers a member who has never saved with the defaults (#2885). It
 * used to send an empty body, which `openapi-fetch` reads as `data: undefined`,
 * and TanStack Query refuses that with a console error and a failed query. An
 * empty body is now a contract break, so it rejects under a name that says so
 * rather than tripping TanStack's generic guard.
 */
export function useUserSettings() {
  const client = useFrappClient();
  return useQuery({
    queryKey: userSettingsKey,
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/settings");
      if (error) throw error;
      if (data === undefined) {
        throw new Error("GET /v1/settings answered with an empty body");
      }
      return data;
    },
    staleTime: 300_000,
  });
}

export function useRegisterPushToken() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["notifications", "register-push-token"],
    mutationFn: async (body: { token: string; device_name?: string }) => {
      const { data, error } = await client.POST("/v1/push-tokens", { body });
      if (error) throw error;
      return data;
    },
  });
}

export function useRemovePushToken() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["notifications", "remove-push-token"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/push-tokens/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Identifies `useMarkNotificationRead` (#3393), so a client can give it its
 * own defaults. Its failures group in Sentry under `notifications`, not
 * `unkeyed` (`@repo/observability`'s `query-errors.ts`).
 */
export const markNotificationReadMutationKey = ["notifications", "read"] as const;

/**
 * The read receipt a push tap sends as it opens the app: the same write, under
 * a longer key so a client can default it on its own. Mobile retries it once
 * (#3747, `apps/mobile/lib/query-client.ts`), because it goes out the moment
 * the app comes back. The inbox's taps and its Mark all read keep the shorter
 * key and no retry: a batch awaits every write, and a retry parked offline
 * would never let it settle.
 */
export const markNotificationReadOnOpenMutationKey = [
  ...markNotificationReadMutationKey,
  "on-open",
] as const;

/**
 * True for a cached in-app list (`notificationKeys.list`), not the
 * preferences entries that share the `notifications` prefix.
 */
function isNotificationListKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === "notifications" && queryKey[1] !== "preferences";
}

type CachedNotificationRow = Record<string, unknown> & {
  read_at?: unknown;
};

/**
 * `rows` with `read_at` set on every unread row `select` picks, or `rows`
 * itself (same reference) when nothing changed, so an unrelated cache entry
 * is not re-rendered by a write that did not touch it.
 */
function withRowsRead(
  rows: unknown,
  select: (row: CachedNotificationRow) => boolean,
  /** The stamp, or a function read right after `select` picked the row. */
  readAt: string | (() => string),
): unknown {
  if (!Array.isArray(rows)) return rows;
  let changed = false;
  const next = rows.map((row: unknown) => {
    if (!row || typeof row !== "object") return row;
    const candidate = row as CachedNotificationRow;
    if (candidate.read_at !== null || !select(candidate)) return row;
    changed = true;
    return {
      ...candidate,
      read_at: typeof readAt === "function" ? readAt() : readAt,
    };
  });
  return changed ? next : rows;
}

/** Mark rows read in every cached list. True when any row changed. */
function markCachedRowsRead(
  queryClient: QueryClient,
  select: (row: CachedNotificationRow) => boolean,
  readAt: string,
): boolean {
  let changed = false;
  for (const [queryKey, rows] of queryClient.getQueriesData({
    predicate: (query) => isNotificationListKey(query.queryKey),
  })) {
    const next = withRowsRead(rows, select, readAt);
    if (next !== rows) {
      changed = true;
      queryClient.setQueryData(queryKey, next);
    }
  }
  return changed;
}

/**
 * Refetch the mounted in-app lists. Narrower than `notificationKeys.all`,
 * which would refetch a mounted preferences screen for a read that cannot
 * change it.
 */
export function invalidateNotificationLists(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => isNotificationListKey(query.queryKey),
  });
}

/**
 * The cached list with every row a pending read receipt names shown read
 * (#3788). `pending` maps a notification id to when its receipt was sent.
 */
function withPendingReads<T>(data: T, pending: ReadonlyMap<string, string>): T {
  if (pending.size === 0) return data;
  // One pass however many receipts are pending: web's Mark all read sends one
  // per unread row, and this reruns in every observer as each one settles.
  let stamp = "";
  return withRowsRead(
    data,
    (row) => {
      const sentAt = typeof row.id === "string" ? pending.get(row.id) : undefined;
      if (sentAt === undefined) return false;
      stamp = sentAt;
      return true;
    },
    () => stamp,
  ) as T;
}

function chatChannelOf(row: CachedNotificationRow): string | null {
  const data = row.data;
  if (!data || typeof data !== "object") return null;
  const target = (data as Record<string, unknown>).target;
  if (!target || typeof target !== "object") return null;
  const { screen, channelId } = target as Record<string, unknown>;
  return screen === "chat" && typeof channelId === "string" ? channelId : null;
}

/**
 * Clear the cached chat notifications for a channel the member just read
 * (#3788), the way `POST /v1/channels/{id}/read` now clears them on the
 * server. True when a cached row changed, so the caller refetches the lists
 * only when they were showing one.
 */
export function markChannelNotificationsReadInCache(
  queryClient: QueryClient,
  channelId: string,
  readAt: string = new Date().toISOString(),
): boolean {
  return markCachedRowsRead(
    queryClient,
    (row) => chatChannelOf(row) === channelId,
    readAt,
  );
}

/**
 * Refetch the in-app lists when one of them shows an unread chat row for
 * `channelId`, without writing anything: for a server change the client can't
 * predict row by row (leaving a group DM clears nothing, hiding a DM clears
 * its rows).
 */
export function refetchIfChannelNotificationsShown(
  queryClient: QueryClient,
  channelId: string,
): void {
  const shown = queryClient
    .getQueriesData({ predicate: (query) => isNotificationListKey(query.queryKey) })
    .some(
      ([, rows]) =>
        Array.isArray(rows) &&
        rows.some(
          (row: unknown) =>
            !!row &&
            typeof row === "object" &&
            (row as CachedNotificationRow).read_at === null &&
            chatChannelOf(row as CachedNotificationRow) === channelId,
        ),
    );
  if (shown) void invalidateNotificationLists(queryClient);
}

export function useMarkNotificationRead({
  sentOnOpen = false,
}: {
  /** A push tap's receipt, sent as the app opens (see the key above). */
  sentOnOpen?: boolean;
} = {}) {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: sentOnOpen
      ? markNotificationReadOnOpenMutationKey
      : markNotificationReadMutationKey,
    mutationFn: async (id: string) => {
      const result = await client.PATCH("/v1/notifications/{id}/read", {
        params: { path: { id } },
      });
      // On the status, not `error`: see `useMarkChannelRead`.
      throwUnlessOk(result);
      return result.data;
    },
    // The row reads as read while this write is pending through
    // `useNotifications`' overlay of pending receipts (#3788), not a cache
    // write, so a refetch landing mid-write can't relight it and a failed
    // write simply stops overlaying. On success the server's stamp goes into
    // the cache before the overlay lifts, and the refetch reconciles: for a
    // list that has data, its invalidation cancels any GET that started before
    // this write committed.
    //
    // A list with no data yet is the exception, and a push tap's cold start
    // is exactly that case: query-core cancels an in-flight fetch only when
    // the query has data, so the invalidation joins the first GET instead.
    // That GET may have read the row before this write committed, and nothing
    // here could stamp into an empty entry. So the mutation stays pending,
    // keeping the overlay up, until that GET has landed and one started after
    // the write has replaced it.
    onSuccess: (updated, id) => {
      const stamp =
        updated && typeof updated === "object" && "read_at" in updated
          ? (updated as { read_at?: unknown }).read_at
          : null;
      markCachedRowsRead(
        queryClient,
        (row) => row.id === id,
        typeof stamp === "string" ? stamp : new Date().toISOString(),
      );
      const firstFetchInFlight = queryClient
        .getQueryCache()
        .findAll({ predicate: (query) => isNotificationListKey(query.queryKey) })
        .some(
          (query) =>
            query.state.data === undefined &&
            query.state.fetchStatus === "fetching",
        );
      const refetch = invalidateNotificationLists(queryClient);
      if (!firstFetchInFlight) return;
      return refetch.then(() => invalidateNotificationLists(queryClient));
    },
  });
}

/**
 * Toggle one notification category, optimistically (#312).
 *
 * The cache is the source of truth here, not a copy the screen keeps: before
 * this, the screen held its own `preferences` state and latched it after the
 * first server payload, so every later payload — a post-PATCH refetch that
 * normalized the value, an edit made on another device, a chapter switch — was
 * dropped on the floor.
 *
 * `onSettled` rather than `onSuccess` invalidates, so a failed PATCH also
 * reconciles against the server instead of leaving the rolled-back value
 * unverified.
 */
export function useUpdateNotificationPreference() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["notifications", "update-notification-preference"],
    mutationFn: async (body: UpdateNotificationPreferenceBody) => {
      const { data, error } = await client.PATCH(
        "/v1/notifications/preferences",
        { body },
      );
      if (error) throw error;
      return data;
    },
    onMutate: async (body) => {
      const queryKey = notificationKeys.preferences(body.chapter_id);
      // An in-flight GET that started before this toggle has not observed it,
      // so letting it land would overwrite the optimistic value with a stale
      // one and look like the write was lost.
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      const restore = previousEnabledFor(previous, body.category);
      const next = applyPreferenceToRows(previous, body);
      if (next) queryClient.setQueryData(queryKey, next);
      return { queryKey, category: body.category, restore, wrote: next !== null };
    },
    onError: (_error, _body, context) => {
      if (!context?.wrote) return;
      // Revert only this category, and only if the cache still holds what we
      // wrote. Restoring the whole snapshot would undo a *different* category
      // the member toggled after this one — the race the generation counters in
      // the old mobile hook existed to prevent. Mutation-level callbacks always
      // fire (unlike the per-`mutate()` options they replaced, which v5 drops
      // for a superseded mutation), so a slow failure can land after a fast
      // success and must not speak for it.
      queryClient.setQueryData(context.queryKey, (current: unknown) =>
        revertCategory(current, context.category, context.restore),
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: notificationKeys.preferencesRoot,
      });
    },
  });
}

/**
 * Update quiet hours (and theme, on web), optimistically (#312).
 *
 * Same reconciliation story as the category mutation above. Note the merge
 * drops `undefined` values rather than spreading them — see
 * {@link mergeDefinedSettings}.
 */
export function useUpdateUserSettings() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["settings", "update-user-settings"],
    mutationFn: async (body: UpdateUserSettingsBody) => {
      const { data, error } = await client.PATCH("/v1/settings", { body });
      if (error) throw error;
      return data;
    },
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: userSettingsKey });
      const previous = queryClient.getQueryData(userSettingsKey);
      // Only predict against a payload the server actually sent. An entry
      // that has not loaded (offline, or failed) is `undefined`, and writing a
      // body-shaped object into it would hand consumers settings the server
      // never reported.
      const wrote = previous !== undefined;
      if (wrote) {
        queryClient.setQueryData(
          userSettingsKey,
          mergeDefinedSettings(previous, body),
        );
      }
      return { previous, wrote };
    },
    onError: (_error, _body, context) => {
      if (!context?.wrote) return;
      queryClient.setQueryData(userSettingsKey, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userSettingsKey });
    },
  });
}
