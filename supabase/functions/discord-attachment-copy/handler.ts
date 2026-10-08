/**
 * Copies Discord attachments from Discord's CDN into Supabase Storage (#2848).
 *
 * The Discord bot importer used to stream every attachment through the API
 * process on Render: CDN → API → Storage. Render bills the second hop as
 * outbound bandwidth, byte for byte, and one chapter's history is on the order
 * of 10–20 GB. This function does the copy inside Supabase instead, so the API
 * sends a few hundred bytes of JSON per attachment and never the file.
 *
 * The API keeps everything that decides WHAT to copy: the manifest, the quota
 * RPC, the size and MIME checks. This function only moves bytes, and refuses
 * anything that isn't a Discord CDN object bound for the archive bucket.
 *
 * Pure: `fetch`, the clock and the environment are injected, so the tests run
 * the real handler with fakes. `index.ts` wires it to `Deno.serve`.
 */

/** The only bucket this function writes to. */
export const ALLOWED_BUCKETS: ReadonlySet<string> = new Set(["chat-archive"]);

/**
 * The largest object this function copies: the `chat-archive` bucket's own
 * `file_size_limit` (100 MB), which is also `MAX_ARCHIVE_UPLOAD_BYTES` in
 * `apps/api/src/domain/constants/discord-archive-limits.ts`. The bucket enforces it on the upload regardless; checking
 * the CDN's `Content-Length` first saves pulling an object Storage will refuse.
 */
export const MAX_OBJECT_BYTES = 100 * 1024 * 1024;

/** Items one request may carry. The API sends fewer; this bounds the parse. */
export const MAX_ITEMS = 100;

/** Transfers in flight at once within one request. */
export const COPY_CONCURRENCY = 6;

/**
 * No new transfer starts this long after the request arrived.
 *
 * The binding limit is the platform's **150 s request idle timeout**: a
 * function that has not answered by then gets a 504, and the caller learns
 * nothing about which items landed. The 400 s wall clock is not the constraint.
 * So a request works to a budget and answers early; items it did not start come
 * back `deferred` and the API sends them again (as do transfers the hard
 * deadline cuts short, see `FAIR_TRANSFER_WINDOW_MS`).
 */
export const START_BUDGET_MS = 60_000;

/**
 * In-flight transfers are aborted at this point, and the request answers.
 * Leaves 30 s between it and the 150 s idle timeout for the abort to settle and
 * the response to go out.
 */
export const HARD_DEADLINE_MS = 120_000;

/**
 * How long the CDN gets to answer with headers, per attachment. Only the
 * headers: the timer is cleared once they arrive, so a large file still
 * streaming is bounded by the hard deadline, never by this.
 */
export const CDN_RESPONSE_TIMEOUT_MS = 30_000;

/**
 * A transfer the hard deadline cuts off comes back `deferred`, not `failed`,
 * when it started with less than this much time left before that deadline. It
 * ran out of this request's budget rather than failing, and a re-send starts it
 * first in the next request with the whole budget. One that had this long and
 * still didn't finish is `failed`, so a file too slow for any request can't be
 * re-sent forever.
 */
export const FAIR_TRANSFER_WINDOW_MS = 90_000;

/**
 * Bytes one request may START. Each item reserves its declared size before
 * its transfer starts, corrected to the CDN's `Content-Length` once that
 * arrives, so the first concurrent wave is bounded as well as the ones after.
 *
 * Bounds the CPU a request spends moving bytes. The platform allows 2 s of CPU
 * per request with async I/O excluded, but every chunk still passes through
 * the stream plumbing. Measured locally under Deno 2.9 (#2848): a native
 * CDN-shaped stream piped into a Storage upload cost about 0.8 ms of process
 * CPU per MiB over plain HTTP. Production adds TLS on both hops, which that
 * figure does not include, hence the margin. Past this, remaining items are
 * deferred to the next request.
 */
export const START_BYTE_BUDGET = 256 * 1024 * 1024;

/**
 * How long Auth gets to vouch for a caller whose key the function doesn't hold
 * byte for byte ({@link callerVerdict}). Past it the request answers 503, which
 * the API retries, rather than 401, which would stop the import.
 */
