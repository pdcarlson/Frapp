"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchGlyph } from "./chat-glyphs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { asArray } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  resolveAuthorLabel,
  useSearch,
  SEARCH_MIN_QUERY_LENGTH,
} from "@repo/hooks";
import { formatClock } from "@repo/formatting";

/** Scope of a chat search. Defaults to the active channel per #469. */
export type ChatSearchScope = "channel" | "chapter";

export interface ChatSearchHit {
  message: ChatMessage;
  channelId: string;
}

/**
 * Message search for the chat shell — the single-channel form of search that
 * `spec/behavior/chat/README.md` requires ("full-text search within a single
 * channel or across all channels the user can access") and that only the
 * cross-domain command palette ever implemented.
 *
 * Built on `PinsPopover`'s shape rather than a new one: a header-triggered
 * popover whose rows jump the timeline and which dismisses itself on jump, so
 * the panel never covers the message it just scrolled to.
 *
 * **Scoping is a request parameter, not a client-side filter.** `SEARCH_LIMIT`
 * is applied by the database across every channel the caller can read, so
 * filtering a global result down to the active channel would return nothing
 * for a channel whose matches rank below that cut — indistinguishable from a
 * channel with no matches. `useSearch`'s `channelId` pushes the narrowing into
 * SQL, which is the only place it can be correct.
 *
 * Snippets with highlighted matches are **not** here. `ts_headline` is
 * unimplemented for all four search sources and #1356 owns it; doing a quarter
 * of it inside this popover would leave the other three inconsistent. Rows
 * render the message body under the same `line-clamp` treatment the pins panel
 * uses.
 */
