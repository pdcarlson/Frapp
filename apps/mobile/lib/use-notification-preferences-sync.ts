import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useActiveChapterId,
  useNotificationPreferences,
  useUpdateNotificationPreference,
  useUpdateUserSettings,
  useUserSettings,
} from "@repo/hooks";
import {
  defaultNotificationCategoryState,
  isNotificationCategoryKey,
  MAX_TIME_ZONE_LENGTH,
  type NotificationCategoryKey,
} from "@repo/validation";
import { useIsApiAuthenticated } from "./use-is-api-authenticated";

/**
 * Notification preferences for s16, reconciled against the server.
 *
 * ## The query is the source of truth (#312)
 *
 * This hook used to hold its own `preferences` state and latch it to the first
 * successful server payload with a pair of one-shot refs. Every payload after
 * that was dropped: a post-PATCH refetch that normalized the value, a window
 * edited on web, a chapter switch. The state only recovered on a cold remount.
 *
 * The refs existed to defend a real invariant — "do not clobber the toggle the
 * member just flipped with a refetch that has not observed it yet" — so
 * removing them naively would have flickered every toggle. That defence now
 * lives one layer down, in `useUpdateNotificationPreference` /
 * `useUpdateUserSettings`, which write optimistically, roll back on error and
 * invalidate once settled. With the cache holding the optimistic value there is
 * nothing left for a local copy to protect, so everything below is derived.
 *
 * ## AsyncStorage is still here, and is a different concern
 *
 * The cache is the *server's* answer. AsyncStorage is what the screen shows
 * before there is one — offline, or signed out, when the toggles are local-only
 * and `SyncIndicator` says `"cached"` rather than claiming enforcement. It is
 * only ever a fallback: once a query succeeds, the server wins.
 */
export const PREFERENCE_STORAGE_KEY = "frapp.mobile.notification-preferences";
export const QUIET_HOURS_WINDOW_STORAGE_KEY = "frapp.mobile.quiet-hours-window";

const DEFAULT_QUIET_HOURS_START = "22:00";
const DEFAULT_QUIET_HOURS_END = "08:00";
const FALLBACK_QUIET_HOURS_TZ = "America/New_York";

/**
 * Mirrors the API contract in `UpdateUserSettingsDto` (HH:mm or HH:mm:ss), and
 * additionally tolerates the fractional seconds a Postgres `time` column can hold —
 * reading those as "no window" would wrongly report quiet hours as off.
 *
 * Note the API's own regex does **not** accept fractional seconds. That is safe
 * only because every value leaving this module is normalized to `HH:mm` first;
 * forwarding a raw server value into a PATCH would 400.
 */
const TIME_OF_DAY_PATTERN = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

function resolveDeviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : FALLBACK_QUIET_HOURS_TZ;
  } catch {
    return FALLBACK_QUIET_HOURS_TZ;
  }
}

/**
 * Postgres `time` columns come back as `HH:mm:ss`; the web profile inputs and our
 * UI copy both speak `HH:mm`. Normalize on the way in so a preserved window never
 * round-trips seconds back into the member's face.
 */
function normalizeTimeOfDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = TIME_OF_DAY_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes] = match;
  if (Number(hours) > 23 || Number(minutes) > 59) return null;
  return `${hours}:${minutes}`;
}

/**
 * Repair a stored zone only where this device can be *sure* it is broken.
 *
 * Re-enabling quiet hours replays this value into a PATCH, and the displayed
 * window is built from it, so whatever comes back here can be written to the
 * member's row on every device. That makes the substitution rule a data-safety
 * decision, not a display one.
 *
 * Deliberately does NOT ask `isSupportedTimeZone`. A device's ICU tzdata is
 * routinely older than the server's, so it can fail to resolve a zone the server
 * validated and stored — `Europe/Kyiv` (tzdata 2022b) on an Android build that
 * only knows `Europe/Kiev`, say. `UTC` still resolves there, so the fail-open
 * branch never fires and the verdict comes back a confident, wrong "invalid".
 * Substituting on it would show the wrong zone and then PATCH the device's own
 * zone over the member's, permanently, everywhere, with no error.
 *
 * So only device-independent defects are repaired: not a string, blank, or
 * longer than the column allows. Anything else is the server's to judge — it is
 * the authority (spec/behavior/notifications.md § Quiet Hours). A legacy row
 * holding a genuinely unresolvable zone therefore still round-trips to a 400 on
 * toggle, surfaced as the retry state. That is the accepted cost: a visible
 * error on an already-broken row beats silent corruption of a correct one.
 */
