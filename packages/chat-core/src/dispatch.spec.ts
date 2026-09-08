import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SlashCommand } from "@repo/chat-integrations";
import { dispatchSlashCommand, retryPointsDispatch } from "./dispatch";
import type { ChatActionContext } from "./chat-client";
import type { OutboxStore } from "./adapters";
import {
  chatMessagesKey,
  type ChannelCache,
  type ChatMessage,
} from "./types";
import { selectMessages } from "./cache";

/**
 * #544 — a `/points` grant whose ledger row commits but whose chat card fails to
 * post.
 *
 * The optimistic `loading` placeholder is reconciled by the Realtime echo of
 * that card. No card means no echo, so before this change the placeholder sat on
 * "Granting … points…" forever while the grant had actually succeeded — an
 * officer could not tell it from a lost one, and re-running the command would
 * write a second ledger row.
 */

const CHANNEL_ID = "11111111-1111-4111-8111-111111111111";

const POINTS_COMMAND: SlashCommand = {
  name: "points",
  description: "Grant or deduct points",
  requiredModule: "points",
  implemented: true,
};

function buildCtx(post: ReturnType<typeof vi.fn>): ChatActionContext {
  return {
    queryClient: new QueryClient(),
    apiClient: { POST: post } as unknown as ChatActionContext["apiClient"],
    supabase: { from: vi.fn() } as unknown as ChatActionContext["supabase"],
    userId: "user-1",
    outbox: {} as OutboxStore,
  };
}

/**
 * Count the optimistic `loading` rows sitting in the channel cache.
 *
 * Read through `selectMessages` rather than a hand-written structural cast, so
 * `kind` is the `ChatMessageKind` union — a typo'd literal here is a compile
 * error rather than a filter that quietly matches nothing.
 *
 * A helper that went blind would NOT pass silently: the two `toBe(1)` cases
 * below fail the moment it stops seeing the row (verified by stubbing it to
 * `return 0`, which turns this file red). They are the guard, and they are why
 * the card-posted case asserts a NON-zero count rather than only absences.
 */
function placeholderCount(ctx: ChatActionContext): number {
  const cache = ctx.queryClient.getQueryData<ChannelCache>(
    chatMessagesKey(CHANNEL_ID),
  );
  return selectMessages(cache).filter((m) => m.kind === "loading").length;
}

function dispatchGrant(ctx: ChatActionContext) {
  return dispatchSlashCommand(ctx, {
    command: POINTS_COMMAND,
    args: "grant @bobby 5 for great work",
    channelId: CHANNEL_ID,
    announcementsChannelId: null,
    resolveMember: () => ({ user_id: "user-2", display_name: "Bobby Member" }),
  });
}

describe("dispatchPoints — card_posted (#544)", () => {
  it("leaves the placeholder for the Realtime echo when the card posted", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: { card_posted: true }, error: null });
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    expect(result).toEqual({ ok: true });
    // Still present: the server's card carries the same client_message_id and
    // mergeServerRow reconciles it in place. Removing it here would flicker.
    expect(placeholderCount(ctx)).toBe(1);
  });

  it("drops the placeholder and warns when the card did not post", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: { card_posted: false }, error: null });
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warning).toMatch(/recorded/i);
    expect(placeholderCount(ctx)).toBe(0);
  });

  // The warning must never read as a failure. `ok:false` would make the composer
  // toast it destructively and invite a retry, and a retry writes a SECOND
  // ledger row — the grant already committed.
  it("does not report the committed grant as a failure", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: { card_posted: false }, error: null });

    const result = await dispatchGrant(buildCtx(post));

    expect(result.ok).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  // Pre-#544 servers (and any response that omits the field) must keep the old
  // behaviour rather than having their placeholder torn down under them.
  it("treats an absent card_posted as success", async () => {
    const post = vi.fn().mockResolvedValue({ data: {}, error: null });
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    expect(result).toEqual({ ok: true });
    expect(placeholderCount(ctx)).toBe(1);
  });

  // A *definitive* 4xx: validated and rejected, nothing written. This mock
  // carries a real `response.status`, because that is what the dispatcher now
  // reads to tell a refusal from a lost response — an error with no readable
  // status is deliberately treated as unconfirmed (see below), so omitting it
  // here would be asserting the opposite branch by accident.
  it("still removes the placeholder and fails on a definitive 4xx", async () => {
    const post = vi.fn().mockResolvedValue({
      data: undefined,
      error: { message: "nope" },
      response: { status: 400 },
    });
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    expect(result.ok).toBe(false);
    expect(result.warning).toBeUndefined();
    expect(placeholderCount(ctx)).toBe(0);
  });
});

/**
 * #1733 — a `/points` dispatch whose response was LOST, rather than refused.
 *
 * The ledger is append-only, so the two must not be conflated: a refusal wrote
 * nothing and re-typing is correct, while a lost response may have committed
 * and re-typing mints a fresh `client_message_id`, misses the `#1719` dedupe
 * index, and double-grants with no way back through the API.
 */

