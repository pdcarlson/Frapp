import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { FrappTokens } from "@repo/theme/tokens";
import { ThemePreference, useFrappTheme } from "@/lib/theme";
import {
  type PreferenceState,
  type QuietHoursWindow,
  useNotificationPreferencesSync,
} from "@/lib/use-notification-preferences-sync";

type PreferenceRow = {
  key: keyof PreferenceState;
  title: string;
  description: string;
};

const TIME_INPUT_PATTERN = /^\d{2}:\d{2}$/;

/** "22:00" -> "10:00 PM". Falls back to the raw value for anything unparseable. */
function formatTimeOfDay(value: string): string {
  const match = TIME_INPUT_PATTERN.exec(value);
  if (!match) return value;
  const [rawHours, rawMinutes] = value.split(":");
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  if (hours > 23 || minutes > 59) return value;
  const suffix = hours < 12 ? "AM" : "PM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${rawMinutes} ${suffix}`;
}

const PREFERENCE_ROWS: PreferenceRow[] = [
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

type QuietHoursCardProps = {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  quietHoursWindow: QuietHoursWindow;
  onWindowChange: (next: QuietHoursWindow) => void;
  tokens: FrappTokens;
  styles: ReturnType<typeof createStyles>;
};

function QuietHoursCard({
  enabled,
  onEnabledChange,
  quietHoursWindow,
  onWindowChange,
  tokens,
  styles,
}: QuietHoursCardProps) {
  const [draft, setDraft] = useState<QuietHoursWindow>(quietHoursWindow);

  // Re-sync when the effective window changes underneath us: a server hydrate, an
  // edit made on web, or the remembered window being restored on re-enable.
  useEffect(() => {
    setDraft(quietHoursWindow);
  }, [quietHoursWindow]);

  const draftIsValid =
    TIME_INPUT_PATTERN.test(draft.start.trim()) &&
    TIME_INPUT_PATTERN.test(draft.end.trim()) &&
    draft.tz.trim().length > 0;

  const commitDraft = () => {
    if (!draftIsValid) {
      setDraft(quietHoursWindow);
      return;
    }
    onWindowChange({
      start: draft.start.trim(),
      end: draft.end.trim(),
      tz: draft.tz.trim(),
    });
  };

  return (
    <View style={styles.quietHoursCard}>
      <View style={styles.quietHoursHeaderRow}>
        <View style={styles.toggleTextStack}>
          <Text style={styles.toggleTitle}>Quiet hours</Text>
          <Text style={styles.toggleDescription}>
            {enabled
              ? `Silence normal-priority pushes from ${formatTimeOfDay(
                  quietHoursWindow.start,
                )} to ${formatTimeOfDay(quietHoursWindow.end)}.`
              : "Silence normal-priority pushes during a window you choose."}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onEnabledChange}
          accessibilityLabel="Quiet hours"
          trackColor={{
            false: tokens.color.surface.border,
            true: tokens.color.feedback.infoBorderStrong,
          }}
          thumbColor={enabled ? tokens.color.brand.royalBlue : tokens.color.surface.card}
        />
      </View>

      <View style={styles.quietHoursFieldRow}>
        <View style={styles.quietHoursField}>
          <Text style={styles.quietHoursFieldLabel}>Start</Text>
          <TextInput
            value={draft.start}
            onChangeText={(value) => setDraft((current) => ({ ...current, start: value }))}
            onBlur={commitDraft}
            placeholder="22:00"
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Quiet hours start time"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={styles.quietHoursInput}
          />
        </View>
        <View style={styles.quietHoursField}>
          <Text style={styles.quietHoursFieldLabel}>End</Text>
          <TextInput
            value={draft.end}
            onChangeText={(value) => setDraft((current) => ({ ...current, end: value }))}
            onBlur={commitDraft}
            placeholder="08:00"
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Quiet hours end time"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={styles.quietHoursInput}
          />
        </View>
      </View>

      <View style={styles.quietHoursField}>
        <Text style={styles.quietHoursFieldLabel}>Timezone</Text>
        <TextInput
          value={draft.tz}
          onChangeText={(value) => setDraft((current) => ({ ...current, tz: value }))}
          onBlur={commitDraft}
          placeholder="America/New_York"
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel="Quiet hours timezone"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.quietHoursInput}
        />
      </View>

      <Text style={draftIsValid ? styles.quietHoursHint : styles.quietHoursHintError}>
        {!draftIsValid
          ? "Use 24-hour HH:mm times (e.g. 21:00) and an IANA timezone."
          : enabled
            ? "Applies to this account on every device."
            : "Saved for when you turn quiet hours back on."}
      </Text>
    </View>
  );
}