function normalizeTimeZone(value: unknown): string {
  if (typeof value !== "string") return resolveDeviceTimeZone();
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TIME_ZONE_LENGTH) {
    return resolveDeviceTimeZone();
  }
  return trimmed;
}

/** Which categories are on. Keys come from the shared catalog, never from here. */
export type CategoryState = Record<NotificationCategoryKey, boolean>;

/** A concrete quiet-hour window. Times are `HH:mm`; `tz` is an IANA zone name. */
export type QuietHoursWindow = {
  start: string;
  end: string;
  tz: string;
};

export type SyncIndicator = "synced" | "pending" | "cached" | "retry";

type ServerSettings = {
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_tz?: string | null;
};

/** What lives under {@link PREFERENCE_STORAGE_KEY}. */
type CachedPreferences = {
  quietHoursEnabled: boolean;
  categories: Partial<CategoryState>;
};

const DEFAULT_CACHED: CachedPreferences = {
  quietHoursEnabled: true,
  categories: {},
};

/**
 * The pre-catalog blob's two toggles, and the categories they stood for.
 *
 * A member upgrading has a blob in this shape sitting on their device. Dropping
 * it would silently re-enable a category they turned off, offline, with no
 * server round trip to correct it — so it migrates rather than being discarded
 * with the other unknown keys.
 */
const LEGACY_CATEGORY_KEYS: Record<string, NotificationCategoryKey> = {
  dmAlertsEnabled: "chat",
  eventRemindersEnabled: "events",
};

/**
 * Coerce whatever is in AsyncStorage into the current shape.
 *
 * Unknown keys are dropped rather than carried: the blob is written back on
 * every change, and a key nothing reads would otherwise live on that device
 * forever (this is what #266 found with `digestEmailsEnabled`).
 */
export function parseCachedPreferences(value: unknown): CachedPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.quietHoursEnabled !== "boolean") return null;

  const categories: Partial<CategoryState> = {};

  for (const [legacyKey, category] of Object.entries(LEGACY_CATEGORY_KEYS)) {
    const legacyValue = candidate[legacyKey];
    if (typeof legacyValue === "boolean") categories[category] = legacyValue;
  }

  const stored = candidate.categories;
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [key, entry] of Object.entries(stored)) {
      // Server-side the category column is unconstrained, so a blob can name a
      // category this build has no switch for. Widening state to match would
      // render nothing and persist forever.
      if (isNotificationCategoryKey(key) && typeof entry === "boolean") {
        categories[key] = entry;
      }
    }
  }

  return { quietHoursEnabled: candidate.quietHoursEnabled, categories };
}

export function defaultQuietHoursWindow(): QuietHoursWindow {
  return {
    start: DEFAULT_QUIET_HOURS_START,
    end: DEFAULT_QUIET_HOURS_END,
    tz: resolveDeviceTimeZone(),
  };
}

/** Coerce an untrusted blob (server row or cached JSON) into a normalized window. */
function toQuietHoursWindow(value: unknown): QuietHoursWindow | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const start = normalizeTimeOfDay(candidate.start);
  const end = normalizeTimeOfDay(candidate.end);
  if (!start || !end) return null;
  return { start, end, tz: normalizeTimeZone(candidate.tz) };
}

function settingsToQuietHoursWindow(
  settings: ServerSettings | undefined,
): QuietHoursWindow | null {
  if (!settings) return null;
  const start = normalizeTimeOfDay(settings.quiet_hours_start);
  const end = normalizeTimeOfDay(settings.quiet_hours_end);
  if (!start || !end) return null;
  return { start, end, tz: normalizeTimeZone(settings.quiet_hours_tz) };
}

