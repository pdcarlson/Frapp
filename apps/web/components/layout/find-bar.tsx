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
import { Search } from "lucide-react";
import {
  useChannels,
  useSearch,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_COMPLETED_EVENT,
} from "@repo/hooks";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { asArray, cn } from "@/lib/utils";
import { AnalyticsContext } from "@/lib/providers/analytics-provider";
import { FOCUS_RING_WITHIN } from "@/components/ui/focus";

/**
 * The top bar's wide find field — what replaced the ⌘K command palette.
 *
 * The palette was a modal over the page that you had to know a shortcut to
 * open, advertised by a button reading "Search (⌘K)". Board option `1b` (pin 8)
 * and `1d` replace it with a field that is simply visible, 520px wide, bound to
 * the browser-native find gesture: Cmd/Ctrl+F.
 *
 * **Taking over Cmd/Ctrl+F is deliberate.** It is the key people already press
 * to find something on a page, and in an app whose content is paginated and
 * virtualized, the browser's own in-page find searches only what happens to be
 * mounted. Escape closes and returns the page. The keyboard hint in the field
 * says `⌘F`, so the binding is advertised where it is used rather than being
 * folklore — `components.md` §5 bans a hint for a binding that is not wired,
 * and this one is.
 *
 * **Ranking is Channels, then Members, then Messages** (`1d` pins 2-4), with
 * the first hit preselected and Enter opening it. Channels rank first because
 * they are the destinations a member navigates to most, and they come from a
 * different source than the rest: `/v1/search` has no channel source, so
 * channels are matched client-side against the channel list the member can
 * already read. Members and messages come from the server, which stems and
 * ranks them.
 *
 * Events and Backwork hits are deliberately not shown here. The search API
 * returns them, but the board's field promises three things and names them in
 * its own placeholder; widening the list past its own copy is how a find field
 * turns back into a palette.
 */

const FIND_PLACEHOLDER = "Find channels, members, messages";

type FindResult = {
  id: string;
  group: "Channels" | "Members" | "Messages";
  label: string;
  hint?: string;
  href: string;
};

type ChannelRow = {
  id?: string;
  name?: string | null;
  category?: string | null;
};

type MemberRow = {
  user_id?: string;
  display_name?: string | null;
  email?: string | null;
};

type MessageRow = {
  id?: string;
  content?: string | null;
  channel_id?: string | null;
};

/** Per-group display cap. The panel is a shortlist, not a results page. */
const GROUP_LIMIT = 5;

