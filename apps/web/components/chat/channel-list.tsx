"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, ListFilter, Plus } from "lucide-react";
import {
  arrangeChannelSidebar,
  canHideConversation,
  compareChannelOrder,
  compareLatestFirst,
  directChannelDisplayName,
  groupChannelsByCategory,
  HIDDEN_CONVERSATIONS_LABEL,
  FILTER_CHANNELS_LABEL,
  FILTER_CHANNELS_ON_LABEL,
  foldedSectionAnnouncement,
  HIDE_MUTED_LABEL,
  isAddressed,
  countsLookUnread,
  NO_MATCHING_CHANNELS,
  otherMemberId,
  SHOW_ALL_CHANNELS_LABEL,
  sidebarSections,
  UNREAD_ONLY_LABEL,
  type DisplayNameMap,
  type MemberAvatarTint,
  type SidebarFilterChange,
  type SidebarPreferences,
  type SidebarUnreadCounts,
} from "@repo/hooks";
import type { SidebarSectionKey } from "@repo/validation";
import { isDirectChannel } from "@repo/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { compactControlClassName } from "@/components/shared/table-controls";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AuditGlyph, LockGlyph, MuteGlyph } from "./chat-glyphs";
import { ChannelRowMenu, type ChannelRowActions } from "./channel-row-menu";
import {
  useRailReorder,
  type RailDrag,
  type RailDrop,
  type RailLift,
} from "./use-rail-reorder";
import { useRailFlip } from "./use-rail-flip";
import { signetDarkTokens } from "@repo/theme/signet";
import { isSystemChannel } from "./channel-start";
import { cn, initials } from "@/lib/utils";
import { EYEBROW } from "@/components/ui/typography";

const RAIL_MOTION = signetDarkTokens.motion;

export interface ChatChannel {
  id: string;
  name: string;
  description?: string | null;
  type: "PUBLIC" | "PRIVATE" | "ROLE_GATED" | "DM" | "GROUP_DM";
  category_id?: string | null;
  is_read_only?: boolean;
  muted?: boolean | null;
  /**
   * Server-decided capability (#704): whether the caller may post in this
   * channel right now, via `ChannelAccessService.withPostCapability` — the
   * same `canAccessChannel` predicate the write path enforces. Optional and
   * treated as `true` when absent (a channel from before this field existed,
   * or the brief window after `getOrCreateDm`/`createGroupDm` returns a row
   * that hasn't gone through the list projection) rather than a claim the
   * caller can't post, since every prior caller of this type assumed exactly
   * that.
   */
  can_post?: boolean;
  /**
   * `users.id` of each participant, on DM and group-DM rows. Optional because
   * the shell builds these with an unchecked `asArray<ChatChannel>` cast and has
   * no normalizing selector — declaring it required would be a claim the
   * compiler cannot check.
   */
  member_ids?: string[] | null;
  /**
   * The caller hid this 1:1 DM from their own list (#2303). The server keeps
   * the row in `GET /v1/channels` so a `?channel=` link, a search hit or a
   * bookmark into it still resolves; the rail leaves it out unless it is the
   * channel open right now.
   */
  hidden?: boolean;
  /**
   * The chapter's default channel, where Chat opens when this browser has no
   * last channel (`landingChannelId` in `@repo/hooks`).
   */
  is_default?: boolean;
  /**
   * The chapter's audit log, `#chapter-audit` (#3909). Only Frapp posts there,
   * so the composer gives way to a line saying so.
   */
  is_audit_log?: boolean;
  /**
   * Always formal (#3787): everyone sees the channel in the formal display.
   * The shell copies it into `@repo/chat-core/density` for every row.
   */
  display_locked?: boolean;
  /** Who created the channel, who may set Always formal; null when unrecorded. */
  created_by?: string | null;
  /**
   * The chapter's order for this channel inside its section (#4178), set by
   * an officer dragging it; null until its section is first arranged.
   * `compareChannelOrder` in `@repo/hooks` sorts by it.
   */
  display_order?: number | null;
}

/**
 * Server-computed counts for one channel, from `GET /v1/channels/unread`.
 *
 * There used to be an `unread_count?` field on `ChatChannel` here, commented
 * "populated by future unread tracking". Nothing ever populated it — the
 * channel payload carries no counts, they come from their own endpoint — so the
 * badge that read it could not render, ever. `spec/behavior/chat/README.md`
 * § Read Receipts also forbids deriving either number client-side: the server
 * excludes the viewer's own and deleted messages and treats a never-opened
 * channel as entirely unread, and a second definition would disagree on exactly
 * those cases.
 */
export type ChannelUnread = SidebarUnreadCounts;

const NO_UNREAD: ChannelUnread = { unreadCount: 0, mentionCount: 0 };

/**
 * A display-only channel grouping, from `GET /v1/channels/categories/list`.
 *
 * Deliberately narrower than the API row, which also carries `chapter_id`,
 * `created_at` and `display_order`. **`display_order` is absent on purpose: the
 * rail never sorts by it.** `SupabaseChatCategoryRepository.findByChapter`
 * returns the rows already ordered — `display_order` first, then `created_at`
 * to break ties deterministically — so the array arrives in the order it should
 * render, and re-sorting here would be a second implementation of the same rule,
 * free to disagree with the server's the moment either changes.
 *
 * So: **order is the caller's array order.**
 *
 * Note this is *not* how the chat-admin screen reads it — `chat-admin-page.tsx`
 * re-sorts by `display_order` client-side. That is a real divergence and not the
 * pattern to copy here: it predates the server's tie-break, and while
 * `Array.sort` is stable enough that the two agree today, only one of them is
 * reading the order the server actually decided.
 */
export interface ChannelCategory {
  id: string;
  name: string;
}

/** Stable empty default, so an absent `categories` prop is not a new array per render. */
const NO_CATEGORIES: ChannelCategory[] = [];

/**
 * The sidebar as it was before #2877: nothing pinned, nothing folded, no
 * filter. What a caller that passes no `sidebar` gets.
 */
const DEFAULT_PREFERENCES: SidebarPreferences = {
  pinnedIds: new Set(),
  collapsed: new Set(),
  filters: { unreadOnly: false, hideMuted: false },
};

/**
 * The member's own arrangement of the rail (#2877) and the writes that change
 * it. The rule is `spec/behavior/chat/README.md` § Sidebar arrangement.
 */
export interface ChannelSidebarControls {
  preferences: SidebarPreferences;
  /**
   * Channels whose notification level is `off`, or `undefined` while the
   * levels are not known, in which case Hide muted hides nothing.
   */
  mutedChannelIds: ReadonlySet<string> | undefined;
  onSetPinned: (channel: ChatChannel, pinned: boolean) => void;
  onSetCollapsed: (key: SidebarSectionKey, collapsed: boolean) => void;
  onSetFilters: (change: SidebarFilterChange) => void;
  /** Turn both filters off, from the empty state they caused. */
  onClearFilters: () => void;
}