function sameQuietHoursWindow(
  a: QuietHoursWindow | null,
  b: QuietHoursWindow | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.start === b.start && a.end === b.end && a.tz === b.tz;
}

/**
 * `null` means "the server hasn't told us yet"; a boolean is a real answer.
 * Quiet hours are *derived* state — enabled iff a full window is stored.
 */
function settingsToQuietHoursEnabled(
  settings: ServerSettings | undefined,
): boolean | null {
  if (!settings) return null;
  return settingsToQuietHoursWindow(settings) !== null;
}

/**
 * Fold the server's preference rows over the catalog defaults.
 *
 * A category with no row is enabled, because that is what the server does with
 * an absent row (`notification.service.ts` only suppresses on an explicit
 * `is_enabled: false`) — so this returns a complete state, not a patch, and a
 * category the member has never touched reads the same here as it behaves in
 * delivery.
 */
function rowsToCategoryState(rows: unknown): CategoryState {
  const state = defaultNotificationCategoryState();
  if (!Array.isArray(rows)) return state;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { category, is_enabled: isEnabled } = row as Record<string, unknown>;
    if (typeof isEnabled !== "boolean") continue;
    if (isNotificationCategoryKey(category)) state[category] = isEnabled;
  }
  return state;
}

export type NotificationPreferencesSync = {
  quietHoursEnabled: boolean;
  setQuietHoursEnabled: (value: boolean) => void;
  categories: CategoryState;
  setCategory: (key: NotificationCategoryKey, value: boolean) => void;
  /** The window that is in force (or that re-enabling would restore). */
  quietHoursWindow: QuietHoursWindow;
  /** Edit start/end/tz. Invalid times are ignored. */
  setQuietHoursWindow: (window: QuietHoursWindow) => void;
  isHydrated: boolean;
  hydrationRecovered: boolean;
  persistenceFailed: boolean;
  isAuthenticated: boolean;
  chapterId: string | null;
  quietHoursSync: SyncIndicator;
  categorySync: SyncIndicator;
};

