"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  BookOpen,
  CalendarDays,
  Hash,
  MessageSquareText,
  Search,
  User,
  type LucideIcon,
} from "lucide-react";
import {
  useChannels,
  useDepartments,
  usePermissionList,
  useSearch,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_COMPLETED_EVENT,
} from "@repo/hooks";
import { ASK_COPY, canAny } from "@repo/validation";
import { useAskEntry } from "@/components/ask/ask-host";
import { FrappCrest } from "@/components/ask/frapp-crest";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useChapterModuleGate } from "@/lib/hooks/use-chapter-module-gate";
import { asArray, cn } from "@/lib/utils";
import { AnalyticsContext } from "@/lib/providers/analytics-provider";
import { FOCUS_RING } from "@/components/ui/focus";
import { DialogOverlay } from "@/components/ui/dialog";
import { EYEBROW } from "@/components/ui/typography";
import { asksFirst } from "@/components/layout/find-ask";
import {
  FIND_GROUPS,
  buildFindResults,
  type FindFilter,
  type FindGroup,
  type FindResult,
} from "@/components/layout/find-results";

/**
 * The Find dialog: a centered search over channels, members, messages, events
 * and backwork, opened by Cmd/Ctrl+F or the top-bar field (`find-bar.tsx`).
 *
 * **Why a dialog again.** #2141 replaced the ⌘K palette with a field that
 * dropped its results under itself, 520px wide. Paul picked a centered dialog
 * instead on 2026-11-05 (option A of the Find and Ask proposal): results get
 * the room for full message previews, dates, and two more groups, and filter
 * chips narrow it without retyping. The top-bar field stays as the visible way
 * in, so the shortcut is still a convenience rather than the only door.
 *
 * **The same field asks Frapp** (#4904, Paul's pick of 2026-11-13: one
 * field for search and Ask). For a member with Ask (`useAskEntry`), the
 * first row of the list is "Ask Frapp" with what they typed; choosing it
 * closes this dialog and opens the conversation in its place with the
 * question already asked (`ask-card.tsx`). Slack's search and Linear's and
 * Notion's command menus offer a question the same way. Which of the two
 * Enter means is decided from the words alone (`find-ask.ts`), never from
 * results arriving, so the highlight does not move under a keypress: words
 * that read as a question highlight the Ask row, anything else highlights
 * the first result, and the Ask row takes over only once a search has
 * settled with nothing to show. A member without Ask sees none of this.
 *
 * Find lists places to go, from everything the member can read. Ask answers
 * a question from the chapter's sources (`spec/behavior/ai.md`). Per
 * foundations §6 the highlighted row is a neutral `--card-hover` fill, like
 * every menu highlight; only the active filter chip and the Ask row's crest
 * take the chapter accent.
 *
 * Focus never leaves the input while arrowing: the list is an
 * `aria-activedescendant` listbox, as the field's dropdown was.
 */

export const FIND_PLACEHOLDER = "Find channels, members, messages and more";
/** The field's words for a member who can also ask Frapp from it. */
export const FIND_ASK_PLACEHOLDER = "Search or ask Frapp";

const GROUP_ICON: Record<FindGroup, LucideIcon> = {
  Channels: Hash,
  Members: User,
  Messages: MessageSquareText,
  Events: CalendarDays,
  Backwork: BookOpen,
};

const MODULE_FOR_GROUP: Partial<Record<FindGroup, string>> = {
  Events: "events",
  Backwork: "backwork",
};

/**
 * The library's own gate (`BackworkController`, any of the two). `/v1/search`
 * applies it too and sends such a member no backwork rows; hiding the group
 * here also drops its chip and skips the department read, which would 403.
 */
const BACKWORK_BROWSE = ["backwork:upload", "backwork:admin"] as const;

/** Which group each `/v1/search` source fills, for its timeout notice. */
const GROUP_FOR_SOURCE: Record<string, FindGroup> = {
  backwork: "Backwork",
  events: "Events",
  members: "Members",
  messages: "Messages",
};

type FindDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Owned by the trigger so a closed dialog keeps what was typed. */
  query: string;
  onQueryChange: (query: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Puts focus back where it was before the dialog opened. */
  onCloseFocus: () => void;
  /**
   * Select the kept query on open (the default), so typing replaces it. Off
   * when the dialog opened from a keystroke on the field, which already put
   * that character in the query: selecting it would let the next one erase it.
   */
  selectOnOpen?: boolean;
  /**
   * The member chose the Ask row: hand the question (or none, to open the
   * conversation as it stands) to Ask. The caller closes this dialog.
   */
  onAsk?: (question: string) => void;
};

export function FindDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  inputRef,
  onCloseFocus,
  selectOnOpen = true,
  onAsk,
}: FindDialogProps) {
  /*
   * The last query a `search-completed` event went out for. Held here, not in
   * the panel, because the panel unmounts on close and the query survives it:
   * reopening refetches the kept query (`staleTime: 0`), and without this the
   * refetch would count as a search the member never re-ran.
   */
  const lastTrackedQueryRef = useRef<string | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay className="motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-modal="true"
          // Select what was typed last time, so typing replaces it and Enter
          // or the arrows still work on it.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const input = inputRef.current;
            input?.focus();
            if (selectOnOpen) input?.select();
            else
              input?.setSelectionRange(input.value.length, input.value.length);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onCloseFocus();
          }}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-[0.98] motion-reduce:animate-none"
        >
          <DialogPrimitive.Title className="sr-only">
            Find
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search channels, members, messages, events and backwork. Use the
            arrow keys to move through results and Enter to open one.
            {onAsk ? " The first row asks Frapp what you typed." : ""}
          </DialogPrimitive.Description>
          <FindPanel
            query={query}
            onQueryChange={onQueryChange}
            inputRef={inputRef}
            onDone={() => onOpenChange(false)}
            lastTrackedQueryRef={lastTrackedQueryRef}
            onAsk={onAsk}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * The dialog's body. Radix mounts `Content` only while open, so these queries
 * (search, channels, departments) run only while the dialog is up: the
 * department list in particular is read for nothing else in the shell.
 */
