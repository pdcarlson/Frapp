"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGifSearch, type GifResult } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { compactControlClassName } from "@/components/shared/table-controls";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { GifFrame, REDUCED_MOTION } from "./message-gif";

/**
 * The composer's GIF button and picker (#4631): Discord's layout, a "GIF"
 * button beside the emoji button that opens search over trending GIFs, and
 * one click sends. The popover is the emoji picker's size, so the two read as
 * a pair. The field's placeholder names the provider, which is the
 * attribution KLIPY asks for. Behavior: `spec/behavior/chat/README.md` § GIFs.
 *
 * The composer renders this only when the server has GIFs set up
 * (`useGifAvailability`), so an unset key never shows a broken picker.
 */
export function GifPickerButton({
  provider,
  onPick,
}: {
  /** The provider's name, for the field's "Search KLIPY". */
  provider: string;
  onPick: (gif: GifResult) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={compactControlClassName}
          aria-label="Send a GIF"
          title="GIF"
        >
          <GifGlyph />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {open ? (
          <GifPickerPanel
            provider={provider}
            onPick={(gif) => {
              setOpen(false);
              onPick(gif);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * "GIF" in a rounded outline: the label Discord, Slack and iMessage's keyboard
 * all use, since no pictogram reads as "GIF" on its own.
 */
function GifGlyph() {
  return (
    <span
      aria-hidden="true"
      className="rounded-[5px] border-[1.5px] border-current px-[3px] text-[10px] font-bold leading-[13px] tracking-[0.02em]"
    >
      GIF
    </span>
  );
}

const PANEL_WIDTH = 312;
const PANEL_HEIGHT = 352;
const GRID_PADDING = 8;
const GRID_GAP = 6;
const TILE_WIDTH = (PANEL_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;
const SKELETON_HEIGHTS = [96, 132, 110, 84, 120, 100];

/** Two columns, each GIF in the shorter one, so the grid keeps its shape. */
function intoColumns(
  results: readonly GifResult[],
): [GifResult[], GifResult[]] {
  const columns: [GifResult[], GifResult[]] = [[], []];
  const heights = [0, 0];
  for (const gif of results) {
    const height = tileHeight(gif);
    const column = heights[0]! <= heights[1]! ? 0 : 1;
    columns[column].push(gif);
    heights[column]! += height + GRID_GAP;
  }
  return columns;
}

function tileHeight(gif: GifResult): number {
  const { width, height } = gif.preview;
  return Math.round(Math.min(Math.max((TILE_WIDTH * height) / width, 60), 220));
}

export function GifPickerPanel({
  provider,
  onPick,
}: {
  provider: string;
  onPick: (gif: GifResult) => void;
}) {
  const [query, setQuery] = useState("");
  const search = useGifSearch(query);
  const reduceMotion = useMediaQuery(REDUCED_MOTION);
  const columns = useMemo(() => intoColumns(search.results), [search.results]);
  const viewport = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = search;

  // The next page when the bottom comes into view. Not after a failed load:
  // a fresh observer fires at once, so it would retry in a loop. The member
  // retries from the button below instead.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          !isFetchingNextPage
        ) {
          void fetchNextPage();
        }
      },
      { root: viewport.current, rootMargin: "120px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  // A new search starts at the top.
  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
  }, [query]);

  const empty =
    !search.isLoading && !search.isError && search.results.length === 0;

  return (
    <div
      className="flex flex-col rounded-md border border-border bg-popover text-popover-foreground"
      style={{ width: PANEL_WIDTH, height: PANEL_HEIGHT }}
    >
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={`Search ${provider || "GIFs"}`}
        placeholder={`Search ${provider || "GIFs"}`}
        maxLength={100}
        className={cn(
          "m-2 rounded-md border border-control-edge bg-surface-1 px-3 py-2 text-base outline-none transition-colors",
          FOCUS_RING,
        )}
      />
      <div
        ref={viewport}
        className="relative flex-1 overflow-y-auto"
        style={{ padding: `0 ${GRID_PADDING}px ${GRID_PADDING}px` }}
        aria-busy={search.isLoading || search.isSearching}
      >
        {search.isError && search.results.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-caption text-muted-foreground">
            <p>GIFs couldn&apos;t load.</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void search.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : empty ? (
          <p className="p-4 text-center text-caption text-muted-foreground">
            No GIFs match &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          <div
            className={cn(
              "flex items-start transition-opacity",
              // The old results stay while a new search loads, dimmed, so the
              // grid never flashes empty or jumps.
              search.isSearching ? "opacity-60" : "opacity-100",
            )}
            style={{ gap: GRID_GAP }}
          >
            {search.isLoading
              ? [0, 1].map((column) => (
                  <div
                    key={column}
                    className="flex flex-col"
                    style={{ width: TILE_WIDTH, gap: GRID_GAP }}
                  >
                    {SKELETON_HEIGHTS.filter((_, i) => i % 2 === column).map(
                      (height, i) => (
                        <div
                          key={i}
                          className="rounded-md bg-surface-1"
                          style={{ height }}
                        />
                      ),
                    )}
                  </div>
                ))
              : columns.map((column, index) => (
                  <ul
                    key={index}
                    className="flex flex-col"
                    style={{ width: TILE_WIDTH, gap: GRID_GAP }}
                  >
                    {column.map((gif) => (
                      <li key={gif.id}>
                        <GifTile
                          gif={gif}
                          reduceMotion={reduceMotion}
                          onPick={onPick}
                        />
                      </li>
                    ))}
                  </ul>
                ))}
          </div>
        )}
        {isFetchNextPageError ? (
          <div className="flex justify-center pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void fetchNextPage()}
            >
              Couldn&apos;t load more. Try again
            </Button>
          </div>
        ) : null}
        <div ref={sentinel} aria-hidden="true" className="h-px" />
      </div>
    </div>
  );
}

/**
 * One picker result. With reduced motion (#4657) it holds its first frame
 * and plays while hovered or focused, as a GIF in the thread does.
 */
function GifTile({
  gif,
  reduceMotion,
  onPick,
}: {
  gif: GifResult;
  reduceMotion: boolean;
  onPick: (gif: GifResult) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const height = tileHeight(gif);
  return (
    <button
      type="button"
      onClick={() => onPick(gif)}
      title={gif.title || undefined}
      aria-label={gif.title ? `Send GIF: ${gif.title}` : "Send GIF"}
      className={cn(
        "relative block w-full overflow-hidden rounded-md bg-surface-1 hover:opacity-85",
        FOCUS_RING,
      )}
      style={{ height }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {reduceMotion ? (
        <GifFrame
          url={gif.preview.url}
          width={Math.round(TILE_WIDTH)}
          height={Math.round(height)}
          playing={hovered || focused}
          className="h-full w-full object-cover"
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- a provider's animated WebP, hotlinked; next/image would re-encode it */
        <img
          src={gif.preview.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      )}
    </button>
  );
}
