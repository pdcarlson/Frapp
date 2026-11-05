"use client";

import { Skeleton } from "@/components/shared/async-states";
import { ChannelListSkeleton } from "@/components/chat/channel-list";
import { MessageTimelineSkeleton } from "@/components/chat/message-timeline";
import {
  COMPOSER_BOX_CLASS,
  COMPOSER_TOOLBAR_CLASS,
  COMPOSER_WELL_CLASS,
} from "@/components/chat/composer";

/**
 * `/chat` while the route itself is in flight (navigation from another page).
 *
 * The shell already draws its own cold-load skeletons once it mounts; this is
 * the frame around them, on the shell's own geometry, so the route loader and
 * the mounted shell are the same picture: the 240px `--surface-1` channels
 * column with its 48px header, and the main column's 48px header, bottom-up
 * message rows and the composer box.
 *
 * A client module only because the composer's class constants are exported
 * from one: a server component importing them would get a reference, not the
 * string.
 */
export function ChatRouteSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-0 flex-1"
    >
      <span className="sr-only">Loading chat</span>
      <div
        aria-hidden="true"
        className="hidden min-h-0 w-60 shrink-0 flex-col border-r border-border bg-surface-1 lg:flex"
      >
        <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
          <Skeleton className="h-[13px] w-20" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          <ChannelListSkeleton />
        </div>
      </div>
      <div aria-hidden="true" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
          <Skeleton className="h-[13px] w-28" />
        </div>
        <div className="min-h-0 flex-1">
          <MessageTimelineSkeleton />
        </div>
        {/*
          The composer's own box and well classes, so the box is the height
          the mounted composer will be. Inert here: the real composer takes
          text from first paint, and one that vanished with this loader would
          drop what was typed into it.
        */}
        <div className={COMPOSER_BOX_CLASS}>
          <div className={COMPOSER_WELL_CLASS}>
            <div className="min-h-[40px]" />
            <div className={COMPOSER_TOOLBAR_CLASS} />
          </div>
        </div>
      </div>
    </div>
  );
}