export function ChatSearchPopover({
  activeChannelId,
  channelNameFor,
  nameFor,
  onJump,
}: {
  /** The channel currently open, or `null` when none is selected yet. */
  activeChannelId: string | null;
  /** Resolves a channel id → display name; `null` when unknown. */
  channelNameFor: (channelId: string) => string | null;
  /** Resolves `users.id` → display name; `null` when unresolvable. */
  nameFor: (userId: string) => string | null;
  /**
   * Navigate to a hit. The shell decides whether that means scrolling the
   * current timeline or switching channel first — search does not need to know.
   */
  onJump: (hit: ChatSearchHit) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ChatSearchScope>("channel");

  const debouncedQuery = useDebouncedValue(query.trim(), 200);
  const hasMinQuery = debouncedQuery.length >= SEARCH_MIN_QUERY_LENGTH;
  // True while the member has typed something the debounce has not caught up
  // to. Without this the panel shows the PREVIOUS query's hits as though they
  // were current for 200ms — `isFetching` is false in that window because no
  // request is in flight yet — and a fast click jumps to a message that does
  // not match what is on screen.
  const isSettling = query.trim() !== debouncedQuery;

  // With no channel open there is nothing to scope to, so the effective scope
  // is chapter-wide. `effectiveScope` (not `scope`) drives the request, the tab
  // state AND the per-row channel labels, so the three cannot disagree — the
  // earlier split let the tab render "This channel" as checked while the search
  // ran chapter-wide and the rows hid the labels that would have shown it.
  const effectiveScope: ChatSearchScope = activeChannelId ? scope : "chapter";
  const channelFilter =
    effectiveScope === "channel" && activeChannelId
      ? activeChannelId
      : undefined;

  // Gated on `open`: Radix keeps this component mounted and only unmounts
  // `PopoverContent`, so an ungated query kept living in a closed popover —
  // and with `staleTime: 0` plus the app's global `refetchOnWindowFocus`, every
  // later tab refocus re-issued a search nobody was looking at, against a route
  // whose throttle bucket the ⌘K palette shares.
  const search = useSearch(
    open && hasMinQuery ? debouncedQuery : "",
    channelFilter,
  );

  const hits = useMemo<ChatSearchHit[]>(() => {
    const payload = search.data?.payload as { messages?: unknown } | undefined;
    return asArray<ChatMessage>(payload?.messages)
      .filter((message) => typeof message.channel_id === "string")
      .map((message) => ({
        message,
        channelId: message.channel_id as string,
      }));
  }, [search.data]);

  // The message source specifically — a chat search that timed out has nothing
  // to say about the other three, which this form does not even run.
  const messagesTimedOut = Boolean(
    search.data?.timedOutSources.includes("messages"),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" aria-label="Search messages">
          <SearchGlyph className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="border-b border-border p-3">
          <Input
            type="search"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search messages…"
            aria-label="Search messages"
          />
          <div
            className="mt-2 flex items-center gap-1"
            role="radiogroup"
            aria-label="Search scope"
          >
            <ScopeTab
              label="This channel"
              selected={effectiveScope === "channel"}
              disabled={!activeChannelId}
              onSelect={() => setScope("channel")}
            />
            <ScopeTab
              label="All channels"
              selected={effectiveScope === "chapter"}
              onSelect={() => setScope("chapter")}
            />
          </div>
        </div>

        <div aria-live="polite" role="status" className="sr-only">
          {/*
            Announces a count ONLY for a settled, successful search. Gating this
            on `!isFetching` alone announced "0 results" over the top of "Search
            failed" and "Search timed out" — telling a screen-reader user the
            channel holds no match when the search never finished, which is
            precisely the "we stopped looking" vs "we found nothing" distinction
            spec/behavior/search.md requires the client to preserve.
          */}
          {hasMinQuery &&
          !isSettling &&
          !search.isFetching &&
          !search.isError &&
          !messagesTimedOut
            ? `${hits.length} ${hits.length === 1 ? "result" : "results"}`
            : ""}
        </div>

        <ChatSearchResults
          hasMinQuery={hasMinQuery}
          // `isSettling` folds the debounce window into the pending state, so
          // the panel never presents one query's hits under another's text.
          // `isFetching && !search.data` (not bare `isFetching`) keeps a
          // background refetch from blanking a list the member is reading.
          isPending={isSettling || (search.isFetching && !search.data)}
          isError={search.isError}
          onRetry={() => void search.refetch()}
          timedOut={messagesTimedOut}
          hits={hits}
          scope={effectiveScope}
          activeChannelId={activeChannelId}
          channelNameFor={channelNameFor}
          nameFor={nameFor}
          onPick={(hit) => {
            // Dismiss before jumping, for the same reason the pins panel does:
            // a 384px panel left open over the pane it just scrolled hides the
            // message it navigated to.
            setOpen(false);
            onJump(hit);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function ScopeTab({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "rounded-md px-2 py-1 text-[12.5px] font-semibold transition-colors",
        selected
          ? "bg-accent-subtle text-accent-text"
          : "text-muted-foreground hover:bg-accent-subtle hover:text-accent-text",
        // components.md §3's single disabled recipe — card fill, neutral
        // hairline, `--disabled` text — matching `button.tsx`, which bans
        // `opacity-50` by name because it dims label and fill equally and lands
        // wherever the underlying colour happened to be. `pointer-events-none`
        // is part of that recipe and also stops the hover rules above from
        // recolouring a control that cannot be used.
        disabled &&
          "pointer-events-none border border-border bg-card text-disabled",
        FOCUS_RING,
      )}
    >
      {label}
    </button>
  );
}

function ChatSearchResults({
  hasMinQuery,
  isPending,
  isError,
  onRetry,
  timedOut,
  hits,
  scope,
  activeChannelId,
  channelNameFor,
  nameFor,
  onPick,
}: {
  hasMinQuery: boolean;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  timedOut: boolean;
  hits: ChatSearchHit[];
  scope: ChatSearchScope;
  activeChannelId: string | null;
  channelNameFor: (channelId: string) => string | null;
  nameFor: (userId: string) => string | null;
  onPick: (hit: ChatSearchHit) => void;
}) {
  if (!hasMinQuery) {
    return (
      <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
        Type at least {SEARCH_MIN_QUERY_LENGTH} characters to search
        {scope === "channel" && activeChannelId
          ? " this channel."
          : " every channel you can read."}
      </p>
    );
  }
  if (isPending) {
    return (
      <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
        Searching…
      </p>
    );
  }
  // An erroring source fails the whole request as a 500 (only slowness
  // degrades), so this is a real failure and gets a retry rather than being
  // painted as "no matches".
  if (isError) {
    return (
      <div className="px-3 py-4">
        <p role="alert" className="text-[12.5px] text-destructive">
          Search failed.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          onClick={onRetry}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (hits.length === 0) {
    return (
      <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
        {timedOut
          ? // "We stopped looking here" is not "we found nothing", and
            // spec/behavior/search.md requires the client to tell them apart.
            "Search timed out before it finished. Try a narrower query."
          : "No messages match that search."}
      </p>
    );
  }

  return (
    <>
      {timedOut ? (
        <p className="border-b border-border px-3 py-2 text-[12.5px] text-muted-foreground">
          Search timed out — some matches may be missing.
        </p>
      ) : null}
      <ul className="max-h-80 divide-y divide-border overflow-y-auto">
        {hits.map((hit) => {
          const channelName = channelNameFor(hit.channelId);
          const showChannel =
            scope === "chapter" && hit.channelId !== activeChannelId;
          return (
            <li key={hit.message.id}>
              <button
                type="button"
                onClick={() => onPick(hit)}
                className={cn(
                  "block w-full px-3 py-3 text-left text-[12.5px] transition-colors",
                  "hover:bg-accent-subtle hover:text-accent-text",
                  FOCUS_RING,
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold text-foreground">
                    {/* viewerId null, matching the pins panel: results name
                        every author including the viewer rather than "You". */}
                    {resolveAuthorLabel(hit.message, nameFor, null)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatClock(hit.message.created_at)}
                  </span>
                </span>
                {showChannel ? (
                  <span className="mt-0.5 block truncate text-muted-foreground">
                    {/* A hit in another channel says so — picking it switches
                        channel, and an unlabelled row would make that jump
                        look like the timeline lost its place. */}
                    in {channelName ?? "another channel"}
                  </span>
                ) : null}
                {/* foundations §7: message prose is body text, never below 16. */}
                <span className="mt-1 line-clamp-3 block whitespace-pre-wrap text-base text-muted-foreground">
                  {hit.message.content}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
