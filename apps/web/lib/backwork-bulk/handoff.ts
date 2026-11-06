import type { CollectedFiles } from "./collect-files";
import type { BulkFields } from "./fields";

/**
 * Files picked or dropped on `/backwork` on their way to bulk upload
 * (`/backwork/upload`), which takes them on mount. A `File` can't ride a URL
 * or storage, so the hand-off is a module variable: it lives exactly as long
 * as the tab, which is as long as the files are readable anyway.
 *
 * `fields` carries what the one-file sheet already had typed in when a
 * Student Copy is sent here to be redacted (#3509), so the person doesn't
 * type the course and term twice.
 */
export type StagedBulkUpload = CollectedFiles & {
  fields?: Partial<BulkFields>;
};

let staged: StagedBulkUpload | null = null;

/** Replaces anything staged before, so a stale drop never rides along. */
export function stageBulkUpload(next: StagedBulkUpload): void {
  staged = next;
}

/** What is staged, left in place (for a render to read). */
export function peekStagedBulkUpload(): StagedBulkUpload | null {
  return staged;
}

/** Returns the staged files once, then forgets them. */
export function takeStagedBulkUpload(): StagedBulkUpload | null {
  const taken = staged;
  staged = null;
  return taken;
}
