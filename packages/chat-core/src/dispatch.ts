/**
 * Slash command dispatch (Chunk 05).
 *
 * Translates a parsed slash command into a `sendMessage` call against the
 * chat hot-path client. Lives in `@repo/chat-core` beside `chat-client.ts`,
 * whose `ChatActionContext` — the Supabase client, query client, outbox and
 * toast — it threads through. Pure mapping otherwise; the caller surfaces
 * the `{ok:false, error}` toast.
 */

import {
  parseAnnounceArgs,
  parseEventArgs,
  parsePollArgs,
  parsePointsArgs,
  parseTaskArgs,
  type AnnouncementPayload,
  type PollPayload,
  type SlashCommand,
} from "@repo/chat-integrations";
import {
  sendMessage,
  insertLocalPlaceholder,
  removeLocalPlaceholder,
  markLocalUnconfirmed,
  type ChatActionContext,
} from "./chat-client";
import { randomClientId } from "./random-id";
import type { ReplayRequest } from "./types";

export interface DispatchResult {
  ok: boolean;
  error?: string;
  /**
   * Set when the command's side effect committed but something non-essential
   * around it did not — today, a heavy command whose ledger row landed while its
   * chat card failed to post (#544). Distinct from `error`: the write happened,
   * so the caller must NOT present this as a failure or invite a retry that
   * would duplicate it. Callers surface it as a non-destructive notice.
   */
  warning?: string;
}

/**
 * Resolves a `@member` slash-command token to a chapter member. Built in
 * `chat-shell` from the loaded member directory; returns `null` when the token
 * matches no (or more than one) member, so the dispatcher fails closed without
 * a ledger write.
 */
export type ResolveMember = (
  token: string,
) => { user_id: string; display_name: string } | null;

interface DispatchArgs {
  command: SlashCommand;
  args: string;
  /** Channel where the command was invoked (used for /poll and /points). */
  channelId: string;
  /**
   * Channel id of `#announcements` for the active chapter. Required to
   * dispatch `/announce` regardless of which channel the user was in —
   * the brief routes announcements to the dedicated channel.
   */
  announcementsChannelId: string | null;
  /** Resolves the `@member` token for member-targeted commands (/points). */
  resolveMember?: ResolveMember;
}

function makeOptionId(): string {
  // A poll option id only has to be unique within one message's option list, so
  // it stays a short readable token rather than a full UUID. (`randomClientId()`
  // is the right call for anything the server dedupes on.)
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Dispatch a slash command. The command must be `implemented:true`; the
 * caller is expected to ignore unimplemented commands earlier (the slash
 * palette filters them).
 */
export async function dispatchSlashCommand(
  ctx: ChatActionContext,
  {
    command,
    args,
    channelId,
    announcementsChannelId,
    resolveMember,
  }: DispatchArgs,
): Promise<DispatchResult> {
  if (!command.implemented) {
    return { ok: false, error: `/${command.name} is not implemented yet` };
  }
  switch (command.name) {
    case "poll":
      return dispatchPoll(ctx, args, channelId);
    case "announce":
      if (!announcementsChannelId) {
        return {
          ok: false,
          error: "#announcements channel not found in this chapter",
        };
      }
      return dispatchAnnounce(ctx, args, announcementsChannelId);
    case "points":
      return dispatchPoints(ctx, args, channelId, resolveMember);
    case "task":
      return dispatchTask(ctx, args, channelId, resolveMember);
    case "event":
      return dispatchEvent(ctx, args, channelId);
    default:
      return {
        ok: false,
        error: `/${command.name} has no dispatch handler`,
      };
  }
}

async function dispatchPoll(
  ctx: ChatActionContext,
  args: string,
  channelId: string,
): Promise<DispatchResult> {
  const parsed = parsePollArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const closesAt = new Date(
    Date.now() + parsed.value.closesInMinutes * 60 * 1000,
  ).toISOString();
  const payload: PollPayload = {
    question: parsed.value.question,
    options: parsed.value.options.map((label) => ({
      id: makeOptionId(),
      label,
    })),
    closes_at: closesAt,
  };

  await sendMessage(ctx, {
    channelId,
    content: parsed.value.question,
    kind: "poll",
    payload: payload as unknown as Record<string, unknown>,
  });
  return { ok: true };
}

async function dispatchAnnounce(
  ctx: ChatActionContext,
  args: string,
  channelId: string,
): Promise<DispatchResult> {
  const parsed = parseAnnounceArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const payload: AnnouncementPayload = { body: parsed.value.message };

  await sendMessage(ctx, {
    channelId,
    content: parsed.value.message,
    kind: "announcement",
    payload: payload as unknown as Record<string, unknown>,
  });
  return { ok: true };
}

/** Pull a human message out of an openapi-fetch / NestJS error body. */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
    if (Array.isArray(m) && typeof m[0] === "string" && m[0].length > 0) {
      return m[0];
    }
  }
  return fallback;
}

