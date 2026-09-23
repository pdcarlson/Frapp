import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import type { MaskedRefreshState } from "@/lib/chat/masked-refresh";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * What the thread draws in place of a message from a member the viewer blocked
 * (`spec/behavior/chat/README.md` § What a block does and does not hide).
 *
 * **Takes no message.** Only the fact of a hidden message reaches this
 * component — never its body, attachments, reactions or card payload — so no
 * later edit here can start rendering what the block is meant to hide. A masked
 * row carries no `attachment_count` anyway; an unmasked Realtime row still
 * does, and this is what keeps its files from mounting. (The server refuses the
 * attachments route for a blocked sender's message too, #2324.)
 *
 * **Unblock is the only action — no "tap to expand".** The owner's decision
 * (2026-09-22): a server-masked row arrives with its content already withheld,
 * so expand could only ever work for the rows that happened to arrive over the
 * live echo — an affordance that works on some rows and not others. The
 * durable way back is Unblock, here and in Settings.
 *
 * **Reload, only when a re-read failed.** Once this client unblocked the
 * sender, a leftover masked copy has nothing to unblock, and only the
 * post-unblock re-read can bring its words back. If that re-read gave up
 * (`lib/chat/masked-refresh.ts`), the copy offers Reload, which runs it again —
 * otherwise it would sit here with no control and nothing saying why. Reload is
 * not offered on a copy whose re-read landed: that copy is older than the page
 * the re-read covers, and tapping Reload would visibly do nothing.
 *
 * These strings are the tombstone's, and a reply quoting a hidden message uses
 * the same words (`thread-message-row.tsx`), so the two cannot disagree.
 */
export interface BlockedMessageTombstoneProps {
  /** Shown only in the accessibility label and the confirm prompt. */
  senderName: string | null;
  /**
   * `false` only when this client confirmed unblocking the sender and this row
   * is still the server's masked copy (older than the page the unblock
   * re-read). There is nothing to unblock, so the control is withheld rather
   * than left dead. See `tombstoneCanUnblock` in `lib/chat/blocks.ts`.
   */
  canUnblock: boolean;
  onUnblock: () => void;
  /**
   * The sender's post-unblock re-read, when `canUnblock` is `false`: `failed`
   * offers Reload, `refreshing` shows it busy, and `null` offers nothing.
   * Ignored while `canUnblock` is `true`.
   */
  reload?: MaskedRefreshState | null;
  onReload?: () => void;
}

export const TOMBSTONE_TEXT = "Message from a member you blocked";
export const TOMBSTONE_STALE_TEXT = "Hidden while you had this member blocked";

export function BlockedMessageTombstone({
  senderName,
  canUnblock,
  onUnblock,
  reload = null,
  onReload,
}: BlockedMessageTombstoneProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const text = canUnblock ? TOMBSTONE_TEXT : TOMBSTONE_STALE_TEXT;
  const hiddenFrom = senderName
    ? `hidden messages from ${senderName}`
    : "hidden messages";

  return (
    <View style={styles.row}>
      <Text style={styles.text}>{text}</Text>
      {canUnblock ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            senderName ? `Unblock ${senderName}` : "Unblock this member"
          }
          hitSlop={12}
          onPress={onUnblock}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <Text style={styles.action}>Unblock</Text>
        </Pressable>
      ) : reload === "refreshing" ? (
        <ActivityIndicator
          accessibilityLabel={`Reloading ${hiddenFrom}`}
          accessibilityState={{ busy: true }}
          color={tokens.color.text.muted}
        />
      ) : reload === "failed" && onReload ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Reload ${hiddenFrom}`}
          hitSlop={12}
          onPress={onReload}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <Text style={styles.action}>Reload</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      maxWidth: "86%",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.md + 2,
      // An outline with no fill: the same hairline an incoming bubble draws,
      // without the card surface, so it reads as the absence of a message
      // rather than as one.
      borderRadius: tokens.radius.bubble,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    text: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      fontStyle: "italic",
      flexShrink: 1,
    },
    action: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.gold.askText,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
