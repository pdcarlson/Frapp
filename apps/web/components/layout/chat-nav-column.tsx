"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  sidebarMutedChannelIds,
  sidebarUnreadCounts,
  useChannelNotificationPreferences,
  useChannelUnreadCounts,
} from "@repo/hooks";
import { AppNav } from "@/components/layout/app-nav";
import { ChapterNavHeader } from "@/components/layout/chapter-nav-header";
import type { NavFace } from "@/components/layout/nav-face";
import { ChannelListSkeleton } from "@/components/chat/channel-list";
import { cn } from "@/lib/utils";

/**
 * `/chat`'s left column from `lg` up: one 240px column with two faces
 * (owner, 2026-11-05; option A on the proposal page).
 *
 * - **Channels** (the default): `ChatShell` portals its channels pane into the
 *   slot, with a back arrow beside the Channels heading.
 * - **Modules**: the ordinary nav. Every row but Chat navigates away; Chat
 *   slides the channels back.
 *
 * The chapter switcher stays pinned above both, so the column never loses
 * which chapter it belongs to. The width is the old channels column's: the
 * nav's 220px and the channels' 240px no longer sit side by side.
 *
 * The slide is the standard transition (220ms, `motion.ts`), horizontal in the
 * direction of going back, and instant under reduced motion. The face that is
 * out of view is `inert`, so neither a tab stop nor a screen reader lands in it.
 */

type ChatNavColumnProps = {
  face: NavFace;
  onShowChannels: () => void;
  /** Receives the channels face's container (`NavFaceContext.channelsSlot`). */
  channelsSlotRef: (node: HTMLDivElement | null) => void;
  permissions: readonly string[] | null | undefined;
  isModuleEnabled?: (moduleKey: string) => boolean;
  pathname: string;
};

const SLIDE =
  "absolute inset-0 flex flex-col transition-[transform,opacity] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

/**
 * Whether any channel the member hasn't muted has something unread. Counts are
 * the server's (`GET /v1/channels/unread`, the same cached read the channel
 * list uses), never a local re-derivation, and unknown counts light nothing.
 */
function useChatHasUnread(): boolean {
  const unreadQuery = useChannelUnreadCounts();
  const prefsQuery = useChannelNotificationPreferences();
  return useMemo(() => {
    const counts = sidebarUnreadCounts({
      data: unreadQuery.data,
      isError: unreadQuery.isError,
    });
    if (!counts) return false;
    const muted =
      sidebarMutedChannelIds({
        data: prefsQuery.data,
        isError: prefsQuery.isError,
      }) ?? new Set<string>();
    for (const [channelId, c] of counts) {
      if (muted.has(channelId)) continue;
      if (c.unreadCount > 0 || c.mentionCount > 0) return true;
    }
    return false;
  }, [
    unreadQuery.data,
    unreadQuery.isError,
    prefsQuery.data,
    prefsQuery.isError,
  ]);
}

export function ChatNavColumn({
  face,
  onShowChannels,
  channelsSlotRef,
  permissions,
  isModuleEnabled,
  pathname,
}: ChatNavColumnProps) {
  const hasUnread = useChatHasUnread();
  const modulesRef = useRef<HTMLDivElement>(null);
  const channelsRef = useRef<HTMLDivElement | null>(null);
  const previousFace = useRef(face);

  // Focus follows the slide, so a keyboard user is never left on a control
  // that just went inert. Only on a change, never on mount.
  useEffect(() => {
    if (previousFace.current === face) return;
    previousFace.current = face;
    const target =
      face === "modules"
        ? modulesRef.current?.querySelector<HTMLElement>(
            '[aria-current="page"]',
          )
        : channelsRef.current?.querySelector<HTMLElement>("[data-nav-back]");
    target?.focus();
  }, [face]);

  const showingChannels = face === "channels";

  return (
    <div className="box-border flex w-60 shrink-0 flex-col border-r border-border bg-surface-1">
      <div className="shrink-0 p-2 pb-0">
        <ChapterNavHeader collapsed={false} />
      </div>
      <div className="relative mt-1 min-h-0 flex-1 overflow-hidden">
        <div
          inert={!showingChannels}
          className={cn(
            SLIDE,
            showingChannels ? "translate-x-0" : "translate-x-full opacity-0",
          )}
        >
          <div
            ref={(node) => {
              channelsRef.current = node;
              channelsSlotRef(node);
            }}
            data-nav-channels-slot=""
            className="peer flex min-h-0 flex-1 flex-col empty:hidden"
          />
          {/*
            Holds the column's shape until chat's own pane arrives in the slot
            above: through server render and hydration the slot is empty, and
            an empty column would be a flash of nothing beside the thread.
          */}
          <div
            aria-hidden="true"
            className="hidden min-h-0 flex-1 flex-col peer-empty:flex"
          >
            <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
              <span className="text-sm font-semibold text-foreground">
                Channels
              </span>
            </div>
            <div className="p-2">
              <ChannelListSkeleton />
            </div>
          </div>
        </div>
        <div
          ref={modulesRef}
          inert={showingChannels}
          className={cn(
            SLIDE,
            "p-2 pt-0",
            showingChannels ? "-translate-x-full opacity-0" : "translate-x-0",
          )}
        >
          <AppNav
            variant="face"
            collapsed={false}
            permissions={permissions}
            isModuleEnabled={isModuleEnabled}
            pathname={pathname}
            chatRow={{ onSelect: onShowChannels, hasUnread }}
          />
        </div>
      </div>
    </div>
  );
}
