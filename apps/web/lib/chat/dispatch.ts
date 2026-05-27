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
  type AnnouncementPayload,
  type PollPayload,
  type SlashCommand,
} from "@repo/chat-integrations";
import { sendMessage, type ChatActionContext } from "./chat-client";

export interface DispatchResult {
  ok: boolean;
  error?: string;
}

interface DispatchArgs {
  command: SlashCommand;
  args: string;
  /** Channel where the command was invoked (used for /poll). */
  channelId: string;
  /**
   * Channel id of `#announcements` for the active chapter. Required to
   * dispatch `/announce` regardless of which channel the user was in —
   * the brief routes announcements to the dedicated channel.
   */
  announcementsChannelId: string | null;
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
  { command, args, channelId, announcementsChannelId }: DispatchArgs,
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
