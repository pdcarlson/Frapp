"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CornerDownRight,
  Hash,
  Lock,
  MessagesSquare,
  Pin,
  Pin as PinIcon,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserSquare2,
} from "lucide-react";
import {
  useChannels,
  useCategories,
  useDeleteMessage,
  useMarkChannelRead,
  useMessages,
  usePinMessage,
  usePinnedMessages,
  useSearch,
  useSendMessage,
  useToggleReaction,
  useUnpinMessage,
} from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { useToast } from "@/hooks/use-toast";
import { asArray } from "@/lib/utils";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useChapterStore } from "@/lib/stores/chapter-store";

type Channel = {
  id: string;
  chapter_id: string;
  name: string;
  description?: string | null;
  type: "PUBLIC" | "PRIVATE" | "ROLE_GATED" | "DM" | "GROUP_DM";
  category_id?: string | null;
  is_read_only: boolean;
};

type Category = {
  id: string;
  chapter_id: string;
  name: string;
  display_order: number;
};

type Message = {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  type: "TEXT" | "POLL";
  reply_to_id?: string | null;
  metadata?: Record<string, unknown> | null;
  is_pinned: boolean;
  pinned_at?: string | null;
  edited_at?: string | null;
  is_deleted: boolean;
  created_at: string;
};

const QUICK_REACTIONS = ["👍", "🎉", "❤️", "😂", "🔥"];

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

