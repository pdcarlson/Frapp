"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { settingWebPath } from "@repo/hooks";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";
import { useSettingsSearch } from "@/lib/settings/use-settings-search";

export const SETTINGS_SEARCH_COPY = {
  placeholder: "Search settings",
  none: "No settings match. Try another word.",
} as const;

/**
 * The search field atop both settings rails (Chapter settings and Settings),
 * as Vercel, GitHub and Linear put one atop theirs (Paul, 2026-11-19).
 *
 * It finds single settings, not just rail rows, by their words and synonyms
 * ("donate" finds Donation link, "rush" Recruitment), across both pages, and
 * lists only what the viewer can change (`searchSettings`). Picking one opens
 * its page with `?setting=`, which scrolls to it and lights it
 * (`use-setting-jump.ts`).
 *
 * A combobox whose list drops under the field, so focus stays in the field
 * while the arrows move the highlight, as the Find dialog's does. The list
 * is wider than the 200px rail, so a setting's name and where it lives fit.
 *
 * The list is its own component, mounted only once something is typed, so a
 * settings page that nobody searches reads nothing for it.
 */
export function SettingsSearch({ className }: { className?: string }) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<ResultsHandle>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const typed = query.trim();
  const showList = open && typed !== "";

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      if (query) {
        event.preventDefault();
        setQuery("");
      } else {
        inputRef.current?.blur();
      }
      return;
    }
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter"
    ) {
      event.preventDefault();
      setOpen(true);
      listRef.current?.handleKey(event.key);
    }
  }

  return (
    <div className={cn("relative w-full", className)}>
      <Search
        className="pointer-events-none absolute left-[10px] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? activeId : undefined}
        aria-label={SETTINGS_SEARCH_COPY.placeholder}
        placeholder={SETTINGS_SEARCH_COPY.placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // The results take `onMouseDown` preventDefault, so a click on one
        // never blurs the field first.
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={cn(
          "h-[34px] w-full rounded-[10px] border border-control-edge bg-surface-1 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground pointer-coarse:h-11 pointer-coarse:text-base",
          FOCUS_RING,
        )}
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          className={cn(
            "absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground",
            FOCUS_RING,
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
      {typed ? (
        <SettingsSearchResults
          ref={listRef}
          listId={listId}
          query={typed}
          shown={showList}
          onActiveChange={setActiveId}
          onPicked={() => {
            setQuery("");
            setOpen(false);
            inputRef.current?.blur();
          }}
        />
      ) : null}
    </div>
  );
}

type ResultsHandle = { handleKey: (key: string) => void };

const SettingsSearchResults = forwardRef<
  ResultsHandle,
  {
    listId: string;
    query: string;
    shown: boolean;
    onActiveChange: (id: string | undefined) => void;
    onPicked: () => void;
  }
>(function SettingsSearchResults(
  { listId, query, shown, onActiveChange, onPicked },
  ref,
) {
  const find = useSettingsSearch();
  const results = useMemo(() => find(query), [find, query]);
  const [moved, setMoved] = useState<{ query: string; index: number } | null>(
    null,
  );
  // The highlight goes back to the top whenever the words change.
  const active =
    moved && moved.query === query && moved.index < results.length
      ? moved.index
      : 0;
  const optionId = (index: number) => `${listId}-option-${index}`;
  const activeId = results[active] ? optionId(active) : undefined;
  useEffect(() => {
    onActiveChange(activeId);
  }, [activeId, onActiveChange]);
  useEffect(() => () => onActiveChange(undefined), [onActiveChange]);

  useImperativeHandle(ref, () => ({
    handleKey(key: string) {
      if (results.length === 0) return;
      if (key === "ArrowDown") {
        setMoved({ query, index: (active + 1) % results.length });
      } else if (key === "ArrowUp") {
        setMoved({
          query,
          index: (active - 1 + results.length) % results.length,
        });
      } else if (key === "Enter" && activeId) {
        // Each result is a link, so Enter goes where a click would.
        document.getElementById(activeId)?.click();
      }
    },
  }));

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {shown
          ? results.length === 0
            ? SETTINGS_SEARCH_COPY.none
            : `${results.length} setting${results.length === 1 ? "" : "s"}.`
          : ""}
      </p>
      <div
        id={listId}
        role="listbox"
        aria-label={SETTINGS_SEARCH_COPY.placeholder}
        hidden={!shown}
        className="absolute left-0 top-[calc(100%+6px)] z-30 max-h-[min(420px,60vh)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
      >
        {results.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">
            {SETTINGS_SEARCH_COPY.none}
          </p>
        ) : (
          results.map((match, index) => (
            <Link
              key={match.entry.id}
              id={optionId(index)}
              href={settingWebPath(match.entry) ?? "/settings"}
              role="option"
              aria-selected={index === active}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={() => setMoved({ query, index })}
              onClick={onPicked}
              className={cn(
                "flex min-h-8 w-full flex-col items-start rounded-[10px] px-2.5 py-1.5 text-left pointer-coarse:min-h-11",
                index === active ? "bg-card-hover" : "hover:bg-card-hover",
              )}
            >
              <span className="w-full truncate text-sm text-foreground">
                {match.entry.label}
              </span>
              <span className="w-full truncate text-caption text-muted-foreground">
                {match.hint}
              </span>
            </Link>
          ))
        )}
      </div>
    </>
  );
});
