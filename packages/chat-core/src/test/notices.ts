import type {
  RecordedNotice,
  UnconfirmedNotice,
} from "../heavy-command-notices";
import type { ReplayRequest } from "../types";

/**
 * Spec-only heavy-command notice fixtures, shared by the store, chat-client
 * and realtime-manager suites. Lives under `src/test/` so dep-cruiser treats it
 * as unshipped.
 */

export function pointsReplay(
  clientMessageId = "cm-1",
  channelId = "chan-1",
): ReplayRequest {
  return {
    command: "points",
    channelId,
    clientMessageId,
    body: {
      target_user_id: "user-2",
      amount: 5,
      category: "MANUAL",
      reason: "great work",
      channel_id: channelId,
      client_message_id: clientMessageId,
    },
  };
}

export function recordedNotice(
  overrides: Partial<RecordedNotice> = {},
): RecordedNotice {
  return {
    status: "recorded",
    clientMessageId: "cm-1",
    channelId: "chan-1",
    senderId: "user-1",
    content: "Granting 5 points…",
    note: "Points recorded — the chat card didn't post. Don't run this command again.",
    createdAt: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

export function unconfirmedNotice(
  overrides: Partial<UnconfirmedNotice> = {},
): UnconfirmedNotice {
  const clientMessageId = overrides.clientMessageId ?? "cm-1";
  const channelId = overrides.channelId ?? "chan-1";
  return {
    status: "unconfirmed",
    clientMessageId,
    channelId,
    senderId: "user-1",
    content: "Granting 5 points…",
    note: "Not confirmed — these points may or may not have been recorded.",
    createdAt: "2026-09-09T00:00:00.000Z",
    replay: pointsReplay(clientMessageId, channelId),
    ...overrides,
  };
}
