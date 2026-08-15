import { useEffect, useMemo, useState } from "react";
import {
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { SignetTokens } from "@repo/theme/signet";
import { isSupportedTimeZone, MAX_TIME_ZONE_LENGTH } from "@repo/validation";
import { useChapterBranding } from "@/lib/chapter-branding";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
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

/**
 * Must agree with the hook's normalizer, including the range check — otherwise a
 * value like `24:00` passes here, is rejected there, and the edit silently no-ops
 * while the field still shows the uncommitted text.
 */
function isValidTimeInput(value: string): boolean {
  if (!TIME_INPUT_PATTERN.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours <= 23 && minutes <= 59;
}

/** "22:00" -> "10:00 PM". Falls back to the raw value for anything unparseable. */
function formatTimeOfDay(value: string): string {
  if (!isValidTimeInput(value)) return value;
  const [rawHours, rawMinutes] = value.split(":");
  const hours = Number(rawHours);
  const suffix = hours < 12 ? "AM" : "PM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${rawMinutes} ${suffix}`;
}

const PREFERENCE_ROWS: PreferenceRow[] = [
  {
    key: "dmAlertsEnabled",
    title: "Direct message alerts",
    description:
      "Allow immediate push notifications for chapter direct messages.",
  },
  {
    key: "eventRemindersEnabled",
    title: "Event reminders",
    description: "Receive pre-check-in reminders for upcoming chapter events.",
  },
];

type PreferenceToggleRowProps = {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  tokens: SignetTokens;
  accent: string;
  styles: ReturnType<typeof createStyles>;
};

function PreferenceToggleRow({
  title,
  description,
  value,
  onValueChange,
  tokens,
  accent,
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
          false: tokens.color.border.input,
          true: tint(tokens.color.semantic.info, 0.3),
        }}
        thumbColor={value ? accent : tokens.color.surface.card}
      />
    </View>
  );
}

type QuietHoursCardProps = {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  quietHoursWindow: QuietHoursWindow;
  onWindowChange: (next: QuietHoursWindow) => void;
  tokens: SignetTokens;
  accent: string;
  styles: ReturnType<typeof createStyles>;
};

function QuietHoursCard({
  enabled,
  onEnabledChange,
  quietHoursWindow,
  onWindowChange,
  tokens,
  accent,
  styles,
}: QuietHoursCardProps) {
  const [draft, setDraft] = useState<QuietHoursWindow>(quietHoursWindow);

  // Re-sync when the effective window changes underneath us: a server hydrate, an
  // edit made on web, or the remembered window being restored on re-enable.
  useEffect(() => {
    setDraft(quietHoursWindow);
  }, [quietHoursWindow]);

  // Validate only what the member typed. A stored zone arrives here already
  // accepted by the server, and this device's tzdata can be older than the
  // server's — so running our own resolvability check over it produces a
  // confident false negative (`Europe/Kyiv` on a build that knows only
  // `Europe/Kiev`). That would strand the member twice over: `commitDraft`
  // reverts on every blur, so they could not edit their times at all, and the
  // only way out — retyping a zone this device knows — would overwrite their
  // correct zone on every other device. Structural checks still apply, because
  // blank and over-length are wrong on any device.
  const trimmedTz = draft.tz.trim();
  const tzEdited = trimmedTz !== quietHoursWindow.tz.trim();
  const tzIsValid =
    trimmedTz.length > 0 &&
    trimmedTz.length <= MAX_TIME_ZONE_LENGTH &&
    (!tzEdited || isSupportedTimeZone(trimmedTz));
  const timesAreValid =
    isValidTimeInput(draft.start.trim()) && isValidTimeInput(draft.end.trim());
  const draftIsValid = timesAreValid && tzIsValid;

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
            false: tokens.color.border.input,
            true: tint(tokens.color.semantic.info, 0.3),
          }}
          thumbColor={enabled ? accent : tokens.color.surface.card}
        />
      </View>

      <View style={styles.quietHoursFieldRow}>
        <View style={styles.quietHoursField}>
          <Text style={styles.quietHoursFieldLabel}>Start</Text>
          <TextInput
            value={draft.start}
            onChangeText={(value) =>
              setDraft((current) => ({ ...current, start: value }))
            }
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
            onChangeText={(value) =>
              setDraft((current) => ({ ...current, end: value }))
            }
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
          onChangeText={(value) =>
            setDraft((current) => ({ ...current, tz: value }))
          }
          onBlur={commitDraft}
          placeholder="America/New_York"
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel="Quiet hours timezone"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.quietHoursInput}
        />
      </View>

      <Text
        style={
          draftIsValid ? styles.quietHoursHint : styles.quietHoursHintError
        }
      >
        {!timesAreValid
          ? "Use 24-hour HH:mm times (e.g. 21:00)."
          : !tzIsValid
            ? "Enter a timezone name like America/Chicago."
            : enabled
              ? "Applies to this account on every device."
              : "Saved for when you turn quiet hours back on."}
      </Text>
    </View>
  );
}

export default function PreferencesScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
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
        accent={accent}
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
          accent={accent}
          styles={styles}
        />
      ))}

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
        meta={
          persistenceFailed
            ? "Local storage write failed"
            : "Last verified just now"
        }
      />
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    summaryCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tint(tokens.color.semantic.info, 0.3),
      backgroundColor: tint(tokens.color.semantic.info),
      padding: tokens.spacing.lg,
      gap: tokens.spacing.xs,
    },
    summaryLabel: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.semantic.info,
    },
    summaryValue: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
      letterSpacing: -0.3,
    },
    summaryMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.info,
    },
    toggleCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    toggleTextStack: {
      flex: 1,
      gap: tokens.spacing.xs,
      paddingRight: tokens.spacing.md,
    },
    quietHoursCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    quietHoursHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    quietHoursFieldRow: {
      flexDirection: "row",
      gap: tokens.spacing.md,
    },
    quietHoursField: {
      flex: 1,
    },
    quietHoursFieldLabel: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.mutedForeground,
    },
    quietHoursInput: {
      marginTop: tokens.spacing.xs,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    quietHoursHint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    quietHoursHintError: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    toggleTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    toggleDescription: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
  });
}