export function useNotificationPreferencesSync(): NotificationPreferencesSync {
  const isAuthenticated = useIsApiAuthenticated();
  const chapterId = useActiveChapterId();
  const settingsQuery = useUserSettings();
  const notifPrefsQuery = useNotificationPreferences(chapterId ?? "");
  const updateSettings = useUpdateUserSettings();
  const updatePreference = useUpdateNotificationPreference();

  // The offline/pre-auth view. Never the answer when a query has one.
  const [cached, setCached] = useState<CachedPreferences>(DEFAULT_CACHED);
  const [isHydrated, setIsHydrated] = useState(false);
  const [hydrationRecovered, setHydrationRecovered] = useState(false);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const [windowPersistenceFailed, setWindowPersistenceFailed] = useState(false);

  // Disabling quiet hours nulls the window out server-side, so the member's custom
  // times only survive an off -> on cycle if we remember them here. `null` means we
  // have never seen a real window, and only then are the 22:00/08:00 defaults right.
  const [rememberedWindow, setRememberedWindow] =
    useState<QuietHoursWindow | null>(null);
  const fallbackWindow = useMemo(() => defaultQuietHoursWindow(), []);
  const quietHoursWindow = rememberedWindow ?? fallbackWindow;

  useEffect(() => {
    let isMounted = true;

    async function hydrate() {
      try {
        const persisted = await AsyncStorage.getItem(PREFERENCE_STORAGE_KEY);
        if (!persisted || !isMounted) return;
        const parsed = parseCachedPreferences(JSON.parse(persisted) as unknown);
        if (!parsed) return;
        setCached(parsed);
      } catch {
        if (isMounted) setHydrationRecovered(true);
        try {
          await AsyncStorage.removeItem(PREFERENCE_STORAGE_KEY);
        } catch {
          // ignore cleanup failures
        }
      } finally {
        if (isMounted) setIsHydrated(true);
      }
    }

    async function hydrateWindow() {
      try {
        const persisted = await AsyncStorage.getItem(
          QUIET_HOURS_WINDOW_STORAGE_KEY,
        );
        if (!persisted || !isMounted) return;
        const parsed = toQuietHoursWindow(JSON.parse(persisted) as unknown);
        if (!parsed) return;
        // Never clobber a window the server already supplied — it is fresher.
        setRememberedWindow((current) => current ?? parsed);
      } catch {
        try {
          await AsyncStorage.removeItem(QUIET_HOURS_WINDOW_STORAGE_KEY);
        } catch {
          // ignore cleanup failures
        }
      }
    }

    void hydrate();
    void hydrateWindow();
    return () => {
      isMounted = false;
    };
  }, []);

  // Track the newest non-empty window the server reports. Not one-shot: a window
  // edited on web must reach this device on refetch.
  useEffect(() => {
    if (!settingsQuery.isSuccess) return;
    const serverWindow = settingsToQuietHoursWindow(
      settingsQuery.data as unknown as ServerSettings | undefined,
    );
    if (!serverWindow) return;
    setRememberedWindow((current) =>
      sameQuietHoursWindow(current, serverWindow) ? current : serverWindow,
    );
  }, [settingsQuery.isSuccess, settingsQuery.data]);

  // ── Derived state ─────────────────────────────────────────────────────────
  // Both of these read the server first and fall back to the cache, which is
  // what makes a refetch — from any source — land on screen instead of being
  // latched out.

  const serverQuietHoursEnabled = settingsQuery.isSuccess
    ? settingsToQuietHoursEnabled(
        settingsQuery.data as unknown as ServerSettings | undefined,
      )
    : null;
  const quietHoursEnabled =
    serverQuietHoursEnabled ?? cached.quietHoursEnabled;

  const categories = useMemo<CategoryState>(() => {
    // Success means the server has spoken for *every* category, including the
    // ones it returned no row for — so its answer replaces the cache wholesale
    // rather than merging with it.
    if (notifPrefsQuery.isSuccess) {
      return rowsToCategoryState(notifPrefsQuery.data);
    }
    return { ...defaultNotificationCategoryState(), ...cached.categories };
  }, [notifPrefsQuery.isSuccess, notifPrefsQuery.data, cached.categories]);

  // Mirror the effective state for the next cold start. Written from the derived
  // value, so the cache follows the server rather than competing with it.
  useEffect(() => {
    if (!isHydrated) return;
    let cancelled = false;
    const blob: CachedPreferences = { quietHoursEnabled, categories };
    AsyncStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(blob))
      .then(() => {
        if (!cancelled) setPersistenceFailed(false);
      })
      .catch(() => {
        if (!cancelled) setPersistenceFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isHydrated, quietHoursEnabled, categories]);

  useEffect(() => {
    if (!isHydrated || !rememberedWindow) return;
    let cancelled = false;
    AsyncStorage.setItem(
      QUIET_HOURS_WINDOW_STORAGE_KEY,
      JSON.stringify(rememberedWindow),
    )
      .then(() => {
        if (!cancelled) setWindowPersistenceFailed(false);
      })
      .catch(() => {
        if (!cancelled) setWindowPersistenceFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isHydrated, rememberedWindow]);

  /**
   * The window to apply when enabling. A live server window wins — it is
   * authoritative and closes the race where a stale local cache would otherwise
   * clobber times set on another device before hydration lands.
   */
  const resolveWindowForEnable = useCallback((): QuietHoursWindow => {
    const serverWindow = settingsToQuietHoursWindow(
      settingsQuery.data as unknown as ServerSettings | undefined,
    );
    return serverWindow ?? rememberedWindow ?? fallbackWindow;
  }, [fallbackWindow, rememberedWindow, settingsQuery.data]);

  const setQuietHoursEnabled = useCallback(
    (value: boolean) => {
      // Always record it locally, not just when signed out. The optimistic
      // write in `useUpdateUserSettings` only fires when `GET /v1/settings` has
      // produced data, so on a cold start or after a failed load the switch
      // would otherwise not move at all — the state it derives from is the
      // fallback below, and nothing else would have updated it.
      setCached((current) => ({ ...current, quietHoursEnabled: value }));
      if (!isAuthenticated) return;

      if (value) {
        const window = resolveWindowForEnable();
        setRememberedWindow((current) =>
          sameQuietHoursWindow(current, window) ? current : window,
        );
        updateSettings.mutate({
          quiet_hours_start: window.start,
          quiet_hours_end: window.end,
          quiet_hours_tz: window.tz,
        });
        return;
      }

      // Clear the window server-side but keep remembering it, so turning quiet
      // hours back on restores the member's times instead of the defaults.
      updateSettings.mutate({
        quiet_hours_start: null,
        quiet_hours_end: null,
        quiet_hours_tz: null,
      });
    },
    [isAuthenticated, resolveWindowForEnable, updateSettings],
  );

  const setCategory = useCallback(
    (key: NotificationCategoryKey, value: boolean) => {
      // Same reasoning as the quiet-hours switch: the local mirror is the
      // fallback the derived state reads when no server answer exists, so it is
      // written on every toggle. Preferences are also chapter-scoped, so
      // without a chapter there is nothing to PATCH against and this is all
      // that happens.
      setCached((current) => ({
        ...current,
        categories: { ...current.categories, [key]: value },
      }));
      if (!isAuthenticated || !chapterId) return;

      updatePreference.mutate({
        chapter_id: chapterId,
        category: key,
        is_enabled: value,
      });
    },
    [chapterId, isAuthenticated, updatePreference],
  );

  const setQuietHoursWindow = useCallback(
    (next: QuietHoursWindow) => {
      const window = toQuietHoursWindow(next);
      if (!window) return;
      setRememberedWindow((current) =>
        sameQuietHoursWindow(current, window) ? current : window,
      );

      if (!isAuthenticated) return;
      // While quiet hours are off the server window is intentionally null; PATCHing
      // times now would silently switch enforcement back on. Remember them instead
      // and apply on re-enable.
      if (!quietHoursEnabled) return;

      updateSettings.mutate({
        quiet_hours_start: window.start,
        quiet_hours_end: window.end,
        quiet_hours_tz: window.tz,
      });
    },
    [isAuthenticated, quietHoursEnabled, updateSettings],
  );

  // The mutations own failure now — `isError` clears on the next `mutate`, which
  // is exactly the "toggle again to retry" affordance the copy promises.
  const quietHoursSync = useMemo<SyncIndicator>(() => {
    if (!isAuthenticated) return "cached";
    if (updateSettings.isError || settingsQuery.isError) return "retry";
    if (updateSettings.isPending) return "pending";
    if (settingsQuery.isSuccess) return "synced";
    return "pending";
  }, [
    isAuthenticated,
    settingsQuery.isError,
    settingsQuery.isSuccess,
    updateSettings.isError,
    updateSettings.isPending,
  ]);

  const categorySync = useMemo<SyncIndicator>(() => {
    if (!isAuthenticated || !chapterId) return "cached";
    if (updatePreference.isError || notifPrefsQuery.isError) return "retry";
    if (updatePreference.isPending) return "pending";
    if (notifPrefsQuery.isSuccess) return "synced";
    return "pending";
  }, [
    chapterId,
    isAuthenticated,
    notifPrefsQuery.isError,
    notifPrefsQuery.isSuccess,
    updatePreference.isError,
    updatePreference.isPending,
  ]);

  return {
    quietHoursEnabled,
    setQuietHoursEnabled,
    categories,
    setCategory,
    quietHoursWindow,
    setQuietHoursWindow,
    isHydrated,
    hydrationRecovered,
    persistenceFailed: persistenceFailed || windowPersistenceFailed,
    isAuthenticated,
    chapterId,
    quietHoursSync,
    categorySync,
  };
}
