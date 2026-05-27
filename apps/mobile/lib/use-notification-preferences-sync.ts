import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useActiveChapterId,
  useNotificationPreferences,
  useUpdateNotificationPreference,
  useUpdateUserSettings,
  useUserSettings,
} from "@repo/hooks";
import { useIsApiAuthenticated } from "./frapp-client";

export const PREFERENCE_STORAGE_KEY = "frapp.mobile.notification-preferences";

const DEFAULT_QUIET_HOURS_START = "22:00";
const DEFAULT_QUIET_HOURS_END = "08:00";
const FALLBACK_QUIET_HOURS_TZ = "America/New_York";

function resolveDeviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : FALLBACK_QUIET_HOURS_TZ;
  } catch {
    return FALLBACK_QUIET_HOURS_TZ;
  }
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

function settingsToQuietHoursEnabled(settings: ServerSettings | undefined): boolean | null {
  if (!settings) return null;
  const hasWindow =
    typeof settings.quiet_hours_start === "string" &&
    settings.quiet_hours_start.length > 0 &&
    typeof settings.quiet_hours_end === "string" &&
    settings.quiet_hours_end.length > 0;
  return hasWindow;
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

  const [preferences, setPreferences] = useState<PreferenceState>(DEFAULT_PREFERENCES);
  const [isHydrated, setIsHydrated] = useState(false);
  const [hydrationRecovered, setHydrationRecovered] = useState(false);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const [quietHoursFailed, setQuietHoursFailed] = useState(false);
  const [categoryFailed, setCategoryFailed] = useState(false);

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

    void hydrate();
    return () => {
      isMounted = false;
    };
  }, []);

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

  const setPreference = useCallback(
    (key: keyof PreferenceState, value: boolean) => {
      setPreferences((current) =>
        current[key] === value ? current : { ...current, [key]: value },
      );

      if (!isAuthenticated) return;

      if (key === "quietHoursEnabled") {
        const generation = ++quietHoursGenRef.current;
        const body = value
          ? {
              quiet_hours_start: DEFAULT_QUIET_HOURS_START,
              quiet_hours_end: DEFAULT_QUIET_HOURS_END,
              quiet_hours_tz: resolveDeviceTimeZone(),
            }
          : {
              quiet_hours_start: null,
              quiet_hours_end: null,
              quiet_hours_tz: null,
            };
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
    [chapterId, isAuthenticated, updatePreference, updateSettings],
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
    isHydrated,
    hydrationRecovered,
    persistenceFailed,
    isAuthenticated,
    chapterId,
    quietHoursSync,
    categorySync,
  };
}
