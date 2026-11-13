/**
 * Slash command dispatch (Chunk 05).
 *
 * Translates a parsed slash command into a `sendMessage` call against the
 * chat hot-path client. Lives in `@repo/chat-core` beside `chat-client.ts`,
 * whose `ChatActionContext` — the Supabase client, query client, outbox and
 * toast — it threads through. Every path returns a `DispatchResult`; the
 * caller surfaces the toast. `/poll` and `/announce` wrap `sendMessage` so a
 * never-sent outbox fault is `{ ok: false }` and a post-commit bookkeeping
 * fault is `{ ok: true, warning }` (#1718) — not an escaped rejection.
 */

import {
  parseAnnounceArgs,
  parseEventArgs,
  parseHoursArgs,
  parsePollArgs,
  parsePointsArgs,
  parseRushArgs,
  parseTaskArgs,
  type AnnouncementPayload,
  type SlashCommand,
} from "./integrations";
import { buildPollMessage, type PollPayload } from "./polls";
import type { FormPayload } from "./forms";
import type { SignupPayload } from "./signups";
import {
  sendMessage,
  insertLocalPlaceholder,
  removeLocalPlaceholder,
  markLocalRecorded,
  markLocalUnconfirmed,
  RATE_LIMITED_COPY,
  type ChatActionContext,
} from "./chat-client";
import {
  isDefinitiveClientError,
  randomClientId,
  serverMessageOf,
} from "@repo/api-sdk";
import { localIsoDate } from "@repo/formatting";
import type { ReplayRequest } from "./types";

export interface DispatchResult {
  ok: boolean;
  error?: string;
  /**
   * Set when the command's side effect committed but something non-essential
   * around it did not — today, a heavy command whose row landed while its
   * chat card failed to post (#544, #1717). Distinct from `error`: the write
   * happened, so the caller must NOT present this as a failure or invite a
   * retry that would duplicate it. Callers surface it as a non-destructive
   * notice.
   */
  warning?: string;
  /**
   * The outcome is **unknown** — the response was lost, so the write may or may
   * not have committed (#1733).
   *
   * A third thing again, and it must not be collapsed into either neighbour.
   * `error` would title the notice "failed" and invite the re-typed command
   * that double-grants; `warning` alone would title it "partly succeeded",
   * asserting a write that may never have happened — which on a `/points
   * deduct` reads as "the fine landed" and silently loses it. Callers give this
   * its own copy.
   */
  unconfirmed?: boolean;
  /**
   * A retry resolved the row it was fired from. Callers report it explicitly —
   * silence after a retry is indistinguishable from a retry that did nothing.
   */
  resolved?: string;
  /**
   * The API's refusal body, set beside `error` by `postTask` and `postHours`,
   * so a form posting through them can read the same gate refusals
   * (subscription, module, receipt required) it reads from its own request.
   */
  cause?: unknown;
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
    case "hours":
      return dispatchHours(ctx, args, channelId);
    case "rush":
      return dispatchRush(ctx, args, channelId, resolveMember);
    default:
      return {
        ok: false,
        error: `/${command.name} has no dispatch handler`,
      };
  }
}

/**
 * `/poll` and `/announce` post through `sendMessage`. A never-sent outbox
 * fault throws; a post-commit dequeue fault resolves with `warning`. Map
 * both onto `DispatchResult` so `dispatchSlashCommand` stays total (#1718).
 */
async function sendSimpleCommand(
  ctx: ChatActionContext,
  args: Parameters<typeof sendMessage>[1],
): Promise<DispatchResult> {
  try {
    const sent = await sendMessage(ctx, args);
    return sent.warning ? { ok: true, warning: sent.warning } : { ok: true };
  } catch {
    return { ok: false, error: "Couldn't run that command." };
  }
}

async function dispatchPoll(
  ctx: ChatActionContext,
  args: string,
  channelId: string,
): Promise<DispatchResult> {
  const parsed = parsePollArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { content, payload } = buildPollMessage({
    question: parsed.value.question,
    options: parsed.value.options,
    closesAt: new Date(Date.now() + parsed.value.closesInMinutes * 60 * 1000),
  });

  return sendSimpleCommand(ctx, {
    channelId,
    content,
    kind: "poll",
    payload: payload as unknown as Record<string, unknown>,
  });
}

/** A post from a form with no signed-in member behind it, on either surface. */
export const SIGNED_OUT_POST_COPY =
  "You're signed out. Sign in, then post it again.";

/**
 * Posts a poll card a New poll form built (`buildPollMessage`): web's dialog
 * (#3865) and the phone's New poll sheet. Through the outbox like a message, so
 * it is optimistic and survives going offline. Unlike `/poll` it leaves the
 * channel's saved draft alone: the composer may hold a message the member is
 * still writing beside the form.
 *
 * Never rejects. `{ ok: false }` means nothing was queued and the form's
 * draft is all the member has: signed out (`sendMessage` toasts that itself
 * and resolves without queuing), or an outbox that refused the row.
 * `{ ok: true, warning }` is `sendMessage`'s posted-but-not-saved warning,
 * which the caller must show, as `notifyDispatchOutcome` does for `/poll`.
 */
export function postPoll(
  ctx: ChatActionContext,
  channelId: string,
  poll: { content: string; payload: PollPayload },
): Promise<PostFormCardResult> {
  return postFormCard(
    ctx,
    channelId,
    "poll",
    poll,
    "Couldn't post that poll. Try again.",
  );
}

type PostFormCardResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string; cause?: unknown };

/**
 * The one way a + form posts a card that queues like a message: a poll, a
 * sign-up sheet and a form. Never rejects; the outcomes are `postPoll`'s.
 */
async function postFormCard(
  ctx: ChatActionContext,
  channelId: string,
  kind: "poll" | "signup" | "form",
  card: { content: string; payload: object },
  failureCopy: string,
): Promise<PostFormCardResult> {
  if (!ctx.userId) {
    return { ok: false, error: SIGNED_OUT_POST_COPY };
  }
  try {
    const sent = await sendMessage(ctx, {
      channelId,
      content: card.content,
      kind,
      payload: card.payload as Record<string, unknown>,
      keepDraft: true,
    });
    return sent.warning ? { ok: true, warning: sent.warning } : { ok: true };
  } catch (cause) {
    // The outbox refused the row and `sendMessage` took the optimistic card
    // back out, so nothing is queued or on screen. `cause` is for the
    // caller's error reporting, which chat-core has no port for.
    return { ok: false, error: failureCopy, cause };
  }
}

/**
 * Posts a sign-up sheet card the New sign-up sheet form built
 * (`buildSignupMessage`, #3926), on web's + card and the phone's sheet.
 * Through the outbox like a poll, so it is optimistic and survives going
 * offline, and it leaves the channel's saved draft alone. Never rejects; the
 * outcomes are `postPoll`'s.
 */
export function postSignup(
  ctx: ChatActionContext,
  channelId: string,
  signup: { content: string; payload: SignupPayload },
): Promise<PostFormCardResult> {
  return postFormCard(
    ctx,
    channelId,
    "signup",
    signup,
    "Couldn't post that sign-up sheet. Try again.",
  );
}

/**
 * Posts a form card the New form builder built (`buildFormMessage`, #3926
 * step 3). Through the outbox like a sign-up sheet: optimistic, survives
 * going offline, and leaves the channel's saved draft alone. Never rejects;
 * the outcomes are `postPoll`'s.
 */
export function postForm(
  ctx: ChatActionContext,
  channelId: string,
  form: { content: string; payload: FormPayload },
): Promise<PostFormCardResult> {
  return postFormCard(
    ctx,
    channelId,
    "form",
    form,
    "Couldn't post that form. Try again.",
  );
}

async function dispatchAnnounce(
  ctx: ChatActionContext,
  args: string,
  channelId: string,
): Promise<DispatchResult> {
  const parsed = parseAnnounceArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const payload: AnnouncementPayload = { body: parsed.value.message };

  return sendSimpleCommand(ctx, {
    channelId,
    content: parsed.value.message,
    kind: "announcement",
    payload: payload as unknown as Record<string, unknown>,
  });
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
    return {
      ok: false,
      error: `No member matches @${parsed.value.memberToken}`,
    };
  }
  return postPointsAdjustment(ctx, channelId, {
    target_user_id: member.user_id,
    amount:
      parsed.value.action === "grant"
        ? parsed.value.amount
        : -parsed.value.amount,
    category: parsed.value.category,
    reason: parsed.value.reason,
  });
}

/** What a points adjustment posted into a channel carries (`/points` or the + menu's form). */
export interface PointsAdjustmentInput {
  target_user_id: string;
  /** Signed: negative deducts. */
  amount: number;
  category: ReplayRequest["body"]["category"];
  reason: string;
}

/**
 * Adjust a member's points and post the points card in `channelId`: the
 * `/points` one-liner, and the composer's + menu's Points form (#3865). Mints
 * the idempotency key and shows the `loading` placeholder;
 * {@link submitPointsAdjustment} owns everything after it, so the command,
 * the form and an explicit retry cannot drift.
 */
export async function postPointsAdjustment(
  ctx: ChatActionContext,
  channelId: string,
  input: PointsAdjustmentInput,
): Promise<DispatchResult> {
  if (ctx.userId && input.target_user_id === ctx.userId) {
    return { ok: false, error: "You can't adjust your own points" };
  }
  const clientMessageId = randomClientId();

  const replay: ReplayRequest = {
    command: "points",
    channelId,
    clientMessageId,
    body: {
      target_user_id: input.target_user_id,
      amount: input.amount,
      category: input.category,
      reason: input.reason,
      channel_id: channelId,
      client_message_id: clientMessageId,
    },
  };

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: pointsPlaceholderContent(replay),
  });

  return submitPointsAdjustment(ctx, replay, false);
}

/**
 * The placeholder's copy, derived from the request rather than the command
 * text, so a row redrawn after a REST rebuild (from nothing but its replay
 * handle) reads exactly like the one the officer saw.
 */
function pointsPlaceholderContent(replay: ReplayRequest): string {
  const { amount } = replay.body;
  return `${amount < 0 ? "Deducting" : "Granting"} ${Math.abs(amount)} points…`;
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
  // The button's own disabled state cannot carry this guard: the timeline is
  // virtualized (Virtuoso unmounts off-screen rows), so scrolling away and back
  // remounts the row with fresh state and re-enables Retry while the first
  // replay is still in flight. Two concurrent replays cannot double-grant —
  // they share a key — but their responses race, and the loser can overwrite a
  // clean resolution with "the card's fate is unknown". Keyed here because this
  // module outlives every row that renders it.
  if (REPLAYS_IN_FLIGHT.has(replay.clientMessageId)) {
    return { ok: true, unconfirmed: true, warning: RETRY_IN_FLIGHT_NOTE };
  }
  REPLAYS_IN_FLIGHT.add(replay.clientMessageId);
  try {
    return await submitPointsAdjustment(ctx, replay, true);
  } finally {
    REPLAYS_IN_FLIGHT.delete(replay.clientMessageId);
  }
}

