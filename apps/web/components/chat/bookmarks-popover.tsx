"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookmarkGlyph } from "./chat-glyphs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import type { MessageAuthor } from "@repo/hooks";
import { resolveAuthorLabel } from "@repo/hooks";
import { formatClock } from "@repo/formatting";

/**
 * The message as `GET /v1/bookmarks` serves it — a nine-field projection, not
 * a `ChatMessage`.
 *
 * Typed narrowly on purpose. This was `ChatMessage` while the endpoint really
 * did return all 19 columns; once the API narrowed to what `BookmarkedMessageDto`
 * declares, keeping the wide type would have been a lie the compiler happily
 * enforced — every field this panel does not receive would still autocomplete
 * and typecheck, and read `undefined` at runtime. `MessageAuthor` is the shared
 * shape `resolveAuthorLabel` already accepts, which is why it takes a structural
 * type rather than the full row.
 */
export interface BookmarkedMessage extends MessageAuthor {
  id: string;
  channel_id: string;
  content: string;
  is_deleted: boolean;
  created_at: string;
}

export interface BookmarkEntry {
  id: string;
  message_id: string;
  created_at: string;
  message: BookmarkedMessage;
  /**
   * False when the viewer has lost access to the message's channel since
   * saving it. The API redacts `message` in that case; this row must not offer
   * a jump, because the channel is no longer in the viewer's channel list and
   * navigating to it would silently drop them into #general instead.
   */
  message_available?: boolean;
}

/**
 * The viewer's personal Bookmarks view (#462), scoped to the active chapter.
 *
 * **Chapter-wide, not channel-scoped** — that is the one structural difference
 * from the sibling `PinsPopover` and it is what the spec asks for: "Bookmarked
 * messages appear in a personal 'Bookmarks' view, scoped per chapter." So a row
 * here may belong to a channel the viewer is not currently looking at, which is
 * why `onJump` takes the channel id too and the shell switches channel before
 * scrolling.
 *
 * Two things this panel deliberately never shows, because showing either would
 * break the privacy guarantee the feature exists for: a count of who else
 * bookmarked a message, and any other member's bookmarks. The API cannot answer
 * those questions, so there is nothing to render even by accident.
 */
export function BookmarksPopover({
  bookmarks,
  nameFor,
  isLoading,
  isError,
  onJump,
  onRemove,
}: {
  bookmarks: BookmarkEntry[];
  /** Resolves `users.id` → display name; `null` when unresolvable. */
  nameFor: (userId: string) => string | null;
  isLoading?: boolean;
  isError?: boolean;
  onJump?: (channelId: string, messageId: string) => void;
  /**
   * Removes a bookmark from this panel.
   *
   * **Load-bearing, not a convenience.** The only other way to un-bookmark is
   * the "Saved" chip on the message row, which is reachable only from a channel
   * the member can still open — so without this control a bookmark in a channel
   * they lost access to would be permanently stuck in their panel. The API was
   * changed (#462) so that removing such a row succeeds; this is what lets a
   * member actually ask for it.
   */
  onRemove?: (messageId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`${bookmarks.length} bookmarked messages`}
        >
          <BookmarkGlyph className="h-5 w-5" />
          {bookmarks.length > 0 ? <span>{bookmarks.length}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <p className="border-b border-border px-3 py-3 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Your bookmarks
        </p>
        {/*
          Loading and error are distinct states rather than both collapsing to
          the empty copy: "you have no bookmarks" is a claim about the member's
          data, and asserting it while the request is in flight or has failed is
          the false-empty defect components.md §5 bans.
        */}
        {isLoading ? (
          <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
            Loading your bookmarks…
          </p>
        ) : isError ? (
          <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
            Couldn’t load your bookmarks. Reopen this panel to try again.
          </p>
        ) : bookmarks.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
            Nothing saved yet. Save a message to keep it here — only you can see
            your bookmarks.
          </p>
        ) : (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {bookmarks.map((bookmark) => {
              // `!== false` rather than truthiness: an older cached payload has
              // no such field, and treating "unknown" as "unavailable" would
              // make every row inert for one render after a deploy.
              const available = bookmark.message_available !== false;
              const body = (
                <>
                  <span className="block font-semibold text-foreground">
                    {/* viewerId null, matching the pins panel: this list names
                        every author including the viewer rather than "You". */}
                    {available
                      ? resolveAuthorLabel(bookmark.message, nameFor, null)
                      : "Unavailable"}
                  </span>
                  <span className="block text-muted-foreground">
                    {formatClock(bookmark.created_at)}
                  </span>
                  {/*
                    A deleted message keeps its row here carrying the
                    `[message deleted]` placeholder the API returns — the spec
                    requires the bookmark to survive the deletion rather than
                    vanish. It is italicised so it reads as a tombstone rather
                    than as somebody having typed that. A redacted row is
                    italicised for the same reason: neither string was typed by
                    a person.

                    foundations §7 is a hard MUST NOT on body text below 16, and
                    a bookmark's body is a message.
                  */}
                  <span
                    className={cn(
                      "mt-1 line-clamp-3 block whitespace-pre-wrap text-base text-muted-foreground",
                      (bookmark.message.is_deleted || !available) && "italic",
                    )}
                  >
                    {bookmark.message.content}
                  </span>
                </>
              );
              return (
                <li key={bookmark.id} className="relative">
                  {/*
                    A row whose channel the viewer can no longer read is a
                    static <div>, not a disabled <button>. Jumping would set the
                    shell's channel to one absent from the viewer's channel
                    list, which silently resolves to #general and never scrolls
                    — a control that appears to work and quietly does the wrong
                    thing, which is worse than the dead ends components.md §5
                    already bans.
                  */}
                  {available ? (
                    <button
                      type="button"
                      onClick={() => {
                        // Dismiss on jump, for the reason the pins panel
                        // records: a 320px panel left open over the pane it
                        // just scrolled hides the message it navigated to.
                        setOpen(false);
                        onJump?.(
                          bookmark.message.channel_id,
                          bookmark.message_id,
                        );
                      }}
                      className={cn(
                        "block w-full py-3 pl-3 pr-11 text-left text-[12.5px] transition-colors",
                        "hover:bg-accent-subtle hover:text-accent-text",
                        FOCUS_RING,
                      )}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="block w-full py-3 pl-3 pr-11 text-left text-[12.5px]">
                      {body}
                    </div>
                  )}
                  {onRemove ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      // The shared primitive, not a hand-rolled button:
                      // `thread-panel.tsx` uses exactly this for the same
                      // dismiss-an-item job, and a bespoke 22px target here
                      // sat under the design system's touch floor — on the one
                      // control that exists so a member can clear a bookmark
                      // they have no other way to reach.
                      //
                      // Absolutely positioned rather than a flex sibling so the
                      // row's own hit area stays full-width for the jump:
                      // shrinking the common action to fit the rare one is the
                      // wrong trade.
                      className="absolute right-1 top-1"
                      aria-label="Remove bookmark"
                      onClick={() => onRemove(bookmark.message_id)}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