/** The single cached row for the dispatch, whatever status it now carries. */
function onlyRow(ctx: ChatActionContext): ChatMessage {
  const cache = ctx.queryClient.getQueryData<ChannelCache>(
    chatMessagesKey(CHANNEL_ID),
  );
  const rows = selectMessages(cache);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

const LOST_RESPONSE = {
  data: undefined,
  error: { message: "Bad Gateway" },
  response: { status: 502 },
};

describe("dispatchPoints — unconfirmed outcomes (#1733)", () => {
  it("keeps the row and does NOT claim failure when the response is lost", async () => {
    const post = vi.fn().mockResolvedValue(LOST_RESPONSE);
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    // `ok:false` here is the bug: `notifyDispatchOutcome` derives its
    // "/points failed" title and destructive styling from it alone, and the
    // retry an officer performs after a red toast is re-typing the command.
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warning).toMatch(/couldn't confirm/i);
    expect(placeholderCount(ctx)).toBe(1);
  });

  // A gateway 502 arrives through `{ error }`, NOT as a thrown exception:
  // openapi-fetch resolves on any non-2xx. A fix confined to `catch` would
  // miss the commonest way a committed write loses its response.
  it("routes a resolved 5xx to unconfirmed, not to the catch-only path", async () => {
    const post = vi.fn().mockResolvedValue(LOST_RESPONSE);
    const ctx = buildCtx(post);

    await dispatchGrant(ctx);

    expect(onlyRow(ctx)._status).toBe("unconfirmed");
  });

  it("marks the row unconfirmed — never failed — so no discard is offered", async () => {
    const post = vi.fn().mockRejectedValue(new Error("network down"));
    const ctx = buildCtx(post);

    await dispatchGrant(ctx);

    const row = onlyRow(ctx);
    // `failed` asserts nothing was written and its UI offers Discard, which
    // here could throw away the only trace of a committed grant.
    expect(row._status).toBe("unconfirmed");
    expect(row._status).not.toBe("failed");
  });

  it("carries the original request so a retry can replay it verbatim", async () => {
    const post = vi.fn().mockResolvedValue(LOST_RESPONSE);
    const ctx = buildCtx(post);

    await dispatchGrant(ctx);

    const row = onlyRow(ctx);
    expect(row._replay).toBeDefined();
    expect(row._replay?.command).toBe("points");
    expect(row._replay?.body.client_message_id).toBe(row.client_message_id);
    expect(row._replay?.body.target_user_id).toBe("user-2");
    expect(row._replay?.body.amount).toBe(5);
  });

  // The whole point of the issue: the retry's identity is the ORIGINAL attempt.
  it("replays under the original key rather than minting a new one", async () => {
    const post = vi.fn().mockResolvedValue(LOST_RESPONSE);
    const ctx = buildCtx(post);
    await dispatchGrant(ctx);
    const replay = onlyRow(ctx)._replay!;

    post.mockResolvedValue({ data: { card_posted: true }, error: null });
    await retryPointsDispatch(ctx, replay);

    const [first, second] = post.mock.calls;
    expect(second![1].body.client_message_id).toBe(
      first![1].body.client_message_id,
    );
    // Same key AND same content — `resolveReplay` compares target, amount,
    // category, reason and acting admin before treating a request as a replay,
    // and answers 409 on any mismatch.
    expect(second![1].body).toEqual(first![1].body);
  });

  // The guard the #1733 coupling comment required before key reuse could ship.
  // On a replay, `completeReplay` returns the stored row with `card_posted`
  // ABSENT — the ledger row exists but nothing is known about the original
  // attempt's card. Falling through to `{ok:true}` would leave the placeholder
  // waiting for an echo that is never coming: #544's bug via the replay branch.
  it("does not strand the row when a replay reports no card outcome", async () => {
    const post = vi.fn().mockResolvedValue(LOST_RESPONSE);
    const ctx = buildCtx(post);
    await dispatchGrant(ctx);
    const replay = onlyRow(ctx)._replay!;

    post.mockResolvedValue({ data: {}, error: null });
    const result = await retryPointsDispatch(ctx, replay);

    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/recorded/i);
    expect(placeholderCount(ctx)).toBe(0);
  });

  // Same absent field, first attempt: nothing was skipped, the echo may still
  // arrive. The two must not be collapsed — this is why `isReplay` exists.
  it("still waits for the echo when a FIRST attempt reports no card outcome", async () => {
    const post = vi.fn().mockResolvedValue({ data: {}, error: null });
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    expect(result).toEqual({ ok: true });
    expect(placeholderCount(ctx)).toBe(1);
  });

  it("surfaces a 409 distinctly from a lost response, and does not offer retry", async () => {
    const post = vi.fn().mockResolvedValue({
      data: undefined,
      error: { message: "already used for a different point adjustment" },
      response: { status: 409 },
    });
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    // The key is spent: replaying it can never succeed, so the recovery is a
    // FRESH key — which is exactly what running the command again mints.
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/run the command again/i);
    expect(result.warning).toBeUndefined();
    expect(placeholderCount(ctx)).toBe(0);
  });
});