function formatClock(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

function channelIcon(type: Channel["type"]) {
  switch (type) {
    case "DM":
    case "GROUP_DM":
      return UserSquare2;
    case "PRIVATE":
    case "ROLE_GATED":
      return Lock;
    default:
      return Hash;
  }
}

function ChannelList({
  channels,
  categories,
  activeChannelId,
  onPick,
}: {
  channels: Channel[];
  categories: Category[];
  activeChannelId: string | null;
  onPick: (channel: Channel) => void;
}) {
  const grouped = useMemo(() => {
    const categoryById = new Map<string, Category>();
    for (const c of categories) categoryById.set(c.id, c);
    const sections = new Map<string, Channel[]>();
    sections.set("__uncategorized__", []);
    for (const ch of channels) {
      const bucket =
        ch.category_id && categoryById.has(ch.category_id)
          ? ch.category_id
          : "__uncategorized__";
      if (!sections.has(bucket)) sections.set(bucket, []);
      sections.get(bucket)!.push(ch);
    }
    return { sections, categoryById };
  }, [channels, categories]);

  return (
    <div className="space-y-4">
      {Array.from(grouped.sections.entries())
        .sort(([a], [b]) => {
          if (a === "__uncategorized__") return 1;
          if (b === "__uncategorized__") return -1;
          const ca = grouped.categoryById.get(a);
          const cb = grouped.categoryById.get(b);
          return (ca?.display_order ?? 0) - (cb?.display_order ?? 0);
        })
        .map(([key, items]) => {
          if (items.length === 0) return null;
          const label =
            key === "__uncategorized__"
              ? "Channels"
              : grouped.categoryById.get(key)?.name ?? "Channels";
          return (
            <div key={key}>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {label}
              </p>
              <ul className="space-y-0.5">
                {items
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((channel) => {
                    const Icon = channelIcon(channel.type);
                    const isActive = channel.id === activeChannelId;
                    return (
                      <li key={channel.id}>
                        <button
                          type="button"
                          onClick={() => onPick(channel)}
                          aria-current={isActive ? "page" : undefined}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                            isActive
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span className="truncate">{channel.name}</span>
                          {channel.is_read_only ? (
                            <Badge variant="outline" className="ml-auto">
                              Read
                            </Badge>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          );
        })}
    </div>
  );
}

function MessageRow({
  message,
  currentUserId,
  onDelete,
  onTogglePin,
  onReact,
}: {
  message: Message;
  currentUserId: string | null;
  onDelete: (m: Message) => void;
  onTogglePin: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
}) {
  const isMine = currentUserId && message.sender_id === currentUserId;
  return (
    <li className="group flex gap-3 px-4 py-2 hover:bg-muted/30">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {message.sender_id.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">
            {isMine ? "You" : `Member ${message.sender_id.slice(0, 6)}`}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatClock(message.created_at)}
          </span>
          {message.edited_at ? (
            <span className="text-[11px] text-muted-foreground">(edited)</span>
          ) : null}
          {message.is_pinned ? (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <PinIcon className="h-3 w-3" /> Pinned
            </Badge>
          ) : null}
        </div>
        <p
          className={`mt-0.5 whitespace-pre-wrap text-sm ${
            message.is_deleted ? "italic text-muted-foreground" : ""
          }`}
        >
          {message.is_deleted ? "[message deleted]" : message.content}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1 opacity-0 transition group-hover:opacity-100">
          {!message.is_deleted ? (
            <>
              {QUICK_REACTIONS.map((emoji) => (
                <Button
                  key={emoji}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-sm"
                  onClick={() => onReact(message, emoji)}
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => onTogglePin(message)}
              >
                <Pin className="h-3 w-3" />
                {message.is_pinned ? "Unpin" : "Pin"}
              </Button>
              {isMine ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-destructive"
                  onClick={() => onDelete(message)}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function ChatPage() {
  const { toast } = useToast();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const frappUser = useFrappUser();

  const channelsQuery = useChannels();
  const categoriesQuery = useCategories();

  const channels = useMemo(
    () => asArray<Channel>(channelsQuery.data),
    [channelsQuery.data],
  );
  const categories = useMemo(
    () => asArray<Category>(categoriesQuery.data),
    [categoriesQuery.data],
  );

  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeChannelId && channels.length > 0) {
      setActiveChannelId(channels[0]!.id);
    }
  }, [activeChannelId, channels]);
  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  const messagesQuery = useMessages(activeChannelId ?? "", { limit: 50 });
  const pinsQuery = usePinnedMessages(activeChannelId ?? "");
  const sendMessage = useSendMessage();
  const deleteMessage = useDeleteMessage();
  const pinMessage = usePinMessage();
  const unpinMessage = useUnpinMessage();
  const toggleReaction = useToggleReaction();
  const markRead = useMarkChannelRead();

  // Realtime: refresh the message list when anyone posts/edits/pins in the
  // active channel. This layer runs in addition to the optimistic-send flow
  // so two tabs stay in sync.
  useRealtimeTable({
    table: "chat_messages",
    filter: activeChannelId ? `channel_id=eq.${activeChannelId}` : undefined,
    invalidate: [
      ["channels", activeChannelId, "messages"],
      ["channels", activeChannelId, "pins"],
    ],
    enabled: Boolean(activeChannelId),
  });

  useEffect(() => {
    if (!activeChannelId) return;
    markRead.mutate(activeChannelId);
    // Intentionally omit `markRead` — its reference is stable enough for this
    // "mark visible channel as read" side-effect, and adding it would cause
    // a hot loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannelId]);

  const messages = useMemo(
    () =>
      asArray<Message>(messagesQuery.data).sort((a, b) =>
        a.created_at < b.created_at ? -1 : 1,
      ),
    [messagesQuery.data],
  );
  const pins = useMemo(
    () => asArray<Message>(pinsQuery.data),
    [pinsQuery.data],
  );

  const [draft, setDraft] = useState("");
  const timelineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [messages.length, activeChannelId]);

  async function handleSend() {
    if (!activeChannelId || !draft.trim()) return;
    try {
      await sendMessage.mutateAsync({
        channelId: activeChannelId,
        body: { content: draft.trim() },
      });
      setDraft("");
    } catch (error) {
      toast({
        title: "Couldn't send message",
        description: getErrorMessage(
          error,
          "Retry in a moment. Your draft is preserved.",
        ),
        variant: "destructive",
      });
    }
  }

  async function handleDelete(message: Message) {
    const confirmed = window.confirm(
      "Delete this message? Only you and chapter admins with channels:manage can see it afterward.",
    );
    if (!confirmed) return;
    try {
      await deleteMessage.mutateAsync(message.id);
    } catch (error) {
      toast({
        title: "Couldn't delete message",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  async function handleTogglePin(message: Message) {
    try {
      if (message.is_pinned) {
        await unpinMessage.mutateAsync(message.id);
      } else {
        await pinMessage.mutateAsync(message.id);
      }
    } catch (error) {
      toast({
        title: "Couldn't update pin",
        description: getErrorMessage(
          error,
          "Pinning requires the channels:manage permission.",
        ),
        variant: "destructive",
      });
    }
  }

  async function handleReact(message: Message, emoji: string) {
    try {
      await toggleReaction.mutateAsync({
        messageId: message.id,
        body: { emoji },
      });
    } catch (error) {
      toast({
        title: "Couldn't toggle reaction",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchResults = useSearch(searchOpen ? searchQuery.trim() : "");

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
    return <LoadingState message="Loading chapter channels..." />;
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
        description="Chapters seed #general, #announcements, and #alumni automatically when billing activates. Ask an admin if none appear here."
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr_260px]">
      <Card className="md:sticky md:top-20 md:self-start">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <MessagesSquare className="h-4 w-4" />
            Channels
          </CardTitle>
          <CardDescription>
            {channels.length} channel{channels.length === 1 ? "" : "s"} · DMs
            open from member profiles.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-[60vh] overflow-y-auto">
          <ChannelList
            channels={channels}
            categories={categories}
            activeChannelId={activeChannelId}
            onPick={(c) => setActiveChannelId(c.id)}
          />
        </CardContent>
      </Card>

      <Card className="flex min-h-[60vh] flex-col">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                {activeChannel
                  ? (() => {
                      const Icon = channelIcon(activeChannel.type);
                      return (
                        <>
                          <Icon className="h-4 w-4" />
                          {activeChannel.name}
                        </>
                      );
                    })()
                  : "Pick a channel"}
              </CardTitle>
              {activeChannel?.description ? (
                <CardDescription>
                  {activeChannel.description}
                </CardDescription>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchOpen(true);
                setSearchQuery("");
              }}
              aria-label="Search chapter chat"
            >
              <Search className="h-4 w-4" />
              Search
            </Button>
          </div>
        </CardHeader>
        <div
          ref={timelineRef}
          className="flex-1 overflow-y-auto"
          aria-label="Chat timeline"
        >
          {messagesQuery.isPending ? (
            <LoadingState message="Loading messages..." />
          ) : messagesQuery.isError ? (
            <ErrorState
              title="Couldn't load messages"
              description="Retry in a moment."
              onRetry={() => void messagesQuery.refetch()}
            />
          ) : messages.length === 0 ? (
            <EmptyState
              title="Nothing in this channel yet"
              description="Be the first to post — messages render live with Supabase Realtime."
            />
          ) : (
            <ul className="divide-y divide-border/70">
              {messages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  currentUserId={frappUser.userId}
                  onDelete={handleDelete}
                  onTogglePin={handleTogglePin}
                  onReact={handleReact}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-3">
          {activeChannel?.is_read_only ? (
            <p className="text-xs text-muted-foreground">
              This channel is read-only. Posting requires the{" "}
              <code>announcements:post</code> permission.
            </p>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSend();
              }}
            >
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  activeChannel
                    ? `Message #${activeChannel.name}`
                    : "Pick a channel"
                }
                rows={2}
                className="resize-none"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
              />
              <Button
                type="submit"
                disabled={!draft.trim() || sendMessage.isPending || !activeChannel}
              >
                <Send className="h-4 w-4" />
                Send
              </Button>
            </form>
          )}
        </div>
      </Card>

      <Card className="md:sticky md:top-20 md:self-start">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Pin className="h-4 w-4" /> Pinned
          </CardTitle>
          <CardDescription>
            {pins.length} pinned in this channel.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-[50vh] overflow-y-auto">
          {pinsQuery.isPending ? (
            <p className="text-xs text-muted-foreground">Loading pins…</p>
          ) : pins.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing pinned yet. Channel managers can pin key messages from
              the timeline.
            </p>
          ) : (
            <ul className="space-y-3">
              {pins.map((pin) => (
                <li
                  key={pin.id}
                  className="rounded-md border border-border p-2 text-xs"
                >
                  <p className="font-semibold">
                    Member {pin.sender_id.slice(0, 6)}
                  </p>
                  <p className="text-muted-foreground">
                    {formatClock(pin.pinned_at ?? pin.created_at)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{pin.content}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {searchOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-background/90 p-6 backdrop-blur"
          role="dialog"
          aria-modal="true"
          aria-label="Chat search"
        >
          <div className="w-full max-w-2xl">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base">Search chat</CardTitle>
                  <CardDescription>
                    Results come from the chapter-wide search index across
                    messages, events, members, and backwork.
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchOpen(false)}
                >
                  Close
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  autoFocus
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search messages…"
                />
                {searchResults.isPending && searchQuery ? (
                  <p className="text-xs text-muted-foreground">Searching…</p>
                ) : null}
                {searchResults.data && typeof searchResults.data === "object" ? (
                  <ul className="divide-y divide-border/70 text-sm">
                    {asArray<{
                      id?: string;
                      content?: string;
                      channel_id?: string;
                    }>(
                      (searchResults.data as { messages?: unknown }).messages,
                    ).map((result, idx) => (
                      <li
                        key={result.id ?? idx}
                        className="py-2"
                      >
                        <p className="text-xs text-muted-foreground">
                          <CornerDownRight className="inline h-3 w-3" />{" "}
                          {channels.find((c) => c.id === result.channel_id)
                            ?.name ?? "Unknown channel"}
                        </p>
                        <p className="whitespace-pre-wrap">
                          {result.content}
                        </p>
                      </li>
                    ))}
                    {asArray<{
                      id?: string;
                      content?: string;
                      channel_id?: string;
                    }>(
                      (searchResults.data as { messages?: unknown }).messages,
                    ).length === 0 && searchQuery.trim() ? (
                      <li className="py-4 text-center text-xs text-muted-foreground">
                        No matches. Try broader keywords.
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {activeChannel ? (
        <aside
          aria-hidden="true"
          className="hidden md:col-span-3 md:block"
        >
          <p className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            Messages stream via Supabase Realtime. DMs, full presence, and
            typing indicators ship in a follow-up polish pass.
          </p>
        </aside>
      ) : null}
    </div>
  );
}
