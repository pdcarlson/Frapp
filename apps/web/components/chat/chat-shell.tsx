"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AuditGlyph,
  DirectMessageGlyph,
  LockGlyph,
} from "./chat-glyphs";
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
  useOrgConfig,
} from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { asArray } from "@/lib/utils";
import { useChatChannel } from "@/lib/chat/use-chat-channel";
import type { ResolveMember } from "@repo/chat-core/dispatch";
import {
  ChannelList,
  type ChannelUnread,
  type ChatChannel,
} from "./channel-list";
import { MessageTimeline, type MessageTimelineHandle } from "./message-timeline";
import { Composer } from "./composer";
import { ThreadPanel } from "./thread-panel";
import { PinsPopover } from "./pins-popover";
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
export function ChatShell() {
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
    // On error, leave the map empty rather than guessing. Every channel then
    // reads at its default (`mentions`), which is what an un-configured account
    // genuinely looks like — the failure mode is a control that shows the
    // default, not one that claims a channel is muted when it is not.
    if (notificationPrefsQuery.isError || !notificationPrefsQuery.data) {
      return map;
    }
    for (const row of notificationPrefsQuery.data) {
      map.set(row.channel_id, row.level);
    }
    return map;
  }, [notificationPrefsQuery.data, notificationPrefsQuery.isError]);

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

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );
  const activeChannelId = useMemo(() => {
    if (
      selectedChannelId &&
      channels.some((ch) => ch.id === selectedChannelId)
    ) {
      return selectedChannelId;
    }
    if (channels.length === 0) return null;
    return channels.find((ch) => ch.name === "general")?.id ?? channels[0]!.id;
  }, [selectedChannelId, channels]);

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

  // Opening a channel stamps the read cursor — the only thing that moves it, and
  // the only thing that clears the badges above. Without it the rail lights up
  // on first load and never goes out, which is worse than the dead badge this
  // slice replaced: it would show every channel as permanently unread.
  // `spec/behavior/chat/README.md` § Read Receipts: opening stamps to server
  // `now()`; there is no mark-read-to-a-message.
  const setNotificationLevel = useSetChannelNotificationLevel();
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
        | { isModuleEnabled?: (k: string) => boolean }
        | undefined;
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
              <NotificationLevelPopover
                level={
                  activeChannel
                    ? (levelByChannelId.get(activeChannel.id) ?? "mentions")
                    : "mentions"
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
        <div className="min-h-0 flex-1 overflow-hidden" aria-label="Chat timeline">
          <MessageTimeline
            ref={timeline}
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
          />
        </div>
        {activeChannel ? (
          <Composer
            channelId={activeChannel.id}
            channelName={activeChannelName}
            isDirect={
              activeChannel.type === "DM" || activeChannel.type === "GROUP_DM"
            }
            isReadOnly={!!activeChannel.is_read_only}
            draft={channel.draft}
            onChangeDraft={channel.setDraft}
            onSend={(body, attachments) =>
              channel.send(body, { attachments })
            }
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
            parent={threadParent}
            allMessages={channel.messages}
            viewerId={userId}
            onClose={() => setThreadParentId(null)}
            onReact={channel.react}
            onUnreact={channel.unreact}
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
    </div>
  );
}
