import type { Middleware } from "openapi-fetch";
import { mintRequestId, REQUEST_ID_HEADER } from "./request-id";
import type { components, paths } from "./types";

/** A section `GET /v1/bootstrap` can answer. */
export type BootstrapSection = keyof components["schemas"]["BootstrapDto"];

/** The inbox page the bootstrap reads, and so the only one it can answer. */
const BOOTSTRAP_NOTIFICATION_LIMIT = 50;

/**
 * The reads `GET /v1/bootstrap` answers, by the route each stands in for
 * (#4709). Only routes that take no path or query parameter are here, plus
 * the inbox at the one page the bootstrap reads.
 */
const SECTION_BY_PATH: Readonly<Record<string, BootstrapSection>> = {
  // Checked against the generated paths (the `satisfies` below), so a route
  // renamed in the API fails the build here instead of silently leaving the
  // batch.
  "/v1/users/me": "user",
  "/v1/users/me/permissions": "permissions",
  "/v1/users/me/legal-acceptance": "legal_acceptance",
  "/v1/users/me/whats-new": "whats_new",
  "/v1/chapters": "chapters",
  "/v1/chapters/current": "current_chapter",
  "/v1/settings": "settings",
  "/v1/channels": "channels",
  "/v1/channels/unread": "channel_unread",
  "/v1/channels/categories/list": "channel_categories",
  "/v1/channels/notification-preferences": "channel_notification_preferences",
  "/v1/channels/mention-roles": "mention_roles",
  "/v1/chat-sidebar": "chat_sidebar",
  "/v1/chat/blocks": "chat_blocks",
  "/v1/chat-backgrounds/default": "chat_background_default",
  "/v1/gifs/availability": "gif_availability",
  "/v1/bookmarks": "bookmarks",
  "/v1/roles": "roles",
  "/v1/events": "events",
  "/v1/geofences": "geofences",
  "/v1/documents": "documents",
  "/v1/members/roster": "member_roster",
  "/v1/notifications": "notifications",
} satisfies Partial<Record<keyof paths, BootstrapSection>>;

/**
 * Sections that read the same whatever chapter is active. A read for one of
 * these may go out before the client knows its chapter (web builds a client
 * per active chapter, and the first one exists before the persisted chapter
 * loads), so it joins whichever batch its session has open.
 */
const USER_SECTIONS: ReadonlySet<BootstrapSection> = new Set([
  "user",
  "legal_acceptance",
  "whats_new",
  "chapters",
  "settings",
]);

/**
 * The section a read stands for, or null when the bootstrap can't answer it:
 * a write, a route it doesn't cover, or one with a query it doesn't read.
 */
export function bootstrapSectionFor(
  method: string,
  schemaPath: string,
  query: Record<string, unknown> | undefined,
): BootstrapSection | null {
  if (method !== "GET") return null;
  const section = SECTION_BY_PATH[schemaPath];
  if (!section) return null;
  const keys = Object.keys(query ?? {}).filter(
    (key) => query?.[key] !== undefined,
  );
  if (section === "notifications") {
    const onlyLimit = keys.length === 1 && keys[0] === "limit";
    return onlyLimit && Number(query?.limit) === BOOTSTRAP_NOTIFICATION_LIMIT
      ? section
      : null;
  }
  return keys.length === 0 ? section : null;
}

/** How long a batch waits for more reads after its first. */
export const FIRST_SCREEN_BATCH_WINDOW_MS = 12;

/**
 * A batch needs this many different sections to be worth one bootstrap call;
 * a lone read goes out on its own route as before.
 */
export const FIRST_SCREEN_BATCH_MIN_SECTIONS = 2;

interface Waiter {
  section: BootstrapSection;
  resolve: (response: Response | undefined) => void;
}

interface Batch {
  /** The session the batch reads for (its credentials and the API origin). */
  session: string;
  /** The read whose headers the bootstrap call carries. */
  request: Request;
  /** The `x-chapter-id` the batch reads for, or null while none has one. */
  chapter: string | null;
  waiters: Waiter[];
}

/**
 * The batches waiting to go out, by session (its credentials and the API's
 * origin). Module-wide, not per client: a client is rebuilt when the chapter
 * changes, and the reads one open fires can straddle two clients.
 */
