/**
 * A resumable upload straight to Supabase Storage, over the TUS protocol
 * Storage speaks (`/storage/v1/upload/resumable`), signed for one object by
 * the API. Written by hand because it is forty lines of `fetch`: create the
 * upload, send it in pieces, and after a dropped connection ask the server
 * how much it has and carry on from there.
 *
 * Used for a meeting's recording (#712), where a 100 MB file on chapter-house
 * wifi must survive a blip without starting over. The web sends a `Blob`
 * (`blobSource`); the phone reads the file it recorded a piece at a time, so
 * the thing uploaded is a `ResumableSource`, not a `Blob`. Nothing here
 * needs a browser: no `btoa`, `DOMException` or `Response` is constructed,
 * because React Native's runtime doesn't promise them.
 */

/** Supabase Storage takes every piece but the last at exactly this size. */
export const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;

/** How long to wait before each try at a piece that failed. */
const RETRY_DELAYS_MS = [1000, 3000, 5000, 10_000, 20_000];

export interface ResumableUploadTarget {
  bucket: string;
  path: string;
  /** The API's signature for this one object. */
  token: string;
  contentType: string;
}

export type ResumableUploadFailure =
  /** The connection kept failing past every retry. */
  | "network"
  /** Storage refused the file as larger than it takes. */
  | "too_large"
  /** Storage refused the upload: an expired signature, a type it bars. */
  | "rejected";

export class ResumableUploadError extends Error {
  constructor(readonly failure: ResumableUploadFailure) {
    super(`Upload failed: ${failure}`);
    this.name = "ResumableUploadError";
  }
}

/** What is uploaded: its size, and any stretch of its bytes on request. */
export interface ResumableSource {
  size: number;
  /** Bytes `from` (inclusive) to `to` (exclusive), as a request body. */
  read: (from: number, to: number) => BodyInit | Promise<BodyInit>;
}

/** A browser `File` or `Blob` as a source. */
export function blobSource(blob: Blob): ResumableSource {
  return { size: blob.size, read: (from, to) => blob.slice(from, to) };
}

export interface ResumableUploadOptions {
  /** The project's Supabase URL. */
  supabaseUrl: string;
  /**
   * An upload begun earlier for this same target (`onUploadUrl` gave it):
   * carry on from what Storage already holds instead of starting over. When
   * Storage no longer knows it, a new upload is created.
   */
  resumeUrl?: string | null;
  /** Storage's address for this upload, once it exists. Keep it to resume. */
  onUploadUrl?: (uploadUrl: string) => void;
  /** Bytes the server has, after each piece. */
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Replaced in tests so a retry doesn't wait. */
  sleep?: (ms: number) => Promise<void>;
}

const TUS_VERSION = "1.0.0";

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 of a string's UTF-8 bytes, without leaning on `btoa`. */
export function base64Utf8(value: string): string {
  const bytes: number[] = [];
  for (const char of encodeURIComponent(value).match(/%[0-9A-F]{2}|[^%]/g) ?? []) {
    bytes.push(char.length === 3 ? parseInt(char.slice(1), 16) : char.charCodeAt(0));
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    out += BASE64[a >> 2]!;
    out += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? "=" : BASE64[c & 63]!;
  }
  return out;
}

/** What a stopped upload rejects with, shaped like the platform's own. */
function abortError(): Error {
  const error = new Error("Upload stopped");
  error.name = "AbortError";
  return error;
}

/**
 * Whether a thrown fetch failure means "no answer", which is worth trying
 * again, as against a bug or a refusal. Browsers and React Native's own fetch
 * throw a `TypeError`. Expo's fetch, which is the global one in the mobile app,
 * throws its own `FetchError` (a plain `Error` whose message starts "fetch
 * failed"), so the class alone can't be the test.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (
    error instanceof Error &&
    !(error instanceof ResumableUploadError) &&
    error.name !== "AbortError" &&
    (error.name === "FetchError" || error.message.startsWith("fetch failed"))
  );
}

function metadata(target: ResumableUploadTarget): string {
  const encode = base64Utf8;
  return [
    `bucketName ${encode(target.bucket)}`,
    `objectName ${encode(target.path)}`,
    `contentType ${encode(target.contentType)}`,
    `cacheControl ${encode("3600")}`,
  ].join(",");
}

function refusal(status: number): ResumableUploadError {
  return new ResumableUploadError(status === 413 ? "too_large" : "rejected");
}

/**
 * Sends `file` to `target`. Resolves when Storage has every byte; rejects
 * with a `ResumableUploadError`, or with the signal's `AbortError` when the
 * caller stopped it.
 */
