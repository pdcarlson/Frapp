"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { asArray } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  hasMessageFilter,
  isSearchRunnable,
  memberLabel,
  resolveAuthorLabel,
  useSearch,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchFilters,
  type SearchHasTrait,
} from "@repo/hooks";
import { formatDayTime, localIsoDate } from "@repo/formatting";
import { CHIP, CHIP_HIT_AREA } from "./chip";
import {
  SEARCH_DATE_PRESETS,
  SEARCH_HAS_TRAITS,
  isSearchToken,
  matchChannelOptions,
  matchMemberOptions,
  parseSearchToken,
  searchDateBounds,
  searchDateLabel,
  type SearchDateFilter,
  type SearchPickerOption,
  type SearchTokenKind,
} from "./chat-search-filters";
import { replyPreviewText } from "./reply-quote";

export type { SearchPickerOption } from "./chat-search-filters";

export interface ChatSearchHit {
  message: ChatMessage;
  channelId: string;
}

/** The In picker's first row: every channel the member can read. */
const ALL_CHANNELS: SearchPickerOption = { id: "", label: "All channels" };

/**
 * Message search for the chat shell: the form of search
 * `spec/behavior/chat/README.md` specifies (§ Messages, the **Search** block), narrowed by four filter
 * chips (#3958): **From** (one member), **In** (one channel the member can
 * read, or all of them), **Date** and **Has**.
 *
 * Content only: this is the "search" view of the channel overflow menu
 * (`channel-menu.tsx`), which owns the Popover, its `⋯` trigger, its width and
 * its back header. Rows jump the timeline, and the host closes the menu on
 * jump so the panel never covers the message it just scrolled to.
 *
 * **From and In have one picker each, reached two ways.** Typing `from:` or
 * `in:` at the end of the box opens it, the way Slack and Discord do, and the
 * chip does the same thing by writing that word into the box. So there is one
 * list, one keyboard model (arrows and Enter from the box) and no popover
 * inside the menu's popover.
 *
 * **Every filter is a request parameter, not a client-side filter.**
 * `SEARCH_LIMIT` is applied by the database across every channel the caller
 * can read, so narrowing a wider result here would return nothing for a
 * channel, sender or week whose matches rank below that cut. `useSearch`
 * pushes each one into SQL, which is the only place it can be correct. The
 * API applies them inside the caller's accessible-channel set, so a filter
 * never widens what a member can read.
 *
 * Snippets with highlighted matches are **not** here. `ts_headline` is
 * unimplemented for all four search sources and #1356 owns it. Rows render
 * `replyPreviewText`, so a poll or a file-only hit is a noun rather than an
 * empty grey block (#1726).
 */
