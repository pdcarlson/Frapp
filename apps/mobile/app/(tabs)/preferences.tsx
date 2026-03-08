import { StyleSheet, Switch, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { frappTokens } from "@repo/theme/tokens";
type PreferencePreview = {
  title: string;
  description: string;
  enabled: boolean;
};

const PREFERENCE_PREVIEW_ROWS: PreferencePreview[] = [
  {
    title: "Quiet hours",
    description: "Silence normal-priority pushes from 10:00 PM to 8:00 AM.",
    enabled: true,
  },
  {
    title: "Direct message alerts",
    description: "Allow immediate push notifications for chapter direct messages.",
    enabled: true,
  },
  {
    title: "Event reminders",
    description: "Receive pre-check-in reminders for upcoming chapter events.",
    enabled: true,
  },
  {
    title: "Digest emails",
    description: "Send daily summary email with unread updates and action items.",
    enabled: false,
  },
];

type PreferenceToggleRowProps = {
  title: string;
  description: string;
  value: boolean;
};

function PreferenceToggleRow({
  title,
  description,
  value,
}: PreferenceToggleRowProps) {
  return (
    <View style={styles.toggleCard}>
      <View style={styles.toggleTextStack}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        disabled
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

export default function PreferencesScreen() {
  const enabledCount = PREFERENCE_PREVIEW_ROWS.filter((row) => row.enabled).length;

  return (
    <ScreenShell
      title="Preferences"
      subtitle="Control communication defaults and confirm whether each preference has synced."
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Saved preferences</Text>
        <Text style={styles.summaryValue}>{enabledCount} enabled</Text>
        <Text style={styles.summaryMeta}>
          Live persistence resumes once mobile runtime hook issue is resolved.
        </Text>
      </View>

      {PREFERENCE_PREVIEW_ROWS.map((row) => (
        <PreferenceToggleRow
          key={row.title}
          title={row.title}
          description={row.description}
          value={row.enabled}
        />
      ))}

      <TaskLoopCard
        category="Quiet hours"
        state="synced"
        title="10:00 PM → 8:00 AM"
        body="Quiet-hour preference is synced and reflected in push delivery rules."
        meta="Timezone: America/New_York • Preview values"
      />
      <TaskLoopCard
        category="Category controls"
        state="pending"
        title="Preference sync queue ready"
        body="Recent toggle changes are queued for the next reliable network sync."
        meta="Will retry automatically when runtime persistence is restored."
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
        state="retry"
        title="Notification token refresh failed"
        body="Push registration is retrying. You can still view all alerts from Notification Center."
        meta="Retry in 30 seconds"
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
