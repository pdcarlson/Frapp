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
  markLocalRecorded,
  markLocalUnconfirmed,
  isDefinitiveClientError,
  type ChatActionContext,
} from "./chat-client";
import { randomClientId } from "./random-id";
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
    return {
      ok: false,
      error: `No member matches @${parsed.value.memberToken}`,
    };
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

  const placeholderContent = `${parsed.value.action === "grant" ? "Granting" : "Deducting"} ${parsed.value.amount} points…`;

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: placeholderContent,
  });

  return submitPointsAdjustment(ctx, replay, false, placeholderContent);
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
  placeholderContent?: string,
): Promise<DispatchResult> {
  const { channelId, clientMessageId } = replay;

  let data: PointsAdjustResponse | undefined;
  let status: number | undefined;
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
      return { ok: false, error: REFUSED_ERROR };
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
      content: placeholderContent,
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

const POINTS_RECORDED_ROW_NOTE =
  "Points recorded — the chat card didn't post. Don't run this command again.";

const TASK_RECORDED_ROW_NOTE =
  "Task created — the chat card didn't post. Don't run this command again.";

const EVENT_RECORDED_ROW_NOTE =
  "Event created — the chat card didn't post. Don't run this command again.";

const REPLAY_ACCEPTED_WARNING =
  "These points were already recorded — the retry didn't add a second entry. Whether the original chat card posted isn't something the server can tell us, so check the channel or the points ledger if you need to be sure.";

const RETRY_RESOLVED_NOTE = "Points recorded.";

/**
 * The row is gone — the card's Realtime echo reconciled it while the request
 * was still in flight, or the channel query was rebuilt underneath us. Pointing
 * the officer at a Retry control that no longer exists is worse than saying
 * nothing, so the copy has to stand on its own.
 */
const UNCONFIRMED_NO_ROW_WARNING =
  "We couldn't confirm whether these points were recorded. Check the points ledger before running the command again — running it again would record them twice.";

/**
 * The row is still there and carries the original key, so an explicit Retry is
 * the safe recovery. The second sentence is not padding: the row lives only in
 * the in-memory cache today, and a reconnect or reload rebuilds the channel
 * from the server and takes it with it (#1909), so the copy must not promise a
 * Retry that may be gone by the time the officer looks.
 */
const UNCONFIRMED_WARNING =
  "We couldn't confirm whether these points were recorded. Use Retry on the message rather than running the command again, which would record them twice. If the message is gone, check the points ledger before re-running.";

/**
 * What the timeline row itself says. Short on purpose: it sits directly above
 * its own Retry button, so the toast's "use Retry on the message … if the
 * message is gone" guidance is nonsense in that position — and printing the
 * toast's three sentences on the row duplicates them verbatim on screen and,
 * under `aria-atomic`, in the announcement.
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
  const placement = markLocalUnconfirmed(ctx, replay, UNCONFIRMED_ROW_NOTE);

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
      placement === "optimistic"
        ? UNCONFIRMED_WARNING
        : UNCONFIRMED_NO_ROW_WARNING,
  };
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

  const placeholderContent = `Creating task "${parsed.value.title}"…`;

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: placeholderContent,
  });

  try {
    const result = await ctx.apiClient.POST("/v1/tasks", {
      body: {
        title: parsed.value.title,
        assignee_id: member.user_id,
        due_date: parsed.value.dueDate,
        point_reward: parsed.value.pointReward ?? undefined,
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
      removeLocalPlaceholder(ctx, channelId, clientMessageId);
      return {
        ok: false,
        error: apiErrorMessage(result.error, "Couldn't create task"),
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
    removeLocalPlaceholder(ctx, channelId, clientMessageId);
    return { ok: false, error: "Couldn't reach the tasks service" };
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

  const startIso = localDateTimeToIso(
    parsed.value.date,
    parsed.value.startTime,
  );
  const endIso = localDateTimeToIso(parsed.value.date, parsed.value.endTime);
  if (startIso === null || endIso === null) {
    return { ok: false, error: "Couldn't read the event date or time" };
  }

  const clientMessageId = randomClientId();

  const placeholderContent = `Creating event "${parsed.value.name}"…`;

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: placeholderContent,
  });

  try {
    const result = await ctx.apiClient.POST("/v1/events", {
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
    // Same status-without-`error` narrowing as `/task` / `/points`. Empty-body
    // gateway 502/504 must not read as success: `/event` has no server-side
    // dedupe, so a stranded placeholder invites a duplicating retry (#1717).
    const data = result.data as CardPostedResponse | undefined;
    let status = result.response?.status;
    if (result.error) status ??= 0;
    const ok = typeof status === "number" && status >= 200 && status < 300;
    if (!ok) {
      removeLocalPlaceholder(ctx, channelId, clientMessageId);
      return {
        ok: false,
        error: apiErrorMessage(result.error, "Couldn't create event"),
      };
    }
    if (data?.card_posted === false) {
      markLocalRecorded(ctx, {
        channelId,
        clientMessageId,
        note: EVENT_RECORDED_ROW_NOTE,
        content: placeholderContent,
      });
      return { ok: true, warning: EVENT_CARD_LOST_WARNING };
    }
  } catch {
    removeLocalPlaceholder(ctx, channelId, clientMessageId);
    return { ok: false, error: "Couldn't reach the events service" };
  }

  // Success: the server posts the `event` card (same client_message_id); the
  // Realtime echo reconciles the placeholder via mergeServerRow.
  return { ok: true };
}