const openBatches = new Map<string, Batch[]>();

/**
 * Reads a screen makes only once an earlier one has answered: What's new
 * once the user is known, the nav's "not set up yet" check (geofences,
 * documents) once permissions are. Fetching them with the read they wait on
 * spares the open a second bootstrap call a few hundred milliseconds later.
 */
const COMPANIONS: Partial<Record<BootstrapSection, BootstrapSection[]>> = {
  user: ["whats_new"],
  permissions: ["geofences", "documents"],
};

/**
 * How long a companion's answer waits for its read. Long enough for the
 * render that issues it, short enough that nothing a member did since can
 * have changed it in a way they'd see; a read after that goes out as usual.
 */
export const FIRST_SCREEN_COMPANION_TTL_MS = 3_000;

/**
 * How long a batch waits for the bootstrap before its reads go out on their
 * own routes instead. A batch holds every read in it, so one stalled call
 * must not hold the first screen.
 */
export const FIRST_SCREEN_BATCH_TIMEOUT_MS = 5_000;

interface Stashed {
  value: unknown;
  expires: number;
}

/** Companion answers no read has taken yet, by session, chapter and section. */
const stash = new Map<string, Stashed>();

function stashKey(
  session: string,
  chapter: string | null,
  section: BootstrapSection,
): string {
  // A user section reads the same for every chapter.
  const scope = USER_SECTIONS.has(section) ? "" : (chapter ?? "");
  return `${session}|${scope}|${section}`;
}

/** Takes a fresh companion answer for this read, once. */
function takeStashed(key: string, now: number): unknown {
  const entry = stash.get(key);
  if (!entry) return undefined;
  stash.delete(key);
  return entry.expires > now ? entry.value : undefined;
}

/** Drops the answers no read took in time, so the stash can't grow. */
function sweepStash(now: number): void {
  for (const [key, entry] of stash) {
    if (entry.expires <= now) stash.delete(key);
  }
}

/**
 * Drops a session's held answers when it writes: a write may change what a
 * held answer says, and the read its invalidation sends must reach the route.
 */
function forgetSession(session: string): void {
  for (const key of stash.keys()) {
    if (key.startsWith(`${session}|`)) stash.delete(key);
  }
}