/**
 * Dispatch `/points grant|deduct @member <amount> for <reason>`. This is a
 * "heavy" command: it performs a real ledger write, so the points card is
 * server-originated (a client cannot post `kind:"points"` directly). We show an
 * optimistic `loading` placeholder, call `POST /v1/points/adjust` (which writes
 * the ledger and posts the card with the same `client_message_id`), and let
 * Realtime reconcile the placeholder in place.
 *
 * Mints the idempotency key; {@link submitPointsAdjustment} owns everything
 * after it, so the first attempt and an explicit retry cannot drift.
 */
async function dispatchPoints(
  ctx: ChatActionContext,
  args: string,
  channelId: string,
  resolveMember: ResolveMember | undefined,
): Promise<DispatchResult> {
  const parsed = parsePointsArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  if (!resolveMember) {
    return {
      ok: false,
      error: "Member directory is still loading — try again in a moment",
    };
  }
  const member = resolveMember(parsed.value.memberToken);
  if (!member) {
    return { ok: false, error: `No member matches @${parsed.value.memberToken}` };
  }
  if (ctx.userId && member.user_id === ctx.userId) {
    return { ok: false, error: "You can't adjust your own points" };
  }

  const signedAmount =
    parsed.value.action === "grant"
      ? parsed.value.amount
      : -parsed.value.amount;
  const clientMessageId = randomClientId();

  const replay: ReplayRequest = {
    command: "points",
    channelId,
    clientMessageId,
    body: {
      target_user_id: member.user_id,
      amount: signedAmount,
      category: parsed.value.category,
      reason: parsed.value.reason,
      channel_id: channelId,
      client_message_id: clientMessageId,
    },
  };

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: `${parsed.value.action === "grant" ? "Granting" : "Deducting"} ${parsed.value.amount} points…`,
  });

  return submitPointsAdjustment(ctx, replay, false);
}

/**
 * Replay a `/points` adjustment that came back unconfirmed, under its
 * **original** `client_message_id` (#1733).
 *
 * This is the only sanctioned retry for a heavy command, and the distinction it
 * rests on is the reason the issue exists: re-typing the command is a *new
 * adjustment* — two deliberate +10 grants to the same member are two legitimate
 * ledger rows — so it mints a fresh key and must keep doing so. Only a retry of
 * one specific attempt may reuse that attempt's key, which is why the key
 * travels on the cached row (`_replay`) rather than being re-derived from the
 * command text.
 */
export async function retryPointsDispatch(
  ctx: ChatActionContext,
  replay: ReplayRequest,
): Promise<DispatchResult> {
  return submitPointsAdjustment(ctx, replay, true);
}

/**
 * POST an adjustment and translate the outcome into cache state + a
 * `DispatchResult`. Shared by the first attempt and by
 * {@link retryPointsDispatch} so the two cannot disagree about what a given
 * response means.
 *
 * Seven outcomes, and the distinctions all exist because the ledger is
 * append-only (`spec/behavior/points.md` § Anti-Fraud) — a wrongly-invited
 * retry writes a second row that no API call can undo:
 *
 * | Response | Ledger | Placeholder | Result |
 * | --- | --- | --- | --- |
 * | 4xx, not 409 | did not commit | removed | `ok:false` — re-typing is correct |
 * | 409 | did not commit; key spent | removed | `ok:false`, "run it again" (a fresh key) |
 * | 5xx / transport throw | **unknown** | kept, `unconfirmed` | `ok:true` + warning, retry *this row* |
 * | `card_posted:false` | committed, card lost | removed | `ok:true` + warning |
 * | `card_posted` absent, replay | committed | removed | `ok:true` + warning |
 * | `card_posted` absent, first try | no outcome reported | kept for the echo | `ok:true` |
 * | `card_posted:true` | committed + carded | kept for the echo | `ok:true` |
 */
