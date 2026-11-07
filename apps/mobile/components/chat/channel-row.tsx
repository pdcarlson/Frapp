import {
  type GestureResponderEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { SignetTokens } from "@repo/theme/signet";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { MemberAvatar } from "@/components/member-avatar";
import { initialsFor } from "@/lib/chat/display-name";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { SkeletonBlock, SkeletonRegion } from "@/components/state-block";
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
 *   channel takes the `border.input` fill with `text.foreground` text, plus a
 *   bold title. A read row keeps a bright regular-weight title and no badge.
 *
 * **A read name stays bright** (owner, 2026-11-07). The emphasis is weight,
 * the sigil and the badge: a 700 title against a read row's 400, both in
 * `text.foreground`, as Slack, iMessage and Telegram draw it. Read titles used
 * to drop to `text.mutedForeground`, so a chapter with nothing unread was a
 * screen of grey with nothing white on it. Only a muted row dims its title.
 * Chat home's rows are one line (no preview, no time, owner 2026-11-07); the
 * preview line is for the Messages list, where a DM's last line is the point.
 *
 * The row itself never takes a fill at rest. It used to lift every unread row onto
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

/** A DM row's avatar diameter. */
const DIRECT_AVATAR_SIZE = 34;

export interface ChannelRowProps {
  name: string;
  /** DM/group rows draw an avatar; channel rows draw a `#` sigil. */
  isDirect?: boolean;
  /**
   * A one-to-one DM's other member's photo, drawn over the initials. `null`
   * (a group DM, or no photo) keeps the initials.
   */
  avatarUrl?: string | null;
  /**
   * The member pinned this row (#2877). Names the pin action "Unpin from top".
   * The sigil stays muted like every row's: a row icon is neutral, never the
   * chapter accent (foundations.md §6, "Where the accent goes", 2026-11-05).
   */
  isPinned?: boolean;
  /**
   * The latest message's one-line preview, from `GET /v1/channels/latest`
   * through `channelPreviewLine`: the Messages list's rows carry one
   * (2026-11-07). It passes `""` while the previews load, which holds the
   * line blank, so the rows don't grow when they arrive (pending states never
   * shift layout). Leave it out for a one-line row: Chat home's channels and a
   * hidden DM.
   */
  preview?: string | null;
  /**
   * The member muted this channel. The row stays where it is, drawn quiet: a
   * read row's title whatever its count, and a crossed-out bell after the
   * name, so a busy muted channel doesn't shout from the top of the list.
   */
  isMuted?: boolean;
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
   * press reaches it through `onLongPress`'s menu.
   */
  onTogglePin?: () => void;
  /**
   * What a long press does: the screen opens the row's actions menu
   * (`ChannelActionsMenu`) beside the press. Without it a long press falls
   * back to `onHide`, as before #2877. Also a named accessibility action,
   * "Channel actions", since a long press is not discoverable by a screen
   * reader; that one has no press point, so its event is `undefined`.
   */
  onLongPress?: (event: GestureResponderEvent | undefined) => void;
}

/** The menu action's `name`; its spoken label is "Channel actions". */
export const ACTIONS_ACTION = "actions";

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
  avatarUrl = null,
  isPinned = false,
  preview,
  isMuted = false,
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
  // Muted rows read as read unless they address the member: a mention gets
  // past a mute, as it does for push.
  const looksUnread = isUnread && (!isMuted || hasMention);

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelFor({
        name,
        isDirect,
        unreadCount,
        mentionCount,
        isMuted,
        preview,
      })}
      onPress={onPress}
      onLongPress={onLongPress ?? onHide}
      accessibilityActions={
        onLongPress || onTogglePin || onHide
          ? [
              ...(onLongPress
                ? [{ name: ACTIONS_ACTION, label: "Channel actions" }]
                : []),
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
        onLongPress || onTogglePin || onHide
          ? (event) => {
              const action = event.nativeEvent.actionName;
              if (action === ACTIONS_ACTION) onLongPress?.(undefined);
              if (action === PIN_ACTION) onTogglePin?.();
              if (action === HIDE_ACTION) onHide?.();
            }
          : undefined
      }
      style={[styles.row, preview == null ? styles.rowOneLine : null]}
    >
      {isDirect ? (
        <MemberAvatar
          uri={avatarUrl}
          initials={initialsFor(name)}
          size={DIRECT_AVATAR_SIZE}
          style={styles.avatar}
          textStyle={styles.avatarText}
        />
      ) : (
        <Text
          style={[
            styles.sigil,
            looksUnread
              ? styles.sigilUnread
              : isMuted
                ? styles.sigilMuted
                : null,
          ]}
        >
          #
        </Text>
      )}

      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text
            numberOfLines={1}
            style={[
              looksUnread
                ? styles.titleUnread
                : isMuted
                  ? styles.titleMuted
                  : styles.titleRead,
              styles.titleText,
            ]}
          >
            {name}
          </Text>
          {isMuted ? <MutedGlyph color={tokens.color.text.muted} /> : null}
        </View>
        {preview != null ? (
          <Text
            numberOfLines={1}
            style={looksUnread ? styles.previewUnread : styles.previewRead}
          >
            {/* A space, not "", so a pending line keeps its height. */}
            {preview || " "}
          </Text>
        ) : null}
      </View>

      <View style={styles.trailing}>
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
 * A bell with a slash, after a muted row's name. Decorative: the row's label
 * says "muted".
 */
function MutedGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M6 10a6 6 0 0 1 10.4-4.1M18 10c0 4 1.6 5.6 2.2 6.4.2.3 0 .6-.3.6H8M9.5 20a2.6 2.6 0 0 0 5 0M4 4l16 16"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
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
  const styles = createStyles(tokens);
  return (
    <SkeletonRegion label="Loading channels" style={styles.skeletonList}>
      <View style={styles.skeletonCaption}>
        <SkeletonBlock
          width={tokens.spacing["3xl"]}
          height={tokens.spacing.sm}
        />
      </View>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={[styles.row, styles.rowOneLine]}>
          <SkeletonBlock width={tokens.spacing.md} height={tokens.spacing.lg} />
          <View style={styles.skeletonBody}>
            <View style={styles.skeletonTitle}>
              <SkeletonBlock
                width={
                  SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length]
                }
                height={tokens.spacing.md}
              />
            </View>
          </View>
        </View>
      ))}
    </SkeletonRegion>
  );
}

