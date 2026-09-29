import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { initialsFor } from "@/lib/chat/display-name";
import {
  HIDE_CONVERSATION_LABEL,
  countsAddressMember,
  PIN_TO_TOP_LABEL,
  UNPIN_FROM_TOP_LABEL,
} from "@repo/hooks";

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
  /**
   * The member pinned this row (#2877). Renders the sigil in gold, per the
   * drawn pinned `announcements` row, and names the pin action "Unpin from top".
   */
  isPinned?: boolean;
  preview?: string | null;
  timestamp?: string | null;
  unreadCount: number;
  mentionCount: number;
  onPress: () => void;
  /**
   * Offer "Hide conversation" (#2303): a long press, and the same thing as a
   * named accessibility action, since a long press is not discoverable by a
   * screen reader. Pass it only for a row that can be hidden
   * (`canHideConversation`); the row itself does not decide.
   */
  onHide?: () => void;
  /**
   * Pin or unpin the row (#2877), as a named accessibility action. The long
   * press reaches it through `onLongPress`'s chooser.
   */
  onTogglePin?: () => void;
  /**
   * What a long press does. The screen passes the row-actions chooser here;
   * without it a long press falls back to `onHide`, as before #2877.
   */
  onLongPress?: () => void;
}

/** The accessibility action's `name`; its spoken label is `HIDE_CONVERSATION_LABEL`. */
export const HIDE_ACTION = "hide";

/** The pin action's `name`; its spoken label says pin or unpin. */
export const PIN_ACTION = "pin";

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
  onHide,
  onTogglePin,
  onLongPress,
}: ChannelRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  // Red means "you were addressed": an @-mention, or anything unread in a
  // direct message (foundations.md §5). The DM half was missing here until
  // #2877, so an unread DM drew the neutral badge while web drew it red; the
  // rule is now `countsAddressMember` in `@repo/hooks`, which the shared
  // sidebar arrangement uses too.
  const hasMention = countsAddressMember(isDirect, {
    unreadCount,
    mentionCount,
  });
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
      onLongPress={onLongPress ?? onHide}
      accessibilityActions={
        onTogglePin || onHide
          ? [
              ...(onTogglePin
                ? [
                    {
                      name: PIN_ACTION,
                      label: isPinned ? UNPIN_FROM_TOP_LABEL : PIN_TO_TOP_LABEL,
                    },
                  ]
                : []),
              ...(onHide
                ? [{ name: HIDE_ACTION, label: HIDE_CONVERSATION_LABEL }]
                : []),
            ]
          : undefined
      }
      onAccessibilityAction={
        onTogglePin || onHide
          ? (event) => {
              const action = event.nativeEvent.actionName;
              if (action === PIN_ACTION) onTogglePin?.();
              if (action === HIDE_ACTION) onHide?.();
            }
          : undefined
      }
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
          <UnreadBadge
            unreadCount={unreadCount}
            mentionCount={mentionCount}
            addressed={hasMention}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The count badge: neutral for plain unread, the fixed mention red when the
 * member was addressed. Exported for the folded section headers on s04
 * (#2877), so a header's total draws with the row's recipe.
 */
export function UnreadBadge({
  unreadCount,
  mentionCount,
  addressed,
}: {
  unreadCount: number;
  mentionCount: number;
  addressed: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View
      style={[
        styles.badge,
        addressed ? styles.badgeMention : styles.badgeNeutral,
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          addressed ? styles.badgeTextMention : styles.badgeTextNeutral,
        ]}
      >
        {badgeLabel(unreadCount, mentionCount)}
      </Text>
    </View>
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
