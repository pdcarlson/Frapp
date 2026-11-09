"use client";

import { useLayoutEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { signetDarkTokens } from "@repo/theme/signet";
import { AppNav } from "@/components/layout/app-nav";
import { ChapterNavHeader } from "@/components/layout/chapter-nav-header";
import { NavChannelsTitle, type NavFace } from "@/components/layout/nav-face";
import { ChannelListSkeleton } from "@/components/chat/channel-list-skeleton";
import { cn } from "@/lib/utils";

/**
 * The desktop shell's left column, on every route from `lg` up: one column, one
 * chapter band, one geometry (`spec/ui/design-system/components.md` § 7).
 *
 * It holds two faces in the same box:
 *
 * - **Modules**, the ordinary nav. Off `/chat` it is the only face showing.
 * - **Channels**, on `/chat` only and shown by default there: `ChatShell`
 *   portals its channels pane into the slot, with a back arrow beside the
 *   Channels heading. On `/chat` every module row navigates away except Chat,
 *   which slides the channels back.
 *
 * **Why one column rather than a nav on most routes and a chat column on
 * `/chat`** (Paul, 2026-11-06: "weird sidebar behavior and jumps when
 * switching from chat to anything else"). The two used to be separate components:
 * a 220px nav whose chapter row sat in its 8px padding, and a 240px chat
 * column whose chapter row sat in a 48px hairlined band. Every trip between
 * Chat and another module swapped one for the other, so the column changed
 * width by 20px, the chapter row moved 4px, every module row moved 4px the
 * other way, and the band's hairline came and went. Now the box, the band and
 * the module rows never move, and arriving at Chat is the same slide the back
 * arrow uses rather than a swap.
 *
 * The chapter switcher sits in a 48px band that lines up with the top bar, so
 * the Channels header below it lines up with the thread's channel header. The
 * width is 240px, the old channels column's, expanded on every route; the
 * 56px rail is a preference that applies off Chat only, since channels need
 * their names.
 *
 * Until chat's pane arrives (server render, hydration, the route loader) and
 * whenever it is gone (the segment's error boundary), the slot is empty and a
 * placeholder holds the face, with its own back arrow: the module nav must
 * stay reachable when chat itself is not there to offer the way back.
 *
 * The slide is the standard transition (`motion.ts`), horizontal in the
 * direction of going back, and instant under reduced motion. The face that is
 * out of view is `inert`, so neither a tab stop nor a screen reader lands in it.
 */

type NavColumnProps = {
  /**
   * The face `/chat` has chosen, or `null` on every other route, where the
   * modules face is the column.
   */
  chatFace: NavFace | null;
  onShowModules: () => void;
  onShowChannels: () => void;
  /** Receives the channels face's container (`NavFaceContext.channelsSlot`). */
  channelsSlotRef: (node: HTMLDivElement | null) => void;
  /** The rail preference. Ignored on `/chat`. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  permissions: readonly string[] | null | undefined;
  isModuleEnabled?: (moduleKey: string) => boolean;
  pathname: string;
  /**
   * Nav rows with something new for the member (`AppNav`'s `highlighted`),
   * lit on every route until it has been seen.
   */
  highlighted?: ReadonlySet<string>;
};

const SLIDE =
  "absolute inset-0 flex flex-col transition-[transform,opacity] motion-reduce:transition-none";
const SLIDE_STYLE = {
  transitionDuration: `${signetDarkTokens.motion.duration.standard}ms`,
  transitionTimingFunction: signetDarkTokens.motion.easing.standard,
} as const;

/**
 * What the Chat row trails on `/chat`'s modules face: the chevron that says the
 * row slides the channels back rather than navigating. The unread dot is the
 * row's own highlight now (`ProtectedNavItem`), drawn on every route.
 */
const CHAT_ROW_TRAILING = (
  <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
);

export function NavColumn({
  chatFace,
  onShowModules,
  onShowChannels,
  channelsSlotRef,
  collapsed,
  onToggleCollapsed,
  permissions,
  isModuleEnabled,
  pathname,
  highlighted,
}: NavColumnProps) {
  const onChat = chatFace !== null;
  const face: NavFace = chatFace ?? "modules";
  const isCollapsed = collapsed && !onChat;
  const modulesRef = useRef<HTMLDivElement>(null);
  const channelsRef = useRef<HTMLDivElement | null>(null);
  const previousFace = useRef(face);

  // Focus follows the slide, so a keyboard user is never left on a control
  // that just went inert. Only on a change, never on mount, and only when
  // focus was in the face going out: chat also brings the channels back when
  // a link lands (a Find result, a notification), and that must not pull focus
  // out of wherever the member was. A layout effect, because it has to read
  // focus before the browser moves it off the now-inert face.
  useLayoutEffect(() => {
    if (previousFace.current === face) return;
    const outgoing =
      previousFace.current === "modules"
        ? modulesRef.current
        : channelsRef.current;
    previousFace.current = face;
    if (!outgoing?.contains(document.activeElement)) return;
    if (face === "modules") {
      // `true` is a Settings tool's route, which marks the Settings row.
      modulesRef.current
        ?.querySelector<HTMLElement>(
          '[aria-current="page"], [aria-current="true"]',
        )
        ?.focus();
      return;
    }
    // Chat's own back arrow when its pane is in the slot. While the slot is
    // empty (arriving at Chat, with the route still loading) the only arrow is
    // the placeholder's, which hides the moment the pane lands and would drop
    // focus to the document; the face itself holds focus instead, and the
    // next Tab reaches whichever arrow is showing.
    const channels = channelsRef.current;
    const back = channels?.querySelector<HTMLElement>(
      "[data-nav-channels-slot] [data-nav-back]",
    );
    (back ?? channels)?.focus();
  }, [face]);

  const showingChannels = face === "channels";

  return (
    <div
      className={cn(
        "box-border flex shrink-0 flex-col border-r border-border bg-surface-1",
        isCollapsed ? "w-14" : "w-60",
      )}
    >
      {/*
        Not a centering flex box in the rail: the chapter row fills the band's
        40px and centers its own crest, and the recovery card, which is 200px
        wide whatever the rail says, must overflow to the right, into view,
        not to both sides.
      */}
      <div className="box-border min-h-12 shrink-0 border-b border-border px-2 pt-1">
        <ChapterNavHeader collapsed={isCollapsed} />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/*
          The channels face is mounted on every route, out of view and inert
          off `/chat`, so arriving at Chat slides it in rather than swapping
          the column, and chat's pane has its slot from the first frame. It
          takes focus itself (`tabIndex={-1}`) only from the effect above.
        */}
        <div
          ref={channelsRef}
          inert={!showingChannels}
          tabIndex={-1}
          style={SLIDE_STYLE}
          className={cn(
            SLIDE,
            "outline-none",
            showingChannels ? "translate-x-0" : "translate-x-full opacity-0",
          )}
        >
          <div
            ref={channelsSlotRef}
            data-nav-channels-slot=""
            className="peer flex min-h-0 flex-1 flex-col empty:hidden"
          />
          {/*
            The placeholder exists on `/chat` only. Off it, the slot is always
            empty, and a mounted placeholder would keep the skeleton's shimmer
            animating out of view on every route, and would be what slides out
            when leaving Chat from the channels (chat's pane unmounts with the
            route, before the slide starts).
          */}
          {onChat ? (
            <div className="hidden min-h-0 flex-1 flex-col peer-empty:flex">
              <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
                <NavChannelsTitle onBack={onShowModules} heading={false} />
              </div>
              <div aria-hidden="true" className="p-2">
                <ChannelListSkeleton />
              </div>
            </div>
          ) : null}
        </div>
        <div
          ref={modulesRef}
          inert={showingChannels}
          style={SLIDE_STYLE}
          className={cn(
            SLIDE,
            // No top padding: the nav's own 4px under the band puts the first
            // row 52px down, where the old sidebar had it.
            "p-2 pt-0",
            isCollapsed && "items-center",
            showingChannels ? "-translate-x-full opacity-0" : "translate-x-0",
          )}
        >
          <AppNav
            collapsed={isCollapsed}
            onToggleCollapsed={onChat ? undefined : onToggleCollapsed}
            permissions={permissions}
            isModuleEnabled={isModuleEnabled}
            pathname={pathname}
            highlighted={highlighted}
            chatRow={
              onChat
                ? { onSelect: onShowChannels, trailing: CHAT_ROW_TRAILING }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