/** `@repo/validation`'s rule, the one `groupChannelsByCategory` sections by. */
function isDm(channel: ChatChannel): boolean {
  return isDirectChannel(channel);
}

/**
 * A row's marks carry their own quiet tone, so they don't inherit the row's
 * hover lift; this lifts them with the name, on hover and while the row's
 * right-click menu is open (`group/row` is the row's `<li>`).
 */
const ROW_LIFT =
  "group-hover/row:text-foreground group-data-[state=open]/row:text-foreground";

/**
 * A row's name, then the muted mark (`MuteGlyph`, the crossed-out speaker)
 * straight after it on a muted channel, where the phone's row and GroupMe put
 * theirs (#4136): the mark describes the name, and the row's far end stays
 * the count badge's. The name truncates
 * first, so the mark never leaves it.
 *
 * The glyph is `aria-hidden` (every duotone glyph is), so it carries its own
 * `sr-only` word. The muted state used to be the literal text "muted", which a
 * screen reader read for free; swapping it for a mark without this would have
 * silently dropped it.
 */
function ChannelRowName({
  title,
  muted,
  lift,
}: {
  title: string;
  muted: boolean;
  /** Lift the mark with the row on hover; off on the active row. */
  lift: boolean;
}) {
  if (!muted) return <span className="truncate">{title}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate">{title}</span>
      <MuteGlyph
        className={cn("h-3.5 w-3.5 shrink-0 text-muted", lift && ROW_LIFT)}
        active
      />
      <span className="sr-only">Muted</span>
    </span>
  );
}

/**
 * Badge text. A mention badge leads with `@` and shows the **mention** count,
 * not the total — s04 draws `@ 2` on a row whose unread total is higher. Same
 * rule mobile's `channel-row.tsx` ships, and the same 99+ cap.
 *
 * Duplicated from mobile rather than shared, for this slice only: moving it is
 * a cross-app change that does not belong in a web repaint. Consolidation into
 * `@repo/formatting` is #1194.
 */

export function badgeLabel(unreadCount: number, mentionCount: number): string {
  const count = mentionCount > 0 ? mentionCount : unreadCount;
  const capped = count > 99 ? "99+" : String(count);
  return mentionCount > 0 ? `@ ${capped}` : capped;
}

/**
 * What a screen reader hears instead of `@ 2`.
 *
 * Names **both** numbers when there is a mention, because the badge only shows
 * one: a row reading "@ 2" over twelve unread messages tells a sighted reader
 * "two of these are for you", and an announcement of "2 mentions" alone loses
 * the twelve. Pluralised, which the first cut of this was not — it announced
 * "1 mentions".
 */
export function unreadAnnouncement(
  { unreadCount, mentionCount }: ChannelUnread,
  isDirect = false,
): string {
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  if (mentionCount > 0) {
    return `${plural(mentionCount, "mention")}, ${unreadCount} unread`;
  }
  // A DM badge is red for the same reason a mention badge is, so it says the
  // same thing: this one is addressed to you.
  if (isDirect) return `${plural(unreadCount, "unread direct message")}`;
  return plural(unreadCount, "unread message");
}

/** Sorts an open hidden DM, which has no latest row, ahead of any real time. */
const OPEN_HIDDEN_FIRST = "9999-12-31T23:59:59.999Z";

export interface ChannelListProps {
  /**
   * Which list this is (#3774). `direct` is the Direct messages panel, given
   * only direct and group messages: its one section needs no heading under a
   * column already titled "Direct messages", so the rows sit straight under
   * the header, with Pinned above them and Hidden conversations below.
   */
  kind?: "channels" | "direct";
  /**
   * Direct messages only: each conversation's latest message time
   * (`GET /v1/channels/latest`), which orders the list newest first, as the
   * phone's Messages screen does. Absent until that read answers, when the
   * list keeps its A–Z order rather than reordering under the pointer twice.
   */
  latestAt?: ReadonlyMap<string, string>;
  /**
   * Direct messages only: each conversation's last line, worded by
   * `channelPreviewLine` (`@repo/chat-core/channel-preview`). Rows hold a blank
   * line until it answers, so none changes height when the lines land.
   */
  previews?: ReadonlyMap<string, string>;
  channels: ChatChannel[];
  activeChannelId: string | null;
  /** Viewer's `users.id`, subtracted when naming a DM by its other participant. */
  viewerId: string | null;
  /** `users.id` → display name, from `useMemberDisplayNames()`. */
  memberNames: DisplayNameMap;
  /**
   * A member's initials paint, from `useMemberDisplayNames()` (#3860). A 1:1
   * DM's mark wears the other member's tint; without it, or on a group DM, the
   * mark stays the neutral circle.
   */
  avatarTintFor?: (userId: string) => MemberAvatarTint;
  /**
   * Keyed by channel id; a channel with no row counts as fully read.
   *
   * `undefined` is distinct from an empty map and means **the counts are not
   * known** — still loading, or the fetch failed. The rail then shows no badges
   * *and* no read/unread emphasis, rather than asserting "all caught up" on
   * missing data.
   */
  unreadByChannelId?: Map<string, ChannelUnread>;
  /**
   * Chapter channel categories, in the order they should render.
   *
   * Optional and defaulting to none, which reproduces the pre-category layout
   * exactly — a caller that has no categories, or has not loaded them yet, gets
   * the single "Channels" group rather than an empty rail.
   */
  categories?: ChannelCategory[];
  /**
   * Picking a row. A row from the Hidden conversations group comes through
   * here too, flagged `hidden`, and reopening it is the caller's job (#2303).
   */
  onPick: (channel: ChatChannel) => void;
  /**
   * Offer Hide on each 1:1 DM row's right-click menu (#2303). The caller
   * confirms; the rail only asks. Absent, no row offers it.
   */
  onHide?: (channel: ChatChannel) => void;
  /**
   * The rest of a row's right-click menu: mark read, notifications, copy
   * link, and for `channels:manage` edit and delete (owner, 2026-11-06).
   * Absent, the menu offers only pin and hide.
   */
  rowActions?: ChannelRowActions;
  /**
   * Pins, folds and filters (#2877). Absent, the rail draws the default
   * arrangement and offers no pin or fold control.
   */
  sidebar?: ChannelSidebarControls;
  /**
   * Drag to reorder (#4178), for a member with `channels:manage`. Absent, no
   * row or heading drags.
   */
  reorder?: ChannelReorderControls;
  /**
   * New channel from the rail (#3838, Shawn 2026-11-11), for a member with
   * `channels:manage`: a + beside the Channels heading and each category's,
   * as Discord and Slack draw it. `categoryId` is the heading's category,
   * null for the default Channels group. Absent, no heading offers it.
   */
  onCreateChannel?: (categoryId: string | null) => void;
}