const REPLAYS_IN_FLIGHT = new Set<string>();

const RETRY_IN_FLIGHT_NOTE =
  "That retry is still running — give it a moment rather than running the command again.";

/**
 * POST an adjustment and translate the outcome into cache state + a
 * `DispatchResult`. Shared by the first attempt and by
 * {@link retryPointsDispatch} so the two cannot disagree about what a given
 * response means.
 *
 * The distinctions all exist because the ledger is append-only
 * (`spec/behavior/points.md` § Anti-Fraud): a wrongly-invited retry writes a
 * second row that no API call can undo, and a wrongly-suppressed one silently
 * loses an adjustment. **`isReplay` changes what several statuses mean**, which
 * is the subtlety worth reading twice — a refusal of a *retry* says nothing
 * about whether the *original* attempt committed.
 *
 * | Response | First attempt | Replay |
 * | --- | --- | --- |
 * | 409 | removed, `ok:false` — key spent, run it again | same: replaying can never succeed |
 * | other 4xx from the origin | removed, `ok:false` — validated and rejected, nothing written | **kept `unconfirmed`** — says nothing about the original |
 * | 408 / 499 / 460 | kept `unconfirmed` — an intermediary emitted it, possibly post-commit | kept `unconfirmed` |
 * | 5xx / transport | kept `unconfirmed` | kept `unconfirmed` |
 * | `card_posted:false` | kept `recorded`, committed-card-lost warning | same |
 * | `card_posted` absent | kept for the echo — no outcome reported | removed, committed-card-unknown warning (no stored origin) |
 * | `card_posted:true` | kept for the echo | row cleared, explicit success |
 */
async function submitPointsAdjustment(
  ctx: ChatActionContext,
  replay: ReplayRequest,
  isReplay: boolean,
): Promise<DispatchResult> {
  const { channelId, clientMessageId } = replay;

  let data: PointsAdjustResponse | undefined;
  let status: number | undefined;
  let refusal: unknown;
  try {
    // Narrow to the network call ONLY, so a cache-layer or programmer error
    // below is not reported as a lost response.
    //
    // This does NOT fully separate "never sent" from "sent, outcome unknown":
    // `apiClient.POST` runs auth middleware that awaits a token, so a session
    // refresh failure rejects before a socket opens and lands in the same
    // catch. Both are treated as unknown, which is the safe direction —
    // claiming a committed write failed is what causes the re-typed command
    // and the double-grant, while an over-cautious "unknown" costs one
    // unnecessary ledger check.
    const result = await ctx.apiClient.POST("/v1/points/adjust", {
      body: replay.body,
    });
    data = result.data as PointsAdjustResponse | undefined;
    // Read the status without narrowing on `error`: the generated contract
    // declares no error responses for this route, so `error` is typed `never`
    // and `if (result.error)` would narrow the whole branch — `response`
    // included — to `never`.
    status = result.response?.status;
    refusal = result.error;
    if (result.error) status ??= 0;
  } catch {
    // Transport-level: the request may or may not have reached the server.
    return unconfirmed(ctx, replay, isReplay);
  }

  const succeeded = typeof status === "number" && status >= 200 && status < 300;
  if (!succeeded) {
    // A key already spent on a DIFFERENT adjustment (`PointsService`
    // `resolveReplay`). Nothing committed under this request, and replaying it
    // never will — the correct recovery is a fresh key, which is what running
    // the command again mints. True on a replay as much as a first attempt, so
    // this is the one refusal that tears the row down either way.
    if (status === CONFLICT) {
      removeLocalPlaceholder(ctx, channelId, clientMessageId);
      return { ok: false, error: KEY_SPENT_ERROR };
    }

    // A definitive 4xx on a FIRST attempt means the origin validated the
    // request and rejected it: nothing written, safe to tear down and let the
    // officer re-type. `isDefinitiveClientError` deliberately excludes 408/499/460, which
    // an intermediary can emit after the origin already committed — those fall
    // through to the lost-response branch below.
    //
    // On a REPLAY it is nothing of the kind. A 401 (session expired while the
    // row sat there), a 403 (grant revoked, or the subscription lapsed) or a
    // 429 from the global throttler — which answers before `adjustPoints` runs
    // at all, so the service's own replay-aware re-check never fires — all
    // refuse the *retry* while saying nothing about the *original* attempt.
    // Removing the row there would delete the only trace of a write that may
    // have committed, and the officer's next move is re-typing: a fresh key,
    // no dedupe, a second append-only row. Keep it retryable instead.
    if (isTerminalStatus(status) && !isReplay) {
      removeLocalPlaceholder(ctx, channelId, clientMessageId);
      // A 429 says when to try again, which a bare refusal hides: the
      // throttler's minute, or the per-chapter cap's hour (#3061).
      return {
        ok: false,
        error:
          status === 429
            ? `${REFUSED_ERROR} ${serverMessageOf(refusal) ?? RATE_LIMITED_COPY}`
            : REFUSED_ERROR,
      };
    }

    // 5xx, an unreadable status, or any refusal of a replay. `openapi-fetch`
    // RESOLVES rather than throws on a non-2xx, so a gateway 502/504 — the
    // commonest way to lose a response to a request that already committed —
    // arrives HERE, not in the `catch` above.
    return unconfirmed(ctx, replay, isReplay);
  }

  const cardPosted = data?.card_posted;

  // The ledger row is committed either way — the card is best-effort and is
  // never rolled back. The placeholder used to be dropped here, which left
  // only an evictable toast as evidence of an append-only write (#1789).
  // Keep it as a non-retryable `recorded` row so the timeline still says
  // the grant happened after the toast is gone (and after a reload).
  if (cardPosted === false) {
    markLocalRecorded(ctx, {
      channelId,
      clientMessageId,
      note: POINTS_RECORDED_ROW_NOTE,
      // From the request, not a parameter: a replay has no placeholder text of
      // its own, and a row redrawn without it would lose which grant it was.
      content: pointsPlaceholderContent(replay),
    });
    return { ok: true, warning: CARD_LOST_WARNING };
  }

  // `undefined` means the server reported no outcome, and what that implies
  // depends entirely on whether WE are replaying:
  //
  //   - On a replay it means `completeReplay` had no stored origin to heal
  //     into (a pre-#1734 row, or a dashboard-keyed row): the ledger row
  //     exists (that is what made it a replay), this request attempted no
  //     card, and nothing is known about whether the ORIGINAL attempt's card
  //     posted. Leaving the placeholder up would strand it on "Granting…"
  //     forever if that first card failed — #544's bug arriving through the
  //     replay branch, which is why the coupling comment on #1733 required
  //     this guard before key reuse could ship.
  //
  //     A replay whose stored origin *is* set reports `card_posted` and never
  //     reaches this branch.
  //
  //     Note the copy says the card's fate is UNKNOWN, not that it failed: the
  //     server omits the field because it knows nothing about the original
  //     attempt, and asserting failure would send an officer to audit a
  //     discrepancy that usually is not there (the card most often did post).
  //
  //   - On a first attempt it means a dashboard-shaped call (no chat context)
  //     or a pre-#544 server. No side effect was skipped, so the echo may still
  //     arrive; leave the placeholder for it, exactly as before.
  if (cardPosted === undefined && isReplay) {
    removeLocalPlaceholder(ctx, channelId, clientMessageId);
    return { ok: true, warning: REPLAY_ACCEPTED_WARNING };
  }

  // A replay that reached here committed as a FIRST write (the original never
  // landed) and carded successfully. The row is still sitting there marked
  // `unconfirmed` with a Retry control, so clear it back to pending and report
  // explicitly — `notifyDispatchOutcome` is silent on a bare `ok:true`, and
  // silence after a retry is indistinguishable from a retry that did nothing.
  // The echo reconciles it from pending exactly as it would a first dispatch.
  if (isReplay) {
    // Remove rather than return it to `pending`. A pending row still renders
    // `LoadingCard`'s shimmer under `aria-busy`, and both the Retry footer and
    // the replay handle are gone — so if the card's echo never arrives (likely,
    // since the same outage produced the original lost response) it strands on
    // "Granting…" with no affordance at all: #544's bug, re-created at the end
    // of the path that exists to prevent it. The card is committed and will
    // arrive by echo or on the next channel load.
    removeLocalPlaceholder(ctx, channelId, clientMessageId);
    return { ok: true, resolved: RETRY_RESOLVED_NOTE };
  }

  // Success: the server posts the `points` card (same client_message_id); the
  // Realtime echo reconciles the placeholder via mergeServerRow. Nothing to do.
  return { ok: true };
}