export const AUTH_CHECK_TIMEOUT_MS = 10_000;

/** One attachment to copy. */
export interface CopyItem {
  /** The attachment's CDN URL, straight from Discord's API response. */
  url: string;
  bucket: string;
  /** The object key inside `bucket`. */
  path: string;
  /**
   * The type the API checked against the bucket's allowlist, or null when
   * Discord declared none, in which case the CDN's own header is used.
   */
  contentType: string | null;
  /** Discord's declared `attachment.size`, when it gave one. */
  declaredSize: number | null;
}

/**
 * What happened to one item.
 *
 * - `stored`: the object exists at `path`.
 * - `gone`: the CDN answered that the attachment doesn't exist any more.
 * - `rejected`: refused before any transfer (host, bucket, path or size).
 * - `failed`: attempted, and something went wrong on the way.
 * - `deferred`: not attempted, or cut off after starting late, because the
 *   request's budget ran out. Send it again.
 */
export type CopyStatus = "stored" | "gone" | "rejected" | "failed" | "deferred";

export interface CopyResult {
  path: string;
  status: CopyStatus;
  /** The object's size from the CDN's `Content-Length`, when it sent one. */
  bytes?: number;
  /** Why, for anything other than `stored` or `deferred`. */
  reason?: string;
}

export interface CopyResponse {
  results: CopyResult[];
}

/** Everything the handler reads from outside itself. */
export interface HandlerDeps {
  fetch: typeof fetch;
  /** Milliseconds, monotonic within one request. */
  now: () => number;
  env: (name: string) => string | undefined;
  /** Overrides for the budgets above; the tests shrink them. */
  limits?: Partial<Limits>;
}

/** The budgets one request works to. */
export interface Limits {
  concurrency: number;
  startBudgetMs: number;
  hardDeadlineMs: number;
  startByteBudget: number;
  cdnResponseTimeoutMs: number;
  fairTransferWindowMs: number;
  authCheckTimeoutMs: number;
}

const DEFAULT_LIMITS: Limits = {
  concurrency: COPY_CONCURRENCY,
  startBudgetMs: START_BUDGET_MS,
  hardDeadlineMs: HARD_DEADLINE_MS,
  startByteBudget: START_BYTE_BUDGET,
  cdnResponseTimeoutMs: CDN_RESPONSE_TIMEOUT_MS,
  fairTransferWindowMs: FAIR_TRANSFER_WINDOW_MS,
  authCheckTimeoutMs: AUTH_CHECK_TIMEOUT_MS,
};

/**
 * Hosts Discord serves attachments from.
 *
 * Moved here from the API's `DiscordBotGatewayService` when the copy moved: this
 * function is now the only thing that fetches an attachment URL. An allowlist
 * rather than a bare suffix test, because a suffix test matches
 * `cdn.discordapp.net.evil.com`; subdomains of the two Discord domains are
 * accepted through a dot-anchored check, which `evil.com` cannot satisfy.
 */
export function isDiscordCdnHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const exact = [
    "cdn.discordapp.com",
    "media.discordapp.net",
    "images-ext-1.discordapp.net",
    "images-ext-2.discordapp.net",
  ];
  if (exact.includes(host)) return true;
  return host.endsWith(".discordapp.net") || host.endsWith(".discordapp.com");
}

/**
 * A storage key this function will write.
 *
 * Stricter than Storage's own key rules on purpose: every key the importer
 * builds (`archiveMediaObjectPath` in the API) is a `/`-separated run of
 * `[A-Za-z0-9._-]` segments, so anything else is a caller bug, not a filename
 * to accommodate. Dot segments are refused because the key is interpolated
 * into the upload URL, and URL parsing would resolve them.
 */
export function isSafeObjectPath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  return path
    .split("/")
    .every((segment) =>
      /^[A-Za-z0-9._-]+$/.test(segment) && segment !== "." && segment !== ".."
    );
}

