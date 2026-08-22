"use client";

import { useCallback, useMemo, useState } from "react";
import { directChannelDisplayName, type DisplayNameMap } from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AuditGlyph, LockGlyph, SearchGlyph } from "./chat-glyphs";
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
   * `users.id` of each participant, on DM and group-DM rows. Optional because
   * the shell builds these with an unchecked `asArray<ChatChannel>` cast and has
   * no normalizing selector — declaring it required would be a claim the
   * compiler cannot check.
   */
  member_ids?: string[] | null;
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
export interface ChannelUnread {
  unreadCount: number;
  mentionCount: number;
}

const NO_UNREAD: ChannelUnread = { unreadCount: 0, mentionCount: 0 };

type Section = { key: string; label: string; channels: ChatChannel[] };

const SYSTEM_CHANNEL_NAMES = new Set(["chapter-audit"]);

function isSystem(channel: ChatChannel): boolean {
  return SYSTEM_CHANNEL_NAMES.has(channel.name);
}

function isDm(channel: ChatChannel): boolean {
  return channel.type === "DM" || channel.type === "GROUP_DM";
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
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
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
  onPick: (channel: ChatChannel) => void;
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
  onPick,
}: ChannelListProps) {
  const [query, setQuery] = useState("");

  // Resolved once, then used for the row title, the search needle and the sort
  // key alike. Those three must agree: filtering on the stored name meant typing
  // a name the row visibly showed matched nothing, while a chunk of a DM's uuid
  // matched a row displaying no such text.
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return channels;
    return channels.filter((channel) =>
      titleFor(channel).toLowerCase().includes(needle),
    );
  }, [channels, query, titleFor]);

  const sections = useMemo<Section[]>(() => {
    const groups: Record<string, ChatChannel[]> = {
      channels: [],
      dms: [],
      system: [],
    };
    for (const channel of filtered) {
      if (isSystem(channel)) groups.system!.push(channel);
      else if (isDm(channel)) groups.dms!.push(channel);
      else groups.channels!.push(channel);
    }
    for (const list of Object.values(groups)) {
      list.sort((a, b) => titleFor(a).localeCompare(titleFor(b)));
    }
    return [
      { key: "channels", label: "Channels", channels: groups.channels! },
      { key: "dms", label: "Direct messages", channels: groups.dms! },
      { key: "system", label: "System", channels: groups.system! },
    ];
  }, [filtered, titleFor]);

  if (channels.length === 0) {
    return (
      <p className="rounded-lg border border-border px-3 py-4 text-center text-[12.5px] text-muted-foreground">
        All caught up — start a channel to begin chatting.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <SearchGlyph className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        {/*
          No height or size override. The field keeps the primitive's 48px and
          16px value text — `input.tsx` states outright that a field's value
          never renders below 16, and the previous `h-8 text-sm` here was
          fighting exactly that.
        */}
        <Input
          aria-label="Search channels"
          placeholder="Search channels"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-10"
        />
      </div>
      {sections.every((section) => section.channels.length === 0) ? (
        <p className="px-3 text-[12.5px] text-muted-foreground">
          No matches. Try a different name.
        </p>
      ) : null}
      {sections.map((section) =>
        section.channels.length === 0 ? null : (
          <div key={section.key}>
            <p className="px-3 pb-1 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {section.label}
            </p>
            <ul>
              {section.channels.map((channel) => {
                const isActive = channel.id === activeChannelId;
                const countsKnown = unreadByChannelId !== undefined;
                const counts = unreadByChannelId?.get(channel.id) ?? NO_UNREAD;
                // Red is "you were addressed", and foundations §5 spells that
                // as "an @-mention **or a direct message**" — s04 draws the DM
                // row with a plain red `1` and no `@`. `mention_count` is
                // @-mentions only (the RPC filters on `m.mentions`), so a DM
                // has to be folded in here or the one signal the fixed red
                // exists for never fires for the most personal channel there is.
                const hasMention =
                  counts.mentionCount > 0 ||
                  (isDm(channel) && counts.unreadCount > 0);
                // A mention implies an unread row even if the two counts ever
                // disagree — a red badge on a read-styled row is a contradiction
                // on screen.
                const isUnread =
                  countsKnown && (counts.unreadCount > 0 || hasMention);
                return (
                  <li key={channel.id}>
                    <button
                      type="button"
                      onClick={() => onPick(channel)}
                      aria-current={isActive ? "page" : undefined}
                      // The sidebar item recipe (components.md §7), which the
                      // shell's own nav already ships: 40px tall, radius 10,
                      // accent tint when selected. The rail and the app's
                      // sidebar are the same kind of chrome, so they are the
                      // same control.
                      className={cn(
                        "flex h-10 w-full items-center gap-2.5 rounded-sm px-3 text-left text-[14.5px] transition-colors",
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
                        {channel.muted ? (
                          <span className="text-[12.5px] text-muted-foreground">muted</span>
                        ) : null}
                        {channel.is_read_only && !channel.muted && !isUnread ? (
                          <Badge variant="outline" className="h-6 px-2">
                            Read
                          </Badge>
                        ) : null}
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
                  </li>
                );
              })}
            </ul>
          </div>
        ),
      )}
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
  if (isSystem(channel))
    return <AuditGlyph className="h-4 w-4 shrink-0" />;
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
