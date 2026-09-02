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
} from "@repo/hooks";
import { can } from "@repo/validation";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { asArray } from "@/lib/utils";
import { useChatChannel } from "@/lib/chat/use-chat-channel";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import type { ResolveMember } from "@repo/chat-core/dispatch";
import {
  ChannelList,
  type ChannelUnread,
  type ChatChannel,
} from "./channel-list";
import {
  MessageTimeline,
  type MessageTimelineHandle,
} from "./message-timeline";
import { Composer } from "./composer";
import { ThreadPanel } from "./thread-panel";
import { PinsPopover } from "./pins-popover";
import { ChatSearchPopover, type ChatSearchHit } from "./chat-search-popover";
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
  // Which channel `pendingMessageId` belongs to. Seeded from the URL, but
  // tracked separately from `initialChannelId` because the URL is no longer
  // the only source of a jump target: an in-shell search hit can target a
  // channel the URL never named. The jump effect used to guard directly on
  // `initialChannelId`, which meant that arriving at `/chat?channel=A` and then
  // picking a search hit in channel B left the target permanently unconsumed —
  // the guard compared the new active channel against the stale URL one and
  // returned every time. `null` means "no channel was named; jump in whatever
  // channel ends up active", which is the message-only link case.
  const [pendingChannelId, setPendingChannelId] = useState(initialChannelId);
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
    setPendingChannelId(initialChannelId);
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
  const channelNameFor = useCallback(
    (channelId: string) => {
      const found = channels.find((ch) => ch.id === channelId);
      if (!found) return null;
      return directChannelDisplayName(
        {
          name: found.name,
          type: found.type,
          member_ids: found.member_ids ?? [],
        },
        userId,
        memberNames,
      );
    },
    [channels, userId, memberNames],
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

  const { confirm, confirmDialog } = useConfirmDialog();
  const deleteMessage = channel.delete;
  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      void (async () => {
        const confirmed = await confirm({
          title: "Delete this message?",
          description:
            "This can't be undone. Everyone in the channel will see " +
            '"[message deleted]" in its place.',
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

  // Pins are a navigation affordance, not a list: the popover's rows were
  // rendered as buttons but `onJump` was never wired, so every one of them was
  // inert. The timeline exposes the scroll, the shell owns the wiring.
  const timeline = useRef<MessageTimelineHandle | null>(null);
  const jumpToMessage = useCallback((messageId: string) => {
    timeline.current?.scrollToMessage(messageId);
  }, []);

  // A search hit in the active channel is just a scroll. A hit in another
  // channel is the same "select the channel, then jump once the message is
  // actually loaded" problem a `?message=` deep link solves, so it reuses that
  // machinery (`pendingMessageId` + the jump effect below) rather than racing
  // the channel switch with its own scroll — which would fire against the
  // outgoing channel's timeline and silently do nothing.
  const jumpToSearchHit = useCallback(
    (hit: ChatSearchHit) => {
      if (hit.channelId === activeChannelId) {
        jumpToMessage(hit.message.id);
        return;
      }
      setSelectedChannelId(hit.channelId);
      setChannelTargetDismissed(false);
      setPendingMessageId(hit.message.id);
      setPendingChannelId(hit.channelId);
    },
    [activeChannelId, jumpToMessage],
  );

  // A caller-supplied `?message=` jumps to that message once it's actually
  // present in the loaded window. `pendingMessageId` (declared above,
  // resynced whenever a new target arrives) is only cleared on success — a
  // message outside the channel's initial backfill window stays pending and
  // gets a free retry as more history loads, rather than being silently
  // spent on an id `scrollToMessage` couldn't find.
  useEffect(() => {
    if (!pendingMessageId) return;
    // A named channel target must resolve to it first — a message id paired
    // with one channel would be nonsense to look up in another. No channel
    // was named (message-only link): proceed against whatever channel ended
    // up active.
    if (pendingChannelId !== null && activeChannelId !== pendingChannelId) {
      return;
    }
    if (channel.isLoading) return;
    if (!channel.messages.some((m) => m.id === pendingMessageId)) return;
    jumpToMessage(pendingMessageId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consuming a one-shot deep-link target once it's been acted on, not syncing render state
    setPendingMessageId(null);
  }, [
    pendingMessageId,
    activeChannelId,
    pendingChannelId,
    channel.isLoading,
    channel.messages,
    jumpToMessage,
  ]);

  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const threadParent = useMemo(() => {
    if (!threadParentId) return null;
    return channel.messages.find((m) => m.id === threadParentId) ?? null;
  }, [channel.messages, threadParentId]);

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
            unreadByChannelId={unreadByChannelId}
            activeChannelId={activeChannelId}
            onPick={(ch) => {
              setSelectedChannelId(ch.id);
              setThreadParentId(null);
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
            </div>
          </div>
          {channel.typingUsers.length > 0 ? (
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {channel.typingUsers.length === 1
                ? "Someone is typing…"
                : `${channel.typingUsers.length} people are typing…`}
            </p>
          ) : null}
        </header>
        <div
          className="min-h-0 flex-1 overflow-hidden"
          aria-label="Chat timeline"
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
            onOpenThread={(message) => setThreadParentId(message.id)}
            onRetry={channel.retry}
            onDiscard={channel.discard}
            onAct={(messageId, actionType, payload) =>
              void channel.act(messageId, actionType, payload)
            }
            onEdit={channel.edit}
            onDelete={handleDeleteMessage}
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
            onSend={(body, attachments) => channel.send(body, { attachments })}
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
            onClose={() => setThreadParentId(null)}
            onReact={channel.react}
            onUnreact={channel.unreact}
            onEdit={channel.edit}
            onDelete={handleDeleteMessage}
            canManageChannel={canManageChannel}
          />
        ) : (
          <div className="px-3 py-3">
            <h2 className="text-base font-bold text-foreground">Details</h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Open a message thread to see replies. Pinned messages live in the
              popover above the timeline.
            </p>
          </div>
        )}
      </aside>
      {confirmDialog}
    </div>
  );
}
