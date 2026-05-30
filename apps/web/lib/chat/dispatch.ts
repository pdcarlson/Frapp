"use client";

/**
 * Slash command dispatch (Chunk 05).
 *
 * Translates a parsed slash command into a `sendMessage` call against the
 * chat hot-path client. Lives in `apps/web` (not the package) because it
 * needs the `ChatActionContext` from `chat-client.ts` — which carries the
 * Supabase client, query client, and toast. Pure mapping otherwise; the
 * caller surfaces the `{ok:false, error}` toast.
 */

import {
  parseAnnounceArgs,
  parsePollArgs,
  parsePointsArgs,
  type AnnouncementPayload,
  type PollPayload,
  type SlashCommand,
} from "@repo/chat-integrations";
import {
  sendMessage,
  insertLocalPlaceholder,
  removeLocalPlaceholder,
  type ChatActionContext,
} from "./chat-client";

export interface DispatchResult {
  ok: boolean;
  error?: string;
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
  // Avoid `crypto.randomUUID()` here so the option id stays stable in
  // server-rendered or test environments without a Web Crypto polyfill.
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
 * Realtime reconcile the placeholder in place. On failure we drop the
 * placeholder and surface the server's message.
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
  const clientMessageId = crypto.randomUUID();

  insertLocalPlaceholder(ctx, {
    channelId,
    clientMessageId,
    content: `${parsed.value.action === "grant" ? "Granting" : "Deducting"} ${parsed.value.amount} points…`,
  });

  try {
    const { error } = await ctx.apiClient.POST("/v1/points/adjust", {
      body: {
        target_user_id: member.user_id,
        amount: signedAmount,
        category: parsed.value.category,
        reason: parsed.value.reason,
        channel_id: channelId,
        client_message_id: clientMessageId,
      },
    });
    if (error) {
      removeLocalPlaceholder(ctx, channelId, clientMessageId);
      return { ok: false, error: apiErrorMessage(error, "Couldn't adjust points") };
    }
  } catch {
    removeLocalPlaceholder(ctx, channelId, clientMessageId);
    return { ok: false, error: "Couldn't reach the points service" };
  }

  // Success: the server posts the `points` card (same client_message_id); the
  // Realtime echo reconciles the placeholder via mergeServerRow. Nothing to do.
  return { ok: true };
}
