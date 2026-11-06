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
 * Whether the landing is playing now. It plays on a completed import this
 * browser hasn't landed yet, unless the person asked for reduced motion,
 * from the first frame (the finished state mounts on the client, once the
 * import has loaded) and stops after `signatureMoment.totalMs`. It is
 * remembered as played only once it has run to the end, so leaving mid-way
 * plays it again next time.
 */
export function useArrival(row: ImportRow): boolean {
  const completed = row.status === "completed";
  const [playing, setPlaying] = useState(
    () =>
      completed &&
      typeof window !== "undefined" &&
      !reducedMotion() &&
      !seen(row.id),
  );
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      remember(row.id);
      setPlaying(false);
    }, signatureMoment.totalMs);
    return () => window.clearTimeout(timer);
  }, [playing, row.id]);
  return playing;
}

/** `target`, or while the landing plays, the count running up to it. */
export function useCountUp(target: number, playing: boolean): number {
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
  return playing ? value : target;
}

/** The check mark beside a completed import's title; it lands last. */
export function ArrivalMark({ playing }: { playing: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-tint text-success",
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
 * The accent passing once across what it sits in (a `relative` box with its
 * overflow hidden), as the count lands. Nothing is left behind: at rest the
 * figures are neutral, as foundations §6 has numbers.
 */
export function ArrivalSweep({ playing }: { playing: boolean }) {
  if (!playing) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="discord-import-sweep"
      className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-transparent via-accent-subtle to-transparent motion-safe:block motion-safe:animate-signature-sweep"
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
 * with the last. Categories that arrive after the moment has ended are drawn
 * in place.
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
      <ul className="grid gap-1.5 sm:grid-cols-2">
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
