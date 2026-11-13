import type { CollectedFiles } from "@/lib/bulk-upload/collect-files";
import { nextDocumentFields, type BulkFields } from "./fields";

/**
 * Files picked or dropped on `/backwork` on their way to bulk upload
 * (`/backwork/upload`), which takes them on mount. A `File` can't ride a URL
 * or storage, so the hand-off is a module variable: it lives exactly as long
 * as the tab, which is as long as the files are readable anyway.
 *
 * `fields` carries what the one-file sheet already had typed in when a
 * Student Copy is sent here to be redacted (#3509). They are kept against
 * that file, not the batch, and fill its form when it comes up, however much
 * of the batch is ahead of it: the person doesn't type them twice, and the
 * Student Copy mark can't be lost to another document's sticky fields.
 */
export type StagedBulkUpload = CollectedFiles & {
  fields?: Partial<BulkFields>;
};

let staged: StagedBulkUpload | null = null;
const presets = new WeakMap<File, Partial<BulkFields>>();

/** Replaces anything staged before, so a stale drop never rides along. */
export function stageBulkUpload(next: StagedBulkUpload): void {
  staged = next;
  if (next.fields) for (const file of next.files) presets.set(file, next.fields);
}

/**
 * The form for `file` when it comes up in bulk upload: the batch's sticky
 * fields, unless it was staged with its own, which win, the title included
 * when one was typed (a filename can be a student's name).
 */
export function documentFields(sticky: BulkFields, file: File): BulkFields {
  const next = nextDocumentFields(sticky, file.name);
  const preset = presets.get(file);
  if (!preset) return next;
  return { ...next, ...preset, title: preset.title?.trim() ? preset.title : next.title };
}

/**
 * Drops anything staged and not yet taken. Called when bulk batches end (a
 * chapter switch, another account signing in), so a drop made by one account
 * never reaches the next one's batch.
 */
export function clearStagedBulkUpload(): void {
  staged = null;
}

/** Returns the staged files once, then forgets them. */
export function takeStagedBulkUpload(): StagedBulkUpload | null {
  const taken = staged;
  staged = null;
  return taken;
}