/**
 * The chapter's order writes (#4178). The rail works out the whole new order
 * of the one section or category list a drop changed, and the caller saves it.
 */
export interface ChannelReorderControls {
  /** `categoryId` null is the default Channels group. Every listed channel moves there. */
  onReorderChannels: (categoryId: string | null, channelIds: string[]) => void;
  onReorderCategories: (categoryIds: string[]) => void;
}

/** Copy for the reorder (#4178), rostered in writing.md § Arrange the channel list. */
const EMPTY_CATEGORY_HINT = "Drag channels here";

/** The heading +'s name: "New channel", or "New channel in Exec" under a category. */
function newChannelLabel(categoryName: string | null): string {
  return categoryName ? `New channel in ${categoryName}` : "New channel";
}
export const REORDER_SAVE_FAILED_TITLE = "Couldn't save the channel order";
export const REORDER_SAVE_FAILED_BODY =
  "Nothing changed. Check your connection and try again.";

/** A section the chapter orders: the default Channels group or a category. */
function isOrderableSection(key: string): boolean {
  return key === "channels" || key.startsWith("category:");
}

/** The category a section key names, or null for the default group. */
function categoryIdOf(key: string): string | null {
  return key.startsWith("category:") ? key.slice("category:".length) : null;
}

/**
 * The slot a drag opens where the row would land (owner, 2026-11-11: "you
 * could just reserve the space for it"), in place of a drop line. Neutral, as
 * every rail state but the active row is (foundations.md §6): a dashed
 * `--input` hairline around a faint fill, the shape of the row it waits for.
 */
const DROP_SLOT =
  "rounded-xs border border-dashed border-input bg-card-hover/40";
/**
 * The held copy: the highest surface on the ladder with the stronger hairline,
 * because elevation here is a lighter surface, never a shadow (foundations.md
 * §10). Its rotate and scale ease, so the lift, the sway and the settle all
 * glide; `use-rail-reorder.ts` sets them, and never under reduced motion.
 */
const HELD_COPY =
  "h-full rounded-xs border border-input bg-popover text-foreground";
const HELD_COPY_EASE = {
  transition: `rotate ${RAIL_MOTION.duration.standard}ms ${RAIL_MOTION.easing.standard}, scale ${RAIL_MOTION.duration.micro}ms ${RAIL_MOTION.easing.standard}`,
};

/**
 * The copy of a dragged row or heading that follows the pointer (#4178).
 * `attach` hands its element to `use-rail-reorder.ts`, which moves it, so a
 * pointer move redraws nothing in React.
 */
function HeldCopy({
  attach,
  lift,
  children,
}: {
  attach: (el: HTMLElement | null) => void;
  lift: RailLift;
  children: ReactNode;
}) {
  return (
    <div
      ref={attach}
      aria-hidden="true"
      data-reorder-ghost=""
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{ width: lift.width, height: lift.height }}
    >
      <div className={HELD_COPY} style={HELD_COPY_EASE}>
        {children}
      </div>
    </div>
  );
}

/**
 * Left-rail channel list, per `canvas-screens.dc.html` s04.
 *
 * The row carries the read/unread distinction in its **type weight**, which
 * is what foundations.md §5 specifies: an unread row is a bold title in
 * `--foreground`, a read one keeps `--foreground` at regular weight (#3777,
 * matching mobile) and carries no badge at all, and a muted one drops to
 * `--muted` unless it addresses the member. That is the whole signal here.
 * s04 also draws a message preview and a timestamp per row, which mobile
 * has drawn since 2026-11-06 from `GET /v1/channels/latest` (`useChannelLatestMessages`, worded by
 * `channelPreviewLine` in `@repo/chat-core/channel-preview`;
 * spec/behavior/chat/README.md § Channel list previews). On web the Direct
 * messages list draws that line too (`previews`, #3774); the channels rail
 * doesn't yet: #1191.
 *
 * **Red means one thing.** A mention or a DM takes the fixed `#E5484D` badge and
 * nothing else does — a plain unread channel carries no badge, only its bold name (2026-11-07),
 * because red is reserved for direct address and must read identically under
 * every chapter seed (foundations.md §5, accent-engine.md §5).
 */
