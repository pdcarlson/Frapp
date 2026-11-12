/**
 * A resumable upload straight to Supabase Storage, over the TUS protocol
 * Storage speaks (`/storage/v1/upload/resumable`), signed for one object by
 * the API. Written by hand because it is forty lines of `fetch`: create the
 * upload, send it in pieces, and after a dropped connection ask the server
 * how much it has and carry on from there.
 *
 * Used for a meeting's recording (#712), where a 100 MB file on chapter-house
 * wifi must survive a blip without starting over.
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

export interface ResumableUploadOptions {
  /** The project's Supabase URL. */
  supabaseUrl: string;
  /** Bytes the server has, after each piece. */
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Replaced in tests so a retry doesn't wait. */
  sleep?: (ms: number) => Promise<void>;
}

const TUS_VERSION = "1.0.0";

function metadata(target: ResumableUploadTarget): string {
  const encode = (value: string) => btoa(unescape(encodeURIComponent(value)));
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
  file: Blob,
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
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Upload stopped", "AbortError");
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
        if (!(error instanceof TypeError)) throw error;
      }
      const delay = RETRY_DELAYS_MS[tries];
      if (delay === undefined) throw new ResumableUploadError("network");
      await sleep(delay);
    }
  }

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
  const uploadUrl = new URL(location, endpoint).toString();

  /** How much Storage has, by its own count. */
  async function serverOffset(): Promise<number> {
    const head = await withRetries(() =>
      send(uploadUrl, { method: "HEAD", headers: base, signal }),
    );
    const offset = Number(head.headers.get("Upload-Offset"));
    if (!head.ok || !Number.isFinite(offset)) throw refusal(head.status);
    return offset;
  }

  let offset = 0;
  options.onProgress?.(0, file.size);
  while (offset < file.size) {
    const from = offset;
    let resync = false;
    const response = await withRetries(async () => {
      // After a failed piece the server may hold part of it.
      const at = resync ? await serverOffset() : from;
      resync = true;
      offset = at;
      if (at >= file.size) return new Response(null, { status: 204 });
      return send(uploadUrl, {
        method: "PATCH",
        headers: {
          ...base,
          "Upload-Offset": String(at),
          "Content-Type": "application/offset+octet-stream",
        },
        body: file.slice(at, at + RESUMABLE_CHUNK_BYTES),
        signal,
      });
    });
    if (response.status === 409) {
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

/**
 * How long an audio file is, in seconds, as this browser reads it, or null
 * when it can't (a format the browser doesn't play). Nothing is uploaded or
 * played: only the file's header is read.
 */
export function readAudioDuration(
  file: Blob,
  timeoutMs = 15_000,
): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let done = false;
    const finish = (seconds: number | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    const read = () => {
      const { duration } = audio;
      if (Number.isFinite(duration) && duration > 0) finish(duration);
      else if (duration === Infinity) {
        // A recording with no length in its header: seeking past the end
        // makes the browser work it out, and `durationchange` fires again.
        audio.currentTime = 1e9;
      }
    };
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", read);
    audio.addEventListener("durationchange", read);
    audio.addEventListener("error", () => finish(null));
    audio.src = url;
  });
}
