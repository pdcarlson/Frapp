import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The push opt-in primer, drawn as a card.
 *
 * `spec/ui/mobile/patterns.md` § Push notifications: the primer "appears at the
 * first moment push has obvious value … and on the first-run screen (s03) as a
 * card, never as a cold launch-time OS prompt. Declining is a quiet 'Not now';
 * the OS prompt fires only after the user accepts the primer."
 *
 * This owns the *card*. The permission request, the Android channel ordering
 * and the token lifecycle behind "Turn on" are `lib/notifications/push.ts` and
 * `lib/notifications/use-push-runtime.ts` — the seam `patterns.md` draws between
 * the screen that hosts the primer (s03, issue #958) and the cluster that owns
 * push (C7, issue #998). Exported from here so s03 renders it rather than
 * reimplementing the copy.
 *
 * ## It renders when push is unavailable, rather than disappearing
 *
 * Remote push does not run in Expo Go, and no EAS project exists yet (#938), so
 * "unavailable" is the state of every build that can currently be produced. A
 * card that vanished there would leave s03 with a hole and tell the member
 * nothing. Instead the CTA disables and states the reason —
 * `spec/ui/design-system/components.md` §5, the same ruling the dues Pay CTA
 * follows.
 *
 * Signet gold throughout, not the chapter accent: this is Signet asking for a
 * device permission on its own behalf, not chapter chrome.
 */

export interface PushPrimerCardProps {
  /** `pushUnavailableReason()` — `null` when push can actually be enabled. */
  unavailableReason: string | null;
  /** True while the OS dialog is in flight, so the CTA cannot double-fire. */
  isRequesting?: boolean;
  onTurnOn: () => void;
  onNotNow: () => void;
}

/**
 * The drawn bell — `canvas-screens.dc.html` s03 draws a 26×26 gold duotone bell.
 * Built to `spec/ui/design-system/iconography.md` §1's recipe (1.6px stroke on a
 * 24px grid, rounded caps and joins, low-opacity fill of the stroke's own hue)
 * rather than lifted from the reference's markup, per `components.md`'s
 * transcribe-never-lift rule.
 */
function BellGlyph({ color }: { color: string }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5c0 3.2-.7 4.9-1.4 5.9-.4.5 0 1.3.7 1.3h12.4c.7 0 1.1-.8.7-1.3-.7-1-1.4-2.7-1.4-5.9A5.5 5.5 0 0 0 12 3.5Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={tint(color, 0.16)}
      />
      <Path
        d="M10 19.2a2.2 2.2 0 0 0 4 0"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PushPrimerCard({
  unavailableReason,
  isRequesting = false,
  onTurnOn,
  onNotNow,
}: PushPrimerCardProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const disabled = unavailableReason !== null || isRequesting;

  return (
    <View style={styles.card}>
      <BellGlyph color={tokens.color.gold.askText} />
      <Text style={styles.title}>Don&apos;t miss @channel</Text>
      <Text style={styles.body}>
        Get pinged for mandatory events, dues deadlines, and mentions. Nothing
        else.
      </Text>
      {unavailableReason ? (
        <Text style={styles.reason}>{unavailableReason}</Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Turn on notifications"
          // The reason is wired to the control, not merely printed beside it —
          // a screen reader lands on a disabled button and needs to be told why
          // here, not two elements earlier.
          accessibilityHint={unavailableReason ?? undefined}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onTurnOn}
          style={({ pressed }) => [
            styles.primary,
            disabled ? styles.primaryDisabled : null,
            pressed && !disabled ? styles.pressed : null,
          ]}
        >
          <Text style={styles.primaryLabel}>Turn on</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Not now"
          onPress={onNotNow}
          style={({ pressed }) => [
            styles.secondary,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.secondaryLabel}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // Canvas draws this card one surface step above the channel list beside it
    // — elevation is a lighter surface, never a shadow (foundations.md §10).
    card: {
      backgroundColor: tokens.color.surface.card,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      padding: tokens.spacing.lg + 4,
      gap: tokens.spacing.sm,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    reason: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      marginTop: tokens.spacing.xs,
    },
    primary: {
      flex: 1,
      minHeight: tokens.touch.button,
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.gold.house,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryDisabled: {
      opacity: 0.55,
    },
    primaryLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
    secondary: {
      minHeight: tokens.touch.button,
      paddingHorizontal: tokens.spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    pressed: {
      opacity: 0.8,
    },
  });
}
