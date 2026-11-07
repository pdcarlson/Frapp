import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { SignetTokens } from "@repo/theme/signet";
import { ChatGlyph, EventsGlyph, TasksGlyph } from "@/components/tab-glyphs";
import { OnboardingPrimaryButton } from "@/components/onboarding/onboarding-primary-button";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import type { PushAskAction } from "@/lib/notifications/use-push-primer";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Onboarding's notifications step, and the chat home's one reminder: the
 * screen-level ask `spec/ui/mobile/patterns.md` § Push notifications puts in
 * front of the OS dialog. Two hosts draw the step (s03's second beat for a
 * member who joined, chapter setup's for the officer who created it), so the
 * copy and the three rows live here once.
 *
 * The step says what a push is *for* in this app, in the app's own nouns,
 * before the OS asks in its generic words. Three rows, each a tab's glyph so a
 * new member meets the shapes they will tap next: chat, events and tasks.
 * The chat row names what pushes by default: every message in a DM,
 * #announcements and #general (`builtInChannelDefault` in
 * `@repo/validation`), and a mention anywhere (`chat-push-worker`). Events and
 * tasks are `NOTIFICATION_CATEGORIES`. The footnote names where each is
 * changed: chat per conversation from its menu (there is no chat switch in
 * Settings since 2026-11-06), the rest in Settings.
 *
 * Signet gold, not the chapter accent: this is Frapp asking for a device
 * permission on its own behalf, not chapter chrome.
 */

export const PUSH_ASK_TITLE = "Turn on notifications";

const ROWS: {
  key: string;
  label: string;
  glyph: (color: string) => ReactNode;
}[] = [
  {
    key: "chat",
    label: "DMs, mentions, #general, and #announcements",
    glyph: (color) => <ChatGlyph focused accent={color} muted={color} />,
  },
  {
    key: "events",
    label: "New events, reminders, and changes",
    glyph: (color) => <EventsGlyph focused accent={color} muted={color} />,
  },
  {
    key: "tasks",
    label: "Tasks assigned to you or coming due",
    glyph: (color) => <TasksGlyph focused accent={color} muted={color} />,
  },
];

/** The step's body: one line, the three rows, and where to change it later. */
export function PushAskBody() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const gold = tokens.color.gold.askText;
  return (
    <View style={styles.body}>
      <Text style={styles.lead}>
        Chapter plans move fast. Get a ping when something is for you.
      </Text>
      <View style={styles.card}>
        {ROWS.map((row, index) => (
          <View key={row.key}>
            {index > 0 ? <View style={styles.rule} /> : null}
            <View style={styles.row}>
              {row.glyph(gold)}
              <Text style={styles.rowLabel}>{row.label}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.footnote}>
        Mute any chat from its menu. Event and task alerts, and quiet hours, are
        in Settings.
      </Text>
    </View>
  );
}

/**
 * The step's two answers, for the host's pinned footer. The gold button asks
 * the OS, or, when no prompt can appear any more, says it opens the phone's
 * settings, so the member isn't surprised to land there.
 */
export function PushAskActions({
  action,
  busy,
  onTurnOn,
  onNotNow,
}: {
  action: PushAskAction;
  busy: boolean;
  onTurnOn: () => void;
  onNotNow: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <>
      <OnboardingPrimaryButton
        label={action === "settings" ? "Open Settings" : PUSH_ASK_TITLE}
        onPress={onTurnOn}
        disabled={busy}
        busy={busy}
      />
      <OnboardingPressable
        accessibilityRole="button"
        onPress={onNotNow}
        disabled={busy}
        quiet
        style={styles.quietButton}
      >
        <Text style={styles.quietButtonText}>Not now</Text>
      </OnboardingPressable>
    </>
  );
}

/**
 * The drawn bell: a 1.6px stroke on a 24px grid with a low-opacity fill of
 * its own hue (`spec/ui/design-system/iconography.md` §1).
 */
export function BellGlyph({
  color,
  size = 22,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
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

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      gap: tokens.spacing.lg,
    },
    lead: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    // The joined-channels card's shape, so the two beats of s03 match.
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: tokens.spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tint(tokens.color.text.foreground, 0.08),
      marginHorizontal: tokens.spacing.md,
    },
    rowLabel: {
      flex: 1,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    footnote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    quietButton: {
      alignSelf: "center",
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.lg,
      justifyContent: "center",
      marginTop: tokens.spacing.xs,
    },
    quietButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}
