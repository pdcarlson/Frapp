/**
 * Hands files from another page to bulk upload (#3499): a drop on `/backwork`
 * stages its PDFs here and navigates to `/backwork/upload`, whose workspace
 * takes them on mount and queues them.
 *
 * In memory only, on purpose: `File` objects can't survive a reload, and a
 * stale handoff must never queue itself on a later visit, so taking empties it.
 */
let staged: File[] = [];

export function stageBulkUpload(files: readonly File[]): void {
  staged = [...staged, ...files];
}

/** Returns and clears whatever was staged. */
export function takeStagedBulkUpload(): File[] {
  const files = staged;
  staged = [];
  return files;
}
