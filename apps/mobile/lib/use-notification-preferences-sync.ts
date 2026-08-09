import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useActiveChapterId,
  useNotificationPreferences,
  useUpdateNotificationPreference,
  useUpdateUserSettings,
  useUserSettings,
} from "@repo/hooks";
import { MAX_TIME_ZONE_LENGTH } from "@repo/validation";
import { useIsApiAuthenticated } from "./use-is-api-authenticated";

export const PREFERENCE_STORAGE_KEY = "frapp.mobile.notification-preferences";
export const QUIET_HOURS_WINDOW_STORAGE_KEY = "frapp.mobile.quiet-hours-window";

const DEFAULT_QUIET_HOURS_START = "22:00";
const DEFAULT_QUIET_HOURS_END = "08:00";
const FALLBACK_QUIET_HOURS_TZ = "America/New_York";

/**
 * Mirrors the API contract in `UpdateUserSettingsDto` (HH:mm or HH:mm:ss), and
 * additionally tolerates the fractional seconds a Postgres `time` column can hold —
 * reading those as "no window" would wrongly report quiet hours as off.
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

const NOTIFICATION_CATEGORY = {
  dmAlerts: "chat",
  eventReminders: "events",
} as const;

export type PreferenceState = {
  quietHoursEnabled: boolean;
  dmAlertsEnabled: boolean;
  eventRemindersEnabled: boolean;
};

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

type ServerPreferenceRow = {
  category?: string;
  is_enabled?: boolean;
};

export const DEFAULT_PREFERENCES: PreferenceState = {
  quietHoursEnabled: true,
  dmAlertsEnabled: true,
  eventRemindersEnabled: true,
};

export function isPreferenceState(value: unknown): value is PreferenceState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.quietHoursEnabled === "boolean" &&
    typeof candidate.dmAlertsEnabled === "boolean" &&
    typeof candidate.eventRemindersEnabled === "boolean"
  );
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

function preferencesToFlags(
  rows: ServerPreferenceRow[] | undefined | null,
): Partial<PreferenceState> {
  if (!Array.isArray(rows)) return {};
  const result: Partial<PreferenceState> = {};
  for (const row of rows) {
    if (typeof row?.category !== "string") continue;
    if (typeof row?.is_enabled !== "boolean") continue;
    if (row.category === NOTIFICATION_CATEGORY.dmAlerts) {
      result.dmAlertsEnabled = row.is_enabled;
    } else if (row.category === NOTIFICATION_CATEGORY.eventReminders) {
      result.eventRemindersEnabled = row.is_enabled;
    }
  }
  return result;
}

export type NotificationPreferencesSync = {
  preferences: PreferenceState;
  setPreference: (key: keyof PreferenceState, value: boolean) => void;
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

  const [preferences, setPreferences] =
    useState<PreferenceState>(DEFAULT_PREFERENCES);
  const [isHydrated, setIsHydrated] = useState(false);
  const [hydrationRecovered, setHydrationRecovered] = useState(false);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const [windowPersistenceFailed, setWindowPersistenceFailed] = useState(false);
  const [quietHoursFailed, setQuietHoursFailed] = useState(false);
  const [categoryFailed, setCategoryFailed] = useState(false);

  // Disabling quiet hours nulls the window out server-side, so the member's custom
  // times only survive an off -> on cycle if we remember them here. `null` means we
  // have never seen a real window, and only then are the 22:00/08:00 defaults right.
  const [rememberedWindow, setRememberedWindow] =
    useState<QuietHoursWindow | null>(null);
  const fallbackWindow = useMemo(defaultQuietHoursWindow, []);
  const quietHoursWindow = rememberedWindow ?? fallbackWindow;

  const appliedSettingsRef = useRef(false);
  const appliedPrefsRef = useRef(false);
  const quietHoursGenRef = useRef(0);
  const categoryGenRef = useRef(0);

  useEffect(() => {
    let isMounted = true;

    async function hydrate() {
      try {
        const persisted = await AsyncStorage.getItem(PREFERENCE_STORAGE_KEY);
        if (!persisted || !isMounted) return;
        const parsed = JSON.parse(persisted) as unknown;
        if (!isPreferenceState(parsed)) return;
        setPreferences({
          quietHoursEnabled: parsed.quietHoursEnabled,
          dmAlertsEnabled: parsed.dmAlertsEnabled,
          eventRemindersEnabled: parsed.eventRemindersEnabled,
        });
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

  // Track the newest non-empty window the server reports. Unlike the enabled flag
  // this is not one-shot: a window edited on web must reach this device on refetch.
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

  useEffect(() => {
    if (!isHydrated || appliedSettingsRef.current) return;
    if (!settingsQuery.isSuccess) return;
    const quietEnabled = settingsToQuietHoursEnabled(
      settingsQuery.data as unknown as ServerSettings | undefined,
    );
    if (quietEnabled === null) return;
    appliedSettingsRef.current = true;
    setPreferences((current) =>
      current.quietHoursEnabled === quietEnabled
        ? current
        : { ...current, quietHoursEnabled: quietEnabled },
    );
  }, [isHydrated, settingsQuery.isSuccess, settingsQuery.data]);

  useEffect(() => {
    if (!isHydrated || appliedPrefsRef.current) return;
    if (!notifPrefsQuery.isSuccess) return;
    const flags = preferencesToFlags(
      notifPrefsQuery.data as unknown as ServerPreferenceRow[] | undefined,
    );
    if (Object.keys(flags).length === 0) return;
    appliedPrefsRef.current = true;
    setPreferences((current) => ({ ...current, ...flags }));
  }, [isHydrated, notifPrefsQuery.isSuccess, notifPrefsQuery.data]);

  useEffect(() => {
    if (!isHydrated) return;
    let cancelled = false;
    AsyncStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(preferences))
      .then(() => {
        if (!cancelled) setPersistenceFailed(false);
      })
      .catch(() => {
        if (!cancelled) setPersistenceFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isHydrated, preferences]);

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

  const setPreference = useCallback(
    (key: keyof PreferenceState, value: boolean) => {
      setPreferences((current) =>
        current[key] === value ? current : { ...current, [key]: value },
      );

      if (!isAuthenticated) return;

      if (key === "quietHoursEnabled") {
        setQuietHoursFailed(false);
        const generation = ++quietHoursGenRef.current;
        let body: {
          quiet_hours_start: string | null;
          quiet_hours_end: string | null;
          quiet_hours_tz: string | null;
        };
        if (value) {
          const window = resolveWindowForEnable();
          setRememberedWindow((current) =>
            sameQuietHoursWindow(current, window) ? current : window,
          );
          body = {
            quiet_hours_start: window.start,
            quiet_hours_end: window.end,
            quiet_hours_tz: window.tz,
          };
        } else {
          // Clear the window server-side but keep remembering it, so turning quiet
          // hours back on restores the member's times instead of the defaults.
          body = {
            quiet_hours_start: null,
            quiet_hours_end: null,
            quiet_hours_tz: null,
          };
        }
        updateSettings.mutate(body, {
          onSuccess: () => {
            if (generation === quietHoursGenRef.current) {
              setQuietHoursFailed(false);
            }
          },
          onError: () => {
            if (generation === quietHoursGenRef.current) {
              setQuietHoursFailed(true);
            }
          },
        });
        return;
      }

      if (!chapterId) return;
      const category =
        key === "dmAlertsEnabled"
          ? NOTIFICATION_CATEGORY.dmAlerts
          : NOTIFICATION_CATEGORY.eventReminders;
      setCategoryFailed(false);
      const generation = ++categoryGenRef.current;
      updatePreference.mutate(
        { chapter_id: chapterId, category, is_enabled: value },
        {
          onSuccess: () => {
            if (generation === categoryGenRef.current) {
              setCategoryFailed(false);
            }
          },
          onError: () => {
            if (generation === categoryGenRef.current) {
              setCategoryFailed(true);
            }
          },
        },
      );
    },
    [
      chapterId,
      isAuthenticated,
      resolveWindowForEnable,
      updatePreference,
      updateSettings,
    ],
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
      if (!preferences.quietHoursEnabled) return;

      setQuietHoursFailed(false);
      const generation = ++quietHoursGenRef.current;
      updateSettings.mutate(
        {
          quiet_hours_start: window.start,
          quiet_hours_end: window.end,
          quiet_hours_tz: window.tz,
        },
        {
          onSuccess: () => {
            if (generation === quietHoursGenRef.current) {
              setQuietHoursFailed(false);
            }
          },
          onError: () => {
            if (generation === quietHoursGenRef.current) {
              setQuietHoursFailed(true);
            }
          },
        },
      );
    },
    [isAuthenticated, preferences.quietHoursEnabled, updateSettings],
  );

  const quietHoursSync = useMemo<SyncIndicator>(() => {
    if (!isAuthenticated) return "cached";
    if (quietHoursFailed || settingsQuery.isError) return "retry";
    if (updateSettings.isPending) return "pending";
    if (settingsQuery.isSuccess) return "synced";
    return "pending";
  }, [
    isAuthenticated,
    quietHoursFailed,
    settingsQuery.isError,
    settingsQuery.isSuccess,
    updateSettings.isPending,
  ]);

  const categorySync = useMemo<SyncIndicator>(() => {
    if (!isAuthenticated || !chapterId) return "cached";
    if (categoryFailed || notifPrefsQuery.isError) return "retry";
    if (updatePreference.isPending) return "pending";
    if (notifPrefsQuery.isSuccess) return "synced";
    return "pending";
  }, [
    categoryFailed,
    chapterId,
    isAuthenticated,
    notifPrefsQuery.isError,
    notifPrefsQuery.isSuccess,
    updatePreference.isPending,
  ]);

  return {
    preferences,
    setPreference,
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