/** Minimal shape this module reads off the adjust response. */
interface PointsAdjustResponse {
  card_posted?: boolean;
}

/** Minimal shape this module reads off create-task / create-event. */
interface CardPostedResponse {
  card_posted?: boolean;
}

/** HTTP 409 — `PointsService.resolveReplay`'s key-reused-for-something-else refusal. */
const CONFLICT = 409;

const KEY_SPENT_ERROR =
  "That points command was already used for a different adjustment. Run the command again to record a new one.";

const REFUSED_ERROR = "Couldn't adjust points — nothing was recorded.";

const CARD_LOST_WARNING =
  "Points were recorded, but the chat card couldn't be posted. Check the points ledger to confirm — don't run the command again.";

const TASK_CARD_LOST_WARNING =
  "Task was created, but the chat card couldn't be posted. Check the task board to confirm — don't run the command again.";

const EVENT_CARD_LOST_WARNING =
  "Event was created, but the chat card couldn't be posted. Check the events calendar to confirm — don't run the command again.";

const HOURS_CARD_LOST_WARNING =
  "Hours were logged, but the chat card couldn't be posted. Check the service hours page to confirm — don't run the command again.";

const POINTS_RECORDED_ROW_NOTE =
  "Points recorded — the chat card didn't post. Don't run this command again.";

const TASK_RECORDED_ROW_NOTE =
  "Task created — the chat card didn't post. Don't run this command again.";

const EVENT_RECORDED_ROW_NOTE =
  "Event created — the chat card didn't post. Don't run this command again.";

const HOURS_RECORDED_ROW_NOTE =
  "Hours logged — the chat card didn't post. Don't run this command again.";

const TASK_UNCONFIRMED_WARNING =
  "Couldn't confirm the task was created. Check the task board before you create it again.";

const HOURS_UNCONFIRMED_WARNING =
  "Couldn't confirm the hours were logged. Check the service hours page before you log them again.";