function sessionOf(request: Request): string {
  return `${request.headers.get("authorization") ?? ""}|${
    new URL(request.url).origin
  }`;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The open batch a read joins: one for its own chapter, or, for a user
 * section read that names no chapter, any open batch of its session. A
 * chapter read takes over a batch that holds only user sections and no
 * chapter yet, since those read the same either way. Null when it must start
 * its own.
 */
function batchFor(
  batches: Batch[],
  chapter: string | null,
  section: BootstrapSection,
): Batch | null {
  const same = batches.find((batch) => batch.chapter === chapter);
  if (same) return same;
  if (chapter === null) {
    return USER_SECTIONS.has(section) ? (batches[0] ?? null) : null;
  }
  const chapterless = batches.find(
    (batch) =>
      batch.chapter === null &&
      batch.waiters.every((waiter) => USER_SECTIONS.has(waiter.section)),
  );
  return chapterless ?? null;
}

/**
 * Answers the reads a screen fires together from one `GET /v1/bootstrap`
 * (#4709, #3728).
 *
 * An app open (and a resume, when TanStack refetches every stale query at
 * once) used to send each read on its own route, about 30 at once. Each runs
 * the API's whole guard chain, so one open queued hundreds of PostgREST and
 * GoTrue calls and stalled Supabase for seconds. This middleware holds a read
 * the bootstrap covers for {@link FIRST_SCREEN_BATCH_WINDOW_MS}; every covered
 * read that arrives in that window joins it, and the batch goes out as one
 * bootstrap call that `include`s exactly the sections asked for. Each read
 * then gets its own section as an ordinary 200, so the hooks above see the
 * same body their own route would have answered and need no change.
 *
 * Anything the bootstrap can't answer falls through to the read's own route,
 * unchanged: a batch of one, a batch with no chapter (the bootstrap needs
 * one, and a member with none yet would only be refused), a failed, refused
 * or stalled bootstrap (a 401 then comes back on each route, where the
 * client's sign-out handling sees it), a section that came back `null`, or a
 * network error.
 *
 * A batch also fetches the reads known to follow its own ({@link COMPANIONS})
 * and holds each answer for {@link FIRST_SCREEN_COMPANION_TTL_MS}, for the
 * first read of it only, and never past a write by the same session.
 *
 * Reads are batched only with reads carrying the same credentials, and
 * chapter reads only with reads for the same chapter, so a batch never
 * answers one session's or one chapter's read with another's.
 *
 * Runs after the auth middleware, which sets those headers.
 */
export function createFirstScreenBatchMiddleware(options?: {
  windowMs?: number;
  /** Defaults to the global `fetch` at call time, so a test can replace it. */
  fetch?: typeof fetch;
}): Middleware {
  const windowMs = options?.windowMs ?? FIRST_SCREEN_BATCH_WINDOW_MS;

  const send = async (batch: Batch) => {
    const asked = [...new Set(batch.waiters.map((w) => w.section))];
    if (
      asked.length < FIRST_SCREEN_BATCH_MIN_SECTIONS ||
      batch.chapter === null
    ) {
      for (const waiter of batch.waiters) waiter.resolve(undefined);
      return;
    }
    const companions = [
      ...new Set(asked.flatMap((section) => COMPANIONS[section] ?? [])),
    ].filter((section) => !asked.includes(section));
    let body: Record<string, unknown> | null = null;
    try {
      const url = new URL(batch.request.url);
      url.pathname = url.pathname.replace(/\/v1\/.*$/, "/v1/bootstrap");
      url.search = `?include=${[...asked, ...companions].join(",")}`;
      const headers = new Headers(batch.request.headers);
      headers.set(REQUEST_ID_HEADER, mintRequestId());
      const doFetch = options?.fetch ?? globalThis.fetch;
      // A controller and a timer, not `AbortSignal.timeout`, which React
      // Native's runtime may not have.
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        FIRST_SCREEN_BATCH_TIMEOUT_MS,
      );
      let response: Response;
      try {
        response = await doFetch(url.toString(), {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        if (response.ok) {
          const parsed: unknown = await response.json();
          if (parsed && typeof parsed === "object") {
            body = parsed as Record<string, unknown>;
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      body = null;
    }
    const expires = Date.now() + FIRST_SCREEN_COMPANION_TTL_MS;
    for (const section of companions) {
      const value = body?.[section];
      if (value !== undefined && value !== null) {
        stash.set(stashKey(batch.session, batch.chapter, section), {
          value,
          expires,
        });
      }
    }
    for (const waiter of batch.waiters) {
      const value = body?.[waiter.section];
      waiter.resolve(
        value === undefined || value === null ? undefined : jsonResponse(value),
      );
    }
  };

  return {
    onRequest({ request, schemaPath, params }) {
      const session = sessionOf(request);
      const now = Date.now();
      sweepStash(now);
      if (request.method !== "GET" && request.method !== "HEAD") {
        forgetSession(session);
        return undefined;
      }
      const section = bootstrapSectionFor(
        request.method,
        schemaPath,
        (params as { query?: Record<string, unknown> } | undefined)?.query,
      );
      if (!section) return undefined;
      const chapter = request.headers.get("x-chapter-id");
      const stashed = takeStashed(stashKey(session, chapter, section), now);
      if (stashed !== undefined) return jsonResponse(stashed);
      return new Promise<Response | undefined>((resolve) => {
        const batches = openBatches.get(session) ?? [];
        const joined = batchFor(batches, chapter, section);
        if (joined) {
          joined.waiters.push({ section, resolve });
          if (joined.chapter === null && chapter !== null) {
            joined.chapter = chapter;
            joined.request = request;
          }
          return;
        }
        const created: Batch = {
          session,
          request,
          chapter,
          waiters: [{ section, resolve }],
        };
        openBatches.set(session, [...batches, created]);
        setTimeout(() => {
          const left = (openBatches.get(session) ?? []).filter(
            (batch) => batch !== created,
          );
          if (left.length > 0) openBatches.set(session, left);
          else openBatches.delete(session);
          void send(created);
        }, windowMs);
      });
    },
  };
}