/** Exported so the spec asserts the spoken form, not just the drawn one. */
export function accessibilityLabelFor({
  name,
  isDirect,
  unreadCount,
  mentionCount,
  isMuted = false,
  preview,
}: {
  name: string;
  isDirect: boolean;
  unreadCount: number;
  mentionCount: number;
  isMuted?: boolean;
  preview?: string | null;
}): string {
  const subject = isDirect ? name : `#${name}`;
  const parts: string[] = [subject];
  if (isMuted) parts.push("muted");
  if (mentionCount > 0) {
    parts.push(
      `${mentionCount} ${mentionCount === 1 ? "mention" : "mentions"}`,
    );
  }
  if (unreadCount > 0) {
    parts.push(`${unreadCount} unread`);
  }
  // The preview last, after the counts a member listens for first.
  if (preview) parts.push(preview);
  return parts.join(", ");
}

function createStyles(tokens: SignetTokens) {
  const AVATAR_SIZE = DIRECT_AVATAR_SIZE;

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
    // A row without a preview (Chat home's channels): the touch minimum and
    // no more, so a 38-channel chapter fits twice as many on a screen.
    rowOneLine: {
      paddingVertical: 0,
    },
    skeletonList: {
      gap: tokens.spacing.xs,
    },
    skeletonCaption: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    // The row body's two lines at their own heights and gap, so a skeleton
    // row stands as tall as a real one.
    skeletonBody: {
      flex: 1,
      gap: 2,
    },
    skeletonTitle: {
      height: tokens.typography.role.body.lineHeight,
      justifyContent: "center",
    },
    sigil: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.mutedForeground,
    },
    sigilUnread: {
      color: tokens.color.text.foreground,
    },
    sigilMuted: {
      color: tokens.color.text.muted,
    },
    titleLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    titleText: {
      flexShrink: 1,
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
    // Weight carries unread: 700 over a read row's 400, both bright
    // (2026-11-07). A muted row is the one that dims.
    titleUnread: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.foreground,
    },
    titleRead: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    titleMuted: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.muted,
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