/**
 * A `/task` or `/hours` write whose answer never arrived: a transport failure,
 * a 5xx, or a status an intermediary emits after the origin may have
 * committed. Neither route dedupes, so this must not read as a refusal: a
 * red "failed" invites the resubmit (one click on the + menu's form, which
 * keeps the draft) that writes it twice. It reads as unconfirmed instead, and
 * the placeholder goes; if the write did commit, its card still arrives by
 * Realtime echo as a fresh row.
 */
function lostResponse(
  ctx: ChatActionContext,
  channelId: string,
  clientMessageId: string,
  warning: string,
): DispatchResult {
  removeLocalPlaceholder(ctx, channelId, clientMessageId);
  return { ok: true, unconfirmed: true, warning };
}

const RUSH_CARD_LOST_WARNING =
  "Candidate was added, but the chat card couldn't be posted. Don't run the command again.";

const RUSH_RECORDED_ROW_NOTE =
  "Candidate added — the chat card didn't post. Don't run this command again.";

const REPLAY_ACCEPTED_WARNING =
  "These points were already recorded — the retry didn't add a second entry. Whether the original chat card posted isn't something the server can tell us, so check the channel or the points ledger if you need to be sure.";

const RETRY_RESOLVED_NOTE = "Points recorded.";

/**
 * There is no row on screen to point at. Either there is no channel cache to
 * draw it in (the query was garbage-collected while the request was in flight;
 * whatever notice is on disk for the key — this write's, or with storage
 * blocked or full an earlier one's, if any — restores the row on the next load
 * unless it is past its age bound by then), or there is neither a signed-in
 * viewer nor a placeholder row to attribute it to. Pointing the officer at a Retry control that is not there is worse than
 * saying nothing, so the copy has to stand on its own.
 */
const UNCONFIRMED_NO_ROW_WARNING =
  "We couldn't confirm whether these points were recorded. Check the points ledger before running the command again — running it again would record them twice.";

/**
 * The row is on screen and carries the original key, so an explicit Retry is
 * the safe recovery. It does not hedge about the row disappearing: this is
 * `durable: true`, so the row and its replay handle are on disk with at least
 * an hour before their age bound, and the reconnect that follows the outage
 * restores them (#1909).
 */
const UNCONFIRMED_WARNING =
  "We couldn't confirm whether these points were recorded. Use Retry on the message rather than running the command again, which would record them twice.";

/**
 * The row is on screen, but nothing guarantees it outlives the next rebuild —
 * likely the reconnect that follows this very outage. This is `durable: false`
 * from `markLocalUnconfirmed`: the write did not land (storage blocked or
 * full, or no viewer to file it under), or the entry is within an hour of its
 * age bound or past it (a Retry pressed about a day after the dispatch keeps
 * the dispatch's timestamp). The copy keeps the fallback rather than promising
 * a Retry that may be gone.
 */
const UNCONFIRMED_VOLATILE_WARNING =
  "We couldn't confirm whether these points were recorded. Use Retry on the message rather than running the command again, which would record them twice. If the message is gone, check the points ledger before re-running.";

/**
 * What the timeline row itself says. Short on purpose: it sits directly above
 * its own Retry button, so the toast's "use Retry on the message" guidance is
 * nonsense in that position — and printing the toast's sentences on the row
 * duplicates them verbatim on screen and, under `aria-atomic`, in the
 * announcement.
 */
const UNCONFIRMED_ROW_NOTE =
  "Not confirmed — these points may or may not have been recorded.";

function isTerminalStatus(status: number | undefined): boolean {
  // `isDefinitiveClientError` already excludes the statuses an intermediary can emit
  // after the origin may have committed (408/499/460) — see its docblock.
  return typeof status === "number" && isDefinitiveClientError(status);
}

/**
 * Park the placeholder as `unconfirmed` and report it as a non-failure.
 *
 * `ok: true` is deliberate and is AC 2 of #1733: `notifyDispatchOutcome`
 * derives its "/points failed" title and destructive styling purely from
 * `ok: false`, and the retry an officer performs after seeing a red toast is
 * re-typing the command, which mints a fresh key and double-grants.
 *
 * `unconfirmed: true` is equally deliberate. Routing this through `warning`
 * alone would title the toast "/points partly succeeded" — an assertion that
 * the write committed, which is exactly what is NOT known here. On a transport
 * failure where nothing was written that reads as "the fine landed", and the
 * adjustment is silently lost: the mirror of the double-grant.
 */
function unconfirmed(
  ctx: ChatActionContext,
  replay: ReplayRequest,
  isReplay = false,
): DispatchResult {
  const { placement, durable } = markLocalUnconfirmed(
    ctx,
    replay,
    UNCONFIRMED_ROW_NOTE,
    pointsPlaceholderContent(replay),
  );

  // The echo already re-keyed the row under its server id. That is not a
  // missing row — it is proof the server posted the card, which it only does
  // after the ledger row commits. The outcome is therefore NOT unknown: we lost
  // the HTTP response to a request we can see succeeded. Reporting "we couldn't
  // confirm" here would put a warning above a visibly successful points card
  // and send the officer to audit a ledger that is correct.
  if (placement === "confirmed") {
    // On a FIRST dispatch, silence is right: the card is visibly in the
    // timeline and nothing is owed. On a REPLAY it is not — the officer
    // watched "Retrying…" spin and needs to know it landed, and this module's
    // own rule is that silence after a retry is indistinguishable from a retry
    // that did nothing.
    return isReplay
      ? { ok: true, resolved: RETRY_RESOLVED_NOTE }
      : { ok: true };
  }

  return {
    ok: true,
    unconfirmed: true,
    warning:
      placement !== "optimistic"
        ? UNCONFIRMED_NO_ROW_WARNING
        : durable
          ? UNCONFIRMED_WARNING
          : UNCONFIRMED_VOLATILE_WARNING,
  };
}

