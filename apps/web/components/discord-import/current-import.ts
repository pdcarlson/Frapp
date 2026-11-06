import type { ImportRow } from "./import-progress";

/**
 * What the page shows: the chapter's one import (a chapter moves off Discord
 * once, and the API refuses a second import while the first still holds its
 * messages), or nothing yet.
 *
 * A draft is a wizard someone left part-way: it holds nothing, so the page
 * starts over rather than showing it. A deleted (`purged`) import holds
 * nothing either, so the page goes back to the start, naming the last one
 * deleted until it is dismissed.
 */
export interface CurrentImport {
  current: ImportRow | null;
  /** The newest deleted import, only when there is no current one. */
  lastDeleted: ImportRow | null;
}

function newestFirst(a: ImportRow, b: ImportRow): number {
  return b.created_at.localeCompare(a.created_at);
}

export function currentImport(rows: readonly ImportRow[]): CurrentImport {
  const sorted = [...rows].sort(newestFirst);
  const current =
    sorted.find((row) => row.status !== "draft" && row.status !== "purged") ??
    null;
  const lastDeleted = current
    ? null
    : (sorted.find((row) => row.status === "purged") ?? null);
  return { current, lastDeleted };
}

/** Which of the page's states an import is in. */
export type ImportStage = "importing" | "deleting" | "finished";

export function importStage(row: ImportRow): ImportStage {
  if (row.status === "ready" || row.status === "running") return "importing";
  if (row.status === "purging") return "deleting";
  return "finished";
}