/**
 * Whether `presented` is byte for byte one of the service credentials the
 * platform gives this function: the no-network half of {@link callerVerdict}.
 *
 * Accepts the legacy `service_role` JWT and any of the newer `sb_secret_…`
 * keys, because the API's `SUPABASE_SERVICE_ROLE_KEY` holds the former today
 * and Supabase retires legacy keys at the end of 2026. Both are compared as
 * SHA-256 digests, byte by byte, so the comparison takes the same time
 * wherever the strings first differ.
 */
export async function isServiceCredential(
  presented: string,
  env: HandlerDeps["env"],
): Promise<boolean> {
  if (presented.length === 0) return false;
  const accepted = serviceKeys(env);
  if (accepted.length === 0) return false;
  const digest = await sha256(presented);
  let matched = false;
  for (const key of accepted) {
    // Every key is compared, so which one matched is not observable either.
    if (equalBytes(digest, await sha256(key))) matched = true;
  }
  return matched;
}

/**
 * Whether the caller holds a service credential for this project.
 *
 * - `service`: it does. A key the function holds byte for byte
 *   ({@link isServiceCredential}) needs no network. Any other key is sent to
 *   Auth's admin API, which answers 200 to a service credential and to nothing
 *   else.
 * - `refused`: no key, or Auth answered 401 or 403. The request gets a 401.
 * - `unconfirmed`: Auth answered anything else, the call threw, or it timed
 *   out. `reason` says which, and the request's 503 carries it, so the API,
 *   which retries a 503, logs the cause with each attempt.
 *
 * The byte match can't be the whole check (#2981). On staging the API's key
 * matched neither of the function's, and every copy was refused, though the
 * same key served every other call the API made. Auth judges a key by its
 * signature and role rather than its bytes, and knows the `sb_secret_…` keys
 * too. The function still writes to Storage with its own key
 * (`storageHeaders`), never the caller's.
 */
