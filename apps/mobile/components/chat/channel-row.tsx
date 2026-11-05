import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import {
  type ChapterBranding,
  useChapterBranding,
} from "@/lib/chapter-branding";
import { initialsFor } from "@/lib/chat/display-name";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { SkeletonBlock, SkeletonPulse } from "@/components/state-block";
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
 * The emphasis is type alone, as the board draws it: a 700 title in
 * `text.foreground` against a read row's 600 in `text.mutedForeground`. The row
 * itself never takes a fill at rest. It used to lift every unread row onto
 * `surface1`, which on a busy chapter striped the list in card-coloured bars
 * that said nothing the badge didn't; the lift is now only the iOS press
 * state (`usePressFeedback`, through `PressableRow`).
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
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
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
    <PressableRow
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
      style={styles.row}
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
    </PressableRow>
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
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
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

/** Title-bar widths, cycled, so the placeholder list doesn't read as a grid. */
const SKELETON_TITLE_WIDTHS = ["42%", "28%", "55%", "36%", "48%"] as const;

/**
 * Chat home's loading state: a section caption and channel-shaped rows on the
 * row's own geometry, so the real list replaces it in place rather than
 * pushing in under a spinner (components.md §10: content-shaped, no
 * spinner-in-a-box). Its blocks pulse together, as every skeleton's do
 * until the shimmer lands: one `SkeletonPulse` drives them all, still under
 * reduced motion and while Chat is out of view (`components/state-block.tsx`).
 */
export function ChannelListSkeleton({ rows = 5 }: { rows?: number }) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  return (
    // `accessible` makes the list one node, so VoiceOver reads the role and
    // label; without it iOS skips a View that has no text in it.
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading channels"
      style={styles.skeletonList}
    >
      <SkeletonPulse>
        <View style={styles.skeletonCaption}>
          <SkeletonBlock
            width={tokens.spacing["3xl"]}
            height={tokens.spacing.sm}
          />
        </View>
        {Array.from({ length: rows }, (_, index) => (
          <View key={index} style={styles.row}>
            <SkeletonBlock
              width={tokens.spacing.md}
              height={tokens.spacing.lg}
            />
            <View style={styles.skeletonTitle}>
              <SkeletonBlock
                width={
                  SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length]
                }
                height={tokens.spacing.md}
              />
            </View>
          </View>
        ))}
      </SkeletonPulse>
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

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  const AVATAR_SIZE = 34;

  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.md,
      // As the board draws it: the sigil sits on the gutter line.
      ...gutterBleed(tokens),
    },
    skeletonList: {
      gap: tokens.spacing.xs,
    },
    skeletonCaption: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    // A body line's height, so a skeleton row stands as tall as a real one.
    skeletonTitle: {
      flex: 1,
      height: tokens.typography.role.body.lineHeight,
      justifyContent: "center",
    },
    sigil: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.muted,
    },
    sigilPinned: {
      ...typeRole(tokens.typography.role.title),
      color: brand.accent,
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
    // Weight and brightness together carry unread: 700 over a read row's 600
    // (the board's two title weights), foreground over muted-foreground.
    titleUnread: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.foreground,
    },
    titleRead: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.semibold,
      }),
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