export function FindBar({ className }: { className?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // The server search is debounced; the channel match is not. Channels come
  // from a list already in the cache, so making them wait on a timer would add
  // latency to the one group that needs none.
  const debouncedQuery = useDebouncedValue(query, 200);
  /*
   * Both of these read the DEBOUNCED query, deliberately.
   *
   * Gating on the raw `query` desynchronises the panel from the data behind
   * it: `useSearch` keys on the debounced value, so for the first 200ms of a
   * search the hook is still disabled (or still serving the PREVIOUS key) while
   * `isFetching` is false. The panel would render a confident "No matches." on
   * every first search before switching to "Searching...", and re-typing over
   * an existing query would list the old query's hits under the new text with
   * the first one preselected, so Enter opened a result for a search the member
   * had already replaced.
   */
  const hasMinQuery = debouncedQuery.trim().length >= SEARCH_MIN_QUERY_LENGTH;
  const isDebouncing = query !== debouncedQuery;
  const search = useSearch(debouncedQuery);
  const channels = useChannels();
  // `null` outside `AnalyticsProvider` (tests, or an opted-out member).
  const track = useContext(AnalyticsContext);

  const results = useMemo<FindResult[]>(() => {
    if (!hasMinQuery) return [];
    const needle = debouncedQuery.trim().toLowerCase();
    const out: FindResult[] = [];

    for (const row of asArray<ChannelRow>(channels.data)) {
      const name = row.name ?? "";
      if (!name.toLowerCase().includes(needle)) continue;
      out.push({
        id: `channel-${row.id ?? name}`,
        group: "Channels",
        label: name,
        hint: row.category ?? undefined,
        href: chatDeepLink({ channelId: row.id }),
      });
      if (out.length >= GROUP_LIMIT) break;
    }

    const bag =
      search.data?.payload && typeof search.data.payload === "object"
        ? (search.data.payload as Record<string, unknown>)
        : {};

    for (const row of asArray<MemberRow>(bag.members).slice(0, GROUP_LIMIT)) {
      out.push({
        id: `member-${row.user_id ?? row.display_name ?? out.length}`,
        group: "Members",
        label: row.display_name ?? "Unnamed member",
        hint: row.email ?? undefined,
        href: "/members",
      });
    }

    // The channel list is already in hand two lines up, so resolve the name
    // rather than showing a member a raw UUID.
    const channelNames = new Map(
      asArray<ChannelRow>(channels.data).map((c) => [c.id, c.name ?? null]),
    );
    for (const row of asArray<MessageRow>(bag.messages).slice(0, GROUP_LIMIT)) {
      const channelName = row.channel_id
        ? channelNames.get(row.channel_id)
        : undefined;
      out.push({
        id: `message-${row.id ?? out.length}`,
        group: "Messages",
        label: row.content?.slice(0, 80) ?? "Untitled message",
        hint: channelName ? `#${channelName}` : undefined,
        href: chatDeepLink({ channelId: row.channel_id, messageId: row.id }),
      });
    }

    return out;
  }, [hasMinQuery, debouncedQuery, channels.data, search.data]);

  // A new query means a new list, so the preselection has to go back to the
  // top. Without this, typing one more character can leave the highlight on a
  // row that is no longer there and Enter opens the wrong thing.
  //
  // Adjusted during render rather than in an effect: React re-runs this
  // component before touching the DOM, so the reset lands in the same paint as
  // the new results. An effect would render one frame with the stale highlight
  // first, and that frame is the one an Enter keypress can land in.
  const [queryForIndex, setQueryForIndex] = useState(query);
  if (queryForIndex !== query) {
    setQueryForIndex(query);
    setActiveIndex(0);
  }

  /*
   * Search telemetry (`spec/behavior/observability.md` § Search Telemetry).
   *
   * The deleted command palette was the only emitter of this event, so the
   * find field has to carry it or the zero-result taxonomy that section
   * describes silently reports nothing forever. `surface` distinguishes it
   * from the palette's historical rows.
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
      query_length: debouncedQuery.length,
      query_word_count: debouncedQuery.split(/\s+/).filter(Boolean).length,
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
  ]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "f") return;
      // `repeat` guard: holding the chord should focus once, not fight the
      // caret on every repeat tick.
      if (event.repeat) return;
      /*
       * Stand down inside a modal layer, and hand the chord back to the
       * browser when we do.
       *
       * This field lives in the top bar, OUTSIDE every Radix dialog, sheet and
       * drawer focus scope. Inside one, `focus()` is immediately bounced back
       * by the `FocusScope` — so calling `preventDefault()` first would leave
       * the member with neither the app's find nor the browser's, and would
       * open a results panel underneath the overlay. Native find is the more
       * useful of the two in a long form, so it wins here.
       */
      if (document.querySelector("[data-radix-focus-guard]")) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active !== inputRef.current &&
        (active.isContentEditable ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "INPUT")
      ) {
        // Someone is typing somewhere else (the chat composer, a form field).
        // Stealing the caret mid-sentence is worse than not binding at all.
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Click-away closes the panel but leaves the query, so coming back to the
  // field does not mean retyping.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Deliberately touches no ref. Closing the panel and clearing the query is
  // the whole job; focus can stay in the field, which is what a person who
  // wants to search again would want anyway. Reaching for `inputRef.current`
  // here would be a ref read inside a closure handed to `onClick`, which is
  // the pattern that gets a component stale-rendered.
  const openResult = useCallback(
    (result: FindResult | undefined) => {
      if (!result) return;
      setOpen(false);
      setQuery("");
      router.push(result.href);
    },
    [router],
  );

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      // Focus deliberately STAYS in the field. Blurring to <body> restarts the
      // next Tab from the top of the document, so a keyboard user who changes
      // their mind has to traverse the skip link and the whole nav again to
      // reach the control they were heading for.
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openResult(results[activeIndex]);
    }
  }

  const showPanel = open && (hasMinQuery || isDebouncing);
  const isLoading = search.isFetching || isDebouncing;
  const timedOut = search.data?.timedOut ?? false;
  const timedOutSources = search.data?.timedOutSources ?? [];

  /*
   * "We stopped looking here" must read differently from "we found nothing"
   * (spec/behavior/search.md). The budget is per SOURCE, so a slow message
   * scan degrades alone — which means a partial timeout has to be announced
   * even when the panel is showing hits, or the member reads a confident
   * shortlist and concludes the thing they want does not exist.
   */
  const partialTimeout = timedOut && results.length > 0;
  let statusMessage: string | null = null;
  if (isLoading) {
    statusMessage = "Searching...";
  } else if (search.isError) {
    statusMessage = "Search is unavailable right now. Try again in a moment.";
  } else if (results.length === 0) {
    statusMessage = timedOut
      ? "Search took too long. Try a narrower term."
      : "No matches.";
  }

  let lastGroup: FindResult["group"] | null = null;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/*
        The wrapper owns the focus indicator on behalf of the input, which sets
        `outline-none`. Without this the app's single most-used control shows
        nothing at all on keyboard focus — a design-system README §6
        release-gate failure. `FOCUS_RING_WITHIN` is the shared recipe for
        exactly this shape; its docstring names this defect by name.
      */}
      <div
        className={cn(
          "flex h-[34px] w-full items-center gap-2.5 rounded-[10px] border border-input bg-card px-3",
          FOCUS_RING_WITHIN,
        )}
      >
        <Search
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="find-results"
          aria-autocomplete="list"
          // DOM focus never leaves the input, so without this nothing links the
          // input to the highlighted row and a screen reader announces silence
          // as the selection moves.
          aria-activedescendant={
            showPanel && results[activeIndex]
              ? `find-option-${results[activeIndex]!.id}`
              : undefined
          }
          aria-label={FIND_PLACEHOLDER}
          placeholder={FIND_PLACEHOLDER}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
        />
        {/*
          The hint swaps to `esc` while the field is live, because that is the
          key that does something at that moment. Advertising `⌘F` to someone
          already typing in the field would be advertising a no-op.
        */}
        <kbd
          aria-hidden="true"
          className={cn(
            "shrink-0 font-mono text-[11px] text-muted",
            open
              ? ""
              : "rounded-xs border border-border px-1.5 py-px",
          )}
        >
          {open ? "esc" : "⌘F"}
        </kbd>
      </div>

      {/*
        A live region, outside the panel so it survives the panel unmounting.
        `role="listbox"` announces nothing on its own, so without this a blind
        member types a query and hears silence — unable to tell "still loading"
        from "the server gave up" from "there is genuinely nothing".
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {showPanel
          ? (statusMessage ??
            `${results.length} result${results.length === 1 ? "" : "s"}.`)
          : ""}
      </p>

      {showPanel ? (
        <div
          id="find-results"
          role="listbox"
          aria-label={FIND_PLACEHOLDER}
          className="absolute left-1/2 top-[calc(100%+6px)] z-50 w-full -translate-x-1/2 rounded-lg border border-border bg-popover p-1.5"
        >
          {statusMessage ? (
            <p className="px-2.5 py-3 text-sm text-muted-foreground">
              {statusMessage}
            </p>
          ) : null}

          {/*
            A per-source budget means one slow scan degrades alone, so this has
            to show even when there ARE hits. Rendering it only in the empty
            branch is what makes a partial result look complete.
          */}
          {partialTimeout ? (
            <p className="px-2.5 pb-1 pt-2 text-[11px] text-muted-foreground">
              {timedOutSources.length > 0
                ? `Stopped looking in ${timedOutSources.join(", ")}. Results may be incomplete.`
                : "Some sources timed out. Results may be incomplete."}
            </p>
          ) : null}

          {results.map((result, index) => {
            const isNewGroup = result.group !== lastGroup;
            lastGroup = result.group;
            return (
              /*
                `role="group"` rather than a bare <div>: a listbox may own
                groups, but a plain div between listbox and option breaks the
                parent/child relationship the role depends on, and assistive
                tech stops treating the rows as options at all.
              */
              <div
                key={result.id}
                role="group"
                aria-label={isNewGroup ? result.group : undefined}
              >
                {isNewGroup ? (
                  <p
                    aria-hidden="true"
                    className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
                  >
                    {result.group}
                  </p>
                ) : null}
                <button
                  type="button"
                  role="option"
                  id={`find-option-${result.id}`}
                  aria-selected={index === activeIndex}
                  // Focus stays in the input, so these must not be tab stops:
                  // tabbing into a listbox is not what a combobox consumer
                  // expects, and it strands focus in a panel that closes.
                  tabIndex={-1}
                  onPointerEnter={() => setActiveIndex(index)}
                  onClick={() => openResult(result)}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-sm transition",
                    index === activeIndex
                      ? "bg-accent-subtle text-accent-text"
                      : "text-foreground hover:bg-card",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{result.label}</span>
                  {result.hint ? (
                    <span className="shrink-0 truncate text-[11px] text-muted-foreground">
                      {result.hint}
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