export function ChannelList({
  kind = "channels",
  latestAt,
  previews,
  channels,
  activeChannelId,
  viewerId,
  memberNames,
  avatarTintFor,
  unreadByChannelId,
  categories = NO_CATEGORIES,
  onPick,
  onHide,
  rowActions,
  sidebar,
  reorder,
  onCreateChannel,
}: ChannelListProps) {
  const preferences = sidebar?.preferences ?? DEFAULT_PREFERENCES;
  const mutedChannelIds = sidebar?.mutedChannelIds;
  const [showHidden, setShowHidden] = useState(false);
  // Resolved once, then used for the row title and the sort key alike, which
  // must agree: sorting on the stored name put a DM under its uuid rather than
  // under the name the row visibly shows. (It resolved the search needle too,
  // until the field was deleted — `1b` pin 5, "No search field". The top bar's
  // find field on Cmd/Ctrl+F finds channels, and unlike this one it also finds
  // members and messages.)
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const channel of channels) {
      map.set(
        channel.id,
        directChannelDisplayName(
          {
            name: channel.name,
            type: channel.type,
            member_ids: channel.member_ids ?? [],
          },
          viewerId,
          memberNames,
        ),
      );
    }
    return map;
  }, [channels, viewerId, memberNames]);

  // `titles` is keyed from `channels` and every caller passes a member of that
  // array, so the fallback below is a belt, not a path anything takes today.
  const titleFor = useCallback(
    (channel: ChatChannel) => titles.get(channel.id) ?? channel.name,
    [titles],
  );

  /**
   * Rail sections, in render order: Pinned, the uncategorized default group,
   * one per category, DMs, then system.
   *
   * The category rules (API order, type before category, an unknown
   * `category_id` falls back to uncategorized) are `groupChannelsByCategory`'s,
   * shared with mobile's s04 so the two clients can't disagree (#1684), and so
   * is the arrangement on top of it: pins, the sort inside every section (the chapter order, then A–Z, #4178),
   * the filters and the folds (`arrangeChannelSidebar`, #2877). What stays here
   * is web's own: the System group, which is split off first so the shared
   * grouping never sees it, and the Hidden conversations group.
   *
   * **Uncategorized keeps the label "Channels" and stays first** below Pinned.
   * `spec/behavior/chat/README.md` § Channels names the fallback group
   * "Channels", which is what this rail already called it — so adopting
   * categories moves no uncategorized channel. A chapter that categorizes
   * everything just sees that group's empty section disappear.
   */
  const { arranged, hiddenDms, inputSections, sectionOrder } = useMemo(() => {
    // A DM the member hid (#2303) moves to the collapsed group at the end,
    // except while it is the open channel, so a jump into one does not leave
    // the rail with no row marked current. Hiding wins over pinning: a hidden
    // DM the member had pinned waits in the hidden group like any other, and
    // while it is open it sits under Direct messages, not Pinned, since its
    // row offers no pin control to take it back out.
    const hiddenDms: ChatChannel[] = [];
    const system: ChatChannel[] = [];
    const rest: ChatChannel[] = [];
    const pinnedIds = new Set(preferences.pinnedIds);

    for (const channel of channels) {
      if (channel.hidden) pinnedIds.delete(channel.id);
      if (channel.hidden && channel.id !== activeChannelId) {
        hiddenDms.push(channel);
      } else if (isSystemChannel(channel)) {
        system.push(channel);
      } else {
        rest.push(channel);
      }
    }

    const grouped = groupChannelsByCategory(rest, categories);
    const inputSections = sidebarSections(
      grouped,
      { channels: "Channels", direct: "Direct messages" },
      { label: "System", channels: system },
    );
    // Every channel of each orderable section in the order it draws, pinned
    // and filtered-out rows included (#4178): a drop rewrites the whole
    // section, so a row the member pinned or filtered away keeps its place
    // instead of falling to the end.
    const byOrder = compareChannelOrder(titleFor);
    const sectionOrder = new Map<string, ChatChannel[]>();
    for (const section of inputSections) {
      if (isOrderableSection(section.key)) {
        sectionOrder.set(section.key, [...section.channels].sort(byOrder));
      }
    }
    let arranged = arrangeChannelSidebar({
      sections: inputSections,
      pinnedIds,
      // The Direct messages panel draws no heading for its one section, so
      // a fold left from when DMs were a section of the channel list must
      // not hide the whole list with no control to unfold it.
      collapsed:
        kind === "direct" && preferences.collapsed.has("direct")
          ? new Set(
              [...preferences.collapsed].filter((key) => key !== "direct"),
            )
          : preferences.collapsed,
      filters: preferences.filters,
      activeChannelId,
      titleOf: titleFor,
      unreadByChannelId,
      mutedChannelIds,
    });
    hiddenDms.sort((a, b) => titleFor(a).localeCompare(titleFor(b)));
    // Direct messages run newest first, pinned ones still on top (#3774):
    // the order the phone's Messages screen uses (`compareLatestFirst`, one
    // rule for both), and the one a member reads conversations by. An open
    // hidden DM has no latest row, since the server leaves hidden ones out,
    // so it leads: it is the conversation on screen.
    if (kind === "direct" && latestAt) {
      const newestFirst = compareLatestFirst<ChatChannel>(
        (channel) =>
          latestAt.get(channel.id) ??
          (channel.hidden && channel.id === activeChannelId
            ? OPEN_HIDDEN_FIRST
            : undefined),
        titleFor,
      );
      arranged = {
        ...arranged,
        sections: arranged.sections.map((section) => ({
          ...section,
          rows: [...section.rows].sort(newestFirst),
        })),
      };
    }
    return { arranged, hiddenDms, inputSections, sectionOrder };
  }, [
    kind,
    latestAt,
    channels,
    titleFor,
    categories,
    activeChannelId,
    preferences,
    unreadByChannelId,
    mutedChannelIds,
  ]);

  // ── Drag to reorder (#4178) ──────────────────────────────────────────────
  const [announcement, setAnnouncement] = useState("");
  // Which row or heading to give focus back to once a keyboard move redraws
  // it: React moves the node, and moving a focused node blurs it.
  const refocus = useRef<string | null>(null);

  const sectionLabel = useCallback(
    (key: string) =>
      inputSections.find((section) => section.key === key)?.label ?? key,
    [inputSections],
  );

  /** The whole new order a drop makes, or null when it moves nothing. */
  const commitDrop = useCallback(
    (
      drag: RailDrag,
      drop: RailDrop,
    ): { position: number; of: number; label: string } | null => {
      if (!reorder) return null;
      if (drag.kind === "channel") {
        const section =
          drop.kind === "row" || drop.kind === "header" ? drop.section : null;
        if (!section || !isOrderableSection(section)) return null;
        const current = (sectionOrder.get(section) ?? []).map((c) => c.id);
        const next = current.filter((id) => id !== drag.id);
        let at = 0;
        if (drop.kind === "row") {
          const index = next.indexOf(drop.id);
          if (index < 0) return null;
          at = drop.after ? index + 1 : index;
        }
        next.splice(at, 0, drag.id);
        const unchanged =
          section === drag.section &&
          next.length === current.length &&
          next.every((id, i) => id === current[i]);
        if (unchanged) return null;
        reorder.onReorderChannels(categoryIdOf(section), next);
        return {
          position: at + 1,
          of: next.length,
          label: sectionLabel(section),
        };
      }
      if (drop.kind !== "category") return null;
      const current = categories.map((category) => category.id);
      const next = current.filter((id) => id !== drag.id);
      const index = next.indexOf(drop.id);
      if (index < 0) return null;
      const at = drop.after ? index + 1 : index;
      next.splice(at, 0, drag.id);
      if (next.every((id, i) => id === current[i])) return null;
      reorder.onReorderCategories(next);
      return { position: at + 1, of: next.length, label: "categories" };
    },
    [reorder, sectionOrder, categories, sectionLabel],
  );

  const nameOfDrag = useCallback(
    (drag: RailDrag) =>
      drag.kind === "channel"
        ? titleFor(
            channels.find((c) => c.id === drag.id) ?? {
              id: drag.id,
              name: drag.id,
              type: "PUBLIC",
            },
          )
        : (categories.find((c) => c.id === drag.id)?.name ?? "Category"),
    [titleFor, channels, categories],
  );

  const announceMove = useCallback(
    (
      drag: RailDrag,
      moved: { position: number; of: number; label: string } | null,
    ) => {
      if (!moved) return;
      setAnnouncement(
        `${nameOfDrag(drag)} moved to ${moved.position} of ${moved.of} in ${moved.label}`,
      );
    },
    [nameOfDrag],
  );

  const { railRef, track, release, arm } = useRailFlip();
  const railReorder = useRailReorder({
    enabled: !!reorder,
    onLift: track,
    onDrop: (drag, drop) => announceMove(drag, commitDrop(drag, drop)),
    onKeyMove: (drag, step) => {
      let drop: RailDrop | null = null;
      if (drag.kind === "channel") {
        // One place among the rows the section draws, so the move is the one
        // the member sees.
        const rows =
          arranged.sections.find((section) => section.key === drag.section)
            ?.rows ?? [];
        const index = rows.findIndex((row) => row.id === drag.id);
        const neighbour = index < 0 ? undefined : rows[index + step];
        if (neighbour) {
          drop = {
            kind: "row",
            section: drag.section,
            id: neighbour.id,
            after: step === 1,
          };
        }
        refocus.current = `[data-reorder-row="${drag.id}"] button`;
      } else {
        const index = categories.findIndex((c) => c.id === drag.id);
        const neighbour = index < 0 ? undefined : categories[index + step];
        if (neighbour) {
          drop = { kind: "category", id: neighbour.id, after: step === 1 };
        }
        refocus.current = `[data-reorder-category="${drag.id}"] [data-reorder-header]`;
      }
      if (drop) {
        // The rows slide to their new places once the new order arrives.
        arm();
        announceMove(drag, commitDrop(drag, drop));
      }
    },
  });

  useEffect(() => {
    const selector = refocus.current;
    if (!selector) return;
    refocus.current = null;
    const target = document.querySelector<HTMLElement>(selector);
    if (target && target !== document.activeElement) target.focus();
  }, [channels, categories]);

  const { dragging, drop, lift } = railReorder;
  useEffect(() => {
    if (!dragging) release();
  }, [dragging, release]);
  const draggingCategory = dragging?.kind === "category";

  const renderRow = (channel: ChatChannel, sectionKey?: string) => {
    const isActive = channel.id === activeChannelId;
    const twoLine = kind === "direct" && (!channel.hidden || isActive);
    const countsKnown = unreadByChannelId !== undefined;
    const counts = unreadByChannelId?.get(channel.id) ?? NO_UNREAD;
    // Red is "you were addressed", and foundations §5 spells that
    // as "an @-mention **or a direct message**" — s04 draws the DM
    // row with a plain red `1` and no `@`. `mention_count` is
    // @-mentions only (the RPC filters on `m.mentions`), so a DM
    // has to be folded in here or the one signal the fixed red
    // exists for never fires for the most personal channel there is.
    // `isAddressed` is the rule the arrangement's header totals use too.
    const hasMention = isAddressed(channel, counts);
    // A mention implies an unread row even if the two counts ever
    // disagree — a red badge on a read-styled row is a contradiction
    // on screen.
    const isUnread = countsKnown && (counts.unreadCount > 0 || hasMention);
    // `countsLookUnread` is the rule the phone's row and the arrangement's
    // header totals and Unread only read too (#3999): a muted channel reads as
    // unread only when it addresses the member, and otherwise sits quietly in
    // `--muted`. It quiets from the arrangement's own muted set, as the phone's
    // row does, so a failed refetch of the levels (which `channel.muted` rides
    // out on the last good answer) can't leave a read-looking row under a lit
    // folded header. Without the sidebar there is no header to disagree with.
    const isMuted = !!channel.muted;
    const quietedByMute = sidebar
      ? (mutedChannelIds?.has(channel.id) ?? false)
      : isMuted;
    const looksUnread =
      countsKnown &&
      countsLookUnread(isDirectChannel(channel), counts, quietedByMute);
    const pinned = preferences.pinnedIds.has(channel.id);
    const offersHide =
      !!onHide && canHideConversation(channel) && !channel.hidden;
    // A row an officer can drag (#4178): one in the default group or a
    // category, never Pinned, Direct messages, System or Hidden.
    const draggable =
      !!reorder && sectionKey !== undefined && isOrderableSection(sectionKey);
    const drag: RailDrag | null = draggable
      ? { kind: "channel", id: channel.id, section: sectionKey }
      : null;
    // Every row action lives in the right-click menu (owner, 2026-11-06:
    // "take away the pin option on hover"). The row draws no hover controls,
    // so its end is free for the mute mark and the badge alone.
    return (
      <ChannelRowMenu
        key={channel.id}
        channel={channel}
        unread={isUnread}
        pinned={sidebar ? pinned : null}
        onTogglePin={() => sidebar?.onSetPinned(channel, !pinned)}
        onHide={offersHide ? () => onHide?.(channel) : undefined}
        actions={rowActions}
      >
        <li
          // The row stays lit while its menu is open, so the member can see
          // which channel the menu is for.
          className={cn(
            "group/row",
            !isActive &&
              "[&[data-state=open]>button]:bg-card [&[data-state=open]>button]:text-foreground",
          )}
          data-flip={`row:${channel.id}`}
          data-reorder-row={draggable ? channel.id : undefined}
          data-reorder-section={draggable ? sectionKey : undefined}
          onPointerDown={drag ? railReorder.pointerDownFor(drag) : undefined}
        >
          <button
            type="button"
            onClick={() => onPick(channel)}
            onKeyDown={drag ? railReorder.keyDownFor(drag) : undefined}
            aria-keyshortcuts={drag ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
            aria-current={isActive ? "page" : undefined}
            // `1b` pin 6 and the `3a` geometry table: a channel row
            // is 32px at radius 8, tighter than the 34px/r10 nav row
            // above it, because a rail of channels is a longer list
            // than a rail of sections. 14/600 type, and the accent
            // tint still marks the active row the way the nav's does.
            // Read is grey, unread is white and bold with a white pip at the
            // row's start, as Discord draws it (owner, 2026-11-08; mobile's
            // `ChannelRow` matches). A muted channel's plain unread stays
            // grey; a mention gets past the mute.
            className={cn(
              "relative flex w-full items-center gap-2 rounded-xs px-2 text-left text-sm transition-colors",
              // Two lines in Direct messages: the name, then the last line.
              // A row in Hidden conversations has no line (the server keeps
              // no preview for it), so it stays one line.
              twoLine ? "h-12" : "h-8",
              isActive
                ? "bg-accent-subtle font-semibold text-accent-text"
                : looksUnread
                  ? "font-bold text-foreground hover:bg-card"
                  : isMuted
                    ? "text-muted hover:bg-card hover:text-foreground"
                    : "text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            {looksUnread && !isActive ? (
              <span
                aria-hidden
                data-testid="channel-unread-pip"
                className="absolute left-0 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground"
              />
            ) : null}
            <ChannelMark
              channel={channel}
              title={titleFor(channel)}
              tint={dmTint(channel, viewerId, avatarTintFor)}
              // The `#`, lock and audit marks follow mobile's sigil: the
              // row's own tone when unread or active, `--muted` when read,
              // and `--disabled` with a muted row.
              // Like the name, it lifts to `--foreground` on hover and while
              // the row's menu is open (#3999).
              tone={
                isActive || looksUnread
                  ? undefined
                  : cn(isMuted ? "text-disabled" : "text-muted", ROW_LIFT)
              }
            />
            {twoLine ? (
              <span className="flex min-w-0 flex-col">
                <ChannelRowName
                  title={titleFor(channel)}
                  muted={!!channel.muted}
                  lift={!isActive}
                />
                {/*
                  Caption, muted, never bold: the name carries the unread
                  weight, as on the phone. A non-breaking space holds the line
                  while the previews load.
                */}
                <span
                  data-preview=""
                  className="truncate text-caption font-normal text-muted-foreground"
                >
                  {previews?.get(channel.id) ?? "\u00a0"}
                </span>
              </span>
            ) : (
              <ChannelRowName
                title={titleFor(channel)}
                muted={!!channel.muted}
                lift={!isActive}
              />
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {/*
              No read-only mark here any more (#2877). The lock that used to
              sit at this end meant "read-only" while the same glyph at the
              start of a row means "private", and the Discord import makes
              every channel it creates read-only, so it drew on nearly every
              row. The channel says it is read-only where that matters, in
              its composer.
            */}
              {/* A number only when it addresses the member, as Discord does:
                  a merely unread channel says so with its bold name
                  (2026-11-07). */}
              {countsKnown && hasMention ? (
                <Badge
                  variant="mention"
                  className="h-6 justify-center px-2"
                  aria-label={unreadAnnouncement(counts, isDm(channel))}
                >
                  {badgeLabel(counts.unreadCount, counts.mentionCount)}
                </Badge>
              ) : isUnread ? (
                // No number to draw, but a screen reader still hears it.
                <span className="sr-only">
                  {unreadAnnouncement(counts, isDm(channel))}
                </span>
              ) : null}
            </span>
          </button>
        </li>
      </ChannelRowMenu>
    );
  };

  // The sections to draw, in order. An officer who can reorder also sees each
  // category with no channel at all, as a heading to drop the first one on;
  // everyone else sees only sections with rows, as before.
  type RenderEntry =
    | { kind: "section"; section: (typeof arranged.sections)[number] }
    | { kind: "empty"; key: string; label: string };
  const renderOrder: RenderEntry[] = [];
  {
    const byKey = new Map(
      arranged.sections.map((section) => [section.key as string, section]),
    );
    const pinned = byKey.get("pinned");
    if (pinned) renderOrder.push({ kind: "section", section: pinned });
    for (const input of inputSections) {
      const section = byKey.get(input.key);
      if (section) {
        renderOrder.push({ kind: "section", section });
      } else if (
        reorder &&
        input.key.startsWith("category:") &&
        input.channels.length === 0 &&
        !arranged.emptiedByFilters
      ) {
        renderOrder.push({ kind: "empty", key: input.key, label: input.label });
      }
    }
  }

  /**
   * Where the drag's slot is drawn (#4178). For a channel, a section and an
   * index among the rows that section draws without the held row; for a
   * category, the drawn category it goes before, or null for after the last.
   * "After this row" and "before the next" come out the same, so the slot
   * holds still while the pointer crosses from one to the other. No target
   * puts the slot back where the drag began.
   */
  type Slot =
    | { kind: "channel"; section: string; index: number }
    | { kind: "category"; before: string | null; others: string[] };
  let slot: Slot | null = null;
  if (dragging?.kind === "channel") {
    const rowsIn = (key: string) =>
      arranged.sections.find((section) => section.key === key)?.rows ?? [];
    if (drop?.kind === "header") {
      slot = { kind: "channel", section: drop.section, index: 0 };
    } else if (drop?.kind === "row") {
      const index = rowsIn(drop.section)
        .filter((row) => row.id !== dragging.id)
        .findIndex((row) => row.id === drop.id);
      if (index >= 0) {
        slot = {
          kind: "channel",
          section: drop.section,
          index: drop.after ? index + 1 : index,
        };
      }
    }
    if (!slot) {
      const home = rowsIn(dragging.section).findIndex(
        (row) => row.id === dragging.id,
      );
      slot = {
        kind: "channel",
        section: dragging.section,
        index: Math.max(0, home),
      };
    }
  } else if (dragging?.kind === "category") {
    const heldKey = `category:${dragging.id}`;
    const drawn = renderOrder
      .map((entry) =>
        entry.kind === "section" ? entry.section.key : entry.key,
      )
      .filter((key) => key.startsWith("category:"));
    const others = drawn.filter((key) => key !== heldKey);
    let index = -1;
    if (drop?.kind === "category") {
      const at = others.indexOf(`category:${drop.id}`);
      if (at >= 0) index = drop.after ? at + 1 : at;
    }
    // Home: the held category's own place, counted among the others.
    if (index < 0) index = Math.max(0, drawn.indexOf(heldKey));
    slot = { kind: "category", before: others[index] ?? null, others };
  }

  /** The slot a dragged channel would land in, drawn as a row-sized space. */
  const channelSlot = (
    <li
      key="__reorder-slot"
      data-flip="slot"
      data-reorder-gap=""
      aria-hidden="true"
      className={DROP_SLOT}
      style={{ height: lift?.height ?? 32 }}
    />
  );

  /** A section's rows while a channel drag is on: the held row out, the slot in. */
  const rowsWithSlot = (key: string, rows: ChatChannel[]) => {
    const drawn = rows.map((row) => renderRow(row, key));
    if (dragging?.kind !== "channel") return drawn;
    const kept = drawn.filter((_, i) => rows[i]?.id !== dragging.id);
    if (slot?.kind === "channel" && slot.section === key) {
      kept.splice(Math.min(slot.index, kept.length), 0, channelSlot);
    }
    return kept;
  };

  /**
   * The heading's + (#3838): shown while the pointer is over the heading or
   * the + has focus, as Discord and Slack show theirs, so a rail full of
   * headings doesn't carry a column of + signs. Never on Pinned, Direct
   * messages, System or Hidden, which the chapter doesn't fill.
   */
  const createButtonFor = (key: string, label: string) => {
    if (!onCreateChannel || kind !== "channels") return null;
    // Gone while anything is held, so the heading under the pointer is the
    // whole drop target it was.
    if (!isOrderableSection(key) || dragging) return null;
    const categoryId = categoryIdOf(key);
    const name = newChannelLabel(categoryId ? label : null);
    return (
      <button
        type="button"
        aria-label={name}
        title={name}
        onClick={() => onCreateChannel(categoryId)}
        className={cn(
          // `mb-1` matches the heading's own bottom padding, so the + sits
          // on the label's line.
          "mb-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground",
          "opacity-0 focus-visible:opacity-100 group-hover/head:opacity-100",
        )}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    );
  };

  /** A section block's drag attributes. */
  const blockProps = (key: string) => {
    if (!reorder) return {};
    if (!isOrderableSection(key)) return { "data-reorder-none": "" };
    const categoryId = categoryIdOf(key);
    if (!categoryId) return {};
    return { "data-reorder-category": categoryId };
  };

  /**
   * A category with no channel yet, drawn only for an officer who can fill it.
   * Its heading lines up with the others: with the sidebar controls they carry
   * a fold chevron, so this one keeps the chevron's room without drawing one,
   * since there is nothing to fold.
   */
  const renderEmptyCategory = (key: string, label: string) => {
    const categoryId = categoryIdOf(key);
    const drag: RailDrag | null = categoryId
      ? { kind: "category", id: categoryId }
      : null;
    const slotHere = slot?.kind === "channel" && slot.section === key;
    return (
      <div key={key} {...blockProps(key)}>
        <div className="group/head flex items-center gap-1 pr-2">
          <p
            data-flip={`head:${key}`}
            data-reorder-header={key}
            tabIndex={0}
            onPointerDown={drag ? railReorder.pointerDownFor(drag) : undefined}
            onKeyDown={drag ? railReorder.keyDownFor(drag) : undefined}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 pb-1 text-muted-foreground",
              sidebar ? "px-2" : "px-3",
              EYEBROW,
            )}
          >
            {sidebar ? (
              <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : null}
            <span className="truncate">{label}</span>
          </p>
          {createButtonFor(key, label)}
        </div>
        {slotHere ? (
          <ul aria-hidden="true">{channelSlot}</ul>
        ) : draggingCategory ? null : (
          <p
            data-flip={`hint:${key}`}
            data-reorder-into={key}
            className={cn(
              "pt-0.5 text-caption text-muted",
              sidebar ? "pl-[26px] pr-2" : "px-3",
            )}
          >
            {EMPTY_CATEGORY_HINT}
          </p>
        )}
      </div>
    );
  };

  /** A dragged category's slot, as tall as the heading it waits for. */
  const categorySlot = (
    <div
      key="__reorder-slot"
      data-flip="slot"
      data-reorder-gap=""
      aria-hidden="true"
      className={DROP_SLOT}
      style={{ height: lift?.height ?? 24 }}
    />
  );

  /** The render order with a category drag applied: the held one out, the slot in. */
  type DrawEntry = RenderEntry | { kind: "slot" };
  const drawOrder: DrawEntry[] = [];
  if (slot?.kind === "category" && dragging?.kind === "category") {
    const heldKey = `category:${dragging.id}`;
    const lastOther = slot.others[slot.others.length - 1];
    for (const entry of renderOrder) {
      const key = entry.kind === "section" ? entry.section.key : entry.key;
      if (key === slot.before) drawOrder.push({ kind: "slot" });
      if (key === heldKey) {
        // The only category: its slot stays where it was.
        if (slot.others.length === 0) drawOrder.push({ kind: "slot" });
        continue;
      }
      drawOrder.push(entry);
      if (slot.before === null && key === lastOther) {
        drawOrder.push({ kind: "slot" });
      }
    }
  } else {
    drawOrder.push(...renderOrder);
  }

  /** The held copy that follows the pointer, a look-alike of the row or heading. */
  const heldChannel =
    dragging?.kind === "channel"
      ? channels.find((channel) => channel.id === dragging.id)
      : undefined;
  const heldCopy =
    dragging && lift && typeof document !== "undefined"
      ? createPortal(
          <HeldCopy attach={railReorder.attachHeldCopy} lift={lift}>
            {heldChannel ? (
              <div className="flex h-full items-center gap-2 px-2 text-sm font-semibold">
                <ChannelMark
                  channel={heldChannel}
                  title={titleFor(heldChannel)}
                  tint={dmTint(heldChannel, viewerId, avatarTintFor)}
                />
                <span className="truncate">{titleFor(heldChannel)}</span>
              </div>
            ) : (
              <div
                className={cn("flex h-full items-center gap-1 px-2", EYEBROW)}
              >
                {sidebar ? (
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                ) : null}
                <span className="truncate">{nameOfDrag(dragging)}</span>
              </div>
            )}
          </HeldCopy>,
          document.body,
        )
      : null;

  return (
    <div
      ref={railRef}
      className="space-y-4"
      data-reorder-rail={reorder ? "" : undefined}
    >
      {/* Where a drag or an Alt+Arrow move is announced (#4178). */}
      {reorder ? (
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      ) : null}
      {heldCopy}
      {drawOrder.map((entry) => {
        if (entry.kind === "slot") return categorySlot;
        if (entry.kind === "empty") {
          return renderEmptyCategory(entry.key, entry.label);
        }
        const section = entry.section;
        const headerId = `channel-section:${section.key}`;
        const orderable = !!reorder && isOrderableSection(section.key);
        const categoryId = categoryIdOf(section.key);
        const headerDrag: RailDrag | null =
          orderable && categoryId ? { kind: "category", id: categoryId } : null;
        const headerProps = orderable
          ? {
              "data-reorder-header": section.key,
              onPointerDown: headerDrag
                ? railReorder.pointerDownFor(headerDrag)
                : undefined,
              onKeyDown: headerDrag
                ? railReorder.keyDownFor(headerDrag)
                : undefined,
            }
          : {};
        // A category drag folds every category to its heading, as Discord
        // does, so the list being reordered is short enough to see whole.
        const rows =
          draggingCategory && categoryId
            ? []
            : rowsWithSlot(section.key, section.rows);
        return (
          <div key={section.key} {...blockProps(section.key)}>
            {/*
              The header names the list rather than just sitting above it: a
              screen-reader member navigating by list or by button would
              otherwise hear "exec-board, button" with no indication of which
              group it belongs to.

              With `sidebar`, the header is also the fold control (#2877), a
              disclosure button. Folded, it carries the section's own unread
              total, red when anything inside addresses the member, so folding
              never hides a mention.
            */}
            {kind === "direct" && section.key === "direct" ? null : sidebar ? (
              <div
                className={cn(
                  "group/head flex items-center gap-1 pr-2",
                  // Pinned to the top of the rail while its rows scroll under
                  // it, until the next heading pushes it off (owner
                  // 2026-11-07). The rail's own surface, so no row shows
                  // through; the 4px pulled up and padded back keeps the
                  // resting layout and gives the pinned label room. On the
                  // row, not the fold button, so the heading's + stays with it.
                  "sticky top-0 z-10 -mt-1 bg-surface-1 pt-1",
                )}
              >
                <button
                  type="button"
                  id={headerId}
                  data-flip={`head:${section.key}`}
                  {...headerProps}
                  aria-expanded={!section.collapsed}
                  onClick={() =>
                    sidebar.onSetCollapsed(section.key, !section.collapsed)
                  }
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1 px-2 pb-1 text-left text-muted-foreground hover:text-foreground",
                    EYEBROW,
                    // Folded with something unread inside, it reads as an
                    // unread row does, since only a mention carries a number:
                    // `--foreground` bold (foundations.md §5), as mobile draws it.
                    section.collapsed &&
                      section.unreadCount > 0 &&
                      "font-bold text-foreground",
                  )}
                >
                  {section.collapsed ? (
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronDown
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{section.label}</span>
                  {section.collapsed && section.addressed ? (
                    <Badge
                      variant="mention"
                      className="ml-auto h-6 justify-center px-2 normal-case tracking-normal"
                      aria-label={foldedSectionAnnouncement(section)}
                    >
                      {badgeLabel(section.addressedCount, section.mentionCount)}
                    </Badge>
                  ) : section.collapsed && section.unreadCount > 0 ? (
                    <span className="sr-only">
                      {foldedSectionAnnouncement(section)}
                    </span>
                  ) : null}
                </button>
                {createButtonFor(section.key, section.label)}
              </div>
            ) : (
              <p
                id={headerId}
                data-flip={`head:${section.key}`}
                {...headerProps}
                className={cn("px-3 pb-1 text-muted-foreground", EYEBROW)}
              >
                {section.label}
              </p>
            )}
            {rows.length === 0 ? null : kind === "direct" &&
              section.key === "direct" ? (
              <ul aria-label="Direct messages">{rows}</ul>
            ) : (
              <ul aria-labelledby={headerId}>{rows}</ul>
            )}
          </div>
        );
      })}
      {arranged.emptiedByFilters && sidebar ? (
        <div className="space-y-2 rounded-lg border border-border px-3 py-4 text-center text-caption text-muted-foreground">
          <p>{NO_MATCHING_CHANNELS}</p>
          <button
            type="button"
            onClick={sidebar.onClearFilters}
            className="font-semibold text-foreground underline-offset-2 hover:underline"
          >
            {SHOW_ALL_CHANNELS_LABEL}
          </button>
        </div>
      ) : null}
      {hiddenDms.length > 0 ? (
        <div data-reorder-none={reorder ? "" : undefined}>
          <button
            type="button"
            data-flip="head:hidden"
            onClick={() => setShowHidden((open) => !open)}
            aria-expanded={showHidden}
            aria-controls="channel-section:hidden"
            className={cn(
              "w-full px-3 pb-1 text-left text-muted-foreground hover:text-foreground",
              EYEBROW,
            )}
          >
            {`${HIDDEN_CONVERSATIONS_LABEL} (${hiddenDms.length})`}
          </button>
          {showHidden ? (
            <ul
              id="channel-section:hidden"
              aria-label={HIDDEN_CONVERSATIONS_LABEL}
            >
              {hiddenDms.map((row) => renderRow(row))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A 1:1 DM's mark wears the other member's tint, as their avatar does in the
 * thread (#3860). A group DM, or a row whose peer can't be told, stays neutral.
 */
function dmTint(
  channel: ChatChannel,
  viewerId: string | null,
  avatarTintFor: ((userId: string) => MemberAvatarTint) | undefined,
): MemberAvatarTint | null {
  if (!avatarTintFor || !isDm(channel)) return null;
  const peer = otherMemberId(channel, viewerId);
  return peer ? avatarTintFor(peer) : null;
}

/**
 * The leading mark. s04 draws a plain channel as a **text `#`** and a direct
 * message as an initials avatar, so those are type and an avatar rather than
 * icons; the kinds the reference does not draw take their duotone intent glyph.
 */
function ChannelMark({
  channel,
  title,
  tint,
  tone,
}: {
  channel: ChatChannel;
  title: string;
  /** A 1:1 DM's initials paint: the other member's tint (#3860). */
  tint?: MemberAvatarTint | null;
  /** A text-colour class for the glyph; unset, it inherits the row's tone. */
  tone?: string;
}) {
  if (isSystemChannel(channel))
    return <AuditGlyph className={cn("h-4 w-4 shrink-0", tone)} />;
  if (isDm(channel))
    return (
      // 24px, with the primitive's own caption-role initials — no size
      // override. s04 draws the DM avatar larger because it is a full-bleed
      // list row; a rail row is 40px tall, and the `#` beside it is 16px.
      <Avatar className="h-6 w-6 shrink-0" aria-hidden="true">
        <AvatarFallback tint={tint}>{initials(title)}</AvatarFallback>
      </Avatar>
    );
  if (channel.type === "PRIVATE" || channel.type === "ROLE_GATED")
    return <LockGlyph className={cn("h-4 w-4 shrink-0", tone)} />;
  return (
    <span
      aria-hidden="true"
      className={cn("w-4 shrink-0 text-center font-bold", tone)}
    >
      #
    </span>
  );
}

/**
 * The rail's two filters (#2877), behind one control in the Channels header.
 *
 * A popover of two switches rather than two chips: the channels column is
 * 240px wide and its header already carries the column title. The trigger
 * shows a dot while any filter is on, so a shortened list never reads as a
 * chapter that simply has fewer channels.
 */
export function ChannelFilters({
  filters,
  onChange,
}: {
  filters: SidebarPreferences["filters"];
  onChange: (change: SidebarFilterChange) => void;
}) {
  const active = filters.unreadOnly || filters.hideMuted;
  const unreadId = useId();
  const mutedId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(compactControlClassName, "relative ml-auto")}
          aria-label={active ? FILTER_CHANNELS_ON_LABEL : FILTER_CHANNELS_LABEL}
        >
          <ListFilter className="h-4 w-4" aria-hidden="true" />
          {active ? (
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary"
            />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={unreadId}>{UNREAD_ONLY_LABEL}</Label>
          <Switch
            id={unreadId}
            checked={filters.unreadOnly}
            onCheckedChange={(checked) => onChange({ unread_only: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={mutedId}>{HIDE_MUTED_LABEL}</Label>
          <Switch
            id={mutedId}
            checked={filters.hideMuted}
            onCheckedChange={(checked) => onChange({ hide_muted: checked })}
          />
        </div>
        <p className="text-caption text-muted-foreground">
          Pinned channels, the open channel and anything that mentions you
          always show.
        </p>
      </PopoverContent>
    </Popover>
  );
}