async function submitPointsAdjustment(
  ctx: ChatActionContext,
  replay: ReplayRequest,
  isReplay: boolean,
): Promise<DispatchResult> {
  const { channelId, clientMessageId } = replay;

  let cardPosted: boolean | undefined;
  try {
    const { data, error, response } = await ctx.apiClient.POST(
      "/v1/points/adjust",
      { body: replay.body },
    );
    // Read the status BEFORE narrowing on `error`. The generated contract
    // declares no error responses for this route, so `error` is typed `never`
    // and `if (error)` alone narrows the whole branch — `response` included — to
    // `never`. The repo's other openapi-fetch call sites use `error || !data`
    // for the same reason (`chat-client.ts` `sendMessage`, `react`).
    const status: number | undefined = response?.status;
    if (error || !data) {
      // A key already spent on a DIFFERENT adjustment (`PointsService`
      // `resolveReplay`). Nothing committed under this request, and replaying it
      // never will — the correct recovery is a fresh key, which is what running
      // the command again mints. Surfaced separately from a transport failure
      // precisely so the copy can say that (#1733 AC 4).
      if (status === CONFLICT) {
        removeLocalPlaceholder(ctx, channelId, clientMessageId);
        return {
          ok: false,
          error:
            "That points command was already used for a different adjustment. Run the command again to record a new one.",
        };
      }

      // Any other 4xx is a definitive refusal: validated, rejected, nothing
      // written. Safe to tear down and let the officer re-type.
      if (isTerminalStatus(status)) {
        removeLocalPlaceholder(ctx, channelId, clientMessageId);
        return {
          ok: false,
          error: apiErrorMessage(error, "Couldn't adjust points"),
        };
      }

      // 5xx, or a status we could not read. `openapi-fetch` RESOLVES rather than
      // throws on a non-2xx, so a gateway 502/504 — the commonest way to lose a
      // response to a request that already committed — arrives HERE, not in the
      // `catch` below. Treating it as failure is what invites the re-typed
      // command and the double-grant.
      return unconfirmed(ctx, replay);
    }
    cardPosted = data?.card_posted;
  } catch {
    // Transport-level: the request may or may not have reached the server.
    return unconfirmed(ctx, replay);
  }

  // The ledger row is committed either way — the card is best-effort and is
  // never rolled back. But the placeholder is reconciled by the Realtime echo of
  // that card, so when the card did not post the echo never arrives and the
  // placeholder would sit on "Granting … points…" forever. Drop it ourselves and
  // say what happened, without implying the grant failed.
  if (cardPosted === false) {
    removeLocalPlaceholder(ctx, channelId, clientMessageId);
    return { ok: true, warning: CARD_LOST_WARNING };
  }

  // `undefined` means the server reported no outcome, and what that implies
  // depends entirely on whether WE are replaying:
  //
  //   - On a replay it means `completeReplay` short-circuited: the ledger row
  //     exists (that is what made it a replay), the request fired no side
  //     effect, and the row records nothing about whether the ORIGINAL
  //     attempt's card posted. If that first card failed, no echo is ever
  //     coming and leaving the placeholder up strands it on "Granting…"
  //     forever — #544's exact bug, which is why the coupling comment on #1733
  //     required this guard before key reuse could ship. The server cannot
  //     answer until the ledger row records its origin channel (#1734); the
  //     client does not need it to, because the client knows it is replaying.
  //     Treat it as committed-with-unknown-card: the `card_posted:false` copy
  //     is already exactly true.
  //
  //   - On a first attempt it means a dashboard-shaped call (no chat context)
  //     or a pre-#544 server. No side effect was skipped, so the echo may still
  //     arrive; leave the placeholder for it, exactly as before.
  if (cardPosted === undefined && isReplay) {
    removeLocalPlaceholder(ctx, channelId, clientMessageId);
    return { ok: true, warning: CARD_LOST_WARNING };
  }

  // Success: the server posts the `points` card (same client_message_id); the
  // Realtime echo reconciles the placeholder via mergeServerRow. Nothing to do.
  return { ok: true };
}

/** HTTP 409 — `PointsService.resolveReplay`'s key-reused-for-something-else refusal. */
const CONFLICT = 409;

function isTerminalStatus(status: number | undefined): boolean {
  return typeof status === "number" && status >= 400 && status < 500;
}

const CARD_LOST_WARNING =
  "Points were recorded, but the chat card couldn't be posted. Check the points ledger to confirm — don't run the command again.";

const UNCONFIRMED_WARNING =
  "We couldn't confirm whether these points were recorded. The message is still in the channel — use Retry on it rather than running the command again, so it can't be counted twice.";

/**
 * Park the placeholder as `unconfirmed` and report it as a non-failure.
 *
 * `ok: true` is deliberate and is AC 2 of #1733. `notifyDispatchOutcome` derives
 * its "/points failed" title and destructive styling purely from `ok: false`, so
 * returning a failure here would put a red "failed" toast in front of a write
 * that may have committed — and the retry an officer performs after seeing one
 * is re-typing the command, which mints a fresh key, misses the dedupe index and
 * double-grants. The write is not known to have failed, so we must not say it
 * did.
 */
function unconfirmed(
  ctx: ChatActionContext,
  replay: ReplayRequest,
): DispatchResult {
  markLocalUnconfirmed(ctx, replay, UNCONFIRMED_WARNING);
  return { ok: true, warning: UNCONFIRMED_WARNING };
}

