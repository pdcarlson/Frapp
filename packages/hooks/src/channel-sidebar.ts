import {
  categorySectionKey,
  isDirectChannel,
  type SidebarSectionKey,
} from "@repo/validation";
import type { ChannelSections, GroupableChannel } from "./channel-sections";

/**
 * How a member's chat sidebar is arranged (#2877): Pinned first, then the
 * sections the chapter's grouping produced, each sorted, filtered and folded
 * as the member chose. Web's rail and mobile's s04 both render this function's
 * output, so each rule below has one implementation. The rule is
 * `spec/behavior/chat/README.md` § Sidebar arrangement; the member's choices
 * come from `GET /v1/chat-sidebar`.
 *
 * Pure: every number it reads (unread, mentions, mute) is the server's, passed
 * in. Nothing here derives an unread count or a mute from anything else.
 */

/** The fields of a channel row the arrangement reads. */
export interface SidebarChannelLike {
  id: string;
  type: string;
}

/** A section as the grouping produced it, in render order. */
export interface SidebarSectionInput<C extends SidebarChannelLike> {
  key: SidebarSectionKey;
  label: string;
  channels: readonly C[];
}

/** Server counts for one channel, from `GET /v1/channels/unread`. */
export interface SidebarUnreadCounts {
  unreadCount: number;
  mentionCount: number;
}

export interface SidebarFilters {
  unreadOnly: boolean;
  hideMuted: boolean;
}

export interface ArrangeSidebarInput<C extends SidebarChannelLike> {
  /** Every section below Pinned, in render order, already grouped. */
  sections: readonly SidebarSectionInput<C>[];
  pinnedIds: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  filters: SidebarFilters;
  /** The channel open right now, which always shows. */
  activeChannelId: string | null;
  /** The title the row shows, which is also what it sorts by. */
  titleOf: (channel: C) => string;
  /**
   * Keyed by channel id; a channel with no entry counts as read. `undefined`
   * means the counts are not known (loading or failed), which is not the same
   * as "nothing unread": Unread only then filters nothing.
   */
  unreadByChannelId: ReadonlyMap<string, SidebarUnreadCounts> | undefined;
  /**
   * Channels whose effective notification level is `off`. `undefined` means
   * the levels are not known, and Hide muted then hides nothing.
   */
  mutedChannelIds: ReadonlySet<string> | undefined;
}

export interface ArrangedSidebarSection<C extends SidebarChannelLike> {
  key: SidebarSectionKey;
  label: string;
  /** The rows to draw: everything that passed the filters, or, while folded, only the open channel if it is here. */
  rows: C[];
  collapsed: boolean;
  /** Totals over every row that passed the filters, folded or not, for the header badge. */
  unreadCount: number;
  mentionCount: number;
  /** Some row here addresses the member: an @-mention, or an unread DM. */
  addressed: boolean;
}

export interface ArrangedSidebar<C extends SidebarChannelLike> {
  /** Sections with at least one row that passed the filters, in render order. */
  sections: ArrangedSidebarSection<C>[];
  /**
   * The filters removed every row. The list shows an empty state that offers
   * to clear them, rather than a blank sidebar.
   */
  emptiedByFilters: boolean;
}

export const PINNED_SECTION_LABEL = "Pinned";

/**
 * The sections below Pinned, from `groupChannelsByCategory`'s result, keyed the
 * way `@repo/validation` spells them: the default group, each category in the
 * chapter's order, the direct messages, then any group a client splits off
 * before grouping (web's System). Labels stay the client's, since each draws
 * its own (web's "Direct messages", s04's "DIRECT").
 */
export function sidebarSections<
  C extends SidebarChannelLike & GroupableChannel,
  K extends { id: string; name: string },
>(
  grouped: ChannelSections<C, K>,
  labels: { channels: string; direct: string },
  system?: { label: string; channels: readonly C[] },
): SidebarSectionInput<C>[] {
  return [
    { key: "channels", label: labels.channels, channels: grouped.uncategorized },
    ...grouped.categories.map(({ category, channels }) => ({
      key: categorySectionKey(category.id),
      label: category.name,
      channels,
    })),
    { key: "direct", label: labels.direct, channels: grouped.direct },
    ...(system ? [{ key: "system" as const, ...system }] : []),
  ];
}

const NO_UNREAD: SidebarUnreadCounts = { unreadCount: 0, mentionCount: 0 };

/**
 * Whether a row addresses the member, which is what the red badge means: an
 * @-mention, or anything unread in a direct message (foundations.md §5).
 */