/**
 * Dispatch `/task "<title>" @assignee <due date> [points]`. Like `/points`,
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

  return postTask(ctx, channelId, {
    title: parsed.value.title,
    assignee_id: member.user_id,
    due_date: parsed.value.dueDate,
    due_at: parsed.value.dueAt ?? undefined,
    point_reward: parsed.value.pointReward ?? undefined,
  });
}

/** What a task posted into a channel carries (`/task` or the + menu's form). */
export interface TaskInput {
  title: string;
  description?: string;
  assignee_id: string;
  /** `YYYY-MM-DD`. */
  due_date: string;
  /** The moment it is due, when it has a time of day (#4003). */
  due_at?: string;
  /** Subtask titles, in order (#4003). */
  subtasks?: string[];
  point_reward?: number;
  /**
   * A reference photo already uploaded (#4565). `null` only on an edit, to
   * remove the task's photo; a create treats it as none.
   */
  reference_photo_path?: string | null;
  /** Mark done needs a proof photo (#4565). */
  photo_required?: boolean;
}

/**
 * Create a task and post its card in `channelId`: the `/task` one-liner, and
 * the composer's + menu's Task form (#3865). A `loading` placeholder until
 * the server's card reconciles it by Realtime echo; dropped on a refusal;
 * kept as the durable `recorded` row when the task committed without its
 * card. No server-side dedupe, so no retry path.
 */
export async function postTask(
  ctx: ChatActionContext,
  channelId: string,
  input: TaskInput,
): Promise<DispatchResult> {
  const clientMessageId = randomClientId();

  const placeholderContent = `Creating task "${input.title}"…`;

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: placeholderContent,
  });

  try {
    const result = await ctx.apiClient.POST("/v1/tasks", {
      body: {
        title: input.title,
        description: input.description,
        assignee_id: input.assignee_id,
        due_date: input.due_date,
        due_at: input.due_at,
        subtasks: input.subtasks,
        point_reward: input.point_reward,
        reference_photo_path: input.reference_photo_path ?? undefined,
        photo_required: input.photo_required,
        channel_id: channelId,
        client_message_id: clientMessageId,
      },
    });
    // Read the status without narrowing on `error`: the generated contract
    // declares no error responses for this route, so `error` is typed `never`
    // and `if (result.error)` would narrow the whole branch — `response`
    // included — to `never`. Empty-body gateway 502/504 arrive as
    // `{ error: undefined, response }`, so `if (error)` alone would treat them
    // as success and strand the placeholder (#1717).
    const data = result.data as CardPostedResponse | undefined;
    let status = result.response?.status;
    if (result.error) status ??= 0;
    const ok = typeof status === "number" && status >= 200 && status < 300;
    if (!ok) {
      if (!isTerminalStatus(status)) {
        return lostResponse(
          ctx,
          channelId,
          clientMessageId,
          TASK_UNCONFIRMED_WARNING,
        );
      }
      removeLocalPlaceholder(ctx, channelId, clientMessageId);
      return {
        ok: false,
        error: apiErrorMessage(result.error, "Couldn't create task"),
        cause: result.error,
      };
    }
    if (data?.card_posted === false) {
      markLocalRecorded(ctx, {
        channelId,
        clientMessageId,
        note: TASK_RECORDED_ROW_NOTE,
        content: placeholderContent,
      });
      return { ok: true, warning: TASK_CARD_LOST_WARNING };
    }
  } catch {
    return lostResponse(
      ctx,
      channelId,
      clientMessageId,
      TASK_UNCONFIRMED_WARNING,
    );
  }

  // Success: the server posts the `task` card (same client_message_id); the
  // Realtime echo reconciles the placeholder via mergeServerRow. Nothing to do
  // unless `card_posted` was an explicit `false` above.
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
export function localDateTimeToIso(date: string, time: string): string | null {
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

  const startIso = localDateTimeToIso(
    parsed.value.date,
    parsed.value.startTime,
  );
  const endIso = localDateTimeToIso(parsed.value.date, parsed.value.endTime);
  if (startIso === null || endIso === null) {
    return { ok: false, error: "Couldn't read the event date or time" };
  }

  return postEvent(ctx, channelId, {
    name: parsed.value.name,
    start_time: startIso,
    end_time: endIso,
    location: parsed.value.location ?? undefined,
    point_value: parsed.value.pointValue ?? undefined,
  });
}

/** What {@link postEvent} creates: the one-liner's fields, read or typed. */
export interface EventInput {
  name: string;
  /** ISO instants. */
  start_time: string;
  end_time: string;
  location?: string;
  /** 10 when omitted, the spec default. */
  point_value?: number;
}

/**
 * Create an event and post its card in `channelId`: the write `/event` makes,
 * shared with web's + card (#3983) so the two can't drift. A `loading`
 * placeholder until the card's echo, dropped on a refusal, and the durable
 * `recorded` row when the event committed without its card.
 */
