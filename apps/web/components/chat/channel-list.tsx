"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, EyeOff, ListFilter } from "lucide-react";
import {
  arrangeChannelSidebar,
  canHideConversation,
  directChannelDisplayName,
  groupChannelsByCategory,
  HIDDEN_CONVERSATIONS_LABEL,
  HIDE_CONVERSATION_LABEL,
  foldedSectionAnnouncement,
  HIDE_MUTED_LABEL,
  isAddressed,
  NO_MATCHING_CHANNELS,
  PIN_TO_TOP_LABEL,
  SHOW_ALL_CHANNELS_LABEL,
  sidebarSections,
  UNPIN_FROM_TOP_LABEL,
  UNREAD_ONLY_LABEL,
  type DisplayNameMap,
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
import { CHAT_CONTROL_CLASS } from "./chip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AuditGlyph, LockGlyph, MuteGlyph, PinGlyph } from "./chat-glyphs";
import { Skeleton } from "@/components/shared/async-states";
import { cn, initials } from "@/lib/utils";

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

const SYSTEM_CHANNEL_NAMES = new Set(["chapter-audit"]);

function isSystem(channel: ChatChannel): boolean {
  return SYSTEM_CHANNEL_NAMES.has(channel.name);
}

/** `@repo/validation`'s rule, the one `groupChannelsByCategory` sections by. */
function isDm(channel: ChatChannel): boolean {
  return isDirectChannel(channel);
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

export interface ChannelListProps {
  channels: ChatChannel[];
  activeChannelId: string | null;
  /** Viewer's `users.id`, subtracted when naming a DM by its other participant. */
  viewerId: string | null;
  /** `users.id` → display name, from `useMemberDisplayNames()`. */
  memberNames: DisplayNameMap;
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
   * Offer Hide on each 1:1 DM row (#2303). The caller confirms; the rail only
   * asks. Absent, no row offers it.
   */
  onHide?: (channel: ChatChannel) => void;
  /**
   * Pins, folds and filters (#2877). Absent, the rail draws the default
   * arrangement and offers no pin or fold control.
   */
  sidebar?: ChannelSidebarControls;
}

/**
 * Left-rail channel list, per `canvas-screens.dc.html` s04.
 *
 * The row carries the read/unread distinction in its **type weight and tone**,
 * which is what foundations.md §5 specifies: an unread row is a bold title in
 * `--foreground`, a read one drops to `--muted-foreground` and carries no badge
 * at all. That is the whole signal here — s04 also draws a message preview and a
 * timestamp per row, and neither is buildable on web today because
 * `GET /v1/channels` carries no last-message projection. Inventing one client-
 * side would be a second source of truth for "what was said last" — and wrong
 * for every channel the viewer has not opened. Filed as #1191.
 *
 * **Red means one thing.** A mention or a DM takes the fixed `#E5484D` badge and
 * nothing else does — a plain unread channel is the neutral `--input` badge,
 * because red is reserved for direct address and must read identically under
 * every chapter seed (foundations.md §5, accent-engine.md §5).
 */
export function ChannelList({
  channels,
  activeChannelId,
  viewerId,
  memberNames,
  unreadByChannelId,
  categories = NO_CATEGORIES,
  onPick,
  onHide,
  sidebar,
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
   * is the arrangement on top of it: pins, the A–Z sort inside every section,
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
  const { arranged, hiddenDms } = useMemo(() => {
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
      } else if (isSystem(channel)) {
        system.push(channel);
      } else {
        rest.push(channel);
      }
    }

    const arranged = arrangeChannelSidebar({
      sections: sidebarSections(
        groupChannelsByCategory(rest, categories),
        { channels: "Channels", direct: "Direct messages" },
        { label: "System", channels: system },
      ),
      pinnedIds,
      collapsed: preferences.collapsed,
      filters: preferences.filters,
      activeChannelId,
      titleOf: titleFor,
      unreadByChannelId,
      mutedChannelIds,
    });
    hiddenDms.sort((a, b) => titleFor(a).localeCompare(titleFor(b)));
    return { arranged, hiddenDms };
  }, [
    channels,
    titleFor,
    categories,
    activeChannelId,
    preferences,
    unreadByChannelId,
    mutedChannelIds,
  ]);

  const renderRow = (channel: ChatChannel) => {
    const isActive = channel.id === activeChannelId;
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
    const pinned = preferences.pinnedIds.has(channel.id);
    const offersHide =
      !!onHide && canHideConversation(channel) && !channel.hidden;
    return (
      <li key={channel.id} className="group relative">
        <button
          type="button"
          onClick={() => onPick(channel)}
          aria-current={isActive ? "page" : undefined}
          // `1b` pin 6 and the `3a` geometry table: a channel row
          // is 32px at radius 8, tighter than the 34px/r10 nav row
          // above it, because a rail of channels is a longer list
          // than a rail of sections. 14/600 type, and the accent
          // tint still marks the active row the way the nav's does.
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-xs px-2 text-left text-sm transition-colors",
            isActive
              ? "bg-accent-subtle font-semibold text-accent-text"
              : isUnread
                ? "font-semibold text-foreground hover:bg-card"
                : "text-muted-foreground hover:bg-card hover:text-foreground",
          )}
        >
          <ChannelMark channel={channel} title={titleFor(channel)} />
          <span className="truncate">{titleFor(channel)}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {/*
              The glyphs below are `aria-hidden` (every duotone
              glyph is), so each carries its own `sr-only` word.
              The muted state used to be the literal text "muted",
              which a screen reader read for free; swapping it for a
              mark without this would have silently dropped it.
            */}
            {channel.muted ? (
              <>
                <MuteGlyph className="h-4 w-4 text-muted-foreground" active />
                <span className="sr-only">Muted</span>
              </>
            ) : null}
            {/*
              No read-only mark here any more (#2877). The lock that used to
              sit at this end meant "read-only" while the same glyph at the
              start of a row means "private", and the Discord import makes
              every channel it creates read-only, so it drew on nearly every
              row. The channel says it is read-only where that matters, in
              its composer.
            */}
            {isUnread ? (
              <Badge
                variant={hasMention ? "mention" : "secondary"}
                className="h-6 justify-center px-2"
                aria-label={unreadAnnouncement(counts, isDm(channel))}
              >
                {badgeLabel(counts.unreadCount, counts.mentionCount)}
              </Badge>
            ) : null}
          </span>
        </button>
        {offersHide ? (
          // A sibling of the row, not inside it: a button cannot hold a
          // button. Revealed on hover and on keyboard focus, and it sits over
          // the badge while shown, the way a row action does in a chat rail.
          // It takes no pointer events until then: Tailwind's `group-hover`
          // applies only where the device can hover, so on touch it would
          // otherwise be an invisible target over the badge that opens the
          // hide dialog instead of the thread. Touch hides from the open DM's
          // `⋯` menu instead.
          <button
            type="button"
            onClick={() => onHide?.(channel)}
            aria-label={`${HIDE_CONVERSATION_LABEL} with ${titleFor(channel)}`}
            title={HIDE_CONVERSATION_LABEL}
            className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-xs bg-card text-muted-foreground pointer-events-none opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
          >
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        {sidebar && !channel.hidden ? (
          // Beside Hide, on the same terms: revealed on hover and keyboard
          // focus, inert to touch, where the channel menu's Pin to top row is
          // the way in.
          <button
            type="button"
            onClick={() => sidebar.onSetPinned(channel, !pinned)}
            aria-label={`${pinned ? UNPIN_FROM_TOP_LABEL : PIN_TO_TOP_LABEL}: ${titleFor(channel)}`}
            title={pinned ? UNPIN_FROM_TOP_LABEL : PIN_TO_TOP_LABEL}
            className={cn(
              "absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-xs bg-card text-muted-foreground pointer-events-none opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
              offersHide ? "right-8" : "right-1",
            )}
          >
            {/* The channel menu's Pin to top row draws the same glyph. */}
            <PinGlyph className="h-4 w-4" active={pinned} />
          </button>
        ) : null}
      </li>
    );
  };

  if (channels.length === 0) {
    return (
      <p className="rounded-lg border border-border px-3 py-4 text-center text-caption text-muted-foreground">
        All caught up. Start a channel to begin chatting.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {arranged.sections.map((section) => {
        const headerId = `channel-section:${section.key}`;
        return (
          <div key={section.key}>
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
            {sidebar ? (
              <button
                type="button"
                id={headerId}
                aria-expanded={!section.collapsed}
                onClick={() =>
                  sidebar.onSetCollapsed(section.key, !section.collapsed)
                }
                className="flex w-full items-center gap-1 px-2 pb-1 text-left text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
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
                {section.collapsed &&
                (section.unreadCount > 0 || section.addressed) ? (
                  <Badge
                    variant={section.addressed ? "mention" : "secondary"}
                    className="ml-auto h-5 justify-center px-1.5 normal-case tracking-normal"
                    aria-label={foldedSectionAnnouncement(section)}
                  >
                    {badgeLabel(section.unreadCount, section.mentionCount)}
                  </Badge>
                ) : null}
              </button>
            ) : (
              <p
                id={headerId}
                className="px-3 pb-1 text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              >
                {section.label}
              </p>
            )}
            {section.rows.length > 0 ? (
              <ul aria-labelledby={headerId}>{section.rows.map(renderRow)}</ul>
            ) : null}
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
        <div>
          <button
            type="button"
            onClick={() => setShowHidden((open) => !open)}
            aria-expanded={showHidden}
            aria-controls="channel-section:hidden"
            className="w-full px-3 pb-1 text-left text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            {`${HIDDEN_CONVERSATIONS_LABEL} (${hiddenDms.length})`}
          </button>
          {showHidden ? (
            <ul
              id="channel-section:hidden"
              aria-label={HIDDEN_CONVERSATIONS_LABEL}
            >
              {hiddenDms.map(renderRow)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The leading mark. s04 draws a plain channel as a **text `#`** and a direct
 * message as an initials avatar, so those are type and an avatar rather than
 * icons; the kinds the reference does not draw take their duotone intent glyph.
 */
function ChannelMark({
  channel,
  title,
}: {
  channel: ChatChannel;
  title: string;
}) {
  if (isSystem(channel)) return <AuditGlyph className="h-4 w-4 shrink-0" />;
  if (isDm(channel))
    return (
      // 24px, with the primitive's own caption-role initials — no size
      // override. s04 draws the DM avatar larger because it is a full-bleed
      // list row; a rail row is 40px tall, and the `#` beside it is 16px.
      <Avatar className="h-6 w-6 shrink-0" aria-hidden="true">
        <AvatarFallback>{initials(title)}</AvatarFallback>
      </Avatar>
    );
  if (channel.type === "PRIVATE" || channel.type === "ROLE_GATED")
    return <LockGlyph className="h-4 w-4 shrink-0" />;
  return (
    <span aria-hidden="true" className="w-4 shrink-0 text-center font-bold">
      #
    </span>
  );
}

/**
 * Reserved geometry for the channels column while `useChannels()` is in flight.
 *
 * The board's first-paint contract (`1s`) puts the channel column's chrome at
 * 0ms and fills it from cache on the first chunk; what it never does is replace
 * the route with a loading card. These blocks are the row geometry above — 32px
 * tall at radius 8, the same 2px gaps, an indent for the mark — so the real rows
 * land in the space the placeholders already held rather than pushing anything.
 *
 * **Since the first-chunk cache shipped this is the cold-cache path, not the
 * usual one.** A warm load seeds `["channels"]` from IndexedDB before the rail
 * renders, so `channelsPaneState` never reaches `"loading"` and neither this
 * nor the `sr-only` announcer below is reached. It is still the path for a
 * first-ever visit, a wiped or expired cache, and a browser where IndexedDB
 * throws — which is why it stays, and why its geometry still has to match.
 *
 * Deliberately not a count derived from anything. A cached count is available
 * now, but the skeleton renders precisely when it is *not* — and a number that
 * changes between renders makes the column jump.
 * `aria-hidden` because eight anonymous rectangles are no use to a screen
 * reader. **That means this is not the whole loading affordance**: the spoken
 * half is a separate `sr-only` live region in `chat-shell.tsx`, kept outside
 * this column because `narrowPane` hides the column entirely below `lg`. Do not
 * conclude from the `aria-hidden` here that an announcement is supplied by
 * whatever renders this — the shared `LoadingState` that used to carry one was
 * deleted with the whole-route loading card (#2142).
 */
export function ChannelListSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-0.5">
      {SKELETON_ROW_WIDTHS.map((width, index) => (
        <div key={index} className="flex h-8 items-center gap-2 px-2">
          <Skeleton className="h-4 w-4 shrink-0 rounded-xs" />
          <Skeleton className={cn("h-[13px]", width)} />
        </div>
      ))}
    </div>
  );
}

/**
 * Cycled rather than randomised: a skeleton that reshuffles on every render
 * flickers, and under Strict Mode it would differ between the two passes.
 */
const SKELETON_ROW_WIDTHS = [
  "w-[62%]",
  "w-[45%]",
  "w-[70%]",
  "w-[52%]",
  "w-[58%]",
  "w-[40%]",
  "w-[66%]",
  "w-[48%]",
] as const;

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
          className={cn(CHAT_CONTROL_CLASS, "relative ml-auto")}
          aria-label={
            active ? "Filter channels, filters on" : "Filter channels"
          }
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
