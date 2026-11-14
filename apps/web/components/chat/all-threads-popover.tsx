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
  unreadThreadCount,
  useMemberThreads,
  type MemberThread,
} from "@repo/hooks";
import { formatRelativeDayTime } from "@repo/formatting";
import { forwardedFromOf } from "@repo/chat-core/types";
import { replyPreviewText } from "./reply-quote";
import { StartThreadGlyph } from "./chat-glyphs";

type PreviewSource = MemberThread["root"];

function previewOf(message: PreviewSource): string {
  return replyPreviewText({
    ...message,
    // A forward with no comment previews its copy (#4875).
    forwarded_from: forwardedFromOf(message.forwarded_from),
  });
}

/**
 * All threads (#4960): the chat header's Threads button and its list of every
 * thread the member started, replied in or was mentioned in, across channels,
 * newest activity first. Slack's Threads view is the model (a row per thread:
 * the channel, the parent, the latest reply, bold while unread); Discord's
 * channel-header threads icon is where the door sits.
 *
 * A row opens its thread in the thread panel, switching channel first when it
 * is another one (`onOpenThread`). The list is the server's, so a thread read
 * here or anywhere else drops its unread mark on the next read: on opening the
 * list, and once a minute behind the button.
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
  // Opening re-reads, so the list never shows a mark the member just cleared.
  const query = useMemberThreads({ refetchOnMount: open });
  const threads = query.data ?? [];
  const unread = unreadThreadCount(threads);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
              const channelName = channelNameFor(thread.channel_id);
              const reply = thread.latest_reply;
              const when = formatRelativeDayTime(
                thread.last_reply_at ?? thread.root.created_at,
              );
              return (
                <li key={thread.thread_root_id}>
                  <button
                    type="button"
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
                      <span
                        className={cn(
                          "truncate",
                          isUnread
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {channelName ?? "Conversation"}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {isUnread ? (
                          <span className="mr-2 font-semibold text-primary">
                            {thread.unread_count} new
                          </span>
                        ) : null}
                        {when}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-muted-foreground">
                      <span className="font-semibold">
                        {resolveAuthorLabel(thread.root, nameFor, viewerId)}:
                      </span>{" "}
                      {previewOf(thread.root)}
                    </span>
                    {reply ? (
                      <span
                        className={cn(
                          "mt-1 line-clamp-2 block whitespace-pre-wrap text-base",
                          isUnread ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <span className="font-semibold">
                          {resolveAuthorLabel(reply, nameFor, viewerId)}:
                        </span>{" "}
                        {previewOf(reply)}
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
