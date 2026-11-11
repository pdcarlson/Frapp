"use client";

/**
 * The landing: the signature moment of a Discord import (#3493).
 *
 * When a completed import is first shown, its Discord categories drop into
 * place one after another, the message count runs up to its final number,
 * the check mark lands beside the title, and the chapter accent sweeps once
 * across the figures. About 1.8 seconds, once per import per browser, never
 * looping and never in the way: the page is usable from the first frame.
 *
 * At rest, under reduced motion, and on every later visit, the page shows the
 * finished frame (the categories in place, the final count, the check mark),
 * which is what the moment lands on. `spec/ui/design-system/README.md` §7
 * owns the rules; the timings are `@repo/theme/signature`'s.
 */

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { countUpValue, signatureMoment } from "@repo/theme/signature";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import type { ImportRow } from "./import-progress";
import type { CategoryTile } from "./category-progress";

/** Where a browser remembers that an import's landing has played. */
export function arrivalKey(importId: string): string {
  return `frapp:discord-import-landed:${importId}`;
}

function seen(importId: string): boolean {
  try {
    return window.localStorage.getItem(arrivalKey(importId)) !== null;
  } catch {
    return false;
  }
}

function remember(importId: string): void {
  try {
    window.localStorage.setItem(arrivalKey(importId), "1");
  } catch {
    // Without storage the landing plays again next time, which is harmless.
  }
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * How long after an import finishes its landing may still play: the window
 * in which "it just landed" is true (the finish notification brings the
 * admin here). An import that finished before it, such as every import
 * already done on the day this shipped, rests from the first frame.
 */
export const ARRIVAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function recent(completedAt: string | null | undefined, now: number): boolean {
  if (!completedAt) return false;
  const at = Date.parse(completedAt);
  return Number.isFinite(at) && now - at <= ARRIVAL_WINDOW_MS;
}

/**
 * How long the landing waits for what it lands (a bot import's categories)
 * before it gives up and the page rests. While it waits, the count and the
 * check mark hold their first frame instead of showing the end and then
 * jumping back to start.
 */
export const ARRIVAL_WAIT_MS = 1000;

/**
 * The landing's state. It may play on an import that completed within
 * `ARRIVAL_WINDOW_MS` and that this browser hasn't landed yet, unless the
 * person asked for reduced motion; that is settled once, when the finished
 * state mounts (on the client, once the import has loaded). It is `holding`
 * until `ready` (everything it lands is loaded, so nothing arrives
 * mid-moment), for at most `ARRIVAL_WAIT_MS`; then `playing` for
 * `signatureMoment.totalMs`. It is remembered as played only once it has run
 * to the end, so leaving mid-way, or a wait that gave up, plays it again next
 * time.
 */
export function useArrival(
  row: ImportRow,
  ready: boolean,
): { playing: boolean; holding: boolean } {
  const [eligible] = useState(
    () =>
      row.status === "completed" &&
      typeof window !== "undefined" &&
      recent(row.completed_at, Date.now()) &&
      !reducedMotion() &&
      !seen(row.id),
  );
  const [over, setOver] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const live = eligible && !over && !gaveUp;
  const playing = live && ready;
  const holding = live && !ready;
  useEffect(() => {
    if (!holding) return;
    const timer = window.setTimeout(() => setGaveUp(true), ARRIVAL_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [holding]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      remember(row.id);
      setOver(true);
    }, signatureMoment.totalMs);
    return () => window.clearTimeout(timer);
  }, [playing, row.id]);
  return { playing, holding };
}

/**
 * `target`, or while the landing plays, the count running up to it; 0 while
 * it holds.
 */
export function useCountUp(
  target: number,
  { playing, holding }: { playing: boolean; holding: boolean },
): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const next = countUpValue(target, now - start);
      setValue(next);
      if (next < target) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, target]);
  if (holding) return 0;
  return playing ? value : target;
}

/** The check mark beside a completed import's title; it lands last. */
export function ArrivalMark({
  playing,
  holding,
}: {
  playing: boolean;
  holding: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-tint text-success",
        holding && "opacity-0",
        playing && "motion-safe:animate-signature-pop",
      )}
      style={
        playing ? { animationDelay: `${signatureMoment.countMs}ms` } : undefined
      }
    >
      <Check className="h-4 w-4" strokeWidth={2.5} />
    </span>
  );
}

/**
 * The accent passing once behind what it sits in (an `isolate`d `relative`
 * box with its overflow hidden, so `-z-10` keeps it under the figures'
 * text), as the count lands. Nothing is left behind: at rest the figures
 * are neutral (foundations §6 § A signature moment's accent).
 */
export function ArrivalSweep({ playing }: { playing: boolean }) {
  if (!playing) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="discord-import-sweep"
      className="pointer-events-none absolute inset-0 -z-10 hidden bg-gradient-to-r from-transparent via-accent-subtle to-transparent motion-safe:block motion-safe:animate-signature-sweep"
      style={{ animationDelay: `${signatureMoment.countMs}ms` }}
    />
  );
}

function described(tile: CategoryTile): string {
  return `${tile.total.toLocaleString("en-US")} ${
    tile.total === 1 ? "channel or thread" : "channels and threads"
  }`;
}

/**
 * What came over, by Discord category: the moment's list. Each row drops in
 * after the one above it; past `signatureMoment.maxStaggered`, the rest land
 * with the last.
 */
export function ArrivalCategories({
  tiles,
  playing,
}: {
  tiles: CategoryTile[];
  playing: boolean;
}) {
  if (tiles.length === 0) return null;
  return (
    <section
      aria-labelledby="discord-import-arrived-categories"
      className="space-y-2"
    >
      <h3
        id="discord-import-arrived-categories"
        className={cn(EYEBROW, "text-muted-foreground")}
      >
        By Discord category
      </h3>
      <ul className="grid gap-1.5 @xl:grid-cols-2">
        {tiles.map((tile, index) => (
          <li
            key={tile.key}
            className={cn(
              "flex min-w-0 items-baseline justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm",
              playing && "motion-safe:animate-signature-drop",
            )}
            style={
              playing
                ? {
                    animationDelay: `${
                      Math.min(index, signatureMoment.maxStaggered - 1) *
                      signatureMoment.staggerMs
                    }ms`,
                  }
                : undefined
            }
          >
            <span className="truncate font-medium">{tile.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              <span aria-hidden="true">
                {tile.total.toLocaleString("en-US")}
              </span>
              <span className="sr-only">{described(tile)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