function FindPanel({
  query,
  onQueryChange,
  inputRef,
  onDone,
  lastTrackedQueryRef,
  onAsk,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDone: () => void;
  lastTrackedQueryRef: React.MutableRefObject<string | null>;
  onAsk?: (question: string) => void;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FindFilter>("All");
  // Null until the member moves the highlight: it then sits where the words
  // put it (`defaultRow` below).
  const [movedTo, setMovedTo] = useState<number | null>(null);
  // Drawn only for a member with Ask, and only where a caller takes it.
  const askRow = useAskEntry() !== null && onAsk !== undefined;
  const placeholder = askRow ? FIND_ASK_PLACEHOLDER : FIND_PLACEHOLDER;

  // The server search is debounced; the channel match is not, in effect,
  // because it reads the same debounced query and the channel list is cached.
  const debouncedQuery = useDebouncedValue(query, 200);
  /*
   * Everything below reads the DEBOUNCED query, deliberately. `useSearch` keys
   * on it, so gating on the raw `query` would render a confident "No matches."
   * for the first 200ms of every search. The list therefore trails the text
   * for those 200ms, so Enter is ignored until it catches up (`onInputKeyDown`):
   * otherwise re-typing over an old query and pressing Enter would open an old
   * hit for a search the member had already replaced.
   */
  const hasMinQuery = debouncedQuery.trim().length >= SEARCH_MIN_QUERY_LENGTH;
  const isDebouncing = query !== debouncedQuery;
  const search = useSearch(debouncedQuery);
  const channels = useChannels();
  const isModuleEnabled = useChapterModuleGate();
  const permissions = usePermissionList();
  // `null` outside `AnalyticsProvider` (tests, or an opted-out member).
  const track = useContext(AnalyticsContext);
  // Set by the member typing in this mount; see the telemetry effect.
  const typedRef = useRef(false);

  /*
   * A group whose module the chapter switched off is never listed or offered,
   * and nor is Backwork for a member the library itself would refuse. Unlike
   * the nav, the module groups fail CLOSED while the gate loads (right after a
   * chapter switch): the nav only links to a route, but these rows are data
   * the switched-off module would not show. The permission list is `[]` while
   * it loads, so Backwork fails closed the same way.
   */
  const canBrowseBackwork = canAny(BACKWORK_BROWSE, permissions);
  const hiddenGroups = useMemo(() => {
    const hidden = new Set<FindGroup>();
    for (const group of FIND_GROUPS) {
      const key = MODULE_FOR_GROUP[group];
      if (key && !(isModuleEnabled?.(key) ?? false)) hidden.add(group);
    }
    if (!canBrowseBackwork) hidden.add("Backwork");
    return hidden;
  }, [isModuleEnabled, canBrowseBackwork]);
  const departments = useDepartments({
    enabled: !hiddenGroups.has("Backwork"),
  });
  const chips: FindFilter[] = [
    "All",
    ...FIND_GROUPS.filter((g) => !hiddenGroups.has(g)),
  ];
  // A chip that vanished (its module just went off) must not keep filtering.
  const effectiveFilter: FindFilter =
    filter !== "All" && hiddenGroups.has(filter) ? "All" : filter;

  const results = useMemo<FindResult[]>(
    () =>
      hasMinQuery
        ? buildFindResults({
            query: debouncedQuery,
            filter: effectiveFilter,
            channels: channels.data,
            payload: search.data?.payload,
            departments: departments.data,
            hiddenGroups,
          })
        : [],
    [
      hasMinQuery,
      debouncedQuery,
      effectiveFilter,
      channels.data,
      search.data,
      departments.data,
      hiddenGroups,
    ],
  );

  // A new query or filter means a new list, so the preselection goes back to
  // the top. Adjusted during render rather than in an effect, so the reset
  // lands in the same paint as the new results: an effect would render one
  // frame with a stale highlight, and that frame is the one an Enter can hit.
  const listKey = `${query}\u0000${effectiveFilter}`;
  const [keyForIndex, setKeyForIndex] = useState(listKey);
  if (keyForIndex !== listKey) {
    setKeyForIndex(listKey);
    setMovedTo(null);
  }

  /*
   * Search telemetry (`spec/behavior/observability.md` § Search Telemetry).
   * `surface` stays `"find-bar"`: it names the top-bar entry point, which this
   * dialog still is, so the series does not split at the redesign.
   *
   * Never the query text: `assertContentFreeProperties` does not forbid a key
   * named `query`, so sending length and word count instead is a discipline
   * the shared gate would not catch.
   */
  const searchStartRef = useRef(0);
  useEffect(() => {
    searchStartRef.current = Date.now();
  }, [debouncedQuery]);
  // `dataUpdatedAt` (not the query string) dedupes: `useSearch` sets
  // `staleTime: 0`, so re-running an identical query later still refetches and
  // must still be tracked.
  const trackedAtRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!hasMinQuery) return;
    if (search.isFetching) return;
    if (!search.data) return;
    if (search.dataUpdatedAt === trackedAtRef.current) return;
    trackedAtRef.current = search.dataUpdatedAt;
    // A reopen refetches the kept query; that is not a new search. (A search
    // abandoned by closing before it settled is never counted: it never
    // settled, and the spec counts settled searches.)
    if (!typedRef.current && debouncedQuery === lastTrackedQueryRef.current) {
      return;
    }
    lastTrackedQueryRef.current = debouncedQuery;
    const trimmed = debouncedQuery.trim();

    const bag =
      search.data.payload && typeof search.data.payload === "object"
        ? (search.data.payload as Record<string, unknown>)
        : {};
    const counts = {
      backwork: asArray(bag.backwork).length,
      events: asArray(bag.events).length,
      members: asArray(bag.members).length,
      messages: asArray(bag.messages).length,
    };
    const total =
      counts.backwork + counts.events + counts.members + counts.messages;

    track?.(SEARCH_COMPLETED_EVENT, {
      surface: "find-bar",
      query_length: trimmed.length,
      query_word_count: trimmed.split(/\s+/).filter(Boolean).length,
      backwork_count: counts.backwork,
      events_count: counts.events,
      members_count: counts.members,
      messages_count: counts.messages,
      total_count: total,
      zero_result: total === 0,
      timed_out: search.data.timedOut,
      latency_ms: Date.now() - searchStartRef.current,
    });
  }, [
    hasMinQuery,
    search.isFetching,
    search.data,
    search.dataUpdatedAt,
    debouncedQuery,
    track,
    lastTrackedQueryRef,
  ]);

  // Deliberately touches no ref: closing and clearing is the whole job, and a
  // ref read in a closure handed to `onClick` is the pattern that gets a
  // component stale-rendered.
  const openResult = useCallback(
    (result: FindResult | undefined) => {
      if (!result) return;
      onDone();
      onQueryChange("");
      router.push(result.href);
    },
    [router, onDone, onQueryChange],
  );

  // "Searching..." only for text that will actually be searched.
  const showResults =
    hasMinQuery ||
    (isDebouncing && query.trim().length >= SEARCH_MIN_QUERY_LENGTH);
  const isLoading = search.isFetching || isDebouncing;

  /*
   * Rows are the Ask row (when there is one), then the results. Where the
   * highlight starts is read from the words, not from what has arrived:
   * a question starts on the Ask row; anything else starts on the first
   * result, which may not be there yet (no row is lit, and Enter waits). The
   * Ask row takes it only when there is nothing to search for, or the search
   * has settled empty.
   */
  const offset = askRow ? 1 : 0;
  const rowCount = results.length + offset;
  const nothingToOpen = !showResults || (!isLoading && results.length === 0);
  const defaultRow = !askRow
    ? 0
    : asksFirst(query) || nothingToOpen
      ? 0
      : results.length > 0
        ? 1
        : -1;
  const activeRow = movedTo !== null && movedTo < rowCount ? movedTo : defaultRow;
  const askActive = askRow && activeRow === 0;
  const activeIndex = activeRow - offset;

  const chooseAsk = useCallback(() => {
    const question = query.trim();
    onQueryChange("");
    onAsk?.(question);
  }, [query, onQueryChange, onAsk]);

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // An IME's Enter commits a candidate, and its arrows move between them.
    if (event.nativeEvent.isComposing) return;
    if (rowCount === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMovedTo((activeRow + 1) % rowCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setMovedTo((Math.max(activeRow, 0) - 1 + rowCount) % rowCount);
    } else if (event.key === "Enter") {
      event.preventDefault();
      // The Ask row sends the words as typed, so it never waits on a list.
      if (askActive) {
        chooseAsk();
        return;
      }
      // The list still belongs to the previous text; see `hasMinQuery`.
      if (isDebouncing) return;
      openResult(results[activeIndex]);
    }
  }

  /*
   * Only a timeout in a group the member is looking at counts. Channels are
   * matched here and never time out, so under the Channels chip a slow message
   * scan is not "Search took too long"; nor is one in a hidden group. A server
   * that names no sources falls back to the whole-search flag.
   */
  const shownGroup = (group: FindGroup) =>
    !hiddenGroups.has(group) &&
    (effectiveFilter === "All" || effectiveFilter === group);
  const allTimedOutSources = search.data?.timedOutSources ?? [];
  const timedOutSources = allTimedOutSources.filter((source) => {
    const group = GROUP_FOR_SOURCE[source];
    return group ? shownGroup(group) : true;
  });
  const timedOut =
    allTimedOutSources.length > 0
      ? timedOutSources.length > 0
      : (search.data?.timedOut ?? false) && effectiveFilter !== "Channels";

  /*
   * "We stopped looking here" must read differently from "we found nothing"
   * (spec/behavior/search.md). The budget is per SOURCE, so a slow message
   * scan degrades alone, which means a partial timeout has to be announced
   * even when the list is showing hits.
   */
  const partialTimeout = timedOut && results.length > 0;
  let statusMessage: string | null = null;
  if (!showResults) {
    statusMessage = null;
  } else if (isLoading) {
    statusMessage = "Searching...";
  } else if (search.isError) {
    statusMessage = "Search is unavailable right now. Try again in a moment.";
  } else if (results.length === 0) {
    statusMessage = timedOut
      ? "Search took too long. Try a narrower term."
      : "No matches.";
  }

  const activeId = askActive
    ? "find-option-ask"
    : showResults && results[activeIndex]
      ? `find-option-${results[activeIndex]!.id}`
      : undefined;

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <Search
          className="h-[18px] w-[18px] shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showResults || askRow}
          aria-controls="find-results"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            typedRef.current = true;
            onQueryChange(e.target.value);
          }}
          onKeyDown={onInputKeyDown}
          className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div
        role="group"
        aria-label="Show"
        className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-1 pt-3"
      >
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            aria-pressed={effectiveFilter === chip}
            onClick={() => {
              setFilter(chip);
              inputRef.current?.focus();
            }}
            className={cn(
              "h-7 rounded-full border px-3 text-caption transition",
              effectiveFilter === chip
                ? "border-transparent bg-accent-subtle text-accent-text"
                : "border-border text-muted-foreground hover:text-foreground",
              FOCUS_RING,
            )}
          >
            {chip}
          </button>
        ))}
      </div>

      {/*
        A live region outside the list, so a screen reader hears "Searching...",
        a timeout, or the count rather than silence.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {showResults
          ? (statusMessage ??
            `${results.length} result${results.length === 1 ? "" : "s"}.`)
          : ""}
      </p>

      <div
        id="find-results"
        role="listbox"
        aria-label={placeholder}
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        {askRow ? (
          <button
            type="button"
            role="option"
            id="find-option-ask"
            aria-selected={askActive}
            tabIndex={-1}
            onPointerEnter={() => setMovedTo(0)}
            onClick={chooseAsk}
            className={cn(
              // One step taller than a result: it is a different thing to do.
              "flex min-h-10 w-full items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-left text-sm text-foreground transition hover:bg-card-hover pointer-coarse:min-h-11 pointer-coarse:text-base",
              askActive && "bg-card-hover",
            )}
          >
            <span className="grid w-4 shrink-0 place-items-center">
              <FrappCrest className="h-4 w-[13px] text-primary" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold">{ASK_COPY.name}</span>
              <span className="ml-2 text-muted-foreground">
                {query.trim() || ASK_COPY.empty_title}
              </span>
            </span>
            {askActive ? (
              <span
                aria-hidden="true"
                className="shrink-0 text-caption text-muted-foreground"
              >
                Enter
              </span>
            ) : null}
          </button>
        ) : null}

        {!showResults ? (
          <p className="px-2.5 py-3 text-sm text-muted-foreground">
            Type at least {SEARCH_MIN_QUERY_LENGTH} characters.
          </p>
        ) : null}

        {statusMessage ? (
          <p className="px-2.5 py-3 text-sm text-muted-foreground">
            {statusMessage}
          </p>
        ) : null}

        {partialTimeout ? (
          <p className="px-2.5 pb-1 pt-2 text-caption text-muted-foreground">
            {timedOutSources.length > 0
              ? `Stopped looking in ${timedOutSources.join(", ")}. Results may be incomplete.`
              : "Some sources timed out. Results may be incomplete."}
          </p>
        ) : null}

        {results.map((result, index) => {
          const isNewGroup =
            index === 0 || results[index - 1]!.group !== result.group;
          const Icon = GROUP_ICON[result.group];
          const active = index === activeIndex;
          return (
            /*
              `role="group"`, not a bare <div>: a listbox may own groups, but a
              plain div between listbox and option breaks the relationship.
            */
            <div
              key={result.id}
              role="group"
              aria-label={isNewGroup ? result.group : undefined}
            >
              {isNewGroup ? (
                <p
                  aria-hidden="true"
                  className={cn("px-2.5 pb-1 pt-3 text-muted", EYEBROW)}
                >
                  {result.group}
                </p>
              ) : null}
              <button
                type="button"
                role="option"
                id={`find-option-${result.id}`}
                aria-selected={active}
                // Focus stays in the input, so options are not tab stops.
                tabIndex={-1}
                onPointerEnter={() => setMovedTo(index + offset)}
                onClick={() => openResult(result)}
                className={cn(
                  // The Row step (foundations.md §9, #3515): 32 with a 14px
                  // label on a mouse, 44 with a 16px one on touch. A floor, not
                  // a height, so a row that ever wraps grows; today's labels
                  // and hints are one line because they `truncate`.
                  "flex min-h-8 w-full items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-left text-sm transition pointer-coarse:min-h-11 pointer-coarse:text-base",
                  active
                    ? "bg-card-hover text-foreground"
                    : "text-foreground hover:bg-card-hover",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{result.label}</span>
                {result.hint ? (
                  <span className="max-w-[45%] shrink-0 truncate text-caption text-muted-foreground">
                    {result.hint}
                  </span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