export async function postEvent(
  ctx: ChatActionContext,
  channelId: string,
  input: EventInput,
): Promise<DispatchResult> {
  // The same placeholder and recorded-row bookkeeping the event form uses
  // from chat (#3773), so the two paths can't drift apart.
  const card = trackEventCard(ctx, channelId, input.name);

  try {
    const result = await ctx.apiClient.POST("/v1/events", {
      body: {
        name: input.name,
        start_time: input.start_time,
        end_time: input.end_time,
        location: input.location,
        // point_value and is_mandatory are required in the generated SDK type
        // (their DTO `@default` makes them non-optional); send the spec defaults
        // (10 points, not mandatory) when the command omits them — the
        // one-liner creates non-mandatory events by design (a required event
        // goes through the event form).
        point_value: input.point_value ?? 10,
        is_mandatory: false,
        channel_id: channelId,
        client_message_id: card.clientMessageId,
      },
    });
    // Same status-without-`error` narrowing as `/task` / `/points`. Empty-body
    // gateway 502/504 must not read as success: `/event` has no server-side
    // dedupe, so a stranded placeholder invites a duplicating retry (#1717).
    const data = result.data as CardPostedResponse | undefined;
    let status = result.response?.status;
    if (result.error) status ??= 0;
    const ok = typeof status === "number" && status >= 200 && status < 300;
    if (!ok) {
      card.failed();
      return {
        ok: false,
        error: apiErrorMessage(result.error, "Couldn't create event"),
      };
    }
    if (data?.card_posted === false) {
      card.lost();
      return { ok: true, warning: EVENT_CARD_LOST_WARNING };
    }
  } catch {
    card.failed();
    return { ok: false, error: "Couldn't reach the events service" };
  }

  // Success: the server posts the `event` card (same client_message_id); the
  // Realtime echo reconciles the placeholder via mergeServerRow.
  return { ok: true };
}

/**
 * What a create from chat says when its event card isn't in the thread: kept
 * out because the event is only for some roles (none is asked for), or lost
 * (`card_posted: false`). `null` when the card is there. Web's event form and
 * the phone's New event sheet both say it.
 */
export function eventCardOutcomeCopy(
  name: string,
  card: { cardKeptOut: boolean; cardLost: boolean },
): string | null {
  if (card.cardKeptOut) {
    return `${name} is on the calendar. It isn't posted in chat because it's only for some roles.`;
  }
  if (card.cardLost) {
    return `${name} is on the calendar, but its card couldn't be posted in chat.`;
  }
  return null;
}

/**
 * The chat side of an event created from the event form rather than the
 * one-liner (web chat's `/event` with details it can't read, #3773). The form
 * makes its own `POST /v1/events`; this gives it the one-liner's timeline
 * bookkeeping for the card: a `loading` placeholder under the request's
 * `client_message_id`, which the server's card reconciles by Realtime echo;
 * `failed()` drops it when the create is refused; `lost()` turns it into the
 * durable `recorded` row when the event committed but its card didn't post
 * (`card_posted: false`), since `POST /v1/events` has no dedupe and the toast
 * alone is evictable.
 */
export interface EventCardTrack {
  clientMessageId: string;
  failed: () => void;
  lost: () => void;
}

export function trackEventCard(
  ctx: ChatActionContext,
  channelId: string,
  name: string,
): EventCardTrack {
  const clientMessageId = randomClientId();
  const content = `Creating event "${name}"…`;
  insertLocalPlaceholder(ctx, { channelId, clientMessageId, content });
  return {
    clientMessageId,
    failed: () => removeLocalPlaceholder(ctx, channelId, clientMessageId),
    lost: () =>
      markLocalRecorded(ctx, {
        channelId,
        clientMessageId,
        note: EVENT_RECORDED_ROW_NOTE,
        content,
      }),
  };
}

/**
 * Dispatch `/hours log <duration> <description>`. Like `/task` and `/event`, a
 * "heavy" command: it creates a real service-entry row, so the hours card is
 * server-originated (a client cannot post `kind:"hours"` directly). We show an
 * optimistic `loading` placeholder, call `POST /v1/service-entries` (which
 * creates the entry and posts the card with the same `client_message_id`), and
 * let Realtime reconcile the placeholder in place. On failure we drop the
 * placeholder and surface the server's message. No server-side dedupe — a
 * replay would duplicate the entry, so there is no retry path.
 *
 * The one-liner cannot attach proof (the + menu's form can). When the
 * chapter's `wf_hours_receipt` workflow is on, the API 400s with its existing
 * receipt message; that is the correct UX, not a bypass.
 */
async function dispatchHours(
  ctx: ChatActionContext,
  args: string,
  channelId: string,
): Promise<DispatchResult> {
  const parsed = parseHoursArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return postHours(ctx, channelId, {
    // `/hours log` has no date token: the entry is for the local today.
    date: localIsoDate(new Date()),
    duration_minutes: parsed.value.durationMinutes,
    description: parsed.value.description,
  });
}

/** What a service entry posted into a channel carries (`/hours log` or the + menu's form). */
export interface HoursInput {
  /** `YYYY-MM-DD`. */
  date: string;
  duration_minutes: number;
  description: string;
  /** From `POST /v1/service-entries/proof-upload-url`; only the form can attach one. */
  proof_path?: string;
}

/**
 * Log a service entry and post its hours card in `channelId`: `/hours log`,
 * and the composer's + menu's Service hours form (#3865), which can also
 * attach proof. Same placeholder bookkeeping as {@link postTask}.
 */
