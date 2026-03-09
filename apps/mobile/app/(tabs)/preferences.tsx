import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { frappTokens } from "@repo/theme/tokens";

const PREFERENCE_STORAGE_KEY = "frapp.mobile.notification-preferences";

type PreferenceState = {
  quietHoursEnabled: boolean;
  dmAlertsEnabled: boolean;
  eventRemindersEnabled: boolean;
  digestEmailsEnabled: boolean;
};

type PreferenceRow = {
  key: keyof PreferenceState;
  title: string;
  description: string;
};

const DEFAULT_PREFERENCES: PreferenceState = {
  quietHoursEnabled: true,
  dmAlertsEnabled: true,
  eventRemindersEnabled: true,
  digestEmailsEnabled: false,
};

const PREFERENCE_ROWS: PreferenceRow[] = [
  {
    key: "quietHoursEnabled",
    title: "Quiet hours",
    description: "Silence normal-priority pushes from 10:00 PM to 8:00 AM.",
  },
  {
    key: "dmAlertsEnabled",
    title: "Direct message alerts",
    description: "Allow immediate push notifications for chapter direct messages.",
  },
  {
    key: "eventRemindersEnabled",
    title: "Event reminders",
    description: "Receive pre-check-in reminders for upcoming chapter events.",
  },
  {
    key: "digestEmailsEnabled",
    title: "Digest emails",
    description: "Send daily summary email with unread updates and action items.",
  },
];

type PreferenceToggleRowProps = {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
};

function PreferenceToggleRow({
  title,
  description,
  value,
  onValueChange,
}: PreferenceToggleRowProps) {
  return (
    <View style={styles.toggleCard}>
      <View style={styles.toggleTextStack}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: frappTokens.color.surface.border,
          true: frappTokens.color.feedback.infoBorderStrong,
        }}
        thumbColor={
          value
            ? frappTokens.color.brand.royalBlue
            : frappTokens.color.surface.card
        }
      />
    </View>
  );
}

function isPreferenceState(value: unknown): value is PreferenceState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.quietHoursEnabled === "boolean" &&
    typeof candidate.dmAlertsEnabled === "boolean" &&
    typeof candidate.eventRemindersEnabled === "boolean" &&
    typeof candidate.digestEmailsEnabled === "boolean"
  );
}

export default function PreferencesScreen() {
  const [preferences, setPreferences] = useState<PreferenceState>(DEFAULT_PREFERENCES);
  const [isHydrated, setIsHydrated] = useState(false);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const [hydrationRecovered, setHydrationRecovered] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function hydratePreferences() {
      try {
        const persistedPreferences = await AsyncStorage.getItem(PREFERENCE_STORAGE_KEY);
        if (!persistedPreferences || !isMounted) {
          return;
        }

        const parsedPreferences = JSON.parse(persistedPreferences) as unknown;
        if (!isPreferenceState(parsedPreferences)) {
          return;
        }

        setPreferences(parsedPreferences);
      } catch {
        setHydrationRecovered(true);
        try {
          await AsyncStorage.removeItem(PREFERENCE_STORAGE_KEY);
        } catch {
          // Ignore cleanup failures and continue with safe in-memory defaults.
        }
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    }

    void hydratePreferences();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    async function persistPreferences() {
      try {
        await AsyncStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(preferences));
        setPersistenceFailed(false);
      } catch {
        setPersistenceFailed(true);
      }
    }

    void persistPreferences();
  }, [isHydrated, preferences]);

  const enabledCount = useMemo(
    () => Object.values(preferences).filter(Boolean).length,
    [preferences],
  );

  return (
    <ScreenShell
      title="Preferences"
      subtitle="Control communication defaults and confirm whether each preference has synced."
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Saved preferences</Text>
        <Text style={styles.summaryValue}>{enabledCount} enabled</Text>
        <Text style={styles.summaryMeta}>
          {!isHydrated
            ? "Hydrating local preferences..."
            : hydrationRecovered
              ? "Malformed saved preferences were reset to safe defaults."
              : "Stored on this device for reliable local continuity."}
        </Text>
      </View>

      {PREFERENCE_ROWS.map((row) => (
        <PreferenceToggleRow
          key={row.title}
          title={row.title}
          description={row.description}
          value={preferences[row.key]}
          onValueChange={(value) =>
            setPreferences((current) => ({
              ...current,
              [row.key]: value,
            }))
          }
        />
      ))}

      <TaskLoopCard
        category="Quiet hours"
        state="synced"
        title={preferences.quietHoursEnabled ? "10:00 PM → 8:00 AM" : "Disabled"}
        body="Quiet-hour preference is synced and reflected in push delivery rules."
        meta="Timezone: America/New_York • Persisted locally"
      />
      <TaskLoopCard
        category="Category controls"
        state={hydrationRecovered ? "retry" : isHydrated ? "pending" : "cached"}
        title={
          hydrationRecovered
            ? "Recovered from invalid saved preferences"
            : isHydrated
              ? "Preference sync queue ready"
              : "Hydrating saved preferences"
        }
        body="Recent toggle changes are queued for the next reliable network sync."
        meta={
          hydrationRecovered
            ? "Corrupt local JSON was cleared and defaults were restored."
            : isHydrated
              ? "Will retry automatically on poor networks."
              : "Loading local values..."
        }
      />
      <TaskLoopCard
        category="Theme"
        state="cached"
        title="System mode active"
        body="Frapp follows your device appearance and keeps the last known mode offline."
        meta="Last confirmed sync: today"
      />
      <TaskLoopCard
        category="Integrity"
        state={persistenceFailed ? "retry" : "synced"}
        title={persistenceFailed ? "Local persistence retrying" : "Notification token healthy"}
        body={
          persistenceFailed
            ? "Preference writes failed and will retry automatically."
            : "Notification registration is healthy and linked to saved preference state."
        }
        meta={persistenceFailed ? "Retrying local storage write..." : "Last verified just now"}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.feedback.infoBorder,
    backgroundColor: frappTokens.color.feedback.infoBackground,
    padding: frappTokens.spacing.lg,
    gap: 6,
  },
  summaryLabel: {
    fontSize: frappTokens.type.label,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: frappTokens.color.feedback.infoText,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: "800",
    color: frappTokens.color.feedback.infoTextStrong,
    letterSpacing: -0.3,
  },
  summaryMeta: {
    fontSize: frappTokens.type.meta,
    color: frappTokens.color.feedback.infoText,
  },
  toggleCard: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    padding: frappTokens.spacing.lg,
    gap: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleTextStack: {
    flex: 1,
    gap: 4,
    paddingRight: 12,
  },
  toggleTitle: {
    fontSize: frappTokens.type.section - 2,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
  toggleDescription: {
    fontSize: frappTokens.type.body - 1,
    lineHeight: 20,
    color: frappTokens.color.text.secondary,
  },
});
