import { useEffect } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { MemberNudge } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { isMemberNudgePraise } from "@repo/validation";
import { eyebrowStyle } from "@/components/eyebrow";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The nudge card on the phone's Activity (#4781, `spec/behavior/ai.md`
 * § Nudges): one card, under the week card, that Frapp's AI wrote about one
 * of the member's own tasks. Bevel's daily insight card and Duolingo's
 * streak line are the comparables: a short, specific word at the top of the
 * page the member already opens, with one way in and one way to wave it off.
 *
 * - **One at a time, and never a list.** The server sends one or none.
 * - **Frapp's voice is gold.** The eyebrow and the starting point's rule take
 *   the fixed house gold, as Ask does; the member's own things on this page
 *   keep the chapter accent (`components.md` §11).
 * - **No filled button.** The week card's Next row holds the one filled
 *   action on the screen, so both of this card's buttons are outlined.
 * - **A word of thanks asks for nothing:** no starting point, and one button
 *   that closes it.
 *
 * It says nothing about how it was made. "More" holds the two quieter ways
 * out: fewer of these for a while, or none at all.
 */
export function NudgeCard({
  nudge,
  canAsk,
  onOpenTask,
  onAsk,
  onDismiss,
  onTurnOff,
  onSeen,
}: {
  nudge: MemberNudge;
  /** Ask Frapp is on for this member. Off: no "Ask about this". */
  canAsk: boolean;
  onOpenTask: () => void;
  onAsk: () => void;
  onDismiss: (reason: "not_now" | "fewer" | "thanks") => void;
  onTurnOff: () => void;
  onSeen: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const praise = isMemberNudgePraise(nudge.kind);

  // On screen is seen: the card sits at the top of the page.
  const { id, seen } = nudge;
  useEffect(() => {
    if (!seen) onSeen();
    // Once per card; `onSeen` is read when the card arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, seen]);

  const more = () =>
    Alert.alert("Nudges from Frapp", undefined, [
      { text: "Not now", onPress: () => onDismiss("not_now") },
      { text: "Show fewer of these", onPress: () => onDismiss("fewer") },
      { text: "Turn these off", style: "destructive", onPress: onTurnOff },
      { text: "Cancel", style: "cancel" },
    ]);

  return (
    <View style={styles.card} testID="activity-nudge-card">
      <View style={styles.head}>
        <Text style={styles.eyebrow}>From Frapp</Text>
        {praise ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More"
            accessibilityHint="Hide this, see fewer, or turn nudges off."
            hitSlop={12}
            onPress={more}
            testID="activity-nudge-more"
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <Text style={styles.more}>More</Text>
          </Pressable>
        )}
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {nudge.title}
      </Text>
      <Text style={styles.body}>{nudge.body}</Text>
      {nudge.start_here ? (
        <View style={styles.start}>
          <Text style={styles.startLabel}>A place to start</Text>
          <Text style={styles.startText}>{nudge.start_here}</Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        {praise ? (
          <CardButton
            label="Thanks"
            onPress={() => onDismiss("thanks")}
            testID="activity-nudge-thanks"
          />
        ) : (
          <>
            <CardButton
              label="See the task"
              onPress={onOpenTask}
              testID="activity-nudge-open"
            />
            {canAsk ? (
              <CardButton
                label="Ask about this"
                onPress={onAsk}
                testID="activity-nudge-ask"
              />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function CardButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      <Text numberOfLines={1} style={styles.buttonLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    eyebrow: {
      ...eyebrowStyle(tokens),
      // House gold, fixed. Never the chapter accent on Frapp's own voice.
      color: tokens.color.gold.askText,
    },
    more: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    start: {
      borderLeftWidth: 2,
      borderLeftColor: tokens.color.gold.askText,
      paddingLeft: tokens.spacing.md,
      gap: 2,
    },
    startLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    startText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    actions: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.xs,
    },
    button: {
      flex: 1,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      // The edge that says "this is a control" (`foundations.md` §3).
      borderColor: tokens.color.border.control,
      paddingHorizontal: tokens.spacing.md,
    },
    buttonLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    pressed: { opacity: 0.7 },
  });
}