export async function postHours(
  ctx: ChatActionContext,
  channelId: string,
  input: HoursInput,
): Promise<DispatchResult> {
  const clientMessageId = randomClientId();

  const placeholderContent = `Logging ${input.duration_minutes} minutes of service…`;

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: placeholderContent,
  });

  try {
    const result = await ctx.apiClient.POST("/v1/service-entries", {
      body: {
        date: input.date,
        duration_minutes: input.duration_minutes,
        description: input.description,
        proof_path: input.proof_path,
        channel_id: channelId,
        client_message_id: clientMessageId,
      },
    });
    // Same status-without-`error` narrowing as `/task` / `/event`. Empty-body
    // gateway 502/504 must not read as success: `/hours` has no server-side
    // dedupe, so a stranded placeholder invites a duplicating retry.
    const data = result.data as CardPostedResponse | undefined;
    let status = result.response?.status;
    if (result.error) status ??= 0;
    const ok = typeof status === "number" && status >= 200 && status < 300;
    if (!ok) {
      if (!isTerminalStatus(status)) {
        return lostResponse(
          ctx,
          channelId,
          clientMessageId,
          HOURS_UNCONFIRMED_WARNING,
        );
      }
      removeLocalPlaceholder(ctx, channelId, clientMessageId);
      return {
        ok: false,
        error: apiErrorMessage(result.error, "Couldn't log hours"),
        cause: result.error,
      };
    }
    if (data?.card_posted === false) {
      markLocalRecorded(ctx, {
        channelId,
        clientMessageId,
        note: HOURS_RECORDED_ROW_NOTE,
        content: placeholderContent,
      });
      return { ok: true, warning: HOURS_CARD_LOST_WARNING };
    }
  } catch {
    return lostResponse(
      ctx,
      channelId,
      clientMessageId,
      HOURS_UNCONFIRMED_WARNING,
    );
  }

  return { ok: true };
}

async function resolveRushCandidateId(
  ctx: ChatActionContext,
  token: string,
): Promise<string | null> {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      token,
    )
  ) {
    return token;
  }
  try {
    const result = await ctx.apiClient.GET("/v1/rush/candidates", {
      params: { query: { name: token } },
    });
    const status = result.response?.status;
    const ok = typeof status === "number" && status >= 200 && status < 300;
    const id = (result.data as { id?: string } | undefined)?.id;
    if (!ok || typeof id !== "string") return null;
    return id;
  } catch {
    return null;
  }
}

/**
 * Dispatch `/<vocab> add|vote|bid`. `add` is a heavy command (loading
 * placeholder + `POST /v1/rush/candidates` + `card_posted`). `vote` and `bid`
 * mutate in place with no placeholder — the existing card live-updates.
 */
async function dispatchRush(
  ctx: ChatActionContext,
  args: string,
  channelId: string,
  resolveMember: ResolveMember | undefined,
): Promise<DispatchResult> {
  const parsed = parseRushArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  if (parsed.value.action === "add") {
    return dispatchRushAdd(
      ctx,
      parsed.value.displayName,
      channelId,
      resolveMember,
    );
  }

  const token =
    parsed.value.action === "vote"
      ? (parsed.value.candidateId ?? parsed.value.candidateToken ?? "")
      : parsed.value.candidateToken;
  const id = await resolveRushCandidateId(ctx, token);
  if (!id) {
    return { ok: false, error: "No candidate matches that name" };
  }

  const path =
    parsed.value.action === "vote"
      ? "/v1/rush/candidates/{id}/vote"
      : "/v1/rush/candidates/{id}/bid";
  const fallback =
    parsed.value.action === "vote"
      ? "Couldn't record that vote"
      : "Couldn't extend that bid";

  try {
    const result = await ctx.apiClient.POST(path, {
      params: { path: { id } },
    });
    let status = result.response?.status;
    if (result.error) status ??= 0;
    const ok = typeof status === "number" && status >= 200 && status < 300;
    if (!ok) {
      return { ok: false, error: apiErrorMessage(result.error, fallback) };
    }
  } catch {
    return { ok: false, error: "Couldn't reach the recruitment service" };
  }
  return { ok: true };
}

async function dispatchRushAdd(
  ctx: ChatActionContext,
  displayName: string,
  channelId: string,
  resolveMember: ResolveMember | undefined,
): Promise<DispatchResult> {
  const clientMessageId = randomClientId();
  const placeholderContent = `Adding candidate ${displayName}…`;
  const member = resolveMember?.(displayName);

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: placeholderContent,
  });

  try {
    const result = await ctx.apiClient.POST("/v1/rush/candidates", {
      body: {
        display_name: displayName,
        ...(member?.user_id ? { user_id: member.user_id } : {}),
        channel_id: channelId,
        client_message_id: clientMessageId,
      },
    });
    const data = result.data as CardPostedResponse | undefined;
    let status = result.response?.status;
    if (result.error) status ??= 0;
    const ok = typeof status === "number" && status >= 200 && status < 300;
    if (!ok) {
      removeLocalPlaceholder(ctx, channelId, clientMessageId);
      return {
        ok: false,
        error: apiErrorMessage(result.error, "Couldn't add that candidate"),
      };
    }
    if (data?.card_posted === false) {
      markLocalRecorded(ctx, {
        channelId,
        clientMessageId,
        note: RUSH_RECORDED_ROW_NOTE,
        content: placeholderContent,
      });
      return { ok: true, warning: RUSH_CARD_LOST_WARNING };
    }
  } catch {
    removeLocalPlaceholder(ctx, channelId, clientMessageId);
    return { ok: false, error: "Couldn't reach the recruitment service" };
  }

  return { ok: true };
}
