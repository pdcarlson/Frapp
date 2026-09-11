"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BookmarkGlyph, MuteGlyph, PinGlyph } from "./chat-glyphs";
import { SearchGlyph } from "@/components/layout/nav-glyphs";
import { cn } from "@/lib/utils";
import { ChatSearchPanel, type ChatSearchHit } from "./chat-search-popover";
import { PinsPanel } from "./pins-popover";
import { BookmarksPanel, type BookmarkEntry } from "./bookmarks-popover";
import { NotificationLevelPanel } from "./notification-level-popover";
import type { ChatMessage } from "@repo/chat-core/types";
import type { ChatNotificationLevel } from "@repo/hooks";

/**
 * The channel header's one overflow control: Search, Pinned, Saved and
 * Notifications behind a single `⋯`.
 *
 * The board merges them (`1t`: "Channel header: Search, Pins, Bookmarks,
 * Notification level buttons → one ⋯ menu merged") and the geometry forces it
 * anyway: `1b` pin 11 puts the header at 48px carrying the channel name, its
 * description and a member count, and four 44px trigger buttons do not fit
 * beside that.
 *
 * **One Popover, not four, and not a menu that opens popovers.** Each feature
 * used to own a `Popover` + `PopoverTrigger` + `Button` of its own. Nesting
 * those inside a `DropdownMenu` item does not work: Radix tears the menu's
 * focus and portal down on the click that would open the sibling popover, so
 * the popover has no stable anchor. Instead this is a single Popover whose
 * *content* swaps between a menu view and one panel view, driven by local
 * state. The four features are now trigger-less panels (`PinsPanel`,
 * `BookmarksPanel`, `NotificationLevelPanel`, `ChatSearchPanel`), and there is
 * exactly one anchor and one focus scope for all of them.
 *
 * A panel is only MOUNTED while its view is selected, which is load-bearing for
 * `ChatSearchPanel` — its query used to be gated on an `open` flag precisely
 * because Radix kept the component mounted behind a closed popover. Mounting is
 * now the gate.
 *
 * Muting stays legible without opening this menu: the header renders a
 * `MuteGlyph` beside the channel name when the channel is muted, because the
 * deleted notification trigger used to name that state in its `aria-label` and
 * losing it would make a muted channel silently indistinguishable.
 */

type View = "menu" | "search" | "pins" | "saved" | "notifications";

type ChannelMenuProps = {
  /** The channel currently open, or `null` when none is selected yet. */
  activeChannelId: string | null;
  messages: ChatMessage[];
  /** Resolves `users.id` → display name; `null` when unresolvable. */
  nameFor: (userId: string) => string | null;
  /** Resolves a channel id → display name; `null` when unknown. */
  channelNameFor: (channelId: string) => string | null;
  onJumpToMessage: (messageId: string) => void;
  onJumpToSearchHit: (hit: ChatSearchHit) => void;
  onJumpToBookmark: (channelId: string, messageId: string) => void;
  bookmarks: BookmarkEntry[];
  bookmarksLoading: boolean;
  bookmarksError: boolean;
  onRemoveBookmark: (messageId: string) => void;
  notificationLevel: ChatNotificationLevel | null;
  notificationSaving: boolean;
  onChangeNotificationLevel: (level: ChatNotificationLevel) => void;
};

type MenuRow = {
  view: Exclude<View, "menu">;
  label: string;
  Glyph: (props: { className?: string }) => React.ReactElement;
  /**
   * Shown after the label. Two of the deleted triggers carried a count badge,
   * which was the only way to see from the header that a channel had pins or
   * that anything was saved. Behind a menu that signal would have been lost
   * outright, so it moves onto the row rather than disappearing with the
   * button that used to hold it.
   */
  count?: number;
};

const VIEW_TITLES: Record<Exclude<View, "menu">, string> = {
  search: "Search messages",
  pins: "Pinned",
  saved: "Saved",
  notifications: "Notifications",
};

