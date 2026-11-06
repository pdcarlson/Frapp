import { Zip, ZipPassThrough } from "fflate";
import {
  MAX_BACKWORK_ZIP_BYTES,
  MAX_BACKWORK_ZIP_FILES,
  fileExtension,
} from "@repo/validation";

/**
 * The backwork zip: the files a search or filter narrowed `/backwork` to,
 * fetched one at a time from their signed links and zipped in the browser, so
 * the API never carries the bytes (ADR-26's reason: Render bills outbound).
 *
 * The caps are the owner's rule (2026-11-05). The page offers a zip only once
 * the list is narrowed and holds `MAX_BACKWORK_ZIP_FILES` or fewer, and the
 * API refuses more ids than that. The size cap can only be checked here, as
 * the files come in, because nothing records a file's size at upload: a
 * file's `Content-Length` is checked before its body is read, and the body is
 * counted as it streams in, so the zip stops before it holds more than
 * `MAX_BACKWORK_ZIP_BYTES`, not after.
 *
 * Entries are stored, not deflated: the files are PDFs and Office documents,
 * which are compressed already, and storing keeps a 250 MB zip quick.
 */

export { MAX_BACKWORK_ZIP_FILES };

export class ZipTooLargeError extends Error {
  constructor() {
    super("The files add up to more than the zip allows.");
    this.name = "ZipTooLargeError";
  }
}

export type ZipSource = {
  /** What the member sees on the row; the entry's name is built from it. */
  title: string;
  /** Where the file's extension comes from: titles rarely carry one. */
  storagePath: string;
};

/**
 * Entry names for the zip, one per source in the same order: the title, made
 * safe for every desktop file system, with the stored file's extension, and
 * " (2)" and so on where two titles collide, since a zip with duplicate names
 * extracts only the last.
 */
export function zipEntryNames(sources: readonly ZipSource[]): string[] {
  const taken = new Set<string>();
  return sources.map(({ title, storagePath }) => {
    const ext = fileExtension(storagePath.slice(storagePath.lastIndexOf("/") + 1));
    const suffix = ext ? `.${ext}` : "";
    let base = title
      // Windows forbids these; `/` and `\` would make folders.
      // eslint-disable-next-line no-control-regex -- the control characters are the point
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 120)
      .trim()
      // Windows also drops a trailing dot or space.
      .replace(/[. ]+$/, "");
    if (suffix && base.toLowerCase().endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
    }
    if (!base) base = "Untitled";
    // Device names Windows won't create a file under, whatever the extension.
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `${base} file`;
    let name = `${base}${suffix}`;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
      name = `${base} (${n})${suffix}`;
    }
    taken.add(name.toLowerCase());
    return name;
  });
}

export type ZipResult = {
  blob: Blob;
  /** Files in the zip. */
  added: number;
  /** Files asked for that couldn't be fetched, or that the API left out. */
  missed: number;
};

/**
 * Fetches each linked file in turn and returns the zip. Throws
 * `ZipTooLargeError` the moment the next file would take the total past
 * `maxBytes`, having read no more of it than its headers. A file that fails
 * to fetch is counted in `missed` and the rest still zip; if none can be
 * fetched, the zip fails.
 */
export async function buildBackworkZip(
  entries: ReadonlyArray<{ name: string; url: string | null }>,
  {
    maxBytes = MAX_BACKWORK_ZIP_BYTES,
    signal,
    onProgress,
    fetcher = fetch,
  }: {
    maxBytes?: number;
    signal?: AbortSignal;
    /** Called after each file, with how many have been tried. */
    onProgress?: (done: number, total: number) => void;
    fetcher?: typeof fetch;
  } = {},
): Promise<ZipResult> {
  const chunks: BlobPart[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) zipError = error;
    else chunks.push(chunk as BlobPart);
  });

  let total = 0;
  let added = 0;
  let missed = 0;
  for (const [index, entry] of entries.entries()) {
    signal?.throwIfAborted();
    const data = entry.url ? await fetchFile(entry.url) : null;
    if (data) {
      total += data.byteLength;
      if (total > maxBytes) throw new ZipTooLargeError();
      const file = new ZipPassThrough(entry.name);
      zip.add(file);
      file.push(data, true);
      added += 1;
    } else {
      missed += 1;
    }
    onProgress?.(index + 1, entries.length);
  }
  if (added === 0) throw new Error("None of the files could be downloaded.");
  zip.end();
  if (zipError) throw zipError;
  return {
    blob: new Blob(chunks, { type: "application/zip" }),
    added,
    missed,
  };

  async function fetchFile(url: string): Promise<Uint8Array | null> {
    let response: Response;
    try {
      response = await fetcher(url, { signal });
    } catch (error) {
      // Leaving is the member's choice, not a missed file.
      if (signal?.aborted) throw error;
      return null;
    }
    if (!response.ok) {
      void response.body?.cancel();
      return null;
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 0 && total + declared > maxBytes) {
      void response.body?.cancel();
      throw new ZipTooLargeError();
    }
    if (!response.body) return null;
    // Counted as it streams, for a response that declares no length.
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (total + size > maxBytes) {
          void reader.cancel();
          throw new ZipTooLargeError();
        }
        parts.push(value);
      }
    } catch (error) {
      if (error instanceof ZipTooLargeError || signal?.aborted) throw error;
      return null;
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.byteLength;
    }
    return data;
  }
}

/** Hands `blob` to the browser as a download named `filename`. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has handed the URL to the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
