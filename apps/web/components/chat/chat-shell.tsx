"use client";

import { useEffect, useMemo, useState } from "react";
import { Hash, Lock, MessagesSquare, ShieldAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { useChannels, useCategories } from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useOrgConfig } from "@/lib/hooks/use-org-config";
import { asArray } from "@/lib/utils";
import { useChatChannel } from "@/lib/chat/use-chat-channel";
import { ChannelList, type ChatChannel } from "./channel-list";
import { MessageTimeline } from "./message-timeline";
import { Composer } from "./composer";
import { ThreadPanel } from "./thread-panel";
import { PinsPopover } from "./pins-popover";
import { ReconnectPill } from "./reconnect-pill";
import type { ChatMessage } from "@/lib/chat/types";
import type { SlashCommand } from "@repo/chat-integrations";

function channelHeaderIcon(channel: ChatChannel | null) {
  if (!channel) return Hash;
  if (channel.name === "chapter-audit") return ShieldAlert;
  if (channel.type === "DM" || channel.type === "GROUP_DM")
    return MessagesSquare;
  if (channel.type === "PRIVATE" || channel.type === "ROLE_GATED") return Lock;
  return Hash;
}

/**
 * The 3-pane chat surface. The left and right panes are static cards; the
 * center pane composes timeline + composer + reconnect pill. Every async
 * branch (no-chapter, channels-loading, channels-error, no-channels) renders
 * an explicit state.
 */
export function ChatShell() {
  const activeChapterId = useChapterStore((state) => state.activeChapterId);
  const { userId } = useFrappUser();
  const orgConfig = useOrgConfig();

  const channelsQuery = useChannels();
  const categoriesQuery = useCategories();
  const channels = useMemo(
    () => asArray<ChatChannel>(channelsQuery.data),
    [channelsQuery.data],
  );

  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  useEffect(() => {
    if (activeChannelId && channels.some((ch) => ch.id === activeChannelId)) {
      return;
    }
    if (channels.length > 0) {
      const first =
        channels.find((ch) => ch.name === "general") ?? channels[0]!;
      setActiveChannelId(first.id);
    } else {
      setActiveChannelId(null);
    }
  }, [activeChannelId, channels]);

  const activeChannel = useMemo(
    () => channels.find((ch) => ch.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  const announcementsChannelId = useMemo(
    () => channels.find((ch) => ch.name === "announcements")?.id ?? null,
    [channels],
  );

  const channel = useChatChannel(activeChannelId);

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

  const [threadParent, setThreadParent] = useState<ChatMessage | null>(null);
  // Keep the open thread in sync with the cache (e.g. message edits/deletes).
  useEffect(() => {
    if (!threadParent) return;
    const next = channel.messages.find((m) => m.id === threadParent.id);
    if (!next) {
      setThreadParent(null);
    } else if (next !== threadParent) {
      setThreadParent(next);
    }
  }, [channel.messages, threadParent]);

  if (!activeChapterId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Chat</CardTitle>
          <CardDescription>
            Select an active chapter to load channels and messages.
          </CardDescription>
        </CardHeader>
      </Card>
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

  const HeaderIcon = channelHeaderIcon(activeChannel);

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr_300px]">
      <Card className="md:sticky md:top-20 md:self-start">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Channels</CardTitle>
          <CardDescription className="text-xs">
            {channels.length} channel{channels.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-[70vh] overflow-y-auto">
          <ChannelList
            channels={channels}
            activeChannelId={activeChannelId}
            onPick={(ch) => {
              setActiveChannelId(ch.id);
              setThreadParent(null);
            }}
          />
        </CardContent>
      </Card>

      <Card className="flex min-h-[70vh] flex-col">
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                {activeChannel ? (
                  <>
                    <HeaderIcon className="h-4 w-4" />
                    <span className="truncate">{activeChannel.name}</span>
                  </>
                ) : (
                  "Pick a channel"
                )}
              </CardTitle>
              {activeChannel?.description ? (
                <CardDescription className="truncate">
                  {activeChannel.description}
                </CardDescription>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <ReconnectPill status={channel.connection} />
              <PinsPopover messages={channel.messages} />
            </div>
          </div>
          {channel.typingUsers.length > 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {channel.typingUsers.length === 1
                ? "Someone is typing…"
                : `${channel.typingUsers.length} people are typing…`}
            </p>
          ) : null}
        </CardHeader>
        <div className="flex-1 overflow-hidden" aria-label="Chat timeline">
          <MessageTimeline
            messages={channel.messages}
            viewerId={userId}
            isLoading={channel.isLoading}
            loadError={channel.loadError}
            onReact={channel.react}
            onUnreact={channel.unreact}
            onOpenThread={(message) => setThreadParent(message)}
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
            channelName={activeChannel.name}
            isReadOnly={!!activeChannel.is_read_only}
            draft={channel.draft}
            onChangeDraft={channel.setDraft}
            onSend={(body) => channel.send(body)}
            onSlashDispatch={(command: SlashCommand, args: string) =>
              channel.dispatchSlash(command, args, announcementsChannelId)
            }
            onTyping={channel.emitTyping}
            isModuleEnabled={isModuleEnabled}
            slashCommandsStatus={slashCommandsStatus}
            onRetrySlashCommands={onRetrySlashCommands}
            disabled={channel.connection === "offline"}
          />
        ) : null}
      </Card>

      <Card className="md:sticky md:top-20 md:self-start">
        {threadParent ? (
          <ThreadPanel
            parent={threadParent}
            allMessages={channel.messages}
            viewerId={userId}
            onClose={() => setThreadParent(null)}
            onReact={channel.react}
            onUnreact={channel.unreact}
          />
        ) : (
          <>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Details</CardTitle>
              <CardDescription className="text-xs">
                Open a message thread to see replies. Pinned messages live in
                the popover above the timeline.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              No thread open.
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