export function ChannelMenu({
  activeChannelId,
  messages,
  nameFor,
  channelNameFor,
  onJumpToMessage,
  onJumpToSearchHit,
  onJumpToBookmark,
  bookmarks,
  bookmarksLoading,
  bookmarksError,
  onRemoveBookmark,
  notificationLevel,
  notificationSaving,
  onChangeNotificationLevel,
}: ChannelMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const backRef = useRef<HTMLButtonElement | null>(null);

  /*
    Swapping the view unmounts the row button that was clicked, so focus falls
    to `<body>` and the next Tab restarts from the top of the document — inside
    an open popover, which is disorienting rather than merely untidy. Radix does
    not help here: it manages focus on open and close, not on a content swap
    this component drives itself. The back control is the right landing place —
    it is the panel's title and its way out.

    Keyed on `view` rather than run in the click handler because the back button
    does not exist yet at click time.
  */
  useEffect(() => {
    if (view !== "menu") backRef.current?.focus();
  }, [view]);

  const rows: MenuRow[] = [
    { view: "search", label: "Search messages", Glyph: SearchGlyph },
    {
      view: "pins",
      label: "Pinned",
      Glyph: PinGlyph,
      count: messages.filter((message) => message.is_pinned).length,
    },
    {
      view: "saved",
      label: "Saved",
      Glyph: BookmarkGlyph,
      // Only once the list has actually loaded. A `0` while the query is in
      // flight states "nothing saved", which is the claim the panel's own
      // loading state exists to avoid making.
      count: bookmarksLoading || bookmarksError ? undefined : bookmarks.length,
    },
    { view: "notifications", label: "Notifications", Glyph: MuteGlyph },
  ];

  // Every jump navigates the timeline behind this popover, so the popover has
  // to get out of the way. Closing also resets the view, so the next open
  // starts at the menu rather than resuming wherever the member left off.
  function close() {
    setOpen(false);
    setView("menu");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setView("menu");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          // 32px to a pointer, 44px to a finger — the `pointer-coarse` carve-out
          // `composer.tsx` documents, so the board's density does not cost a
          // touch user the touch-target floor.
          className="h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11"
          disabled={!activeChannelId}
          aria-label="Channel menu"
        >
          <MoreHorizontal className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("p-0", view === "search" ? "w-96" : "w-80")}
        align="end"
      >
        {view === "menu" ? (
          <ul className="divide-y divide-border">
            {rows.map(({ view: target, label, Glyph, count }) => (
              <li key={target}>
                <button
                  type="button"
                  onClick={() => setView(target)}
                  // Spelled out rather than left to name computation: the count
                  // sits in its own element pushed to the far end of the row,
                  // and concatenating the two text nodes yields "Pinned2".
                  aria-label={count ? `${label}, ${count}` : undefined}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-semibold text-foreground transition-colors hover:bg-card"
                >
                  <Glyph className="h-5 w-5 shrink-0 text-muted-foreground" />
                  {label}
                  {count ? (
                    <span className="ml-auto text-[12.5px] font-normal text-muted-foreground">
                      {count}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {/*
              The back control doubles as the panel's title, so the panel bodies
              do not each have to carry a heading of their own — and a member
              who opened the wrong one is one click from the list rather than
              having to dismiss and reopen.
            */}
            <div className="flex items-center gap-1.5 border-b border-border px-2 py-2">
              <Button
                variant="ghost"
                size="icon"
                ref={backRef}
                className="h-7 w-7 pointer-coarse:h-11 pointer-coarse:w-11"
                onClick={() => setView("menu")}
                aria-label="Back to channel menu"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {VIEW_TITLES[view]}
              </span>
            </div>
            {view === "search" ? (
              <ChatSearchPanel
                activeChannelId={activeChannelId}
                channelNameFor={channelNameFor}
                nameFor={nameFor}
                onJump={(hit) => {
                  onJumpToSearchHit(hit);
                  close();
                }}
              />
            ) : null}
            {view === "pins" ? (
              <PinsPanel
                messages={messages}
                nameFor={nameFor}
                onJump={(messageId) => {
                  onJumpToMessage(messageId);
                  close();
                }}
              />
            ) : null}
            {view === "saved" ? (
              <BookmarksPanel
                bookmarks={bookmarks}
                nameFor={nameFor}
                isLoading={bookmarksLoading}
                isError={bookmarksError}
                onJump={(channelId, messageId) => {
                  onJumpToBookmark(channelId, messageId);
                  close();
                }}
                // Removing does NOT close: the member is curating a list, and
                // shutting the panel after each removal would make clearing
                // several bookmarks four clicks apiece.
                onRemove={onRemoveBookmark}
              />
            ) : null}
            {view === "notifications" ? (
              <NotificationLevelPanel
                level={notificationLevel}
                disabled={!activeChannelId}
                isSaving={notificationSaving}
                // Closes, the way the deleted popover's own `setOpen(false)`
                // did. The write is optimistic and its failure is reported by
                // the header's `role="alert"` line, so holding the menu open to
                // watch it is the behaviour that froze the old menu whenever
                // TanStack paused the mutation offline.
                onChange={(level) => {
                  onChangeNotificationLevel(level);
                  close();
                }}
              />
            ) : null}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
