import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { initialsFor } from "@/lib/chat/display-name";

/**
 * One row of the s04 channel list.
 *
 * The whole point of this component is the unread/mention distinction, which
 * `spec/ui/design-system/foundations.md:67-68` states as two binding rules:
 *
 * - **Mention/DM red is fixed and semantic.** `semantic.mention` "states exactly
 *   one fact — *you were addressed*: an @-mention or a direct message. It MUST
 *   NOT be replaced by the chapter accent under any seed", so "you were
 *   addressed" reads identically in every chapter.
 * - **Channel unread is neutral — never red, never accent.** A plain unread
 *   channel takes the `border.input` fill with `text.foreground` text, plus an
 *   emphasized row: bold title over a muted preview. A read row drops to a
 *   lighter title, a dimmer preview, and no badge at all.
 *
 * "fill and text are the only difference, so badge geometry stays one recipe" —
 * hence a single `styles.badge` with two colour overlays rather than two badges.
 *
 * **Neither count is computed here.** `spec/behavior/chat/README.md`
 * § Read Receipts requires both to come from `GET /v1/channels/unread`, because
 * the server excludes the viewer's own and deleted messages and treats a channel
 * never opened as entirely unread — a local re-derivation would disagree on
 * exactly those cases. This component only renders what it is handed.
 */

export interface ChannelRowProps {
  name: string;
  /** DM/group rows draw initials; channel rows draw a `#` sigil. */
  isDirect?: boolean;
  /** Renders the sigil in gold, per the drawn pinned `announcements` row. */
  isPinned?: boolean;
  preview?: string | null;
  timestamp?: string | null;
  unreadCount: number;
  mentionCount: number;
  onPress: () => void;
}

/**
 * Badge text. A mention badge leads with `@` and shows the mention count, not
 * the total — the drawn `@ 2` on a row whose unread total is higher.
 */
export function badgeLabel(unreadCount: number, mentionCount: number): string {
  const count = mentionCount > 0 ? mentionCount : unreadCount;
  const capped = count > 99 ? "99+" : String(count);
  return mentionCount > 0 ? `@ ${capped}` : capped;
}

export function ChannelRow({
  name,
  isDirect = false,
  isPinned = false,
  preview,
  timestamp,
  unreadCount,
  mentionCount,
  onPress,
}: ChannelRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const hasMention = mentionCount > 0;
  // A mention always implies an unread row even if the counts ever disagree —
  // a red badge over a read-styled row would be a contradiction on screen.
  const isUnread = unreadCount > 0 || hasMention;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelFor({
        name,
        isDirect,
        unreadCount,
        mentionCount,
      })}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        isUnread ? styles.rowUnread : null,
        pressed ? styles.pressed : null,
      ]}
    >
      {isDirect ? (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsFor(name)}</Text>
        </View>
      ) : (
        <Text style={isPinned ? styles.sigilPinned : styles.sigil}>#</Text>
      )}

      <View style={styles.body}>
        <Text
          numberOfLines={1}
          style={isUnread ? styles.titleUnread : styles.titleRead}
        >
          {name}
        </Text>
        {preview ? (
          <Text
            numberOfLines={1}
            style={isUnread ? styles.previewUnread : styles.previewRead}
          >
            {preview}
          </Text>
        ) : null}
      </View>

      <View style={styles.trailing}>
        {timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
        {isUnread ? (
          <View
            style={[
              styles.badge,
              hasMention ? styles.badgeMention : styles.badgeNeutral,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                hasMention ? styles.badgeTextMention : styles.badgeTextNeutral,
              ]}
            >
              {badgeLabel(unreadCount, mentionCount)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Exported so the spec asserts the spoken form, not just the drawn one. */
export function accessibilityLabelFor({
  name,
  isDirect,
  unreadCount,
  mentionCount,
}: {
  name: string;
  isDirect: boolean;
  unreadCount: number;
  mentionCount: number;
}): string {
  const subject = isDirect ? name : `#${name}`;
  const parts: string[] = [subject];
  if (mentionCount > 0) {
    parts.push(
      `${mentionCount} ${mentionCount === 1 ? "mention" : "mentions"}`,
    );
  }
  if (unreadCount > 0) {
    parts.push(`${unreadCount} unread`);
  }
  return parts.join(", ");
}

function createStyles(tokens: SignetTokens) {
  const AVATAR_SIZE = 34;

  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
    },
    // Elevation is a lighter surface step, never a shadow
    // (foundations.md:132) — an unread row lifts off the background.
    rowUnread: {
      backgroundColor: tokens.color.surface.surface1,
    },
    pressed: {
      opacity: 0.7,
    },
    sigil: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.muted,
    },
    sigilPinned: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.gold.askText,
    },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: avatarRadius(AVATAR_SIZE),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    body: {
      flex: 1,
      gap: 2,
    },
    titleUnread: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    titleRead: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    previewUnread: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    previewRead: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    trailing: {
      alignItems: "flex-end",
      gap: tokens.spacing.xs + 1,
    },
    timestamp: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    // One geometry recipe; only fill and text colour differ between the two
    // states (foundations.md:68).
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: tokens.radius.chip,
      paddingHorizontal: tokens.spacing.sm - 2,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeNeutral: {
      backgroundColor: tokens.color.border.input,
    },
    badgeMention: {
      backgroundColor: tokens.color.semantic.mention,
    },
    badgeText: {
      ...typeRole(tokens.typography.role.caption),
    },
    badgeTextNeutral: {
      color: tokens.color.text.foreground,
    },
    badgeTextMention: {
      color: tokens.color.semantic.mentionForeground,
    },
  });
}