export async function callerVerdict(
  presented: string,
  deps: HandlerDeps,
  timeoutMs: number,
): Promise<CallerVerdict> {
  if (presented.length === 0) return { verdict: "refused" };
  if (await isServiceCredential(presented, deps.env)) {
    return { verdict: "service" };
  }
  // No URL, no Auth to ask. The platform always sets it, and refusing keeps
  // today's answer for a key the function doesn't hold.
  const supabaseUrl = deps.env("SUPABASE_URL");
  if (!supabaseUrl) return { verdict: "refused" };

  // A JWT goes on both headers, as supabase-js sends one. An opaque `sb_…` key
  // goes on `apikey` alone, which is where the gateway reads it; as a Bearer
  // token with no `apikey` it is refused.
  const headers: Record<string, string> = { apikey: presented };
  if (!presented.startsWith("sb_")) {
    headers.authorization = `Bearer ${presented}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Timed out.", "TimeoutError")),
    timeoutMs,
  );
  try {
    const response = await deps.fetch(
      `${
        supabaseUrl.replace(/\/+$/, "")
      }/auth/v1/admin/users?page=1&per_page=1`,
      { headers, redirect: "error", signal: controller.signal },
    );
    // The body is a user record; nothing here reads it.
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 200) return { verdict: "service" };
    if (response.status === 401 || response.status === 403) {
      return { verdict: "refused" };
    }
    return { verdict: "unconfirmed", reason: `answered ${response.status}` };
  } catch (error) {
    const timedOut = error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      verdict: "unconfirmed",
      reason: timedOut
        ? "timed out"
        : `failed: ${describe(error).slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** What {@link callerVerdict} decided about the caller. */
export type CallerVerdict =
  | { verdict: "service" }
  | { verdict: "refused" }
  | { verdict: "unconfirmed"; reason: string };

/** The project's service credentials, legacy JWT first. */
function serviceKeys(env: HandlerDeps["env"]): string[] {
  const keys: string[] = [];
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) keys.push(legacy);
  const secretKeys = env("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed: unknown = JSON.parse(secretKeys);
      if (parsed && typeof parsed === "object") {
        for (const value of Object.values(parsed)) {
          if (typeof value === "string" && value.length > 0) keys.push(value);
        }
      }
    } catch {
      // A malformed variable is a platform problem; the legacy key still works.
    }
  }
  return keys;
}

async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** The credential a request presents: `apikey`, else a Bearer token. */
function presentedCredential(request: Request): string {
  const apikey = request.headers.get("apikey");
  if (apikey) return apikey.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match ? match[1].trim() : "";
}

/**
 * How this function authenticates to Storage.
 *
 * The legacy JWT goes on both headers, as supabase-js sends it. A new
 * `sb_secret_…` key is not a JWT and must travel on `apikey` alone: the gateway
 * rejects it as a Bearer token.
 */
function storageHeaders(
  env: HandlerDeps["env"],
): Record<string, string> | null {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return { apikey: legacy, authorization: `Bearer ${legacy}` };
  const [secret] = serviceKeys(env);
  return secret ? { apikey: secret } : null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Thrown when Storage refuses the function's own credential. */
class StorageAuthError extends Error {}

/** Validate the parsed body's items, or name what is wrong with it. */
function parseItems(body: unknown): CopyItem[] | string {
  if (!body || typeof body !== "object") return "Expected a JSON object.";
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return "Expected `items` to be an array.";
  if (items.length === 0) return "`items` is empty.";
  if (items.length > MAX_ITEMS) {
    return `At most ${MAX_ITEMS} items per request; got ${items.length}.`;
  }
  const parsed: CopyItem[] = [];
  for (const [index, raw] of items.entries()) {
    const item = raw as Partial<CopyItem> | null;
    if (
      !item ||
      typeof item.url !== "string" ||
      typeof item.bucket !== "string" ||
      typeof item.path !== "string"
    ) {
      return `Item ${index} needs string \`url\`, \`bucket\` and \`path\`.`;
    }
    parsed.push({
      url: item.url,
      bucket: item.bucket,
      path: item.path,
      contentType: typeof item.contentType === "string" && item.contentType
        ? item.contentType
        : null,
      declaredSize: typeof item.declaredSize === "number" &&
          Number.isFinite(item.declaredSize) && item.declaredSize >= 0
        ? item.declaredSize
        : null,
    });
  }
  return parsed;
}

/** Why an item may not be copied at all, or null when it may. */
function refusal(item: CopyItem): string | null {
  if (!ALLOWED_BUCKETS.has(item.bucket)) {
    return `Bucket "${item.bucket}" is not one this function writes to.`;
  }
  if (!isSafeObjectPath(item.path)) return "Unsafe object path.";
  let url: URL;
  try {
    url = new URL(item.url);
  } catch {
    return "Not a valid URL.";
  }
  // The URL comes from Discord's API response, and this function holds a key
  // that writes anywhere in Storage. Pinning the scheme and host is what keeps
  // a hostile payload from turning the copy into a fetch of anything else.
  if (url.protocol !== "https:") return "Only https URLs are fetched.";
  if (!isDiscordCdnHost(url.hostname)) {
    return `Not a Discord CDN host: ${url.hostname}.`;
  }
  if (item.declaredSize !== null && item.declaredSize > MAX_OBJECT_BYTES) {
    return "Larger than the archive accepts.";
  }
  return null;
}

/** An object's length from its headers, when it is trustworthy. */
function declaredLength(response: Response): number | null {
  // A missing header must stay missing: `Number(null)` is 0, and a declared
  // length of zero on a streamed upload is a body/length mismatch. A
  // content-encoded body is decompressed on the way in, so its header gives
  // the compressed size, which would be short.
  const raw = response.headers.get("content-length");
  const encoded = (response.headers.get("content-encoding") ?? "").trim();
  if (raw === null || encoded !== "") return null;
  const length = Number(raw);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "AbortError" || error.name === "TimeoutError"
      ? "Timed out."
      : error.message;
  }
  return String(error);
}

/** Copy one item. Throws only `StorageAuthError`, which ends the request. */
async function copyOne(
  item: CopyItem,
  deps: HandlerDeps,
  storageUrl: string,
  storageAuth: Record<string, string>,
  hardStop: AbortSignal,
  cdnResponseTimeoutMs: number,
  /** Called with the CDN's `Content-Length` once it is known. */
  onLength: (bytes: number) => void,
): Promise<CopyResult> {
  const { path } = item;
  // The CDN request's signal governs only the wait for headers. A fetch's
  // signal keeps governing its response body, so a timeout still armed then
  // would cut a large file mid-stream, and a hard stop reaching the body
  // errors the stream the runtime is piping into the upload, which surfaces as
  // an unhandled rejection. After the headers, the upload's own signal is the
  // one that stops a transfer: aborting the upload cancels its source.
  const waitForHeaders = new AbortController();
  const timer = setTimeout(
    () => waitForHeaders.abort(new DOMException("Timed out.", "TimeoutError")),
    cdnResponseTimeoutMs,
  );
  const onHardStop = () => waitForHeaders.abort(hardStop.reason);
  if (hardStop.aborted) onHardStop();
  hardStop.addEventListener("abort", onHardStop);
  let source: Response;
  try {
    source = await deps.fetch(item.url, {
      redirect: "error",
      signal: waitForHeaders.signal,
    });
  } catch (error) {
    return { path, status: "failed", reason: `CDN: ${describe(error)}` };
  } finally {
    clearTimeout(timer);
    hardStop.removeEventListener("abort", onHardStop);
  }

  const length = declaredLength(source);
  if (length !== null) onLength(length);

  if (!source.ok || !source.body) {
    await source.body?.cancel().catch(() => undefined);
    // 4xx is the attachment being gone or its signature expired, which is a
    // warning on one message. 429 and 5xx are the CDN having a bad moment.
    if (source.status >= 400 && source.status < 500 && source.status !== 429) {
      return { path, status: "gone", reason: `CDN answered ${source.status}.` };
    }
    return {
      path,
      status: "failed",
      reason: `CDN answered ${source.status}.`,
    };
  }

  if (length !== null && length > MAX_OBJECT_BYTES) {
    await source.body.cancel().catch(() => undefined);
    return {
      path,
      status: "rejected",
      bytes: length,
      reason: "Larger than the archive accepts.",
    };
  }

  const contentType = item.contentType ??
    source.headers.get("content-type") ??
    "application/octet-stream";

  // Known limit: if Storage answers before reading the whole body (an early
  // 4xx), the runtime keeps draining the CDN response in the background after
  // the item is reported. Under Deno 2.9.6 neither aborting the CDN request
  // nor cancelling its body stops a body an upload holds, and the 30 s signal
  // this used to carry didn't either (#2848's review measured both). Stopping
  // it would take a JS-level pipe on every transfer, costing CPU on the common
  // path to save bandwidth on a rare one, so it stays: the refusals that
  // cause it are rare, and the file size and the worker's wall clock bound it.
  let upload: Response;
  try {
    upload = await deps.fetch(
      `${storageUrl}/object/${item.bucket}/${item.path}`,
      {
        method: "POST",
        headers: {
          ...storageAuth,
          "content-type": contentType,
          // A resumed import re-sends the same key, and the manifest decides
          // what is done, so an existing object is replaced, not refused.
          "x-upsert": "true",
        },
        body: source.body,
        redirect: "error",
        signal: hardStop,
        // Required by the fetch spec for a stream body.
        duplex: "half",
      } as RequestInit,
    );
  } catch (error) {
    await source.body.cancel().catch(() => undefined);
    return { path, status: "failed", reason: `Storage: ${describe(error)}` };
  }

  if (upload.ok) {
    await upload.body?.cancel().catch(() => undefined);
    return length === null
      ? { path, status: "stored" }
      : { path, status: "stored", bytes: length };
  }

  const detail = (await upload.text().catch(() => "")).slice(0, 300);
  if (upload.status === 401 || upload.status === 403) {
    // Storage refusing the service key is not this attachment's problem, and
    // reporting it per item would read as "every file failed" while the
    // import carried on. End the request so the API fails loudly.
    throw new StorageAuthError(
      `Storage refused the function's service credential (${upload.status}).`,
    );
  }
  if (upload.status === 413) {
    return {
      path,
      status: "rejected",
      reason: "Larger than the archive accepts.",
    };
  }
  return {
    path,
    status: "failed",
    reason: `Storage answered ${upload.status}${detail ? `: ${detail}` : "."}`,
  };
}

/** The whole request: authenticate, validate, copy to budget, answer. */
export async function handleCopyRequest(
  request: Request,
  deps: HandlerDeps,
): Promise<Response> {
  const startedAt = deps.now();
  const limits: Limits = { ...DEFAULT_LIMITS, ...deps.limits };

  if (request.method !== "POST") {
    return json(405, { error: "Use POST." });
  }
  const caller = await callerVerdict(
    presentedCredential(request),
    deps,
    limits.authCheckTimeoutMs,
  );
  if (caller.verdict === "refused") {
    return json(401, { error: "Not authorized." });
  }
  if (caller.verdict === "unconfirmed") {
    return json(503, {
      error:
        `Auth could not confirm the caller's credential: it ${caller.reason}.`,
      retryable: true,
    });
  }

  const supabaseUrl = deps.env("SUPABASE_URL");
  const storageAuth = storageHeaders(deps.env);
  if (!supabaseUrl || !storageAuth) {
    // `retryable: false` tells the API that sending again cannot help, as
    // opposed to a 5xx from the platform in front of the function.
    return json(500, {
      error: "The function is missing its Supabase config.",
      retryable: false,
    });
  }
  const storageUrl = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1`;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Expected a JSON body." });
  }
  const items = parseItems(body);
  if (typeof items === "string") return json(400, { error: items });

  const results: (CopyResult | undefined)[] = new Array(items.length);
  const runnable: number[] = [];
  items.forEach((item, index) => {
    const reason = refusal(item);
    if (reason) {
      results[index] = { path: item.path, status: "rejected", reason };
    } else {
      runnable.push(index);
    }
  });

  const hardStopController = new AbortController();
  const hardStopTimer = setTimeout(
    () =>
      hardStopController.abort(new DOMException("Timed out.", "AbortError")),
    Math.max(0, limits.hardDeadlineMs - (deps.now() - startedAt)),
  );

  let cursor = 0;
  let started = 0;
  let startedBytes = 0;
  // A holder rather than a bare `let`: it is written inside the runners, and
  // TypeScript would narrow a `let` to its initial `null` after them.
  const halt: { error: StorageAuthError | null } = { error: null };

  // May another transfer start? The first always may, so every request that
  // carries a runnable item makes progress, however slow or large it is.
  const mayStart = (): boolean =>
    started === 0 ||
    (halt.error === null &&
      !hardStopController.signal.aborted &&
      deps.now() - startedAt < limits.startBudgetMs &&
      startedBytes < limits.startByteBudget);

  const runner = async (): Promise<void> => {
    while (cursor < runnable.length && mayStart()) {
      const index = runnable[cursor];
      cursor += 1;
      started += 1;
      const startedAfter = deps.now() - startedAt;
      // Reserved before the first await, so the next runner's `mayStart`
      // already counts it.
      const reserved = items[index].declaredSize ?? 0;
      startedBytes += reserved;
      try {
        const result = await copyOne(
          items[index],
          deps,
          storageUrl,
          storageAuth,
          hardStopController.signal,
          limits.cdnResponseTimeoutMs,
          (length) => {
            startedBytes += length - reserved;
          },
        );
        // Cut off by this request's own deadline, having started too late to
        // get a fair share of it: the file didn't fail, the request ran out.
        const cutShort = result.status === "failed" &&
          hardStopController.signal.aborted &&
          halt.error === null &&
          limits.hardDeadlineMs - startedAfter < limits.fairTransferWindowMs;
        results[index] = cutShort
          ? { path: result.path, status: "deferred" }
          : result;
      } catch (error) {
        if (!(error instanceof StorageAuthError)) throw error;
        halt.error = error;
        hardStopController.abort(error);
        results[index] = {
          path: items[index].path,
          status: "failed",
          reason: error.message,
        };
      }
    }
  };

  try {
    await Promise.all(
      Array.from(
        { length: Math.min(limits.concurrency, runnable.length) },
        runner,
      ),
    );
  } finally {
    clearTimeout(hardStopTimer);
  }

  if (halt.error) {
    return json(502, { error: halt.error.message, retryable: false });
  }

  const response: CopyResponse = {
    results: items.map((item, index) =>
      results[index] ?? { path: item.path, status: "deferred" }
    ),
  };
  return json(200, response);
}
