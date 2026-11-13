import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";
import { ForwardGlyph } from "@/components/control-glyphs";
import { eyebrowStyle } from "@/components/eyebrow";
import { useChapterBranding } from "@/lib/chapter-branding";
import type { StudyZoneModel } from "@/lib/study/zones";
import { zoneRewardCopy } from "@/lib/study/zones";
import { proximityCopy, type ZoneProximity } from "@/lib/study/proximity";
import { CardMessages } from "@/components/card-messages";
import { SkeletonBlock, SkeletonText } from "@/components/state-block";

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
  /**
   * Where the member is relative to `zone`, from a fix read while the screen
   * is open, or null with no fix yet (location not allowed, or still reading).
   * Shown before the tap, so "You're outside the zone" stops being news that
   * only arrives after Start.
   */
  proximity?: ZoneProximity | null;
  /** True when more than one zone exists, so the row is worth tapping. */
  canChooseZone: boolean;
  isStarting: boolean;
  /**
   * The chapter's subscription refused a session write (#2297). Permanent
   * until an officer resolves it, so Start is disabled rather than left
   * inviting a tap that 403s every time. The explanation is the screen's
   * `failure` line; this only removes the affordance.
   */
  isBlocked?: boolean;
  graceCopy: string;
  /**
   * The screen's notice (a session that just ended) and failure lines, drawn
   * under Start rather than above the card, so the card and the list below it
   * don't jump when one arrives.
   */
  notice?: string | null;
  failure?: string | null;
  onChooseZone: () => void;
  onStart: () => void;
}

export function StartCard({
  zone,
  proximity = null,
  canChooseZone,
  isStarting,
  isBlocked = false,
  graceCopy,
  notice = null,
  failure = null,
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
          zone
            ? `Study zone: ${zone.name}${proximity ? `, ${proximityCopy(proximity)}` : ""}`
            : "No study zone selected"
        }
        accessibilityHint={
          canChooseZone ? "Choose a different zone." : undefined
        }
        disabled={!canChooseZone}
        onPress={onChooseZone}
        style={({ pressed }) => [
          styles.zoneRow,
          pressed && canChooseZone ? styles.zoneRowPressed : null,
        ]}
      >
        <View style={styles.zoneText}>
          <Text style={styles.zoneName}>{zone?.name ?? "Pick a zone"}</Text>
          {/* No meta without a zone. The screen picks one by default, so this
              is a moment between loads, and the old line only narrated that
              zones exist. */}
          {zone ? (
            <Text style={styles.zoneMeta}>
              {/* Inline, on the line that is always there, so a fix landing
                  never moves the button (the no-layout-shift rule). */}
              {proximity ? (
                <Text
                  style={
                    proximity.inside
                      ? styles.proximityHere
                      : styles.proximityAway
                  }
                >
                  {proximityCopy(proximity)}
                  {" · "}
                </Text>
              ) : null}
              {zoneRewardCopy(zone)}
            </Text>
          ) : null}
        </View>
        {canChooseZone ? (
          <ForwardGlyph color={tokens.color.text.mutedForeground} size={20} />
        ) : null}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start session"
        accessibilityState={{
          disabled: !zone || isStarting || isBlocked,
          busy: isStarting,
        }}
        disabled={!zone || isStarting || isBlocked}
        onPress={onStart}
        style={({ pressed }) => [
          styles.startButton,
          { backgroundColor: accent },
          // `isBlocked` greys it too. Disabling without greying leaves a
          // control that reads as live and silently swallows the tap — the
          // dead end #2297 removes, not a smaller version of it.
          !zone || isStarting || isBlocked ? styles.startButtonDisabled : null,
          pressed && zone && !isStarting && !isBlocked
            ? styles.startButtonPressed
            : null,
        ]}
      >
        <Text style={[styles.startLabel, { color: tokens.color.gold.onHouse }]}>
          {isStarting ? "Starting…" : "Start session"}
        </Text>
      </Pressable>

      <CardMessages notice={notice} failure={failure} align="left" />

      <Text style={styles.grace}>{graceCopy}</Text>
    </View>
  );
}

/**
 * The start card before its zones load, on the card's own styles: the eyebrow,
 * the zone row's name and reward lines, the start button and the grace line.
 * `CardListSkeleton` places it above the session list.
 */
export function StartCardSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, title } = tokens.typography.role;

  return (
    <View style={styles.card}>
      <SkeletonText role={caption} width="26%" />
      <View style={styles.zoneRow}>
        <View style={styles.zoneText}>
          <SkeletonText role={title} width="50%" />
          <SkeletonText
            role={caption}
            width="36%"
            style={styles.skeletonMeta}
          />
        </View>
      </View>
      <SkeletonBlock
        width="100%"
        height={tokens.touch.buttonLarge}
        radius={tokens.radius.control}
        style={styles.skeletonButton}
      />
      <SkeletonText role={caption} width="72%" style={styles.skeletonGrace} />
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  // Shared by the card's lines and its skeleton's, so the two can't drift.
  const margin = {
    zoneMeta: 2,
    button: tokens.spacing.md,
    grace: tokens.spacing.md,
  };
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      padding: tokens.spacing.lg,
    },
    eyebrow: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.mutedForeground,
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
      marginTop: margin.zoneMeta,
    },
    proximityHere: {
      color: tokens.color.semantic.success,
    },
    proximityAway: {
      color: tokens.color.text.foreground,
    },
    startButton: {
      height: tokens.touch.buttonLarge,
      borderRadius: tokens.radius.control,
      alignItems: "center",
      justifyContent: "center",
      marginTop: margin.button,
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
    // The skeleton's lines take the margins the real ones do, from `margin`.
    skeletonMeta: {
      marginTop: margin.zoneMeta,
    },
    skeletonButton: {
      marginTop: margin.button,
    },
    skeletonGrace: {
      marginTop: margin.grace,
    },
    grace: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: margin.grace,
    },
  });
}
