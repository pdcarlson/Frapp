"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuditGlyph, DirectMessageGlyph, LockGlyph } from "./chat-glyphs";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import {
  directChannelDisplayName,
  useChannelNotificationPreferences,
  useChannelUnreadCounts,
  useChannels,
  useSetChannelNotificationLevel,
  useMarkChannelRead,
  useCategories,
  useChapterRoster,
  useMemberDisplayNames,
  useMyPermissions,
  useOrgConfig,
  useBookmarks,
  useBookmarkedMessageIds,
  useBookmarkMessage,
  useUnbookmarkMessage,
  resolveAuthorLabel,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { asArray, cn } from "@/lib/utils";
import { useChatChannel } from "@/lib/chat/use-chat-channel";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import type { ResolveMember } from "@repo/chat-core/dispatch";
import type { ChatMessage } from "@repo/chat-core/types";
import { FOCUS_RING, SKIP_LINK_CLASSES } from "@/components/ui/focus";
import {
  ChannelList,
  type ChannelCategory,
  type ChannelUnread,
  type ChatChannel,
} from "./channel-list";
import {
  MessageTimeline,
  type MessageTimelineHandle,
} from "./message-timeline";
import { Composer } from "./composer";
import { DELETED_MESSAGE_PLACEHOLDER } from "./message-placeholders";
import { replyPreviewText } from "./reply-quote";
import { ThreadPanel } from "./thread-panel";
import { OpsSetupNudge } from "./ops-setup-nudge";
import { PinsPopover } from "./pins-popover";
import { ChatSearchPopover, type ChatSearchHit } from "./chat-search-popover";
import { BookmarksPopover, type BookmarkEntry } from "./bookmarks-popover";
import { NotificationLevelPopover } from "./notification-level-popover";
import { ReconnectPill } from "./reconnect-pill";
import type { SlashCommand } from "@repo/chat-integrations";
import type { ChatNotificationLevel } from "@repo/hooks";

interface DirectoryMember {
  user_id: string;
  display_name: string;
}

/**
 * Resolve a `/points @member` token to a single chapter member. Tiered and
 * fail-closed: exact user id → exact display name → name without spaces →
 * first name → unique prefix. Ambiguity at any tier (or no match) returns
 * `null` so the dispatcher never adjusts the wrong person.
 */
function matchMember(
  list: DirectoryMember[],
  token: string,
): DirectoryMember | null {
  const needle = token.trim().toLowerCase();
  if (needle.length === 0) return null;
  const lower = (s: string) => s.toLowerCase();
  const noSpace = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const firstWord = (s: string) => s.toLowerCase().split(/\s+/)[0] ?? "";

  const tiers: Array<(m: DirectoryMember) => boolean> = [
    (m) => m.user_id.toLowerCase() === needle,
    (m) => lower(m.display_name) === needle,
    (m) => noSpace(m.display_name) === needle,
    (m) => firstWord(m.display_name) === needle,
    (m) => lower(m.display_name).startsWith(needle),
  ];
  for (const pred of tiers) {
    const hits = list.filter(pred);
    if (hits.length === 1) {
      return { user_id: hits[0]!.user_id, display_name: hits[0]!.display_name };
    }
    if (hits.length > 1) return null;
  }
  return null;
}

/**
 * Leading mark for the channel header.
 *
 * A plain channel takes a **text `#`**, not a glyph: `canvas-screens.dc.html`
 * s04/s05 draw the sigil as type (17px / 700), and the reference wins over a
 * tidier all-icons row. Everything the reference does not draw — audit, direct,
 * private — takes its duotone intent glyph at the 20px list-row size
 * (`iconography.md` §2).
 */
function ChannelHeaderMark({
  channel,
  className,
}: {
  channel: ChatChannel | null;
  className?: string;
}) {
  if (channel?.name === "chapter-audit")
    return <AuditGlyph className={className} />;
  if (channel?.type === "DM" || channel?.type === "GROUP_DM")
    return <DirectMessageGlyph className={className} />;
  if (channel?.type === "PRIVATE" || channel?.type === "ROLE_GATED")
    return <LockGlyph className={className} />;
  return (
    <span aria-hidden="true" className="font-bold text-muted-foreground">
      #
    </span>
  );
}

/**
 * The 3-pane chat surface: channel rail, thread, thread/details rail.
 *
 * **The panes are not cards, and that is load-bearing.** They used to be
 * `<Card>`s, so the whole surface painted `--card` — and `components.md` §11
 * specs the incoming bubble as `--card` with a hairline. A card on a card is
 * `#1E1B17` on `#1E1B17`: the bubble simply would not have existed. The
 * reference resolves it the other way round (`canvas-screens.dc.html` s05):
 * the thread sits on `--background`, the app floor, and the bubbles are the
 * step above it. The two rails are `--surface-1`, the ladder step foundations
 * §2 assigns to nav chrome, which is what the sidebar already uses.
 *
 * Every async branch (no-chapter, channels-loading, channels-error,
 * no-channels) renders an explicit state.
 */
