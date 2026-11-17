"use client";

import {
  resolveAuthorLabel,
  resolveAuthorName,
  type MemberThread,
} from "@repo/hooks";
import { memberThreadPreview } from "@repo/chat-core/threads";
import type { RawChatMessage } from "@repo/chat-core/types";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * Where the parent row's mark sits, so the connector drops from its middle and
 * the thread's words start where the channel's name does: the row's `px-2`,
 * then the `#` (16px) or a conversation's avatar (24px), then the row's
 * `gap-2`. Pinned by `channel-thread-rows.spec.tsx` against `ChannelMark`.
 */
const ROW_PADDING_PX = 8;
const ROW_GAP_PX = 8;
export const CHANNEL_MARK_PX = 16;
export const DIRECT_MARK_PX = 24;

/**
 * A channel's active threads, indented under its row in the rail (#5300,
 * Paul 2026-11-17), as the phone has drawn them since #5277 and as Discord's
 * desktop channel list draws the threads you're in: a curved connector from
 * the channel's mark into each thread, named by its parent's words. Which
 * threads show is `sidebarThreadsByChannel`'s rule (`@repo/chat-core/threads`);
 * a channel with none renders nothing, so there is no empty state.
 *
 * A thread with replies new to the member reads as an unread channel row does
 * (the leading pip and a bold title, no number: a thread reply is not direct
 * address); a muted thread reads as a muted channel; the open thread wears the
 * active row's tint. A click opens the thread in its channel's thread panel,
 * switching channel first (`onOpen`), as the header's All threads list does.
 * That list stays the full one, reaching threads past the quiet window.
 */
export function ChannelThreadRows({
  threads,
  channelLabel,
  markPx,
  activeThreadRootId,
  nameFor,
  viewerId,
  onOpen,
}: {
  threads: readonly MemberThread[];
  /** `#general`, or a conversation's people, for the accessible name. */
  channelLabel: string;
  /** The parent row's mark width: {@link CHANNEL_MARK_PX} or {@link DIRECT_MARK_PX}. */
  markPx: number;
  /** The thread open in the panel, drawn as the current row. */
  activeThreadRootId: string | null;
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  onOpen: (channelId: string, rootId: string) => void;
}) {
  const names = {
    nameOf: (id: string) =>
      resolveAuthorName({ sender_id: id, author_name: null }, nameFor),
    fallbackLabel: (id: string) =>
      resolveAuthorLabel({ sender_id: id, author_name: null }, nameFor, null),
  };
  const lineX = ROW_PADDING_PX + markPx / 2;
  const textX = ROW_PADDING_PX + markPx + ROW_GAP_PX;
  return (
    <ul aria-label={`Threads in ${channelLabel}`} data-testid="channel-threads">
      {threads.map((thread, index) => {
        const { rootText } = memberThreadPreview(
          thread.root as unknown as RawChatMessage,
          viewerId,
          names,
        );
        const unread = thread.unread_count > 0;
        const muted = thread.state === "muted";
        const active = thread.thread_root_id === activeThreadRootId;
        const last = index === threads.length - 1;
        return (
          <li key={thread.thread_root_id} className="relative">
            {/* From the row above down to the row's middle, curving right. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-10 h-1/2 rounded-bl-lg border-b-[1.5px] border-l-[1.5px] border-border"
              style={{ left: lineX - 0.75, width: markPx / 2 + 4 }}
            />
            {/* On every row but the last, the line carries on to the next. */}
            {last ? null : (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 top-1/2 z-10 w-[1.5px] bg-border"
                style={{ left: lineX - 0.75 }}
              />
            )}
            <button
              type="button"
              data-testid="channel-thread-row"
              aria-current={active ? "true" : undefined}
              aria-label={[
                `Thread: ${rootText}`,
                `in ${channelLabel}`,
                muted ? "muted" : null,
                unread ? `${thread.unread_count} new` : null,
              ]
                .filter(Boolean)
                .join(", ")}
              onClick={() => onOpen(thread.channel_id, thread.thread_root_id)}
              className={cn(
                "relative flex h-8 w-full items-center rounded-xs pr-2 text-left text-sm transition-colors",
                FOCUS_RING,
                active
                  ? "bg-accent-subtle font-semibold text-accent-text"
                  : unread
                    ? "font-bold text-foreground hover:bg-card"
                    : muted
                      ? "text-muted hover:bg-card hover:text-foreground"
                      : "text-muted-foreground hover:bg-card hover:text-foreground",
              )}
              style={{ paddingLeft: textX }}
            >
              {unread && !active ? (
                <span
                  aria-hidden="true"
                  data-testid="channel-thread-unread-pip"
                  className="absolute left-0 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground"
                />
              ) : null}
              <span className="truncate">{rootText}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
