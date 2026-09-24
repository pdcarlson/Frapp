import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { formatTimer } from "@repo/formatting";

/**
 * The live-session card — `canvas-screens.dc.html`, `id="s10"`.
 *
 * Canvas draws one state: running, inside the zone. The paused variant is not
 * drawn and is built from the nearest patterns, because it is not an edge case
 * here — backgrounding the app *is* the pause (`spec/behavior/study-sessions.md`
 * § Anti-Distraction), so any member who checks a message sees it.
 *
 * ## The timer
 *
 * TODO-DESIGN: Canvas draws 52px/700; `display` is 32/700 and arithmetic on a
 * role token is banned by `foundations.md` §7, so the nearest role wins — the
 * ruling `components/tasks/points-summary-card.tsx` already made for the points
 * balance.
 *
 * `foundations.md` §7 reserves monospace for "the study timer" among other
 * fixed-width strings, but Canvas draws it in Figtree with
 * `font-variant-numeric: tabular-nums`, which is the same fix for the same
 * problem — digits that do not jitter as they tick. The reference wins on
 * visuals (`spec/ui/README.md` precedence), so this is Figtree with
 * `fontVariant: ["tabular-nums"]`, and `foundations.md` is amended in the same
 * change rather than left contradicting the thing that shipped.
 *
 * The number itself is *credited* time from the server's own watermark, not a
 * counter this component owns — see `lib/study/session.ts`.
 */
export interface SessionCardProps {
  /** Credited seconds, recomputed by the parent on its one-second tick. */
  seconds: number;
  zoneName: string;
  isPaused: boolean;
  /** The server has not heard a heartbeat in a while — see `isReportingStale`. */
  isReportingStale: boolean;
  /** e.g. `Leaving the zone pauses with a 5-min grace window.` */
  graceCopy: string;
  isEnding: boolean;
  onEnd: () => void;
}

export function SessionCard({
  seconds,
  zoneName,
  isPaused,
  isReportingStale,
  graceCopy,
  isEnding,
  onEnd,
}: SessionCardProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const statusColor = isPaused
    ? tokens.color.semantic.warning
    : tokens.color.semantic.success;
  const statusText = isPaused
    ? `${zoneName} · paused`
    : `${zoneName} · inside zone`;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Current session</Text>

      <Text
        style={styles.timer}
        // The visible clock reads as a stopwatch; the label says what it counts,
        // because "1:24:36" alone does not tell a screen-reader user whether
        // this is elapsed wall time or the time they will be paid for.
        accessibilityLabel={`${formatTimer(seconds)} of credited study time`}
      >
        {formatTimer(seconds)}
      </Text>

      <View style={styles.statusRow}>
        {/* Never colour alone: iconography.md §"Never encode status with icon
            colour alone" — the dot is always paired with this label. */}
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={[styles.statusText, { color: statusColor }]}>
          {statusText}
        </Text>
      </View>

      {isPaused ? (
        <Text style={styles.pausedNote}>
          Paused while Frapp was in the background. It resumes on its own — your
          credited time is safe until the grace window runs out.
        </Text>
      ) : null}

      {/* Without this the clock keeps climbing while the server hears nothing,
          and a member in a basement watches 47 minutes accumulate that will be
          voided the moment they stop. The number itself is clamped
          (`creditedSeconds`); this is what says so. */}
      {!isPaused && isReportingStale ? (
        <Text style={styles.staleNote}>
          Frapp hasn&apos;t been able to confirm your location for a few minutes.
          Move somewhere with signal — sessions that stop reporting for 10
          minutes are closed without points.
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="End session"
        accessibilityState={{ disabled: isEnding, busy: isEnding }}
        disabled={isEnding}
        onPress={onEnd}
        style={({ pressed }) => [
          styles.endButton,
          pressed && !isEnding ? styles.endButtonPressed : null,
          isEnding ? styles.endButtonDisabled : null,
        ]}
      >
        <Text style={styles.endLabel}>
          {isEnding ? "Ending…" : "End session"}
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
      paddingVertical: tokens.spacing.xl,
      paddingHorizontal: tokens.spacing.lg,
      alignItems: "center",
    },
    eyebrow: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    timer: {
      ...typeRole(tokens.typography.role.display),
      // Fixed-width digits, so the seconds column does not shuffle every tick.
      fontVariant: ["tabular-nums"],
      letterSpacing: -1,
      color: tokens.color.gold.askText,
      marginTop: tokens.spacing.sm,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.md,
    },
    dot: {
      width: 9,
      height: 9,
      // A 9px circle: `avatarRadius` is the sanctioned path for a round shape,
      // and half of 9 is the only value that makes it one.
      borderRadius: 4.5,
    },
    statusText: {
      ...typeRole(tokens.typography.role.label),
    },
    pausedNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
      marginTop: tokens.spacing.sm,
      maxWidth: 260,
    },
    staleNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.warning,
      textAlign: "center",
      marginTop: tokens.spacing.sm,
      maxWidth: 260,
    },
    endButton: {
      alignSelf: "stretch",
      // Secondary chrome, as drawn. The destructive weight lives in the
      // `Alert.alert` confirm the parent raises — `spec/ui/mobile/README.md`
      // names "end session early" as an action that needs one — and
      // `components.md` §3 reserves the Destructive *variant* for tint-style red.
      height: tokens.touch.buttonLarge,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
      marginTop: tokens.spacing.lg,
    },
    endButtonPressed: {
      opacity: 0.85,
    },
    endButtonDisabled: {
      opacity: 0.5,
    },
    endLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    grace: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      textAlign: "center",
      marginTop: tokens.spacing.md,
    },
  });
}
