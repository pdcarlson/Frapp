import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import type { StudyZoneModel } from "@/lib/study/zones";
import { zoneRewardCopy } from "@/lib/study/zones";

/**
 * The idle half of s10 — pick a zone, start a session.
 *
 * **Not drawn.** Canvas draws only a running session, but a member arrives here
 * with nothing running, `study_sessions.geofence_id` is required, and
 * `spec/ui/mobile/patterns.md` anchors the location primer to "the first
 * Start-session tap" — so a Start control and a zone choice both have to exist.
 * Composed from the card, list-row and primary-button tokens the rest of the
 * app already uses (`components.md` §2: undrawn primitives compose from the
 * same tokens).
 */
export interface StartCardProps {
  zone: StudyZoneModel | null;
  /** True when more than one zone exists, so the row is worth tapping. */
  canChooseZone: boolean;
  isStarting: boolean;
  graceCopy: string;
  onChooseZone: () => void;
  onStart: () => void;
}

export function StartCard({
  zone,
  canChooseZone,
  isStarting,
  graceCopy,
  onChooseZone,
  onStart,
}: StartCardProps) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Study zone</Text>

      <Pressable
        accessibilityRole={canChooseZone ? "button" : "text"}
        accessibilityLabel={
          zone ? `Study zone: ${zone.name}` : "No study zone selected"
        }
        accessibilityHint={canChooseZone ? "Choose a different zone." : undefined}
        disabled={!canChooseZone}
        onPress={onChooseZone}
        style={({ pressed }) => [
          styles.zoneRow,
          pressed && canChooseZone ? styles.zoneRowPressed : null,
        ]}
      >
        <View style={styles.zoneText}>
          <Text style={styles.zoneName}>{zone?.name ?? "Pick a zone"}</Text>
          <Text style={styles.zoneMeta}>
            {zone ? zoneRewardCopy(zone) : "Your chapter has study zones set up."}
          </Text>
        </View>
        {canChooseZone ? <Text style={styles.chevron}>›</Text> : null}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start session"
        accessibilityState={{ disabled: !zone || isStarting, busy: isStarting }}
        disabled={!zone || isStarting}
        onPress={onStart}
        style={({ pressed }) => [
          styles.startButton,
          { backgroundColor: accent },
          !zone || isStarting ? styles.startButtonDisabled : null,
          pressed && zone && !isStarting ? styles.startButtonPressed : null,
        ]}
      >
        <Text style={[styles.startLabel, { color: tokens.color.gold.onHouse }]}>
          {isStarting ? "Starting…" : "Start session"}
        </Text>
      </Pressable>

      <Text style={styles.grace}>{graceCopy}</Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
    },
    eyebrow: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    zoneRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      marginTop: tokens.spacing.sm,
    },
    zoneRowPressed: {
      opacity: 0.7,
    },
    zoneText: {
      flex: 1,
    },
    zoneName: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    zoneMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: 2,
    },
    chevron: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.muted,
    },
    startButton: {
      height: tokens.touch.buttonLarge,
      borderRadius: tokens.radius.control,
      alignItems: "center",
      justifyContent: "center",
      marginTop: tokens.spacing.md,
    },
    startButtonPressed: {
      opacity: 0.85,
    },
    startButtonDisabled: {
      opacity: 0.5,
    },
    startLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    grace: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: tokens.spacing.md,
    },
  });
}
