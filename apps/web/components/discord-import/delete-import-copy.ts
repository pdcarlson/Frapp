import type { ConfirmRequest } from "@/components/shared/confirm-dialog";
import { purgeProgress, type ImportRow } from "./import-progress";

/**
 * The words around deleting an import (#2944). The approved strings are the
 * Discord Import rows of `spec/ui/design-system/writing.md`; what a delete
 * removes and what it keeps is owned by `spec/behavior/chat/README.md`
 * § Imported archive messages, whose wording the confirmation follows.
 */

function countOf(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/** What the confirmation says goes, before the channel and role sentences. */
function removesSentence(row: ImportRow): string {
  const purged = row.purged_messages ?? 0;
  // A delete offered again after one failed part-way (the row went `failed`
  // with its count kept): the import's own totals include what is already
  // gone, and the attachments went with their messages, so the count left is
  // the honest one.
  if (purged > 0) {
    const left = Math.max(0, row.imported_messages - purged);
    return left > 0
      ? `An earlier deletion already removed ${purged.toLocaleString()} of its ${countOf(row.imported_messages, "message")}. This deletes the ${left.toLocaleString()} left, their attachments, and its archive files.`
      : "An earlier deletion already removed its messages. This deletes its archive files.";
  }
  const held = [
    row.imported_messages > 0 ? countOf(row.imported_messages, "message") : "",
    row.attachments_imported > 0
      ? countOf(row.attachments_imported, "attachment")
      : "",
  ].filter(Boolean);
  return held.length > 0
    ? `This deletes the ${held.join(" and ")} it brought in, and its archive files.`
    : "This deletes its archive files.";
}

/**
 * The confirmation Delete import opens. It names the counts because a delete
 * of five thousand messages and one of a hundred and forty thousand look the
 * same from the button, and names the server because every row carries the
 * same control.
 */
export function deleteImportConfirmation(row: ImportRow): ConfirmRequest {
  const removes = removesSentence(row);
  return {
    title: row.guild_name
      ? `Delete the import from ${row.guild_name}?`
      : "Delete this Discord import?",
    description: `${removes} It then deletes the channels it created, and any it merged into that another deleted import created, once they hold nothing. The roles and read permissions it created stay. This cannot be undone.`,
    confirmLabel: "Delete import",
    tone: "destructive",
  };
}

export const DELETE_IMPORT_STARTED =
  "Deleting the import. Its row shows how far along it is.";

/**
 * What a deleting or deleted row says in place of its import counts, or null
 * for any other status. A deleting row counts its messages down and then says
 * what it is doing once they are gone, since the channels and archive files
 * that follow take a while on a large import and a row stuck at "0 left"
 * would read as stalled.
 */
export function purgeLine(row: ImportRow): string | null {
  if (row.status === "purged") {
    return "Deleted. The messages, attachments and archive files it brought in are gone.";
  }
  const progress = purgeProgress(row);
  if (!progress) return null;
  if (progress.left === 0) {
    return "Messages deleted. Finishing with its channels and archive files.";
  }
  return `Deleting: ${progress.left.toLocaleString()} of ${countOf(progress.total, "message")} left`;
}