/**
 * Dispatch `/task "<title>" @assignee <YYYY-MM-DD> [points]`. Like `/points`,
 * this is a "heavy" command: it creates a real task row, so the task card is
 * server-originated (a client cannot post `kind:"task"` directly). We show an
 * optimistic `loading` placeholder, call `POST /v1/tasks` (which creates the
 * task and posts the card with the same `client_message_id`), and let Realtime
 * reconcile the placeholder in place. On failure we drop the placeholder and
 * surface the server's message.
 */
async function dispatchTask(
  ctx: ChatActionContext,
  args: string,
  channelId: string,
  resolveMember: ResolveMember | undefined,
): Promise<DispatchResult> {
  const parsed = parseTaskArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  if (!resolveMember) {
    return {
      ok: false,
      error: "Member directory is still loading — try again in a moment",
    };
  }
  const member = resolveMember(parsed.value.assigneeToken);
  if (!member) {
    return {
      ok: false,
      error: `No member matches @${parsed.value.assigneeToken}`,
    };
  }

  const clientMessageId = randomClientId();

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: `Creating task "${parsed.value.title}"…`,
  });

  try {
    const { error } = await ctx.apiClient.POST("/v1/tasks", {
      body: {
        title: parsed.value.title,
        assignee_id: member.user_id,
        due_date: parsed.value.dueDate,
        point_reward: parsed.value.pointReward ?? undefined,
        channel_id: channelId,
        client_message_id: clientMessageId,
      },
    });
    if (error) {
      removeLocalPlaceholder(ctx, channelId, clientMessageId);
      return { ok: false, error: apiErrorMessage(error, "Couldn't create task") };
    }
  } catch {
    removeLocalPlaceholder(ctx, channelId, clientMessageId);
    return { ok: false, error: "Couldn't reach the tasks service" };
  }

  // Success: the server posts the `task` card (same client_message_id); the
  // Realtime echo reconciles the placeholder via mergeServerRow.
  return { ok: true };
}

/**
 * Combine a `YYYY-MM-DD` date and an `H:MM`/`HH:MM` clock time into an ISO-8601
 * datetime, interpreting them in the browser's local timezone (the chapter
 * admin's wall clock — the parser stays timezone-pure). Returns `null` for
 * malformed input so the caller fails with a precise error rather than posting
 * an invalid event. The conversion happens on the client (which knows the
 * timezone), keeping the shared parser timezone-pure.
 */
function localDateTimeToIso(date: string, time: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const local = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  );
  // `new Date(year, …)` remaps years 0–99 to 1900–1999; pin the full year so a
  // four-digit year like 0099 isn't silently misdated (parseIsoDate validates
  // the calendar date, but the remap would still slip through).
  local.setFullYear(Number(dateMatch[1]));
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

/**
 * Dispatch `/event "<name>" <YYYY-MM-DD> <HH:MM>-<HH:MM> [location] [points=<n>]`.
 * Like `/task`, a "heavy" command: it creates a real event row, so the event
 * card is server-originated (a client cannot post `kind:"event"` directly). We
 * show an optimistic `loading` placeholder, call `POST /v1/events` (which
 * creates the event and posts the card with the same `client_message_id`), and
 * let Realtime reconcile the placeholder in place. On failure we drop the
 * placeholder and surface the server's message. No `@member` resolution — events
 * have no assignee.
 */
async function dispatchEvent(
  ctx: ChatActionContext,
  args: string,
  channelId: string,
): Promise<DispatchResult> {
  const parsed = parseEventArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const startIso = localDateTimeToIso(parsed.value.date, parsed.value.startTime);
  const endIso = localDateTimeToIso(parsed.value.date, parsed.value.endTime);
  if (startIso === null || endIso === null) {
    return { ok: false, error: "Couldn't read the event date or time" };
  }

  const clientMessageId = randomClientId();

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: `Creating event "${parsed.value.name}"…`,
  });

  try {
    const { error } = await ctx.apiClient.POST("/v1/events", {
      body: {
        name: parsed.value.name,
        start_time: startIso,
        end_time: endIso,
        location: parsed.value.location ?? undefined,
        // point_value and is_mandatory are required in the generated SDK type
        // (their DTO `@default` makes them non-optional); send the spec defaults
        // (10 points, not mandatory) when the command omits them — slash-created
        // events are non-mandatory by design (mandatory is dashboard-only).
        point_value: parsed.value.pointValue ?? 10,
        is_mandatory: false,
        channel_id: channelId,
        client_message_id: clientMessageId,
      },
    });
    if (error) {
      removeLocalPlaceholder(ctx, channelId, clientMessageId);
      return { ok: false, error: apiErrorMessage(error, "Couldn't create event") };
    }
  } catch {
    removeLocalPlaceholder(ctx, channelId, clientMessageId);
    return { ok: false, error: "Couldn't reach the events service" };
  }

  // Success: the server posts the `event` card (same client_message_id); the
  // Realtime echo reconciles the placeholder via mergeServerRow.
  return { ok: true };
}
