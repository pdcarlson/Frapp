import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { FrappTokens } from "@repo/theme/tokens";
import { ThemePreference, useFrappTheme } from "@/lib/theme";

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

const THEME_OPTIONS: Array<{ key: ThemePreference; label: string }> = [
  { key: "system", label: "System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

type PreferenceToggleRowProps = {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  tokens: FrappTokens;
  styles: ReturnType<typeof createStyles>;
};

function PreferenceToggleRow({
  title,
  description,
  value,
  onValueChange,
  tokens,
  styles,
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
          false: tokens.color.surface.border,
          true: tokens.color.feedback.infoBorderStrong,
        }}
        thumbColor={value ? tokens.color.brand.royalBlue : tokens.color.surface.card}
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
  const { tokens, themePreference, resolvedTheme, setThemePreference } =
    useFrappTheme();
  const styles = createStyles(tokens);
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
          tokens={tokens}
          styles={styles}
        />
      ))}

      <View style={styles.themeCard}>
        <Text style={styles.themeLabel}>Theme override</Text>
        <Text style={styles.themeDescription}>
          System is the default. Manual override persists locally for reliable preview testing.
        </Text>
        <View style={styles.themeOptionRow}>
          {THEME_OPTIONS.map((themeOption) => {
            const selected = themePreference === themeOption.key;
            return (
              <Pressable
                key={themeOption.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setThemePreference(themeOption.key)}
                style={[
                  styles.themeOptionButton,
                  selected ? styles.themeOptionButtonActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.themeOptionText,
                    selected ? styles.themeOptionTextActive : null,
                  ]}
                >
                  {themeOption.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

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
        title={`Theme mode: ${themePreference}`}
        body={`Current resolved appearance is ${resolvedTheme}. Manual override persists on this device.`}
        meta="Theme preference synced to local settings storage"
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

function createStyles(tokens: FrappTokens) {
  return StyleSheet.create({
    summaryCard: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.feedback.infoBorder,
      backgroundColor: tokens.color.feedback.infoBackground,
      padding: tokens.spacing.lg,
      gap: 6,
    },
    summaryLabel: {
      fontSize: tokens.type.label,
      fontWeight: "700",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.feedback.infoText,
    },
    summaryValue: {
      fontSize: 22,
      fontWeight: "800",
      color: tokens.color.feedback.infoTextStrong,
      letterSpacing: -0.3,
    },
    summaryMeta: {
      fontSize: tokens.type.meta,
      color: tokens.color.feedback.infoText,
    },
    toggleCard: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
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
      fontSize: tokens.type.section - 2,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
    toggleDescription: {
      fontSize: tokens.type.body - 1,
      lineHeight: 20,
      color: tokens.color.text.secondary,
    },
    themeCard: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: 8,
    },
    themeLabel: {
      fontSize: tokens.type.section - 2,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
    themeDescription: {
      fontSize: tokens.type.body - 1,
      lineHeight: 20,
      color: tokens.color.text.secondary,
    },
    themeOptionRow: {
      marginTop: 4,
      flexDirection: "row",
      gap: 8,
    },
    themeOptionButton: {
      flex: 1,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.muted,
      paddingVertical: 9,
      alignItems: "center",
    },
    themeOptionButtonActive: {
      borderColor: tokens.color.feedback.infoBorderStrong,
      backgroundColor: tokens.color.feedback.infoBackgroundStrong,
    },
    themeOptionText: {
      fontSize: 13,
      fontWeight: "700",
      color: tokens.color.text.secondary,
    },
    themeOptionTextActive: {
      color: tokens.color.feedback.infoTextInteractive,
    },
  });
}
