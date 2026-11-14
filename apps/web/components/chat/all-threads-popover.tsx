"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FOCUS_RING } from "@/components/ui/focus";
import { compactControlClassName } from "@/components/shared/table-controls";
import { cn } from "@/lib/utils";
import {
  ALL_THREADS_EMPTY,
  ALL_THREADS_ERROR,
  ALL_THREADS_TITLE,
  resolveAuthorLabel,
  resolveAuthorName,
  unreadThreadCount,
  useMemberThreads,
} from "@repo/hooks";
import { formatRelativeDayTime } from "@repo/formatting";
import { memberThreadPreview } from "@repo/chat-core/threads";
import type { RawChatMessage } from "@repo/chat-core/types";
import { StartThreadGlyph } from "./chat-glyphs";

/**
 * All threads (#4960): the chat header's Threads button and its list of every
 * thread the member started, replied in or was mentioned in, across channels,
 * newest activity first. Slack's Threads view is the model (a row per thread:
 * the channel, the parent, the latest reply, bold while unread); Discord's
 * channel-header threads icon is where the door sits.
 *
 * A row opens its thread in the thread panel, switching channel first when it
 * is another one (`onOpenThread`). The list is the server's: it is re-read
 * each time it opens, once a minute behind the button, and right after a
 * thread is read here (`use-message-thread.ts`). The hook lives in this
 * always-mounted trigger for the button's dot, so opening calls `refetch`
 * itself; a `refetchOnMount` change would not fetch on a mounted observer.
 *
 * Unread reads as a list in a popover does (components.md: a dot in
 * `--foreground` and a bolder title, never a New badge); the count is in the
 * row's accessible name.
 */
export function AllThreadsPopover({
  channelNameFor,
  nameFor,
  viewerId,
  onOpenThread,
}: {
  /** The channel's title as the sidebar shows it, or `null` when unknown. */
  channelNameFor: (channelId: string) => string | null;
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  onOpenThread: (channelId: string, rootId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const query = useMemberThreads();
  const threads = query.data ?? [];
  const unread = unreadThreadCount(threads);
  const names = {
    nameOf: (id: string) =>
      resolveAuthorName({ sender_id: id, author_name: null }, nameFor),
    fallbackLabel: (id: string) =>
      resolveAuthorLabel({ sender_id: id, author_name: null }, nameFor, null),
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A read on another device left this list stale; opening shows now.
        if (next) void query.refetch();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(compactControlClassName, "relative")}
          aria-label={
            unread > 0
              ? `Threads, ${unread} with new replies`
              : ALL_THREADS_TITLE
          }
        >
          <StartThreadGlyph className="h-5 w-5" active={unread > 0} />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary"
            />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-1rem))] p-0" align="end">
        <h2 className="border-b border-border px-3 py-2 text-caption font-semibold text-foreground">
          {ALL_THREADS_TITLE}
        </h2>
        {query.isPending ? (
          <p className="px-3 py-4 text-caption text-muted-foreground">
            Loading your threads…
          </p>
        ) : query.isError && threads.length === 0 ? (
          <div className="flex items-center justify-between gap-3 px-3 py-4">
            <p className="text-caption text-muted-foreground">
              {ALL_THREADS_ERROR}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              Try again
            </Button>
          </div>
        ) : threads.length === 0 ? (
          <p className="px-3 py-4 text-caption text-muted-foreground">
            {ALL_THREADS_EMPTY}
          </p>
        ) : (
          <ul className="max-h-[min(28rem,70vh)] divide-y divide-border overflow-y-auto">
            {threads.map((thread) => {
              const isUnread = thread.unread_count > 0;
              const channelName =
                channelNameFor(thread.channel_id) ?? "Conversation";
              const preview = memberThreadPreview(
                thread.root as unknown as RawChatMessage,
                viewerId,
                names,
              );
              const rootAuthor = preview.root.sender_blocked
                ? null
                : resolveAuthorLabel(preview.root, nameFor, viewerId);
              const when = formatRelativeDayTime(
                thread.last_reply_at ?? thread.root.created_at,
              );
              return (
                <li key={thread.thread_root_id}>
                  <button
                    type="button"
                    aria-label={`Thread in ${channelName}${
                      isUnread ? `, ${thread.unread_count} new` : ""
                    }`}
                    onClick={() => {
                      setOpen(false);
                      onOpenThread(thread.channel_id, thread.thread_root_id);
                    }}
                    className={cn(
                      "block w-full px-3 py-3 text-left text-caption transition-colors",
                      "hover:bg-card-hover",
                      FOCUS_RING,
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        {isUnread ? (
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-full bg-foreground"
                          />
                        ) : null}
                        <span
                          className={cn(
                            "truncate",
                            isUnread
                              ? "font-semibold text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {channelName}
                        </span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {when}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-muted-foreground">
                      {rootAuthor ? (
                        <>
                          <span className="font-semibold">{rootAuthor}:</span>{" "}
                        </>
                      ) : null}
                      {preview.rootText}
                    </span>
                    {preview.reply ? (
                      <span
                        className={cn(
                          "mt-1 line-clamp-2 block whitespace-pre-wrap text-base",
                          isUnread
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {preview.reply.name ? (
                          <>
                            <span className="font-semibold">
                              {preview.reply.name}:
                            </span>{" "}
                          </>
                        ) : null}
                        {preview.reply.text}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-muted-foreground">
                      {thread.reply_count === 1
                        ? "1 reply"
                        : `${thread.reply_count} replies`}
                      {thread.state === "muted" ? " · Muted" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