export function isAddressed(
  channel: Pick<SidebarChannelLike, "type">,
  counts: SidebarUnreadCounts,
): boolean {
  return countsAddressMember(isDirectChannel(channel), counts);
}

/** `isAddressed` for a caller that knows only whether the row is a DM. */
export function countsAddressMember(
  isDirect: boolean,
  counts: SidebarUnreadCounts,
): boolean {
  return counts.mentionCount > 0 || (isDirect && counts.unreadCount > 0);
}

export function arrangeChannelSidebar<C extends SidebarChannelLike>(
  input: ArrangeSidebarInput<C>,
): ArrangedSidebar<C> {
  const {
    sections,
    pinnedIds,
    collapsed,
    filters,
    activeChannelId,
    titleOf,
    unreadByChannelId,
    mutedChannelIds,
  } = input;

  const countsOf = (channel: C) =>
    unreadByChannelId?.get(channel.id) ?? NO_UNREAD;

  // A filter applies only while its data is known. Hiding rows on missing
  // counts would tell the member "nothing unread" when the truth is "we don't
  // know", the failure the unread rule exists to prevent.
  const applyUnreadOnly = filters.unreadOnly && unreadByChannelId !== undefined;
  const applyHideMuted = filters.hideMuted && mutedChannelIds !== undefined;

  const passes = (channel: C, pinned: boolean) => {
    if (pinned || channel.id === activeChannelId) return true;
    const counts = countsOf(channel);
    const addressed = isAddressed(channel, counts);
    if (applyUnreadOnly && counts.unreadCount === 0 && !addressed) {
      return false;
    }
    // A mention gets past a mute, the same way it does for push.
    if (applyHideMuted && mutedChannelIds.has(channel.id) && !addressed) {
      return false;
    }
    return true;
  };

  const byTitle = (a: C, b: C) =>
    titleOf(a).localeCompare(titleOf(b)) ||
    // Deterministic between two rows that show the same title.
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const pinned: C[] = [];
  const rest = sections.map((section) => ({
    key: section.key,
    label: section.label,
    channels: [] as C[],
  }));
  let anyChannel = false;
  sections.forEach((section, index) => {
    for (const channel of section.channels) {
      anyChannel = true;
      if (pinnedIds.has(channel.id)) pinned.push(channel);
      else rest[index]!.channels.push(channel);
    }
  });

  const build = (
    key: SidebarSectionKey,
    label: string,
    channels: C[],
    isPinned: boolean,
  ): ArrangedSidebarSection<C> | null => {
    const kept = channels.filter((c) => passes(c, isPinned)).sort(byTitle);
    if (kept.length === 0) return null;
    let unreadCount = 0;
    let mentionCount = 0;
    let addressed = false;
    for (const channel of kept) {
      const counts = countsOf(channel);
      unreadCount += counts.unreadCount;
      mentionCount += counts.mentionCount;
      addressed ||= isAddressed(channel, counts);
    }
    const folded = collapsed.has(key);
    return {
      key,
      label,
      // The open channel stays in view under a folded header, so the list
      // always has a row marked current.
      rows: folded ? kept.filter((c) => c.id === activeChannelId) : kept,
      collapsed: folded,
      unreadCount,
      mentionCount,
      addressed,
    };
  };

  const arranged = [
    build("pinned", PINNED_SECTION_LABEL, pinned, true),
    ...rest.map((section) =>
      build(section.key, section.label, section.channels, false),
    ),
  ].filter((section): section is ArrangedSidebarSection<C> => section !== null);

  return {
    sections: arranged,
    emptiedByFilters: anyChannel && arranged.length === 0,
  };
}

// ── Copy ─────────────────────────────────────────────────────────────────────
//
// One wording for both clients, rostered in `spec/ui/design-system/writing.md`
// § Arrange the channel list. "Pin to top" rather than a bare "Pin": the
// channel menu already has a "Pinned" panel for pinned *messages*, which are
// chapter-wide, and this pin is the member's own.

export const PIN_TO_TOP_LABEL = "Pin to top";
export const UNPIN_FROM_TOP_LABEL = "Unpin from top";

export const UNREAD_ONLY_LABEL = "Unread only";
export const HIDE_MUTED_LABEL = "Hide muted";

export const NO_MATCHING_CHANNELS = "No channels match your filters.";
export const SHOW_ALL_CHANNELS_LABEL = "Show all channels";

export const SIDEBAR_SAVE_FAILED_TITLE = "Couldn't save your channel list";
export const SIDEBAR_SAVE_FAILED_BODY =
  "Nothing changed. Check your connection and try again.";

