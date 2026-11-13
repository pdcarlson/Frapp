import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { localIsoDate, rowsToCsv } from "@repo/formatting";

/**
 * Hands rows to the system share sheet as a `.csv` file (#3926 step 4): the
 * phone's Export for a form's responses and a sign-up's list, where the web
 * dashboard downloads the same rows (`downloadCsv`). From the sheet a member
 * saves it to Files, sends it in Mail or Messages, or opens it in Sheets or
 * Numbers.
 *
 * The CSV is `rowsToCsv` (`@repo/formatting`), the dashboard's own writer, so
 * a phone export opens the same as a web one: a BOM for Excel, CRLF, and
 * formula-shaped cells made inert. The file is named as the web's are,
 * `frapp-<filenamePrefix>-<date>.csv`, and written into the cache the way
 * `share-attachment.ts` writes a shared image, because the share sheet takes
 * a local file.
 *
 * An image goes through React Native's own sheet on iOS so it can drop Save
 * Image; a CSV has no such activity to drop, so both platforms use
 * expo-sharing here.
 */

/** The file's name, the dashboard's export name: `frapp-form-room-picks-2026-11-13.csv`. */
export function csvShareFileName(filenamePrefix: string, now: Date): string {
  return `frapp-${filenamePrefix}-${localIsoDate(now)}.csv`;
}

/**
 * False when there was nothing to share or the file couldn't be written or
 * shared, for the caller to say so. A member who dismisses the sheet is not a
 * failure.
 */
export async function shareCsv(
  rows: Record<string, string>[],
  filenamePrefix: string,
  dialogTitle: string,
): Promise<boolean> {
  try {
    const cache = FileSystem.cacheDirectory;
    if (rows.length === 0 || !cache) return false;
    if (!(await Sharing.isAvailableAsync())) return false;
    // One directory per export, so a second export of the same card that day
    // never overwrites a file a share sheet is still reading.
    const directory = `${cache}chat-export/${Date.now()}/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const uri = `${directory}${csvShareFileName(filenamePrefix, new Date())}`;
    await FileSystem.writeAsStringAsync(uri, rowsToCsv(rows));
    await Sharing.shareAsync(uri, {
      dialogTitle,
      mimeType: "text/csv",
      UTI: "public.comma-separated-values-text",
    });
    return true;
  } catch {
    return false;
  }
}