export function ChatSearchPanel({
  activeChannelId,
  channels,
  members,
  channelNameFor,
  nameFor,
  onJump,
}: {
  /** The channel currently open, or `null` when none is selected yet. */
  activeChannelId: string | null;
  /** Every channel the member can read, by the name they know it by. */
  channels: readonly SearchPickerOption[];
  /** The chapter's members, for the From picker. */
  members: readonly SearchPickerOption[];
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
  const [query, setQuery] = useState("");
  const [fromUserId, setFromUserId] = useState<string | null>(null);
  // `undefined` until the member touches In: the filter then follows the open
  // channel (#469), including one that resolves after the panel mounted on a
  // cold load. `null` is every readable channel.
  const [channelChoice, setChannelId] = useState<string | null | undefined>(
    undefined,
  );
  const channelId =
    channelChoice === undefined ? activeChannelId : channelChoice;
  const [date, setDate] = useState<SearchDateFilter>({ preset: "any" });
  const [has, setHas] = useState<readonly SearchHasTrait[]>([]);
  const [openPanel, setOpenPanel] = useState<"date" | "has" | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  // A `from:` / `in:` being typed is the picker's filter, not search text,
  // but only while it could still pick something (`isSearchToken`).
  const candidate = parseSearchToken(query);
  const candidateOptions = useMemo(() => {
    if (!candidate) return [];
    return candidate.kind === "from"
      ? matchMemberOptions(members, candidate.partial)
      : [
          ...matchChannelOptions([ALL_CHANNELS], candidate.partial),
          ...matchChannelOptions(channels, candidate.partial),
        ];
    // `candidate` is rebuilt every render; its two fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.kind, candidate?.partial, members, channels]);
  const token =
    candidate && isSearchToken(candidate, candidateOptions.length)
      ? candidate
      : null;
  const options = token ? candidateOptions : [];
  const text = (token ? token.rest : query).trim();
  const activeOption = options[Math.min(activeIndex, options.length - 1)];

  // Arrowing moves the highlight, not focus, so the browser will not scroll
  // the list for it; without this Enter picks a row below the fold.
  const activeOptionId =
    token && activeOption ? `${listId}-${activeOption.id || "all"}` : undefined;
  useEffect(() => {
    if (!activeOptionId) return;
    document
      .getElementById(activeOptionId)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId]);

  const debouncedText = useDebouncedValue(text, 200);
  // True while the member has typed something the debounce has not caught up
  // to. Without this the panel shows the PREVIOUS query's hits as though they
  // were current for 200ms — `isFetching` is false in that window because no
  // request is in flight yet — and a fast click jumps to a message that does
  // not match what is on screen. Filters are not debounced: a pick is one
  // deliberate act, and the query key changes with it at once. The one filter
  // that is typed, a custom date, sends nothing until its year is finished
  // (`searchDateBounds`).
  const isSettling = text !== debouncedText;

  // The local day is part of the memo so "Today" picked before midnight does
  // not keep yesterday's bound in a panel left open past it.
  const today = localIsoDate(new Date());
  const filters = useMemo<SearchFilters>(
    () => ({
      ...(channelId ? { channelId } : {}),
      ...(fromUserId ? { fromUserId } : {}),
      ...searchDateBounds(date, new Date()),
      ...(has.length > 0 ? { has } : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelId, fromUserId, date, has, today],
  );
  const isRunnable = isSearchRunnable(debouncedText, filters);

  // `useSearch` holds the request back until the text and filters are
  // something the API will search (`isSearchRunnable`). There is no `open`
  // gate: `channel-menu.tsx` mounts this panel only while its view is
  // selected, so mounted means open and the query dies with the view. Keep
  // this panel out of a closed menu rather than adding an `open` flag: with
  // `staleTime: 0` and the app's `refetchOnWindowFocus`, a query living behind
  // a closed menu re-runs on every tab refocus, against a route whose throttle
  // bucket the find bar shares.
  const search = useSearch(debouncedText, filters);

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

  function focusInput() {
    inputRef.current?.focus();
  }

  /** The chip's half of the picker: write the word the member could have typed. */
  function startToken(kind: SearchTokenKind) {
    setOpenPanel(null);
    setActiveIndex(0);
    setQuery((current) => {
      const open = parseSearchToken(current);
      // A second press on the same chip puts the picker away.
      if (open?.kind === kind) return open.rest.trimEnd();
      const rest = (open ? open.rest : current).trimEnd();
      return `${rest}${rest ? " " : ""}${kind}:`;
    });
    focusInput();
  }

  function pick(option: SearchPickerOption) {
    if (!token) return;
    if (token.kind === "from") setFromUserId(option.id);
    else setChannelId(option.id || null);
    setQuery(token.rest);
    setActiveIndex(0);
    focusInput();
  }

  /**
   * Clearing a chip unmounts the button that was pressed. Left alone, focus
   * falls to `<body>` and the next Tab dismisses the menu's non-modal popover
   * with the whole search in it (`channel-menu.tsx`), so it goes to the box.
   */
  function clear(reset: () => void) {
    reset();
    focusInput();
  }

  /**
   * Escape closes the picker, not the menu: `channel-menu.tsx` holds the
   * popover open while this panel's combobox is expanded, and this puts the
   * picker away. On the panel's header, not the box, because focus may be on
   * a chip when the member presses it.
   */
  function onHeaderKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !token) return;
    event.preventDefault();
    setQuery(token.rest.trimEnd());
    focusInput();
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!token || options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (index) =>
          (Math.min(index, options.length - 1) + step + options.length) %
          options.length,
      );
    } else if (event.key === "Enter" && activeOption) {
      event.preventDefault();
      pick(activeOption);
    }
  }

  // `memberLabel`, the spelling the picker row had (#2422).
  const fromName = fromUserId
    ? memberLabel(nameFor(fromUserId), fromUserId)
    : null;
  const inName = channelId ? (channelNameFor(channelId) ?? "a channel") : null;
  const dateLabel = searchDateLabel(date);
  const hasLabel =
    has.length > 0
      ? SEARCH_HAS_TRAITS.filter((entry) => has.includes(entry.trait))
          .map((entry) => entry.label.toLowerCase())
          .join(", ")
      : null;

  return (
    <>
      <div className="border-b border-border p-3" onKeyDown={onHeaderKeyDown}>
        <Input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={token !== null}
          aria-controls={token ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            if (parseSearchToken(event.target.value)) setOpenPanel(null);
          }}
          onKeyDown={onInputKeyDown}
          placeholder="Search messages…"
          aria-label="Search messages"
        />
        <div
          className="mt-2 flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Search filters"
        >
          <FilterChip
            name="From"
            value={fromName}
            expanded={token?.kind === "from"}
            onOpen={() => startToken("from")}
            onClear={() => clear(() => setFromUserId(null))}
          />
          <FilterChip
            name="In"
            value={inName}
            expanded={token?.kind === "in"}
            onOpen={() => startToken("in")}
            onClear={() => clear(() => setChannelId(null))}
          />
          <FilterChip
            name="Date"
            value={dateLabel}
            expanded={!token && openPanel === "date"}
            onOpen={() => {
              // An open `from:` picker would hide the panel this opens.
              if (token) setQuery(token.rest.trimEnd());
              setOpenPanel((current) => (current === "date" ? null : "date"));
            }}
            onClear={() => clear(() => setDate({ preset: "any" }))}
          />
          <FilterChip
            name="Has"
            value={hasLabel}
            expanded={!token && openPanel === "has"}
            onOpen={() => {
              if (token) setQuery(token.rest.trimEnd());
              setOpenPanel((current) => (current === "has" ? null : "has"));
            }}
            onClear={() => clear(() => setHas([]))}
          />
        </div>

        {token ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={token.kind === "from" ? "Members" : "Channels"}
            className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border"
          >
            {options.length === 0 ? (
              <li className="px-3 py-2 text-caption text-muted-foreground">
                {token.kind === "from"
                  ? `No member named “${token.partial}”.`
                  : `No channel named “${token.partial}”.`}
              </li>
            ) : (
              options.map((option) => (
                <li
                  key={option.id || "all"}
                  id={`${listId}-${option.id || "all"}`}
                  role="option"
                  aria-selected={option === activeOption}
                  // `mousedown`, prevented, so the box keeps focus and the
                  // menu's popover never sees focus leave it mid-pick.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(option)}
                  className={cn(
                    "cursor-pointer truncate px-3 py-2 text-sm text-foreground pointer-coarse:py-3",
                    option === activeOption
                      ? "bg-card-hover"
                      : "hover:bg-card-hover",
                  )}
                >
                  {option.label}
                </li>
              ))
            )}
          </ul>
        ) : null}

        {!token && openPanel === "date" ? (
          <div className="mt-2">
            <div
              className="flex flex-wrap items-center gap-1"
              role="radiogroup"
              aria-label="Date"
            >
              {SEARCH_DATE_PRESETS.map(({ preset, label }) => (
                <OptionPill
                  key={preset}
                  role="radio"
                  label={label}
                  selected={date.preset === preset}
                  onSelect={() =>
                    setDate((current) => ({ ...current, preset }))
                  }
                />
              ))}
            </div>
            {date.preset === "custom" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-caption text-muted-foreground">
                  From
                  <Input
                    type="date"
                    className="w-auto"
                    value={date.from ?? ""}
                    max={date.to || undefined}
                    onChange={(event) =>
                      setDate((current) => ({
                        ...current,
                        from: event.target.value || undefined,
                      }))
                    }
                  />
                </label>
                <label className="flex items-center gap-1.5 text-caption text-muted-foreground">
                  To
                  <Input
                    type="date"
                    className="w-auto"
                    value={date.to ?? ""}
                    min={date.from || undefined}
                    onChange={(event) =>
                      setDate((current) => ({
                        ...current,
                        to: event.target.value || undefined,
                      }))
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : null}

        {!token && openPanel === "has" ? (
          <div
            className="mt-2 flex flex-wrap items-center gap-1"
            role="group"
            aria-label="Has"
          >
            {SEARCH_HAS_TRAITS.map(({ trait, label }) => (
              <OptionPill
                key={trait}
                label={label}
                selected={has.includes(trait)}
                onSelect={() =>
                  setHas((current) =>
                    current.includes(trait)
                      ? current.filter((entry) => entry !== trait)
                      : [...current, trait],
                  )
                }
              />
            ))}
          </div>
        ) : null}
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
        {isRunnable &&
        !isSettling &&
        !search.isFetching &&
        !search.isError &&
        !messagesTimedOut
          ? `${hits.length} ${hits.length === 1 ? "result" : "results"}`
          : ""}
      </div>

      <ChatSearchResults
        isRunnable={isRunnable}
        hasFilter={hasMessageFilter(filters)}
        // `isSettling` folds the debounce window into the pending state, so
        // the panel never presents one query's hits under another's text.
        // `isFetching && !search.data` (not bare `isFetching`) keeps a
        // background refetch from blanking a list the member is reading.
        isPending={isSettling || (search.isFetching && !search.data)}
        isError={search.isError}
        onRetry={() => void search.refetch()}
        timedOut={messagesTimedOut}
        hits={hits}
        searchedChannelId={channelId}
        activeChannelId={activeChannelId}
        channelNameFor={channelNameFor}
        nameFor={nameFor}
        // Dismissal on jump is the host's now, and it still has to happen for
        // the reason the pins panel first recorded: a panel left open over the
        // pane it just scrolled hides the message it navigated to.
        onPick={onJump}
      />
    </>
  );
}

/**
 * One filter: its name while unset, `name: value` in the accent badge once
 * set, with a clear button beside it. The chip is `chip.ts`'s geometry; the
 * unset paint is a hairline outline rather than `CHIP.neutral`, whose
 * `bg-popover` fill is this panel's own surface and would draw nothing.
 */
function FilterChip({
  name,
  value,
  expanded,
  onOpen,
  onClear,
}: {
  name: string;
  value: string | null;
  expanded: boolean;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-0.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onOpen}
        className={cn(
          CHIP.base,
          CHIP_HIT_AREA,
          "min-w-0 max-w-full shrink",
          value
            ? CHIP.accent
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        <span className="truncate">{value ? `${name}: ${value}` : name}</span>
      </button>
      {value ? (
        <button
          type="button"
          aria-label={`Clear ${name} filter`}
          onClick={onClear}
          className={cn(
            "inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:text-foreground",
            "pointer-coarse:h-11 pointer-coarse:w-11",
            FOCUS_RING,
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </span>
  );
}

/** One choice inside the Date or Has panel: a radio, or a toggle without `role`. */
function OptionPill({
  label,
  selected,
  role,
  onSelect,
}: {
  label: string;
  selected: boolean;
  role?: "radio";
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={role}
      {...(role === "radio"
        ? { "aria-checked": selected }
        : { "aria-pressed": selected })}
      onClick={onSelect}
      className={cn(
        "rounded-md px-2 py-1 text-caption font-semibold transition-colors pointer-coarse:min-h-11",
        selected
          ? "bg-accent-subtle text-accent-text"
          : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
        FOCUS_RING,
      )}
    >
      {label}
    </button>
  );
}

function ChatSearchResults({
  isRunnable,
  hasFilter,
  isPending,
  isError,
  onRetry,
  timedOut,
  hits,
  searchedChannelId,
  activeChannelId,
  channelNameFor,
  nameFor,
  onPick,
}: {
  /** The text and filters are something the API will search. */
  isRunnable: boolean;
  /** A sender, date or content filter is set (a channel alone is not one). */
  hasFilter: boolean;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  timedOut: boolean;
  hits: ChatSearchHit[];
  /** The In filter: one channel, or `null` for every readable one. */
  searchedChannelId: string | null;
  activeChannelId: string | null;
  channelNameFor: (channelId: string) => string | null;
  nameFor: (userId: string) => string | null;
  onPick: (hit: ChatSearchHit) => void;
}) {
  if (!isRunnable) {
    // One or two characters are refused even beside a filter, so a filter does
    // not change what to say; without one, say that a filter alone is enough.
    return (
      <p className="px-3 py-4 text-caption text-muted-foreground">
        Type at least {SEARCH_MIN_QUERY_LENGTH} characters to search
        {searchedChannelId === null
          ? " every channel you can read"
          : searchedChannelId === activeChannelId
            ? " this channel"
            : ` ${channelNameFor(searchedChannelId) ?? "that channel"}`}
        {hasFilter
          ? "."
          : ", or pick From, Date or Has to search without text."}
      </p>
    );
  }
  if (isPending) {
    return (
      <p className="px-3 py-4 text-caption text-muted-foreground">Searching…</p>
    );
  }
  // An erroring source fails the whole request as a 500 (only slowness
  // degrades), so this is a real failure and gets a retry rather than being
  // painted as "no matches".
  if (isError) {
    return (
      <div className="px-3 py-4">
        <p role="alert" className="text-caption text-destructive-text">
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
      <p className="px-3 py-4 text-caption text-muted-foreground">
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
        <p className="border-b border-border px-3 py-2 text-caption text-muted-foreground">
          Search timed out. Some matches may be missing.
        </p>
      ) : null}
      {/*
        Taller than `PinsPanel` and `BookmarksPanel`'s `max-h-72` (#3859's
        cheap half, for this view only): the chips took a row, and a filtered
        search is read as a list. Capped by the viewport so the popover never
        runs off a short window.
      */}
      <ul className="max-h-[min(26rem,50vh)] divide-y divide-border overflow-y-auto">
        {hits.map((hit) => {
          const channelName = channelNameFor(hit.channelId);
          // Whatever In holds: with In on another channel every hit is
          // outside the channel in view, and each still says where it is.
          const showChannel = hit.channelId !== activeChannelId;
          return (
            <li key={hit.message.id}>
              <button
                type="button"
                onClick={() => onPick(hit)}
                className={cn(
                  "block w-full px-3 py-3 text-left text-caption transition-colors",
                  "hover:bg-card-hover hover:text-foreground",
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
                    {/* Day and time: hits span days, and a Date filter is
                        only checkable against a date. */}
                    {formatDayTime(hit.message.created_at)}
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
                  {replyPreviewText(hit.message)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
