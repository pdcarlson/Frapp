"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useChannels, useSearch, SEARCH_MIN_QUERY_LENGTH } from "@repo/hooks";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { asArray, cn } from "@/lib/utils";

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
  const hasMinQuery = query.trim().length >= SEARCH_MIN_QUERY_LENGTH;
  const search = useSearch(debouncedQuery);
  const channels = useChannels();

  const results = useMemo<FindResult[]>(() => {
    if (!hasMinQuery) return [];
    const needle = query.trim().toLowerCase();
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

    for (const row of asArray<MessageRow>(bag.messages).slice(0, GROUP_LIMIT)) {
      out.push({
        id: `message-${row.id ?? out.length}`,
        group: "Messages",
        label: row.content?.slice(0, 80) ?? "Untitled message",
        hint: row.channel_id ? `Channel ${row.channel_id}` : undefined,
        href: chatDeepLink({ channelId: row.channel_id, messageId: row.id }),
      });
    }

    return out;
  }, [hasMinQuery, query, channels.data, search.data]);

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "f") return;
      // `repeat` guard: holding the chord should focus once, not fight the
      // caret on every repeat tick.
      if (event.repeat) return;
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
      setOpen(false);
      // `currentTarget` is the input this handler is bound to, so Escape can
      // hand the page back without reading the ref.
      event.currentTarget.blur();
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

  const showPanel = open && hasMinQuery;
  const isLoading = search.isFetching;
  const timedOut = search.data?.timedOut ?? false;

  let lastGroup: FindResult["group"] | null = null;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="flex h-[34px] w-full items-center gap-2.5 rounded-[10px] border border-input bg-card px-3">
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
              : "rounded-[5px] border border-border px-1.5 py-px",
          )}
        >
          {open ? "esc" : "⌘F"}
        </kbd>
      </div>

      {showPanel ? (
        <div
          id="find-results"
          role="listbox"
          className="absolute left-1/2 top-[calc(100%+6px)] z-50 w-full -translate-x-1/2 rounded-[14px] border border-border bg-popover p-1.5"
        >
          {results.length === 0 ? (
            <p className="px-2.5 py-3 text-sm text-muted-foreground">
              {isLoading
                ? "Searching..."
                : timedOut
                  ? "Search took too long. Try a narrower term."
                  : "No matches."}
            </p>
          ) : (
            results.map((result, index) => {
              const isNewGroup = result.group !== lastGroup;
              lastGroup = result.group;
              return (
                <div key={result.id}>
                  {isNewGroup ? (
                    <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                      {result.group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onPointerEnter={() => setActiveIndex(index)}
                    onClick={() => openResult(result)}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-sm transition",
                      index === activeIndex
                        ? "bg-accent-subtle text-accent-text"
                        : "text-foreground hover:bg-card",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {result.label}
                    </span>
                    {result.hint ? (
                      <span className="shrink-0 truncate text-[11px] text-muted-foreground">
                        {result.hint}
                      </span>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