export function ChatShell({
  initialChannelId = null,
  initialMessageId = null,
}: {
  initialChannelId?: string | null;
  initialMessageId?: string | null;
} = {}) {
  const activeChapterId = useChapterStore((state) => state.activeChapterId);
  const { userId } = useFrappUser();
  const orgConfig = useOrgConfig();

  const channelsQuery = useChannels();
  const categoriesQuery = useCategories();
  // Names for message authors and DM titles. Shares its query key with the
  // roster read below, so react-query serves both from one fetch.
  const { byId: memberNames, nameFor } = useMemberDisplayNames();
  // Per-channel notification levels, from their own endpoint rather than the
  // channel payload — the same split unread counts use, and for the same
  // recorded reason (see `channel-list.tsx`, which explains how a `muted` field
  // nothing populated stayed permanently falsy).
  const notificationPrefsQuery = useChannelNotificationPreferences();
  const levelByChannelId = useMemo(() => {
    const map = new Map<string, ChatNotificationLevel>();
    // Keyed off `data`, NOT `isError`. TanStack Query keeps the last good
    // `data` when a *background refetch* fails, so bailing on `isError` threw
    // away still-valid levels the user had already seen: one 502 during an API
    // restart and every muted channel silently rendered as unmuted, which is
    // precisely the "claims a channel is not muted when it is" failure this
    // guard was meant to avoid. With no data at all the map stays empty and
    // callers fall back, which is the honest un-configured state.
    if (!notificationPrefsQuery.data) {
      return map;
    }
    for (const row of notificationPrefsQuery.data) {
      map.set(row.channel_id, row.level);
    }
    return map;
  }, [notificationPrefsQuery.data]);

  const channels = useMemo(
    () =>
      asArray<ChatChannel>(channelsQuery.data).map((ch) => ({
        ...ch,
        // `muted` finally has a writer. It has been on this type since the
        // channel list was built and was populated nowhere until now, so the
        // "muted" indicator it gates could never render.
        muted: levelByChannelId.get(ch.id) === "off",
      })),
    [channelsQuery.data, levelByChannelId],
  );

  // The rail groups plain channels under these. Passed through in the order the
  // API returned them — `SupabaseChatCategoryRepository.findByChapter` orders by
  // `display_order` and then `created_at` server-side, so there is nothing to
  // re-sort here.
  //
  // **A failed categories fetch degrades to the flat list rather than an error
  // state.** Unlike `channelsQuery` below, there is no `isError` branch:
  // `asArray` turns the absent payload into `[]` and every channel falls into
  // the default "Channels" group, which is exactly the pre-category rail.
  //
  // Note what this does *not* say: chat is still gated on
  // `categoriesQuery.isPending` below, so a member does wait out the query
  // provider's `retry: 3` backoff before that fallback renders. That gate
  // predates categories being drawn and was pure cost then; it now buys a rail
  // that paints grouped on first render instead of flat-then-reflowed. Whether
  // that trade is right is worth revisiting — but the degradation is at the end
  // of the retries, not instead of them.
  const categories = useMemo(
    () => asArray<ChannelCategory>(categoriesQuery.data),
    [categoriesQuery.data],
  );

  // Seeded from the `?channel=` query param a caller (e.g. the member
  // directory's Message action, a chat notification, a command-palette
  // search hit) may navigate here with — see `activeChannelId` below for what
  // happens before that channel has loaded into `channels`.
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    initialChannelId,
  );
  // A caller-supplied channel id can be stale (deleted channel) or
  // inaccessible (membership changed since the link was made). Falling back
  // to #general for either case *silently* would make a broken deep link
  // indistinguishable from an intentional one — so this is tracked
  // separately from "no target was requested at all", and surfaces its own
  // empty state below rather than folding into the general fallback.
  const [channelTargetDismissed, setChannelTargetDismissed] = useState(false);
  // State, not a ref: the jump effect below needs to re-run when *only* this
  // changes (a second message-only link into an already-active, already-
  // loaded channel touches nothing else the effect depends on).
  const [pendingMessageId, setPendingMessageId] = useState(initialMessageId);
  // Which channel the pending jump's message actually lives in.
  //
  // Was read straight off `initialChannelId` (the URL param), which conflated
  // "the channel this deep link named" with "the channel this jump targets".
  // Those were the same thing only while deep links and the in-channel pins
  // panel were the only jumps. Both the chapter-wide Bookmarks panel (#462) and
  // chat search (#469) routinely target a *different* channel than the URL
  // named, and against the old guard such a jump was silently dropped, because
  // `activeChannelId` never equals a stale `initialChannelId` again. `null`
  // means "no channel was named; jump in whatever channel ends up active",
  // which is the message-only link case.
  const [pendingJumpChannelId, setPendingJumpChannelId] = useState<
    string | null
  >(initialChannelId);
  // Set when a jump target resolved to a channel but was not in its loaded
  // window. This is the difference between a control that quietly does nothing
  // and one that says why it could not — the whole reason `scrollToMessage`
  // now reports reachability.
  //
  // Scoped to the channel it was raised in, not a bare message id. An
  // unscoped notice followed the member around: switching channels from the
  // rail left it standing in a channel the message was never in, and a
  // `?message=` link with no channel (so no `pendingJumpChannelId` to gate on)
  // re-raised it in every channel visited until it was dismissed.
  const [unreachableTarget, setUnreachableTarget] = useState<{
    messageId: string;
    channelId: string | null;
  } | null>(null);
  // Bumped on every jump request so re-picking the SAME target re-runs the
  // effect. Without it, asking again for something already resolved as
  // unreachable changed no dependency, so the effect never re-ran: the notice
  // cleared and nothing else happened — an inert row again, on the natural
  // "did that work?" second click.
  const [jumpAttempt, setJumpAttempt] = useState(0);
  // `initialChannelId`/`initialMessageId` are only read by `useState`'s
  // initializer on first mount. A second deep link (another notification, a
  // second command-palette hit) navigated to while `/chat` is already
  // mounted only changes these *props* — Next's App Router updates search
  // params without remounting the page — so without this, the new target is
  // silently dropped. Re-applying it here whenever it's genuinely new (not
  // on every render) is what makes each deep link a fresh navigation intent.
  const appliedTargetRef = useRef({
    channelId: initialChannelId,
    messageId: initialMessageId,
  });
  useEffect(() => {
    if (
      appliedTargetRef.current.channelId === initialChannelId &&
      appliedTargetRef.current.messageId === initialMessageId
    ) {
      return;
    }
    appliedTargetRef.current = {
      channelId: initialChannelId,
      messageId: initialMessageId,
    };
    setSelectedChannelId(initialChannelId);
    setChannelTargetDismissed(false);
    setPendingMessageId(initialMessageId);
    setPendingJumpChannelId(initialChannelId);
    setUnreachableTarget(null);
    setJumpAttempt((n) => n + 1);
  }, [initialChannelId, initialMessageId]);

  // `useChannels()` can serve a read up to its `staleTime` old. A channel
  // created moments ago (a fresh DM, a newly shared private channel) can
  // legitimately be absent from that cached read — declaring it "not found"
  // on a stale list would be a false alarm, not an honest one. A forced
  // refetch per target keeps the "missing" verdict below trustworthy.
  const refetchChannels = channelsQuery.refetch;
  useEffect(() => {
    if (initialChannelId === null) return;
    void refetchChannels();
  }, [initialChannelId, refetchChannels]);

  // A caller can pass a channel *name* (onboarding's completion redirect
  // uses the literal `general`, matching `activeChannelId`'s own by-name
  // fallback below) as well as an id — so "missing" means neither matches.
  const requestedChannelMissing =
    !channelTargetDismissed &&
    initialChannelId !== null &&
    selectedChannelId === initialChannelId &&
    channels.length > 0 &&
    !channelsQuery.isFetching &&
    !channels.some(
      (ch) => ch.id === initialChannelId || ch.name === initialChannelId,
    );
  const activeChannelId = useMemo(() => {
    if (requestedChannelMissing) return null;
    if (
      selectedChannelId &&
      channels.some((ch) => ch.id === selectedChannelId)
    ) {
      return selectedChannelId;
    }
    if (channels.length === 0) return null;
    return channels.find((ch) => ch.name === "general")?.id ?? channels[0]!.id;
  }, [selectedChannelId, channels, requestedChannelMissing]);

  const activeChannel = useMemo(
    () => channels.find((ch) => ch.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  // DM channels are stored as `dm-<uuidA>-<uuidB>`; the header, the composer
  // placeholder and the sidebar must all show the resolved title instead.
  const activeChannelName = useMemo(() => {
    if (!activeChannel) return "";
    return directChannelDisplayName(
      {
        name: activeChannel.name,
        type: activeChannel.type,
        member_ids: activeChannel.member_ids ?? [],
      },
      userId,
      memberNames,
    );
  }, [activeChannel, userId, memberNames]);

  // Same resolution as `activeChannelName`, for any channel — a search hit in
  // another channel has to be labelled with the name a member would recognise,
  // and a DM's stored `dm-<uuidA>-<uuidB>` is not it.
  //
  // Built once as a Map rather than a `channels.find` per lookup: this is called
  // per rendered search hit per render, and the shell already keeps
  // `levelByChannelId` in exactly this shape a few lines up.
  const channelTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of channels) {
      map.set(
        ch.id,
        directChannelDisplayName(
          { name: ch.name, type: ch.type, member_ids: ch.member_ids ?? [] },
          userId,
          memberNames,
        ),
      );
    }
    return map;
  }, [channels, userId, memberNames]);
  const channelNameFor = useCallback(
    (channelId: string) => channelTitles.get(channelId) ?? null,
    [channelTitles],
  );

  const announcementsChannelId = useMemo(
    () => channels.find((ch) => ch.name === "announcements")?.id ?? null,
    [channels],
  );

  // Backs `@member` resolution for member-targeted slash commands (/points).
  // Reads the roster projection rather than the full member list: `matchMember`
  // only ever touches `user_id` and `display_name`, so the fat profile put every
  // member's email, bio and city on the chat page to match a name (#986).
  const membersQuery = useChapterRoster();
  const resolveMember = useMemo<ResolveMember>(() => {
    const list = asArray<DirectoryMember>(membersQuery.data);
    return (token: string) => matchMember(list, token);
  }, [membersQuery.data]);

  const channel = useChatChannel(activeChannelId);

  // A custom role can hold `channels:manage` without also being a chapter
  // admin — same gate `chat-admin-page.tsx` computes for its own page-level
  // `<Can>`, done inline here since this is a per-row boolean, not a whole
  // surface to hide.
  const { data: permissionsPayload } = useMyPermissions();
  const canManageChannel = can(
    "channels:manage",
    permissionsPayload?.permissions,
  );

  // Bookmarks (#462). One chapter-wide query backs both the panel and every
  // row's toggle state, so the two can never disagree about what is saved.
  const bookmarksQuery = useBookmarks();
  const bookmarks = useMemo(
    () => asArray<BookmarkEntry>(bookmarksQuery.data),
    [bookmarksQuery.data],
  );
  const bookmarkedMessageIds = useBookmarkedMessageIds();
  const bookmarkMessage = useBookmarkMessage();
  const unbookmarkMessage = useUnbookmarkMessage();
  const handleToggleBookmark = useCallback(
    (messageId: string, next: boolean) => {
      // Both routes are idempotent server-side, so a double-tap or a retry is
      // a no-op rather than an error — no in-flight guard is needed here.
      //
      // A failure is NOT swallowed, though. There is no optimistic write, so a
      // failed save leaves the chip reading "Save" exactly as if nothing had
      // been tapped — the member gets silence and concludes the feature is
      // broken. The sibling control in this same header (notification level)
      // already surfaces its failure as a `role="alert"`; this follows it.
      if (next) bookmarkMessage.mutate(messageId);
      else unbookmarkMessage.mutate(messageId);
    },
    [bookmarkMessage, unbookmarkMessage],
  );
  const bookmarkWriteFailed =
    bookmarkMessage.isError || unbookmarkMessage.isError;
  const resetBookmarkMessage = bookmarkMessage.reset;
  const resetUnbookmarkMessage = unbookmarkMessage.reset;
  // Cleared on a channel switch, mirroring the notification-level control
  // beside it. Both mutations live at the shell level and TanStack keeps
  // `isError` set until the next attempt, so without this one failed save
  // pins "Bookmark not saved" into every channel header for the rest of the
  // session — an alert that outlives its cause is worse than none.
  useEffect(() => {
    resetBookmarkMessage();
    resetUnbookmarkMessage();
  }, [activeChannelId, resetBookmarkMessage, resetUnbookmarkMessage]);

  const { confirm, confirmDialog } = useConfirmDialog();
  const deleteMessage = channel.delete;
  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      void (async () => {
        const confirmed = await confirm({
          title: "Delete this message?",
          description:
            "This can't be undone. Everyone in the channel will see " +
            `"${DELETED_MESSAGE_PLACEHOLDER}" in its place.`,
          confirmLabel: "Delete message",
          tone: "destructive",
        });
        if (!confirmed) return;
        try {
          await deleteMessage(messageId);
        } catch {
          // The delete action already toasted the failure.
        }
      })();
    },
    [confirm, deleteMessage],
  );

  const setNotificationLevel = useSetChannelNotificationLevel();

  // `useSetChannelNotificationLevel` is ONE mutation instance for the whole
  // shell, and TanStack keeps `isError` set until the next `mutate()`. Passing
  // it straight through pinned a "could not save" alert onto every channel for
  // the rest of the session after a single failure — a confident, wrong claim
  // about channels the member never touched. Scope it to the channel the failed
  // write was actually for, and clear it when they move away.
  const failedChannelId = setNotificationLevel.isError
    ? setNotificationLevel.variables?.channelId
    : undefined;
  const resetNotificationLevel = setNotificationLevel.reset;
  const notificationLevelErrored = setNotificationLevel.isError;
  useEffect(() => {
    // Only when there is actually an error to clear. An unconditional reset
    // detached the observer from an IN-FLIGHT write, so a mute that failed
    // after the member changed channel was reported on no channel at all —
    // and it forced a second full render of the shell on every switch to
    // clear state that is almost never set.
    if (notificationLevelErrored) resetNotificationLevel();
  }, [activeChannelId, notificationLevelErrored, resetNotificationLevel]);

  // Opening a channel stamps the read cursor — the only thing that moves it, and
  // the only thing that clears the badges above. Without it the rail lights up
  // on first load and never goes out, which is worse than the dead badge this
  // slice replaced: it would show every channel as permanently unread.
  // `spec/behavior/chat/README.md` § Read Receipts: opening stamps to server
  // `now()`; there is no mark-read-to-a-message.
  const markRead = useMarkChannelRead();
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    if (!activeChannelId) return;
    markReadMutate(activeChannelId);
    // Stamp again on the way out, so messages that arrived while the channel
    // was open do not resurface as unread. Mobile does the same on blur.
    return () => markReadMutate(activeChannelId);
  }, [activeChannelId, markReadMutate]);

  // Unread and mention counts come from `GET /v1/channels/unread`, never from a
  // local re-derivation: the server excludes the viewer's own and deleted
  // messages and treats a never-opened channel as entirely unread, so a second
  // definition would disagree on exactly those cases
  // (`spec/behavior/chat/README.md` § Read Receipts).
  const unreadQuery = useChannelUnreadCounts();
  const unreadByChannelId = useMemo(() => {
    // A failed fetch must not read as "everything is read". `ChannelList` maps
    // an absent row to zero, so handing it an empty map on error would render
    // every row calm and unbadged — telling a member they have no @-mentions
    // at the exact moment we cannot know. `undefined` means "no counts",
    // which the rail shows as neither read nor unread. Mobile guards the same
    // case (`apps/mobile/app/(tabs)/index.tsx`).
    if (unreadQuery.isError || !unreadQuery.data) return undefined;
    const map = new Map<string, ChannelUnread>();
    for (const row of unreadQuery.data) {
      map.set(row.channel_id, {
        unreadCount: row.unread_count,
        mentionCount: row.mention_count,
      });
    }
    return map;
  }, [unreadQuery.data, unreadQuery.isError]);

  // Fail closed while the chapter config is loading or errored. Slash
  // dispatch (`/poll`, `/announce`) flows through the NestJS chat send
  // endpoint, which trusts the client-side enabled_modules gate —
  // returning true here would let a user fire a disabled command before
  // the query resolves (issue #310).
  const isModuleEnabled = useMemo(() => {
    return (key: string) => {
      const data = orgConfig.data as
        { isModuleEnabled?: (k: string) => boolean } | undefined;
      if (!data?.isModuleEnabled) return false;
      return data.isModuleEnabled(key);
    };
  }, [orgConfig.data]);

  const slashCommandsStatus: "loading" | "error" | "ready" = orgConfig.isError
    ? "error"
    : orgConfig.data
      ? "ready"
      : "loading";
  const onRetrySlashCommands = useMemo(
    () => () => void orgConfig.refetch(),
    [orgConfig],
  );

  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  /**
   * The message the composer's next send replies to (#489).
   *
   * An id, not the message: `channel.messages` is the live copy, so deriving
   * the strip from it below means an edit, a delete or a reaction on the parent
   * is reflected in what the member sees they are replying to. A snapshot taken
   * at click time would quote text that no longer exists.
   *
   * Carries its **channel** alongside the message id, so a target can never
   * outlive the channel it was staged in. `chat.service.ts` 400s a
   * `reply_to_id` naming a message in another channel, and clearing on the
   * switch paths alone is not enough to prevent that: the deep-link effect sets
   * `selectedChannelId` directly without going through
   * `dismissThreadForChannelSwitch`. Scoping makes it structural rather than a
   * cleanup every future switch path has to remember.
   */
  const [replyTarget, setReplyTarget] = useState<{
    channelId: string;
    messageId: string;
  } | null>(null);
  // What had focus when a thread was opened (the row's Reply control, most
  // often) — restored by `closeThread` below, per the keyboard-navigation
  // acceptance criterion in #396.
  const threadTriggerRef = useRef<HTMLElement | null>(null);
  // A channel switch while a thread is open unmounts `ThreadPanel` the same
  // way `closeThread` does, but the trigger that opened it belongs to the
  // channel being left — refocusing it would be meaningless at best and
  // would yank focus back to a message the member just navigated away from
  // at worst. Only the bookkeeping is shared.
  const dismissThreadForChannelSwitch = useCallback(() => {
    setThreadParentId(null);
    threadTriggerRef.current = null;
    // A staged reply is NOT cleared here. It is scoped to its own channel (see
    // `replyTarget`), so it is already invisible and unsendable anywhere else,
    // and clearing here would discard it on a path that is not a switch at all:
    // the rail calls this for a click on the channel already open, which is an
    // ordinary miss-click. That silently dropped the reply while leaving the
    // draft text, so Enter posted it as a top-level message.
  }, []);
  // Channel-scoped: the notice belongs to the channel the jump was attempted
  // in, so it never follows the member into a channel the message was never in.
  const showUnreachableNotice =
    unreachableTarget !== null &&
    unreachableTarget.channelId === activeChannelId;
  // Pins are a navigation affordance, not a list: the popover's rows were
  // rendered as buttons but `onJump` was never wired, so every one of them was
  // inert. The timeline exposes the scroll, the shell owns the wiring.
  const timeline = useRef<MessageTimelineHandle | null>(null);
  const jumpToMessage = useCallback((messageId: string) => {
    timeline.current?.scrollToMessage(messageId);
  }, []);

  // Every jump — a search hit, a bookmark, a `?message=` deep link — takes the
  // same route: `pendingMessageId` + the jump effect below. Including a target
  // in the channel already open.
  //
  // The same-channel case used to scroll directly, on the reasoning that no
  // channel switch had to be waited for. That was wrong in the way that matters
  // most here: `scrollToMessage` cannot reach a message outside the loaded
  // window, so for any target older than the backfill it did nothing at all,
  // said nothing, and left nothing pending to retry. Search exists to reach old
  // messages, so that was the common case, not the edge — an inert row of
  // exactly the kind `components.md` §5 bans. One path for every case means the
  // unreachable-target handling below covers them all.
  const jumpToChannelMessage = useCallback(
    (channelId: string, messageId: string) => {
      if (channelId !== activeChannelId) {
        setSelectedChannelId(channelId);
        setChannelTargetDismissed(false);
        // Search and bookmarks both read live rows while `useChannels()` serves
        // up to its `staleTime`, so a target can legitimately name a channel
        // the cached list has never seen (a DM opened moments ago). Without
        // this the id fails `channels.some(...)`, `activeChannelId` quietly
        // falls back to #general, and the member lands somewhere they did not
        // ask for with the jump stranded. The deep-link path already forces
        // this refetch for the same reason.
        void refetchChannels();
        // A jump out of the channel a thread belongs to must close it, the same
        // cleanup picking a channel from the rail does. Left open, the panel
        // merely fails to resolve against the new channel — and pops back up
        // unbidden on any later jump that returns to its channel.
        dismissThreadForChannelSwitch();
      }
      setUnreachableTarget(null);
      setPendingMessageId(messageId);
      setPendingJumpChannelId(channelId);
      setJumpAttempt((n) => n + 1);
    },
    [activeChannelId, refetchChannels, dismissThreadForChannelSwitch],
  );

  /** Search hit (#469) — the popover carries the channel on every row. */
  const jumpToSearchHit = useCallback(
    (hit: ChatSearchHit) => jumpToChannelMessage(hit.channelId, hit.message.id),
    [jumpToChannelMessage],
  );

  /**
   * Bookmark (#462). The Bookmarks panel is chapter-wide, unlike the in-channel
   * pins panel, so its rows routinely target another channel — the same shape
   * as a search hit, and now the same code path.
   */
  const jumpToBookmark = jumpToChannelMessage;

  // A pending target jumps once that message is present in the loaded window.
  //
  // A miss keeps the target pending — a message that arrives later still gets
  // its jump, which is the behaviour deep links have always had — but it no
  // longer keeps *quiet* about it. `scrollToMessage` now reports reachability,
  // so a miss sets the notice rendered in the header below and a later hit
  // clears it. Silence was survivable for pins (a pin you can see is loaded by
  // definition) and is not for search or bookmarks, whose whole job is reaching
  // messages beyond the loaded window: every such row looked inert.
  //
  // Note what this does NOT claim: nothing backfills older history today
  // (`useChatChannel` fetches one window and exposes no pagination), so a
  // genuinely old target is only reachable if a newer message happens to bring
  // it into range. Actually reaching it needs real backfill (#1571).
  useEffect(() => {
    if (!pendingMessageId) return;
    // A named channel target must resolve to it first — a message id paired
    // with one channel would be nonsense to look up in another. No channel
    // was named (message-only link): proceed against whatever channel ended
    // up active.
    if (
      pendingJumpChannelId !== null &&
      activeChannelId !== pendingJumpChannelId
    ) {
      return;
    }
    if (channel.isLoading) return;
    const jumped = timeline.current?.scrollToMessage(pendingMessageId) ?? false;
    if (jumped) {
      setPendingMessageId(null);
      setPendingJumpChannelId(null);
      setUnreachableTarget(null);
    } else {
      setUnreachableTarget({
        messageId: pendingMessageId,
        channelId: activeChannelId,
      });
    }
  }, [
    pendingMessageId,
    activeChannelId,
    pendingJumpChannelId,
    channel.isLoading,
    channel.messages,
    jumpAttempt,
  ]);

  const threadParent = useMemo(() => {
    if (!threadParentId) return null;
    return channel.messages.find((m) => m.id === threadParentId) ?? null;
  }, [channel.messages, threadParentId]);
  // Captures the trigger (the row's Reply control, most often) on the way in,
  // so `closeThread` can hand focus back. The thread panel is a persistent
  // aside, not a dialog, so nothing returns focus here for free the way Radix
  // does for the slash palette — hence the manual bookkeeping, per the
  // keyboard-navigation acceptance criterion in #396.
  const openThread = useCallback((message: ChatMessage) => {
    threadTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setThreadParentId(message.id);
  }, []);
  /**
   * Stages an inline reply, **normalized to the root message** — AC 3 and
   * `spec/behavior/chat/README.md`: "Replying to a reply references the root
   * message (no deep nesting)."
   *
   * Client-side on purpose. `ChatService.createMessage` validates only that
   * `reply_to_id` names a message in the same channel, and it must stay that
   * way: `linkReplyPairs` (`supabase-discord-import.repository.ts`) writes
   * Discord's genuinely nested reply targets during an archive import, so a
   * server-side root rule would rewrite an imported thread's real shape.
   *
   * One hop is enough because every reply this client authors is already
   * root-normalized, so `parent.reply_to_id` is itself always a root. An
   * imported chain deeper than that resolves to its own parent rather than its
   * true root — accepted: chasing the chain would need messages outside the
   * loaded window, and the alternative (quoting nothing) is worse.
   */
  const startReply = useCallback((message: ChatMessage) => {
    setReplyTarget({
      channelId: message.channel_id,
      messageId: message.reply_to_id ?? message.id,
    });
  }, []);
  const cancelReply = useCallback(() => setReplyTarget(null), []);
  /**
   * Whether to offer Reply on rows in this channel at all.
   *
   * **Both halves are load-bearing, and each covers a case the other misses.**
   *
   * `can_post` — is there a composer to stage into? It is the server's own
   * capability (`ChannelAccessService.withPostCapability`), and it comes back
   * false for *two* reasons, only one of which is read-only: the other is the
   * alumni lifecycle restriction (`spec/behavior/alumni.md`). An alumnus in an
   * ordinary `PUBLIC` channel gets `is_read_only: false` and
   * `can_post: false`, so a read-only-only check leaves them a Reply chip whose
   * strip can never render — `Composer` returns the "Alumni can read this
   * channel but not post" paragraph instead of an editor. Clicking it would
   * change nothing anywhere on screen: an inert control, which
   * `spec/ui/design-system/components.md` § 5 bans outright.
   *
   * `is_read_only` — does the channel allow in-thread replies at all?
   * `spec/behavior/chat/README.md` § 253: "Announcement messages cannot be
   * replied to in-thread… it holds regardless of permissions", and
   * `ChatService.sendMessage` 400s such a send. `can_post` does not cover this,
   * because it is deliberately **true** in `#announcements` for a holder of
   * `announcements:post` — they may post a top-level announcement, and nobody
   * threads one. Without this half, that member stages a strip and the send
   * fails.
   *
   * Read off the two fields the rail actually carries rather than through
   * `@repo/validation`'s `allowsInThreadReplies`. Calling the shared predicate
   * would need a hand-built `ChannelAccessRecord`, and the fields the rail has
   * never loaded would have to be invented — `required_permissions: null` and
   * no `archived_at`. That is a projection wearing the full type: the moment
   * the predicate consults a field this literal fabricates, the call silently
   * disagrees with the server while *looking* like it cannot. This is a UX
   * pre-filter; the server is the enforcement, and it is the server's copy of
   * the rule that has to be right.
   */
  const canReplyHere =
    !!activeChannel &&
    activeChannel.can_post !== false &&
    !activeChannel.is_read_only;
  /**
   * The staged reply, resolved for the composer's strip.
   *
   * **This, not `replyTarget`, is what a send reads.** The strip the member can
   * see and the `reply_to_id` the send carries come from the *same* derivation,
   * so they cannot disagree — a reply nobody was shown they were sending is
   * ruled out by construction rather than by an effect syncing state back down
   * (which would also be a `setState` in an effect, and is what
   * `react-hooks/set-state-in-effect` is right to refuse).
   *
   * It resolves to `null` only when nothing is staged for *this* channel. A
   * staged target whose parent is not loaded still resolves — to the
   * unavailable variant — so it stays visible and dismissable.
   */
  const replyTo = useMemo(() => {
    if (!replyTarget || replyTarget.channelId !== activeChannelId) return null;
    const parent = channel.messages.find((m) => m.id === replyTarget.messageId);
    // Staged but not in the loaded window — `author: null` renders
    // `QuotedMessage`'s unavailable variant. It must NOT collapse to `null`:
    // the id is still perfectly sendable (the server validates same-channel,
    // which scoping already guarantees), so dropping the strip would leave the
    // member with a reply they can neither see nor dismiss, which then either
    // vanishes from the send or re-attaches when the parent reappears.
    //
    // Reachable, not hypothetical, in two ways: root normalization can target a
    // root older than the one window `useChatChannel` loads (#1571), and a jump
    // or backfill can re-window the list under a reply already staged.
    if (!parent) {
      return { id: replyTarget.messageId, author: null, preview: null };
    }
    return {
      id: parent.id,
      author: resolveAuthorLabel(parent, nameFor, userId),
      preview: replyPreviewText(parent),
    };
  }, [channel.messages, replyTarget, activeChannelId, nameFor, userId]);

  const closeThread = useCallback(() => {
    setThreadParentId(null);
    // The trigger is a row inside the virtualized timeline (`react-virtuoso`
    // unmounts rows scrolled out of its window), so it can have been removed
    // from the document entirely while the thread stayed open — `.focus()`
    // on a detached element is a silent no-op, which would otherwise strand
    // focus with no explanation. Fall back to the timeline landmark itself,
    // which #396 also made focusable, rather than leaving focus on nothing.
    if (threadTriggerRef.current?.isConnected) {
      threadTriggerRef.current.focus();
    } else {
      document.getElementById("chat-timeline")?.focus();
    }
    threadTriggerRef.current = null;
  }, []);

  // A screen-reader announcement for a genuinely new incoming message,
  // decoupled from `#chat-timeline`'s DOM — see the comment on that `role="log"`
  // div for why: `MessageTimeline` virtualizes, so a live region wired to its
  // subtree re-announces old messages on ordinary scrolling. This ref tracks
  // the last message this effect has already announced, per channel, so a
  // channel switch or the initial backfill load — the latest message is not
  // "new" in either of those cases — doesn't narrate the whole history.
  const lastAnnouncedRef = useRef<{
    channelId: string | null;
    messageId: string | null;
  }>({ channelId: null, messageId: null });
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  useEffect(() => {
    const latest = channel.messages.at(-1);
    if (!activeChannelId || !latest) return;
    const latestKey = latest.client_message_id ?? latest.id;
    if (lastAnnouncedRef.current.channelId !== activeChannelId) {
      lastAnnouncedRef.current = {
        channelId: activeChannelId,
        messageId: latestKey,
      };
      return;
    }
    if (lastAnnouncedRef.current.messageId === latestKey) return;
    lastAnnouncedRef.current = {
      channelId: activeChannelId,
      messageId: latestKey,
    };
    if (latest.is_deleted) return;
    const author =
      latest.sender_id === userId
        ? "You"
        : (nameFor(latest.sender_id ?? "") ?? "Someone");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- announcing a real-time arrival by comparing against the previous render's last-seen id, not syncing render state
    setLiveAnnouncement(`New message from ${author}`);
  }, [channel.messages, activeChannelId, userId, nameFor]);

  if (!activeChapterId) {
    return (
      <EmptyState
        title="No chapter selected"
        description="Pick an active chapter to load its channels and messages."
      />
    );
  }

  if (channelsQuery.isPending || categoriesQuery.isPending) {
    return <LoadingState message="Loading chapter channels…" />;
  }
  if (channelsQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load channels"
        description="Confirm your chapter access and retry."
        onRetry={() => void channelsQuery.refetch()}
      />
    );
  }
  if (channels.length === 0) {
    return (
      <EmptyState
        title="No channels yet"
        description="New chapters seed #general, #announcements, and #chapter-audit during onboarding. Ask an admin if none appear."
      />
    );
  }
  if (requestedChannelMissing) {
    return (
      <EmptyState
        title="Channel not found"
        description="This link points to a channel that's been removed, or one you no longer have access to."
        actionLabel="Browse channels"
        onAction={() => setChannelTargetDismissed(true)}
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr_300px]">
      {/*
        `dashboard-shell.tsx`'s "Skip to main content" link lands the keyboard
        user at the top of `/chat`, which is still the whole 3-pane grid —
        including the channel rail this link exists to skip past. Every visit
        this route needs re-skipping, so it earns its own target rather than
        relying on the app-shell's.
      */}
      <a href="#chat-timeline" className={SKIP_LINK_CLASSES}>
        Skip to messages
      </a>
      {/*
        Decoupled from `#chat-timeline` below on purpose — see that div's own
        comment. This is the only thing that announces a genuinely new
        message; it never mounts inside the virtualized timeline.
      */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>
      {/*
        Rails take `--surface-1` (foundations §2: "raised surface — nav bars"),
        the same step the dashboard sidebar uses, so the chat rail and the app
        rail read as the same kind of chrome.
      */}
      <section
        aria-label="Channels"
        className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-1 md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:self-start"
      >
        <header className="border-b border-border px-3 py-3">
          <h2 className="text-base font-bold text-foreground">Channels</h2>
          <p className="text-[12.5px] text-muted-foreground">
            {channels.length} channel{channels.length === 1 ? "" : "s"}
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <ChannelList
            viewerId={userId}
            memberNames={memberNames}
            channels={channels}
            categories={categories}
            unreadByChannelId={unreadByChannelId}
            activeChannelId={activeChannelId}
            onPick={(ch) => {
              setSelectedChannelId(ch.id);
              dismissThreadForChannelSwitch();
              // Deliberately leaves any pending jump target alone — it is
              // gated on its own channel and will resolve if the member
              // returns. Only the notice is channel-scoped for display.
              setUnreachableTarget(null);
            }}
          />
        </div>
      </section>

      {/*
        The thread is the app floor with the bubbles stepped above it — s05.
        Bordered rather than filled, so the pane still reads as a region.
      */}
      <section className="flex min-h-[70vh] flex-col overflow-hidden rounded-xl border border-border bg-background">
        <header className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                {activeChannel ? (
                  <>
                    <ChannelHeaderMark
                      channel={activeChannel}
                      className="h-5 w-5 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">{activeChannelName}</span>
                  </>
                ) : (
                  "Pick a channel"
                )}
              </h2>
              {activeChannel?.description ? (
                <p className="truncate text-[12.5px] text-muted-foreground">
                  {activeChannel.description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ReconnectPill status={channel.connection} />
              {activeChannel && failedChannelId === activeChannel.id ? (
                // Lives in the header, not inside the popover. The popover
                // unmounts its content when dismissed, so an alert in there is
                // only seen by a member who happens to reopen it — and keeping
                // it open until the write landed is what froze the menu when
                // TanStack paused the mutation offline. Scoped to the channel
                // the failed write was actually for: the mutation is shared by
                // the whole shell, so its bare `isError` would assert a
                // failure on channels nobody touched.
                <p role="alert" className="text-[12.5px] text-destructive">
                  Notification level not saved
                </p>
              ) : null}
              <NotificationLevelPopover
                level={
                  activeChannel
                    ? (levelByChannelId.get(activeChannel.id) ?? null)
                    : null
                }
                disabled={!activeChannel}
                isSaving={setNotificationLevel.isPending}
                onChange={(level) => {
                  if (!activeChannel) return;
                  setNotificationLevel.mutate({
                    channelId: activeChannel.id,
                    level,
                  });
                }}
              />
              <ChatSearchPopover
                activeChannelId={activeChannelId}
                channelNameFor={channelNameFor}
                nameFor={nameFor}
                onJump={jumpToSearchHit}
              />
              <PinsPopover
                messages={channel.messages}
                nameFor={nameFor}
                onJump={jumpToMessage}
              />
              {bookmarkWriteFailed ? (
                // In the header rather than inside the popover, for the reason
                // the notification-level alert beside it records: a popover
                // unmounts its content when dismissed, so an alert in there is
                // only seen by someone who happens to reopen it.
                <p role="alert" className="text-[12.5px] text-destructive">
                  {/* Covers both directions: the same alert fires for a failed
                      save and a failed removal, and "not saved" would be wrong
                      copy for the second. */}
                  Bookmark not updated
                </p>
              ) : null}
              <BookmarksPopover
                bookmarks={bookmarks}
                nameFor={nameFor}
                isLoading={bookmarksQuery.isLoading}
                isError={bookmarksQuery.isError}
                onJump={jumpToBookmark}
                onRemove={(messageId) => unbookmarkMessage.mutate(messageId)}
              />
            </div>
          </div>
          {/*
            The container is ALWAYS mounted and carries the live region; only
            its contents swap. A live region inserted into the DOM at the same
            instant it gains content is not announced by most screen readers —
            which would have left AT users with exactly the silent no-op this
            notice exists to replace, just relocated. The search popover's own
            `sr-only` region is mounted the same way.
          */}
          <div aria-live="polite" role="status">
            {showUnreachableNotice ? (
              // Dismissible because it reports a past action, not a standing
              // condition of the channel.
              <div className="mt-2 flex items-start justify-between gap-2">
                <p className="text-[12.5px] text-muted-foreground">
                  That message is older than the history loaded here, so the
                  timeline can’t jump to it yet.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    // Abandons the target, not just the notice. Clearing only
                    // the message would leave it pending, so the effect would
                    // re-raise this the moment any new message arrived — a
                    // dismiss that visibly un-dismisses itself.
                    setUnreachableTarget(null);
                    setPendingMessageId(null);
                    setPendingJumpChannelId(null);
                  }}
                >
                  Dismiss
                </Button>
              </div>
            ) : null}
          </div>
          {channel.typingUsers.length > 0 ? (
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {channel.typingUsers.length === 1
                ? "Someone is typing…"
                : `${channel.typingUsers.length} people are typing…`}
            </p>
          ) : null}
        </header>
        {/*
          Between the channel header and the timeline: "a dismissible inline
          nudge in chat" (`spec/product/modules.md` § Ops-setup nudges) without
          being *inside* the virtualized log, which would make it a row
          `react-virtuoso` can unmount. Renders `null` for everyone but an
          officer of a chapter with a nudge-eligible module switched off, so it
          costs the common case one early return.
        */}
        <OpsSetupNudge />
        {/*
          `role="log"` alone still carries an ARIA-spec *implicit* default of
          `aria-live="polite"` / `aria-relevant="additions text"` — so making
          this genuinely non-live takes an explicit `aria-live="off"`, not
          just omitting the attribute. It has to be non-live at all, because
          `MessageTimeline` virtualizes (`react-virtuoso`): scrolling back
          through history unmounts and remounts old rows exactly like a new
          message arriving, so a live region here would re-announce
          already-read messages on ordinary scrolling. `liveAnnouncement`
          below is the decoupled, non-virtualized replacement — it updates
          only when a genuinely new message lands, never on scroll.
        */}
        <div
          id="chat-timeline"
          tabIndex={-1}
          role="log"
          aria-live="off"
          aria-label="Chat timeline"
          // `FOCUS_RING`, not `FOCUS_RING_ALWAYS`: this container is a large
          // panel most of whose area is an ordinary mouse-click target (blank
          // space below the last message), not a control reached only
          // programmatically — `FOCUS_RING_ALWAYS`'s plain `focus:` would
          // leave the ring painted after a routine click into that space.
          // `focus-visible:` still shows it for the skip link's keyboard-
          // driven jump, which is the case this needs to stay visible for.
          className={cn(
            "min-h-0 flex-1 overflow-hidden rounded-md",
            FOCUS_RING,
          )}
        >
          <MessageTimeline
            ref={timeline}
            channelId={activeChannel?.id}
            nameFor={nameFor}
            messages={channel.messages}
            viewerId={userId}
            isLoading={channel.isLoading}
            loadError={channel.loadError}
            onReact={channel.react}
            onUnreact={channel.unreact}
            onReply={canReplyHere ? startReply : undefined}
            onOpenThread={openThread}
            onRetry={channel.retry}
            onDiscard={channel.discard}
            onAct={(messageId, actionType, payload) =>
              void channel.act(messageId, actionType, payload)
            }
            onEdit={channel.edit}
            onDelete={handleDeleteMessage}
            bookmarkedMessageIds={bookmarkedMessageIds}
            onToggleBookmark={handleToggleBookmark}
            canManageChannel={canManageChannel}
          />
        </div>
        {activeChannel ? (
          <Composer
            // Remounts the editor whenever the channel *or its resolved
            // display name* changes, so a baked-in-at-creation extension
            // (the Tiptap `Placeholder`) is rebuilt from the current name
            // rather than freezing a stale one — see #1014. Name alone
            // matters too, not just id: a DM's `activeChannelName` can
            // still read the `directChannelDisplayName` fallback
            // ("Direct message") at mount, before `useChapterRoster()` /
            // `useMemberDisplayNames()` resolve the participant's real
            // name a moment later — same `activeChannel.id` throughout, so
            // an id-only key would never pick up the correction. Costs
            // focus/selection per switch, and can briefly seed the fresh
            // editor from the outgoing channel's still-loading draft until
            // `useChatChannel`'s async Dexie read resolves and the
            // `draft`-sync effect below corrects it — tracked as #1497,
            // pre-existing and not introduced by this `key`.
            key={`${activeChannel.id}:${activeChannelName}`}
            channelId={activeChannel.id}
            channelName={activeChannelName}
            isDirect={
              activeChannel.type === "DM" || activeChannel.type === "GROUP_DM"
            }
            isReadOnly={!!activeChannel.is_read_only}
            // Undefined (not yet through the server's capability
            // projection) is left to `Composer`'s own default, which
            // resolves to `!isReadOnly` rather than an unconditional
            // `true` — the safe fallback for a read-only channel whose
            // `can_post` hasn't arrived yet.
            canPost={activeChannel.can_post}
            draft={channel.draft}
            onChangeDraft={channel.setDraft}
            // `replyTo?.id`, not `replyToId`: the derived target is the one the
            // member can actually see staged. Reading the raw id would let a
            // send carry a reply whose strip resolved to nothing.
            onSend={(body, attachments) => {
              const target = replyTo?.id ?? null;
              // Cleared before the await, not after: `channel.send` enqueues to
              // the Dexie outbox and resolves on its own schedule, and a strip
              // still standing after the message appears in the timeline reads
              // as "your reply didn't send" — and would silently attach itself
              // to whatever the member typed next.
              //
              // Only when the target belongs to THIS channel. Clearing
              // unconditionally reproduced the exact bug the channel-scoping
              // above exists to prevent: a member stages a reply in #general,
              // answers a ping in #random — that send wiped it — and comes back
              // to #general to a per-channel draft still in the composer and no
              // strip above it, so Enter posts the reply as a top-level message.
              if (replyTo) setReplyTarget(null);
              return channel.send(body, { replyToId: target, attachments });
            }}
            onSlashDispatch={(command: SlashCommand, args: string) =>
              channel.dispatchSlash(
                command,
                args,
                announcementsChannelId,
                resolveMember,
              )
            }
            onTyping={channel.emitTyping}
            isModuleEnabled={isModuleEnabled}
            slashCommandsStatus={slashCommandsStatus}
            onRetrySlashCommands={onRetrySlashCommands}
            // Never `disabled` while offline: the send path enqueues to the
            // Dexie outbox before it touches the network, so gating the
            // composer would defeat the queue built to make composing-while-
            // offline work (`spec/ui/resilience.md` §2). It is labelled instead.
            isOffline={channel.connection === "offline"}
            replyTo={replyTo}
            onCancelReply={cancelReply}
          />
        ) : null}
      </section>

      <aside
        aria-label="Thread"
        className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-1 md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:self-start"
      >
        {threadParent ? (
          <ThreadPanel
            nameFor={nameFor}
            channelId={threadParent.channel_id}
            parent={threadParent}
            allMessages={channel.messages}
            viewerId={userId}
            onClose={closeThread}
            onReact={channel.react}
            onUnreact={channel.unreact}
            onEdit={channel.edit}
            onDelete={handleDeleteMessage}
            bookmarkedMessageIds={bookmarkedMessageIds}
            onToggleBookmark={handleToggleBookmark}
            canManageChannel={canManageChannel}
          />
        ) : (
          <div className="px-3 py-3">
            <h2 className="text-base font-bold text-foreground">Details</h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Open the quote above a reply to collect that conversation here.
              Pinned messages live in the popover above the timeline.
            </p>
          </div>
        )}
      </aside>
      {confirmDialog}
    </div>
  );
}
