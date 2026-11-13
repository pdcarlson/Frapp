import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { CloseGlyph } from "@/components/control-glyphs";
import { BellGlyph } from "@/components/notifications/push-ask";
import { usePushReminder } from "@/lib/notifications/use-push-primer";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";
import { useGuardedBySwipe } from "@/lib/swipe-claim";

/**
 * The chat home's one come-back for push (`shouldOfferReminder`): a member who
 * said "Not now" in onboarding a few days ago, or joined before onboarding
 * asked, and whose push is still off. One compact row under UP NEXT, like the
 * officer setup checklist above the channels, drawn only once both local reads
 * are in, so it never pushes the list down after it has drawn.
 *
 * Turning it on, or closing it, answers it for good. After that the push row
 * in Settings (s16) is the only place, as it always was.
 */
export function PushReminder() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const reminder = usePushReminder();
  // On Chat home, inside the swipe to Messages: a slide that starts here is
  // the swipe, not a press (`lib/swipe-claim.ts`).
  const turnOn = useGuardedBySwipe(() => {
    void reminder.turnOn();
  });
  const dismiss = useGuardedBySwipe(reminder.dismiss);
  if (!reminder.show) return null;

  const label = reminder.action === "settings" ? "Open Settings" : "Turn on";
  return (
    <View style={styles.card}>
      <BellGlyph color={tokens.color.gold.askText} />
      <View style={styles.copy}>
        <Text style={styles.title}>Notifications are off</Text>
        <Text style={styles.body}>
          You won&apos;t hear about mentions or new events until you open the
          app.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          reminder.action === "settings"
            ? "Open Settings to turn on notifications"
            : "Turn on notifications"
        }
        disabled={reminder.isRequesting}
        onPress={turnOn}
        hitSlop={8}
        style={({ pressed }) => [
          styles.action,
          pressed ? styles.pressed : null,
        ]}
      >
        <Text style={styles.actionLabel}>{label}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={dismiss}
        hitSlop={10}
        style={({ pressed }) => [styles.close, pressed ? styles.pressed : null]}
      >
        <CloseGlyph color={tokens.color.text.muted} size={16} />
      </Pressable>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      paddingVertical: tokens.spacing.md,
      paddingLeft: tokens.spacing.md,
      paddingRight: tokens.spacing.sm,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    action: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.sm,
    },
    actionLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.askText,
    },
    close: {
      minHeight: tokens.touch.minimum,
      minWidth: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