export default function PreferencesScreen() {
  const { tokens, themePreference, resolvedTheme, setThemePreference } =
    useFrappTheme();
  const styles = createStyles(tokens);
  const {
    preferences,
    setPreference,
    quietHoursWindow,
    setQuietHoursWindow,
    isHydrated,
    hydrationRecovered,
    persistenceFailed,
    isAuthenticated,
    quietHoursSync,
    categorySync,
  } = useNotificationPreferencesSync();

  const enabledCount = useMemo(
    () => Object.values(preferences).filter(Boolean).length,
    [preferences],
  );

  const summaryMeta = !isHydrated
    ? "Hydrating local preferences..."
    : hydrationRecovered
      ? "Malformed saved preferences were reset to safe defaults."
      : isAuthenticated
        ? "Synced with your account and cached on this device."
        : "Saved on this device. Will sync when you sign in.";

  const quietHoursMeta =
    quietHoursSync === "synced"
      ? "Server quiet-hour window enforces push delivery."
      : quietHoursSync === "retry"
        ? "Couldn't reach the server. Toggle again to retry."
        : quietHoursSync === "pending"
          ? "Saving quiet-hour window..."
          : "Saved locally. Server sync needs a signed-in session.";

  const categoryMeta =
    categorySync === "synced"
      ? "Category toggles are saved to your account."
      : categorySync === "retry"
        ? "Couldn't reach the server. Toggle again to retry."
        : categorySync === "pending"
          ? "Sending category change..."
          : "Saved locally. Server sync needs a signed-in chapter session.";

  return (
    <ScreenShell
      title="Preferences"
      subtitle="Control communication defaults and see how each preference is synced."
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Saved preferences</Text>
        <Text style={styles.summaryValue}>{enabledCount} enabled</Text>
        <Text style={styles.summaryMeta}>{summaryMeta}</Text>
      </View>

      <QuietHoursCard
        enabled={preferences.quietHoursEnabled}
        onEnabledChange={(value) => setPreference("quietHoursEnabled", value)}
        quietHoursWindow={quietHoursWindow}
        onWindowChange={setQuietHoursWindow}
        tokens={tokens}
        styles={styles}
      />

      {PREFERENCE_ROWS.map((row) => (
        <PreferenceToggleRow
          key={row.key}
          title={row.title}
          description={row.description}
          value={preferences[row.key]}
          onValueChange={(value) => setPreference(row.key, value)}
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
        state={quietHoursSync}
        title={
          preferences.quietHoursEnabled
            ? `${formatTimeOfDay(quietHoursWindow.start)} → ${formatTimeOfDay(
                quietHoursWindow.end,
              )}`
            : "Disabled"
        }
        body={
          quietHoursSync === "synced"
            ? "Quiet-hour preference is synced to your account."
            : "Quiet-hour preference is saved on this device."
        }
        meta={quietHoursMeta}
      />
      <TaskLoopCard
        category="Category controls"
        state={hydrationRecovered ? "retry" : categorySync}
        title={
          hydrationRecovered
            ? "Recovered from invalid saved preferences"
            : categorySync === "synced"
              ? "Category preferences in sync"
              : categorySync === "pending"
                ? "Sending category change..."
                : categorySync === "retry"
                  ? "Server sync failed — toggle again to retry"
                  : "Saved locally — no server sync yet"
        }
        body={
          hydrationRecovered
            ? "Corrupt local JSON was cleared and defaults were restored."
            : "DM alerts map to the chat category; event reminders map to the events category."
        }
        meta={categoryMeta}
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
        state={persistenceFailed ? "retry" : "cached"}
        title={
          persistenceFailed
            ? "Local persistence failed"
            : "Local preference cache healthy"
        }
        body={
          persistenceFailed
            ? "Preference writes failed. Toggle a preference again to re-attempt."
            : "AsyncStorage cache mirrors the latest toggle state for offline reads."
        }
        meta={persistenceFailed ? "Local storage write failed" : "Last verified just now"}
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
    quietHoursCard: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: 12,
    },
    quietHoursHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    quietHoursFieldRow: {
      flexDirection: "row",
      gap: 12,
    },
    quietHoursField: {
      flex: 1,
    },
    quietHoursFieldLabel: {
      fontSize: tokens.type.label,
      fontWeight: "700",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.secondary,
    },
    quietHoursInput: {
      marginTop: 6,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.muted,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: tokens.color.text.primary,
    },
    quietHoursHint: {
      fontSize: tokens.type.meta,
      color: tokens.color.text.secondary,
    },
    quietHoursHintError: {
      fontSize: tokens.type.meta,
      fontWeight: "600",
      color: tokens.color.feedback.errorText,
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
