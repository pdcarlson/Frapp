import { StyleSheet, View } from "react-native";
import type { PresenceStatus } from "@repo/hooks/presence-status";
import { SignetTokens } from "@repo/theme/signet";
import { useFrappTheme } from "@/lib/theme";

/**
 * A status dot (#3845, #3917), drawn the way web draws it so a member reads
 * the same mark on both apps: a member's picked status, or what chapter
 * presence says about them. Every status differs by shape as well as color:
 *
 * - Online: a green fill.
 * - Idle: an amber ring.
 * - Do Not Disturb: a red fill with a dark bar across it.
 * - Invisible: a grey ring, which only the member themselves ever sees.
 * - Offline: a faint grey fill (web's `bg-muted-foreground/40`).
 *
 * Decorative: whatever renders it names the status (the You tab's label,
 * the sheet row's label). `ring` paints a border in the surface behind the
 * dot, for a dot sitting on an avatar's edge.
 */
export function StatusDot({
  status,
  size = 10,
  ring,
  testID,
}: {
  status: PresenceStatus;
  size?: number;
  ring?: string;
  testID?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens, size);
  const ringed = status === "idle" || status === "invisible";
  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        ring ? { padding: 2, borderRadius: size, backgroundColor: ring } : null,
      ]}
    >
      <View
        style={[
          styles.dot,
          status === "online" ? styles.online : null,
          status === "dnd" ? styles.dnd : null,
          ringed ? styles.ring : null,
          status === "idle" ? styles.idle : null,
          status === "invisible" ? styles.invisible : null,
          status === "offline" ? styles.offline : null,
        ]}
      >
        {status === "dnd" ? <View style={styles.bar} /> : null}
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens, size: number) {
  // A ring's width scales with the dot: 2 on the 10pt dot, as web draws it.
  const ringWidth = Math.max(2, Math.round(size / 5));
  return StyleSheet.create({
    dot: {
      width: size,
      height: size,
      borderRadius: size / 2,
      alignItems: "center",
      justifyContent: "center",
    },
    online: { backgroundColor: tokens.color.semantic.success },
    dnd: { backgroundColor: tokens.color.semantic.destructive },
    // The interior is filled, not clear, so a photo behind the ring can't
    // make it read as a solid dot.
    ring: {
      borderWidth: ringWidth,
      backgroundColor: tokens.color.surface.card,
    },
    idle: { borderColor: tokens.color.semantic.warning },
    invisible: { borderColor: tokens.color.text.mutedForeground },
    offline: {
      backgroundColor: tokens.color.text.mutedForeground,
      opacity: 0.4,
    },
    // 6 by 2 on the 10pt dot, the proportion web, Discord and Slack draw.
    bar: {
      width: Math.round(size * 0.6),
      height: Math.max(2, Math.round(size / 5)),
      borderRadius: 1,
      backgroundColor: tokens.color.surface.background,
    },
  });
}
