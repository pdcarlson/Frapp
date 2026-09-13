"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AuditGlyph,
  DirectMessageGlyph,
  LockGlyph,
  MuteGlyph,
} from "./chat-glyphs";
import { EmptyState, ErrorState } from "@/components/shared/async-states";
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
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { asArray, cn } from "@/lib/utils";
import { useChatChannel } from "@/lib/chat/use-chat-channel";
import { useToast } from "@/hooks/use-toast";
import * as Sentry from "@sentry/nextjs";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import type { ResolveMember } from "@repo/chat-core/dispatch";
import type { ChatMessage } from "@repo/chat-core/types";
import { FOCUS_RING, SKIP_LINK_CLASSES } from "@/components/ui/focus";
import {
  ChannelList,
  ChannelListSkeleton,
  type ChannelCategory,
  type ChannelUnread,
  type ChatChannel,
} from "./channel-list";
import {
  MessageTimeline,
  MessageTimelineSkeleton,
  type MessageTimelineHandle,
} from "./message-timeline";
import {
  Composer,
  ComposerSkeleton,
  notifyDispatchOutcome,
} from "./composer";
import { DELETED_MESSAGE_PLACEHOLDER } from "./message-placeholders";
import { replyPreviewText } from "./reply-quote";
import { OpsSetupNudge } from "./ops-setup-nudge";
import { ChannelMenu } from "./channel-menu";
import type { ChatSearchHit } from "./chat-search-popover";
import type { BookmarkEntry } from "./bookmarks-popover";
import { ReconnectPill } from "./reconnect-pill";
import { CHAT_CONTROL_CLASS } from "./chip";
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
 * The chat surface: channels column, then thread and composer.
 *
 * **Two columns, flush, full height** (`1b`). It was three, the third being a
 * Details rail that hosted `ThreadPanel` over a static placeholder. Both are
 * deleted. Where threads went: the quote above a reply, which was the panel's
 * only remaining entry point, now scrolls this timeline to the message it
 * quotes (`MessageItem`'s `onJumpToParent`). The reasoning is recorded in
 * `spec/ui/web-greenfield/deletion-checklist.md` §2.
 *
 * **The panes are not cards, and that is load-bearing.** They used to be
 * `<Card>`s, so the whole surface painted `--card` — and `components.md` §11
 * specs the incoming bubble as `--card` with a hairline. A card on a card is
 * `#1E1B17` on `#1E1B17`: the bubble simply would not have existed. The
 * reference resolves it the other way round (`canvas-screens.dc.html` s05):
 * the thread sits on `--background`, the app floor, and the bubbles are the
 * step above it. The channels column is `--surface-1`, the ladder step foundations
 * §2 assigns to nav chrome, which is what the sidebar already uses.
 *
 * Every async branch renders an explicit state, and none of them replaces the
 * route: they render inside the thread column with the frame already up, which
 * is what the board's first-paint contract asks for. The no-chapter branch was
 * the last exception and is one too, as of #2145.
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
  // **Nothing waits for it either.** Chat used to gate the whole shell on
  // `categoriesQuery.isPending`, which bought a rail that painted grouped on
  // first render rather than flat-then-reflowed, and charged every cold load
  // the query provider's `retry: 3` backoff for it. The framework board's
  // first-paint contract (`1s`) prices that the other way round: it lists the
  // gate under "delete" and accepts the reflow in as many words, "Categories
  // regroup only below the fold or on next visit". So a pending fetch renders
  // `[]`, which is the same flat rail the failed fetch degrades to.
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
  /**
   * Which of the two columns is on screen below `lg`.
   *
   * The shell's responsive contract is two states switching once at `lg`
   * (`deletion-checklist.md` §5), and chat has to hold it: below `lg` the app
   * nav is a drawer and `<main>` is the whole viewport, so a 240px channels
   * column beside the thread leaves the thread about 135px wide at the
   * documented 375px floor. That is not a narrow layout, it is an unusable one,
   * and it clears the floor's horizontal-scroll check while failing what the
   * check is for.
   *
   * So below `lg` exactly one column renders, the way every chat client on a
   * phone does it. At `lg` and up both are always visible and this is inert.
   *
   * Defaults to the thread rather than the list: a channel is always resolved
   * (the rail falls back to #general), and a `?message=` deep link must land on
   * the message rather than on a list the member then has to navigate out of.
   */
  const [narrowPane, setNarrowPane] = useState<"channels" | "thread">("thread");

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
    // The route does not remount on a search-param change, so below `lg` the
    // member can be looking at the channels column when a link lands. Showing
    // the thread is the whole point of following one.
    //
    // Conditional, unlike the six above: a URL that clears back to `/chat`
    // names no target, and yanking someone off the channel list they are
    // reading is not what "no target" should mean.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing to the URL, the external system this whole effect exists to follow; the six setState calls above it are the same act
    if (initialChannelId) setNarrowPane("thread");
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
  const { toast } = useToast();

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
  // write was actually for. Do not `reset()` on channel change: wiring that
  // effect to `isError` cleared the alert on the channel that failed, and an
  // unconditional reset detached in-flight writes. `failedChannelId ===
  // activeChannel.id` is enough — returning to the failed channel still
  // shows the error, which is honest.
  const failedChannelId = setNotificationLevel.isError
    ? setNotificationLevel.variables?.channelId
    : undefined;

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
   * `selectedChannelId` directly without going through any switch handler.
   * Scoping makes it structural rather than a cleanup every future switch path
   * has to remember.
   */

  const [replyTarget, setReplyTarget] = useState<{
    channelId: string;
    messageId: string;
  } | null>(null);
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
    const reached = timeline.current?.scrollToMessage(messageId);
    // Keyboard focus has to go somewhere the scroll can't take away. Every
    // trigger that lands here is inside the virtualized timeline or inside a
    // popover that closes behind the jump, so `react-virtuoso` unmounts the
    // focused element the moment the list scrolls and focus falls to `<body>` —
    // the next Tab starts from the top of the document. The landmark is the
    // destination anyway, and #396 made it focusable for exactly this.
    if (reached) document.getElementById("chat-timeline")?.focus();
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
      }
      setUnreachableTarget(null);
      setPendingMessageId(messageId);
      setPendingJumpChannelId(channelId);
      setJumpAttempt((n) => n + 1);
      // Below `lg` the thread column may be off-screen. Jumping into a
      // `display:none` column consumes the target — `scrollToMessage` finds the
      // index, reports success, and the pending state clears — while nothing
      // visibly happens, so the link reads as broken.
      setNarrowPane("thread");
    },
    [activeChannelId, refetchChannels],
  );

  // The channel's effective notification level, or `null` when it is not known
  // yet. Read once here because two places need it: the mute mark beside the
  // channel name, and the panel behind `⋯`.
  const activeChannelLevel = activeChannelId
    ? (levelByChannelId.get(activeChannelId) ?? null)
    : null;

  /** Search hit (#469) — the panel carries the channel on every row. */
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

  /*
    From here the frame renders FIRST and every state renders inside it.

    The board's first-paint contract (`1s`) paints "nav, top bar, chapter name,
    channel column chrome, composer shell" at 0ms, and its delete list names
    exactly what used to stop that here: "the `categoriesQuery.isPending` gate
    on the whole shell; the shell-level LoadingState card". Both are gone.

    - **Categories no longer gate anything.** `asArray` already turned an absent
      payload into `[]`, so a pending fetch renders the flat rail and the groups
      land when they land. `1s` asks for precisely that ("Categories regroup only
      below the fold or on next visit"). The old gate bought a rail that never
      reflowed, and charged every cold load the query provider's `retry: 3`
      backoff for it.
    - **A whole-route loading card is the opposite of the contract**: it makes
      the channel column paint last rather than first. Channel rows shimmer in
      their own geometry instead, and the channel column's chrome is up
      immediately either way.

    No gate survives. "No chapter yet" used to be one — see `channelsPaneState`
    below for why it is now a state the frame renders rather than a return that
    replaces it.
  */
  /*
    Keyed off what we HAVE, not off `isError`. TanStack Query keeps the last
    good `data` when a *background refetch* fails, so branching on `isError`
    first would blank a rail the member is actively using — and unmount the
    timeline with it — because one refetch 502'd during an API restart. The
    error state is for having nothing to show. `levelByChannelId` above records
    the same reasoning for the same reason; this is that rule applied to the
    list itself.
  */
  /*
    `no-chapter` is LAST, and the ordering is the whole correctness of this
    variable.

    The state exists because `/chat` used to server-render a lone 208px "No
    chapter selected" card with no channel column at all — `activeChapterId`
    comes from a persisted zustand store that initializes to `null`, so in the
    server-rendered HTML a member WITH a chapter was indistinguishable from one
    without, and hydration replaced the card with the whole two-column frame.
    That was the largest layout shift on the route and it fired on every cold
    load. `1s` puts "channel column chrome" in the 0ms set and budgets zero CLS
    above the composer; a card that becomes a layout is the opposite of both.

    The first attempt at this put `no-chapter` first, which was wrong in a way
    worth recording. `useChannels()` takes no chapter argument — no `enabled`
    gate, and `["channels"]` as its whole query key (`packages/hooks/src/use-chat.ts`)
    — and `chapter.guard.ts` resolves a sole membership server-side, so the
    channel list arrives perfectly well while this store field is still null.
    Short-circuiting on the field therefore said "no chapter" over the top of
    real data: the rail and timeline stayed hidden while `activeChannel` (derived
    from `channels`, not from the chapter id) resolved anyway, so the member got
    a live composer under a "Pick an active chapter" card with no timeline — able
    to send into #general, never shown the result, and `markChannelRead` stamping
    their cursor for messages that were never on screen.

    So the list decides. Having channels means ready, whatever the store says;
    "no chapter" is only reached once the query has settled with nothing, where
    it is a terminal explanation rather than a guess about a load still in
    flight. That also removes the need to choose a placeholder for it: a cold
    load is `loading` — `isPending` is true on the server and through hydration —
    so the frame and its skeletons are what render at 0ms, which is what the
    contract asked for in the first place.

    Gating any of this on the store's `hasHydrated` was considered and rejected;
    `profile-panel.tsx` records why at length. That flag never becomes true when
    `localStorage` access throws (privacy modes, blocked site data), so it would
    pin a permanent placeholder onto exactly the members for whom "no active
    chapter" is actually true. Nothing here waits on a flag.
  */
  const channelsPaneState =
    channels.length > 0
      ? "ready"
      : channelsQuery.isPending
        ? "loading"
        : channelsQuery.isError
          ? "error"
          : !activeChapterId
            ? "no-chapter"
            : "empty";
  const timelineReady = channelsPaneState === "ready" && !requestedChannelMissing;

  return (
    /*
      Flush columns, 100vh, independent scroll (`1b` — the board counts the app
      nav as the third; this route owns the other two). The route is
      full-bleed (`layout/full-bleed-routes.ts`), so this sits directly in the
      shell's `<main>` with no inset: the channels column hugs the nav's right
      border, and `h-full` here is the shell's fixed frame rather than a
      document that grows.

      The panes no longer carry `rounded-xl` card chrome, `gap-4` between them,
      or `md:sticky` rail positioning. They are flush columns divided by
      hairlines, and each owns its own scroll because the page has none.
    */
    <div className="flex h-full min-h-0">
      {/*
        `dashboard-shell.tsx`'s "Skip to main content" link lands the keyboard
        user at the top of `/chat`, which is still the whole layout, including
        the channel column this link exists to skip past. Every visit to this
        route needs re-skipping, so it earns its own target. Only offered when
        there is a timeline to land on.
      */}
      {timelineReady ? (
        <a href="#chat-timeline" className={SKIP_LINK_CLASSES}>
          Skip to messages
        </a>
      ) : null}
      {/*
        Decoupled from `#chat-timeline` below on purpose - see that div's own
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
        The cold load, announced once.

        The deleted whole-route `LoadingState` carried `role="status"`,
        `aria-busy` and a visible caption, so a screen-reader user was told the
        channels were loading; `ChannelListSkeleton` is `aria-hidden` (eight
        anonymous rectangles are no use to anyone), so the window would
        otherwise be silent.

        Two things this is deliberately NOT. It is not `role="status"` on the
        list's own container: that role implies `aria-atomic`, so every unread
        badge `useChannelUnreadCounts` repaints would re-read the entire channel
        list aloud — the same defect `#chat-timeline`'s `aria-live="off"` exists
        to prevent, one column over. And it is not inside the channels column,
        which `narrowPane` hides below `lg` — the announcement has to survive the
        viewport where the skeleton itself is off-screen.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {channelsPaneState === "loading" ? "Loading channels" : ""}
      </div>
      {/*
        Channels: 240px, full height, its own scroll, no search field (`1b`
        pin 5). `--surface-1` is the same step the app nav takes, so the two
        columns read as one continuous piece of chrome with a hairline between
        them rather than as a rail floating beside a page.
      */}
      <section
        aria-label="Channels"
        className={cn(
          "flex min-h-0 flex-col border-r border-border bg-surface-1",
          // Full width below `lg`, where it is the only column on screen.
          "w-full lg:w-60 lg:shrink-0",
          narrowPane === "thread" && "max-lg:hidden",
        )}
      >
        {/*
          48px, matching the top bar and the channel header beside it, so the
          three headers line up across the whole route (`3a` geometry: "Top bar,
          column headers 48"). The "N channels" count that used to sit under the
          title is deleted (`1t`) - it restated the length of a list already on
          screen.
        */}
        <header className="flex h-12 shrink-0 items-center border-b border-border px-3">
          <h2 className="text-sm font-semibold text-foreground">Channels</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {/*
            Only `loading` shimmers, and `no-chapter` deliberately does not.

            `loading` is now the state a cold load actually renders — see
            `channelsPaneState` above — so this is the placeholder that carries
            the contract's "channel column chrome" clause, and it resolves the
            moment the list arrives. `no-chapter` is terminal by construction:
            the query has already settled with nothing, so a placeholder there
            would have no exit and would shimmer for as long as the tab stayed
            open. That is the same defect `profile-panel.tsx` rejects
            `hasHydrated` for, reached from the other side.
          */}
          {channelsPaneState === "loading" ? <ChannelListSkeleton /> : null}
          {channelsPaneState === "ready" ? (
            <ChannelList
              viewerId={userId}
              memberNames={memberNames}
              channels={channels}
              categories={categories}
              unreadByChannelId={unreadByChannelId}
              activeChannelId={activeChannelId}
              onPick={(ch) => {
                setSelectedChannelId(ch.id);
                // Below `lg` the list and the thread are never both on screen,
                // so picking has to navigate. Inert at `lg` and up.
                setNarrowPane("thread");
                // Deliberately leaves any pending jump target alone - it is
                // gated on its own channel and will resolve if the member
                // returns. Only the notice is channel-scoped for display.
                setUnreachableTarget(null);
              }}
            />
          ) : null}
        </div>
      </section>

      {/*
        The thread column is the app floor, with bubbles stepped above it (s05).
        No border of its own: the channels column's right hairline is the only
        division, and the composer pins to the bottom of this column, which is
        the bottom of the viewport.
      */}
      <section
        className={cn(
          "flex min-w-0 flex-1 flex-col bg-background",
          narrowPane === "channels" && "max-lg:hidden",
        )}
      >
        {/*
          48px, one row (`1b` pin 11). The name, its description and the one
          overflow control share the row; anything that cannot fit in 48px and
          is not chrome moved below it. Four popover triggers used to live here
          and are now behind `ChannelMenu`'s single `⋯`.
        */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          {/*
            Below `lg` this is the only way back to the list, because the list
            is not on screen. Hidden at `lg`, where both columns are.
          */}
          {/*
            Only when there is a list to go back to. With no channels, or a
            channel list that failed to load, the channels column renders its
            header over an empty scroll area — and since the only control that
            comes back is a channel row, Back would strand the member on a blank
            pane with the Retry button out of reach in the column they left.
          */}
          {channelsPaneState === "ready" ? (
            <Button
              variant="ghost"
              size="icon"
              className={cn(CHAT_CONTROL_CLASS, "shrink-0 lg:hidden")}
              onClick={() => setNarrowPane("channels")}
              aria-label="Back to channels"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : null}
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {/*
              `h1`, not `h2`. This was correctly a sub-heading while the
              dashboard shell rendered an `<h1>Chat</h1>` above it; #2141
              deleted that, so the channel name is now the top heading on
              this route - and it IS the page's title here, the way a chat
              app names a screen. Left as `h2` the route would start its
              outline at level 2, and a screen-reader user jumping by
              heading level 1 would land nowhere.
              Styling is explicit, so the tag change is visually identical.
            */}
            {/*
              `min-w-0`, and deliberately NOT `shrink-0`: the `truncate` on the
              name below only bites if this flex item is allowed to shrink below
              its content. With `shrink-0` a long channel name simply overflows
              and paints under the `⋯` trigger beside it.
            */}
            <h1 className="flex min-w-0 items-center gap-2 text-[15px] font-bold text-foreground">
              {activeChannel ? (
                <>
                  <ChannelHeaderMark
                    channel={activeChannel}
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">{activeChannelName}</span>
                  {/*
                    Muting used to be readable without opening anything: the
                    notification popover's trigger named it in its `aria-label`
                    ("Notifications: muted"). That trigger is now behind `⋯`, so
                    the state moves here rather than being lost - a muted
                    channel must not look identical to an unmuted one.
                  */}
                  {activeChannelLevel === "off" ? (
                    <>
                      <MuteGlyph
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        active
                      />
                      {/*
                        Every duotone glyph is `aria-hidden` (`ui/duotone.tsx`),
                        so the mark alone would restate the deleted trigger's
                        `aria-label` for sighted members only — which is most of
                        the point missed. `channel-list.tsx` pairs its own
                        `MuteGlyph` the same way.
                      */}
                      <span className="sr-only">Muted</span>
                    </>
                  ) : null}
                </>
              ) : (
                "Pick a channel"
              )}
            </h1>
            {activeChannel?.description ? (
              <p className="truncate text-[12.5px] text-muted-foreground">
                {activeChannel.description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ReconnectPill status={channel.connection} />
            <ChannelMenu
              activeChannelId={activeChannelId}
              messages={channel.messages}
              nameFor={nameFor}
              channelNameFor={channelNameFor}
              onJumpToMessage={jumpToMessage}
              onJumpToSearchHit={jumpToSearchHit}
              onJumpToBookmark={jumpToBookmark}
              bookmarks={bookmarks}
              bookmarksLoading={bookmarksQuery.isLoading}
              bookmarksError={bookmarksQuery.isError}
              onRemoveBookmark={(messageId) =>
                unbookmarkMessage.mutate(messageId)
              }
              notificationLevel={activeChannelLevel}
              notificationSaving={setNotificationLevel.isPending}
              onChangeNotificationLevel={(level) => {
                if (!activeChannel) return;
                setNotificationLevel.mutate({
                  channelId: activeChannel.id,
                  level,
                });
              }}
            />
          </div>
        </header>
        {/*
          Status strip, directly under the 48px header rather than inside it.

          Both `role="alert"` lines are here rather than inside the menu for the
          reason they were never inside their own popovers: a popover unmounts
          its content when dismissed, so an alert in there is only seen by a
          member who happens to reopen it. Behind `⋯` that is now strictly
          worse, since the control itself is out of sight too.

          The unreachable-target container is ALWAYS mounted and carries the
          live region; only its contents swap. A live region inserted into the
          DOM at the same instant it gains content is not announced by most
          screen readers - which would have left AT users with exactly the
          silent no-op this notice exists to replace, just relocated.
        */}
        <div className="shrink-0 empty:hidden">
          {activeChannel && failedChannelId === activeChannel.id ? (
            // Scoped to the channel the failed write was actually for: the
            // mutation is shared by the whole shell, so its bare `isError`
            // would assert a failure on channels nobody touched.
            <p
              role="alert"
              className="border-b border-border px-4 py-1.5 text-[12.5px] text-destructive"
            >
              Notification level not saved
            </p>
          ) : null}
          {bookmarkWriteFailed ? (
            <p
              role="alert"
              className="border-b border-border px-4 py-1.5 text-[12.5px] text-destructive"
            >
              {/* Covers both directions: the same alert fires for a failed
                  save and a failed removal, and "not saved" would be wrong
                  copy for the second. */}
              Bookmark not updated
            </p>
          ) : null}
          <div aria-live="polite" role="status">
            {showUnreachableNotice ? (
              // Dismissible because it reports a past action, not a standing
              // condition of the channel.
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5">
                <p className="text-[12.5px] text-muted-foreground">
                  That message is older than the history loaded here.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    // Abandons the target, not just the notice. Clearing only
                    // the message would leave it pending, so the effect would
                    // re-raise this the moment any new message arrived - a
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
        </div>
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
          The four states that used to replace the whole route now render inside
          this column, so the channels column beside them stays usable: a member
          who cannot load #general can still see and pick another channel. FITFO
          copy, per `3b`: the status line is the title and stays under six words,
          with a short second line and one action.

          `no-chapter` joined them in #2145 and is the one that fires on the
          happy path — see `channelsPaneState` above.
        */}
        {channelsPaneState === "no-chapter" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {/*
              Phrased as an instruction, not as a claim about the account, and
              `profile-panel.tsx` owns the reasoning: this copy is on screen both
              before the store rehydrates and when the member really has no
              chapter, so "Pick an active chapter" is true in both where "you
              have no chapter" would be a confident falsehood in one.
            */}
            <EmptyState
              title="No chapter selected"
              description="Pick an active chapter to load its channels."
            />
          </div>
        ) : null}
        {channelsPaneState === "error" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <ErrorState
              title="Couldn't load channels"
              description="Check your chapter access."
              onRetry={() => void channelsQuery.refetch()}
            />
          </div>
        ) : null}
        {channelsPaneState === "empty" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <EmptyState
              title="No channels yet"
              description="Onboarding seeds them. Ask an admin."
            />
          </div>
        ) : null}
        {channelsPaneState === "ready" && requestedChannelMissing ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <EmptyState
              title="Channel not found"
              description="That link points somewhere you can't reach."
              actionLabel="Browse channels"
              onAction={() => {
                setChannelTargetDismissed(true);
                // Below `lg` the list is a separate pane, so a control named
                // "Browse channels" has to actually show it. Dismissing alone
                // resolved the #general fallback and painted a timeline, which
                // is a different channel rather than a list.
                setNarrowPane("channels");
              }}
            />
          </div>
        ) : null}
        {channelsPaneState === "loading" ? (
          /*
            Reserved geometry, not a card: `1s` wants the shell and the composer
            shell up while the tail fills in, and a bordered loading panel here
            would be one more thing to swap out on arrival.

            It draws the same skeleton `MessageTimeline` draws one state later,
            and sharing it is the point rather than a convenience. A cold load
            crosses both branches — channels pending here, then messages pending
            there — and while this was a blank `<div>` the crossing was itself a
            shift: an empty column became ten rows of placeholder became ten rows
            of text. Now only the last of those three is a change.
          */
          <>
            <div className="min-h-0 flex-1">
              {/*
                Bare, unlike `MessageTimeline`'s use of the same skeleton, which
                pairs it with a "Loading messages" region. Here the channel list
                is what is loading, and the announcer above already says so —
                adding a second region would read one event twice.
              */}
              <MessageTimelineSkeleton />
            </div>
            {/*
              The composer's box, held open while the channel list resolves.
              Without it the bottom-aligned skeleton above sits flush against the
              viewport and every row jumps when `<Composer>` finally mounts —
              `ComposerSkeleton` owns why, and owns the geometry.
            */}
            <ComposerSkeleton />
          </>
        ) : null}
        {timelineReady ? (
        <>
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
            // The quote above a reply scrolls to the message it quotes. It used
            // to open `ThreadPanel` in the Details rail; #2142 deleted both, and
            // this is the same machinery pins and saved messages already use.
            onJumpToParent={(message) => jumpToMessage(message.id)}
            onRetry={channel.retry}
            onDiscard={channel.discard}
            // Heavy-command rows bypass the outbox, so `channel.retry` above
            // cannot reach them. This replays the original request under its
            // original idempotency key and toasts the outcome through the same
            // three-way channel a first dispatch uses (#1733).
            onRetryUnconfirmed={async (replay) => {
              // Every path here must end in a toast. The first dispatch gets
              // that guarantee from `runDispatch` in the composer (which also
              // tags Sentry); this control sits in the timeline and had
              // neither, so a throw produced a blinking spinner, no message,
              // and no telemetry — and an officer who concludes Retry is broken
              // re-types the command, mints a fresh key and double-grants.
              try {
                const result = await channel.retryUnconfirmed(replay);
                notifyDispatchOutcome(toast, replay.command, result);
              } catch (error) {
                Sentry.captureException(error, {
                  tags: { slash_command: `${replay.command}_retry` },
                });
                // Non-destructive on purpose: the retry failing says nothing
                // about whether the original attempt committed, and a red
                // "failed" is what invites the re-type.
                toast({
                  title: "Couldn't retry that command",
                  description:
                    "The retry didn't go through. Check the points ledger before running the command again. A second run would record the points twice.",
                });
              }
            }}
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
        {/*
          Directly above the composer, which is where Discord and Slack both put
          it and where a 48px header has no room for it. Reserves no space when
          nobody is typing: it is transient status, and a permanently reserved
          strip would push the composer down by a line on every channel.
        */}
        {channel.typingUsers.length > 0 ? (
          <p className="shrink-0 px-4 pb-1 text-[12.5px] text-muted-foreground">
            {channel.typingUsers.length === 1
              ? "Someone is typing…"
              : `${channel.typingUsers.length} people are typing…`}
          </p>
        ) : null}
        </>
        ) : null}
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
            recruitmentVocab={orgConfig.data?.vocabulary?.recruitment}
            slashCommandsStatus={slashCommandsStatus}
            onRetrySlashCommands={onRetrySlashCommands}
            // Never `disabled` while offline: the send path enqueues to the
            // Dexie outbox before it touches the network, so gating the
            // composer would defeat the queue built to make composing-while-
            // offline work (`spec/ui/resilience/connection-state.md`). It is labelled instead.
            isOffline={channel.connection === "offline"}
            replyTo={replyTo}
            onCancelReply={cancelReply}
          />
        ) : null}
      </section>

      {confirmDialog}
    </div>
  );
}
