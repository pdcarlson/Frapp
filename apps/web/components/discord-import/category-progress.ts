"use client";

import type { components } from "@repo/api-sdk";
import { useDiscordImportProgress } from "@repo/hooks";
import type { ImportRow } from "./import-progress";

/**
 * One Discord category's share of a bot import, as `GET :id/progress` adds it
 * up: its channels and threads being imported, how many are done, how many
 * failed. A thread counts under its parent channel's category.
 */
export type CategoryProgress =
  components["schemas"]["DiscordImportCategoryProgressDto"];

/** What a channel in no Discord category is grouped under. */
const NO_CATEGORY = "No category";

/** One tile on a running import: a category, or the ones past the cap. */
export interface CategoryTile {
  key: string;
  name: string;
  done: number;
  total: number;
  failed: number;
  /** Every channel and thread in it is done. */
  finished: boolean;
}

/** How many tiles a running import draws, the last one summing the rest. */
const MAX_CATEGORY_TILES = 8;

function tile(
  key: string,
  name: string,
  lines: readonly CategoryProgress[],
): CategoryTile {
  const total = lines.reduce(
    (sum, line) => sum + line.channels + line.threads,
    0,
  );
  const done = lines.reduce((sum, line) => sum + line.done, 0);
  const failed = lines.reduce((sum, line) => sum + line.failed, 0);
  return {
    key,
    name,
    done,
    total,
    failed,
    finished: total > 0 && done >= total,
  };
}

/**
 * The tiles for a running import, in the order the API sends the categories
 * (no category first, then Discord's order). Past `max`, the last tile is
 * "+ N more" and sums the categories it stands for, so a server with forty
 * categories still reads at a glance. A category with nothing being imported
 * gets no tile.
 */
export function categoryTiles(
  categories: readonly CategoryProgress[],
  max = MAX_CATEGORY_TILES,
): CategoryTile[] {
  const lines = categories.filter((line) => line.channels + line.threads > 0);
  const named = (line: CategoryProgress, index: number) =>
    tile(
      line.category === null ? "none" : `category:${index}:${line.category}`,
      line.category ?? NO_CATEGORY,
      [line],
    );
  if (lines.length <= max) return lines.map(named);
  const shown = lines.slice(0, max - 1);
  const rest = lines.slice(max - 1);
  return [...shown.map(named), tile("more", `+ ${rest.length} more`, rest)];
}

/** Channels and threads being imported, counted apart. */
export function importTotals(categories: readonly CategoryProgress[]): {
  channels: number;
  threads: number;
} {
  return {
    channels: categories.reduce((sum, line) => sum + line.channels, 0),
    threads: categories.reduce((sum, line) => sum + line.threads, 0),
  };
}

/**
 * A bot import's progress read, shared with the channel panel (same query).
 * An upload's channel rows record neither the order its parts ran in nor a
 * part it skipped, so it has no per-category view and nothing is read; nor
 * is anything read when `wanted` is false. Polled only while the import is
 * moving.
 */
export function useBotImportProgress(
  row: ImportRow,
  active: boolean,
  wanted = true,
) {
  return useDiscordImportProgress(row.id, {
    active,
    enabled: wanted && row.source === "bot",
  });
}