export async function uploadResumable(
  file: ResumableSource,
  target: ResumableUploadTarget,
  options: ResumableUploadOptions,
): Promise<void> {
  const send = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const { signal } = options;
  const endpoint = `${options.supabaseUrl.replace(/\/$/, "")}/storage/v1/upload/resumable/sign`;
  const base = { "Tus-Resumable": TUS_VERSION, "x-signature": target.token };
  const stopped = () => {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : abortError();
    }
  };

  /** Runs `attempt` until it answers, waiting longer after each failure. */
  async function withRetries(attempt: () => Promise<Response>) {
    for (let tries = 0; ; tries += 1) {
      stopped();
      try {
        const response = await attempt();
        // A server that is briefly unwell is the same as no answer.
        if (response.status < 500) return response;
      } catch (error) {
        stopped();
        if (!isNetworkFailure(error)) throw error;
      }
      const delay = RETRY_DELAYS_MS[tries];
      if (delay === undefined) throw new ResumableUploadError("network");
      await sleep(delay);
    }
  }

  /** How much Storage has of the upload at `url`, or null when it has none. */
  async function offsetAt(url: string): Promise<number | null> {
    const head = await withRetries(() =>
      send(url, { method: "HEAD", headers: base, signal }),
    );
    const offset = Number(head.headers.get("Upload-Offset"));
    return head.ok && Number.isFinite(offset) ? offset : null;
  }

  let uploadUrl: string | null = null;
  let offset = 0;
  if (options.resumeUrl) {
    // Storage forgets an upload nobody finished; then this one starts over.
    const held = await offsetAt(options.resumeUrl);
    if (held !== null) {
      uploadUrl = options.resumeUrl;
      offset = held;
    }
  }
  if (!uploadUrl) {
    const created = await withRetries(() =>
      send(endpoint, {
        method: "POST",
        headers: {
          ...base,
          "Upload-Length": String(file.size),
          "Upload-Metadata": metadata(target),
        },
        signal,
      }),
    );
    const location = created.headers.get("Location");
    if (created.status !== 201 || !location) throw refusal(created.status);
    uploadUrl = new URL(location, endpoint).toString();
  }
  const url = uploadUrl;
  options.onUploadUrl?.(url);

  /** How much Storage has, by its own count. */
  async function serverOffset(): Promise<number> {
    const held = await offsetAt(url);
    if (held === null) throw new ResumableUploadError("rejected");
    return held;
  }

  options.onProgress?.(Math.min(offset, file.size), file.size);
  while (offset < file.size) {
    const from = offset;
    let resync = false;
    /** Set when a retry finds Storage already holds everything. */
    let complete = false;
    const response = await withRetries(async () => {
      // After a failed piece the server may hold part of it.
      const at = resync ? await serverOffset() : from;
      resync = true;
      offset = at;
      if (at >= file.size) {
        complete = true;
        return { status: 204 } as Response;
      }
      return send(url, {
        method: "PATCH",
        headers: {
          ...base,
          "Upload-Offset": String(at),
          "Content-Type": "application/offset+octet-stream",
        },
        body: await file.read(at, Math.min(file.size, at + RESUMABLE_CHUNK_BYTES)),
        signal,
      });
    });
    if (complete) {
      offset = file.size;
    } else if (response.status === 409) {
      // The server's count and ours disagree: take the server's.
      offset = await serverOffset();
    } else if (response.status !== 204) {
      throw refusal(response.status);
    } else {
      const next = Number(response.headers.get("Upload-Offset"));
      offset =
        Number.isFinite(next) && next > offset
          ? next
          : Math.min(file.size, offset + RESUMABLE_CHUNK_BYTES);
    }
    options.onProgress?.(Math.min(offset, file.size), file.size);
  }
}
