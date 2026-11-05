"use client";

import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import {
  countsAddressMember,
  sidebarUnreadCounts,
  useChannelNotificationPreferences,
  useChannelUnreadCounts,
  useChannels,
} from "@repo/hooks";
import { signetDarkTokens } from "@repo/theme/signet";
import { AppNav } from "@/components/layout/app-nav";
import { ChapterNavHeader } from "@/components/layout/chapter-nav-header";
import type { NavFace } from "@/components/layout/nav-face";
import { ChannelListSkeleton } from "@/components/chat/channel-list-skeleton";
import { Button } from "@/components/ui/button";
import { compactControlClassName } from "@/components/shared/table-controls";
import { asArray, cn } from "@/lib/utils";

/**
 * `/chat`'s left column from `lg` up: one 240px column with two faces (owner,
 * 2026-11-05; the rules are `spec/ui/design-system/components.md` § 7).
 *
 * - **Channels** (the default): `ChatShell` portals its channels pane into the
 *   slot, with a back arrow beside the Channels heading.
 * - **Modules**: the ordinary nav. Every row but Chat navigates away; Chat
 *   slides the channels back.
 *
 * The chapter switcher stays pinned above both, in a 48px band that lines up
 * with the top bar, so the Channels header below it lines up with the thread's
 * channel header. The width is the old channels column's: the nav's 220px and
 * the channels' 240px no longer sit side by side.
 *
 * Until chat's pane arrives (server render, hydration, the route loader) and
 * whenever it is gone (the segment's error boundary), the slot is empty and a
 * placeholder holds the column, with its own back arrow: the module nav must
 * stay reachable when chat itself is not there to offer the way back.
 *
 * The slide is the standard transition (`motion.ts`), horizontal in the
 * direction of going back, and instant under reduced motion. The face that is
 * out of view is `inert`, so neither a tab stop nor a screen reader lands in it.
 */

type ChatNavColumnProps = {
  face: NavFace;
  onShowModules: () => void;
  onShowChannels: () => void;
  /** Receives the channels face's container (`NavFaceContext.channelsSlot`). */
  channelsSlotRef: (node: HTMLDivElement | null) => void;
  permissions: readonly string[] | null | undefined;
  isModuleEnabled?: (moduleKey: string) => boolean;
  pathname: string;
};

const SLIDE =
  "absolute inset-0 flex flex-col transition-[transform,opacity] motion-reduce:transition-none";
const SLIDE_STYLE = {
  transitionDuration: `${signetDarkTokens.motion.duration.standard}ms`,
  transitionTimingFunction: signetDarkTokens.motion.easing.standard,
} as const;

/**
 * Whether Chat has anything new the member would want to know about while the
 * channels are out of sight. Two ways in, the same two the channel list draws:
 *
 * - **Addressed**: an @-mention, or anything unread in a DM. It gets past a
 *   mute, as it does for push and for the list's Hide muted filter
 *   (`countsAddressMember`, foundations §5).
 * - **Unread in a channel known not to be muted.** Levels are read from the
 *   last good preferences, so a failed refetch keeps a muted channel muted;
 *   while they have never loaded, plain unread lights nothing.
 *
 * Counts are the server's (`GET /v1/channels/unread`, the read the list uses),
 * never a local re-derivation, and unknown counts light nothing.
 */
function useChatHasUnread(): boolean {
  const unreadQuery = useChannelUnreadCounts();
  const prefsQuery = useChannelNotificationPreferences();
  const channelsQuery = useChannels();
  return useMemo(() => {
    const counts = sidebarUnreadCounts({
      data: unreadQuery.data,
      isError: unreadQuery.isError,
    });
    if (!counts) return false;
    const directIds = new Set(
      asArray<{ id: string; type?: string }>(channelsQuery.data)
        .filter((c) => c.type === "DM" || c.type === "GROUP_DM")
        .map((c) => c.id),
    );
    const levels = prefsQuery.data
      ? new Map(prefsQuery.data.map((row) => [row.channel_id, row.level]))
      : undefined;
    for (const [channelId, c] of counts) {
      if (countsAddressMember(directIds.has(channelId), c)) return true;
      if (c.unreadCount > 0 && levels && levels.get(channelId) !== "off") {
        return true;
      }
    }
    return false;
  }, [
    unreadQuery.data,
    unreadQuery.isError,
    prefsQuery.data,
    channelsQuery.data,
  ]);
}

export function ChatNavColumn({
  face,
  onShowModules,
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
      <div className="box-border min-h-12 shrink-0 border-b border-border px-2 pt-1">
        <ChapterNavHeader collapsed={false} />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={channelsRef}
          inert={!showingChannels}
          style={SLIDE_STYLE}
          className={cn(
            SLIDE,
            showingChannels ? "translate-x-0" : "translate-x-full opacity-0",
          )}
        >
          <div
            ref={channelsSlotRef}
            data-nav-channels-slot=""
            className="peer flex min-h-0 flex-1 flex-col empty:hidden"
          />
          <div className="hidden min-h-0 flex-1 flex-col peer-empty:flex">
            <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
              <Button
                variant="ghost"
                size="icon"
                className={cn(compactControlClassName, "-ml-1.5 shrink-0")}
                onClick={onShowModules}
                aria-label="Back to menu"
                title="Back to menu"
                data-nav-back=""
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="text-sm font-semibold text-foreground">
                Channels
              </span>
            </div>
            <div aria-hidden="true" className="p-2">
              <ChannelListSkeleton />
            </div>
          </div>
        </div>
        <div
          ref={modulesRef}
          inert={showingChannels}
          style={SLIDE_STYLE}
          className={cn(
            SLIDE,
            "p-2 pt-1",
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
