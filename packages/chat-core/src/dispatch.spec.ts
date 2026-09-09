import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SlashCommand } from "@repo/chat-integrations";
import { dispatchSlashCommand, retryPointsDispatch } from "./dispatch";
import type { ChatActionContext } from "./chat-client";
import type { KeyValueStore, OutboxRow, OutboxStore } from "./adapters";
import { chatMessagesKey, type ChannelCache, type ChatMessage } from "./types";
import { selectMessages, mergeServerRow } from "./cache";
import { readRecordedNotices } from "./recorded-notices";

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

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

function buildCtx(
  post: ReturnType<typeof vi.fn>,
  kv?: KeyValueStore,
): ChatActionContext {
  return {
    queryClient: new QueryClient(),
    apiClient: { POST: post } as unknown as ChatActionContext["apiClient"],
    supabase: { from: vi.fn() } as unknown as ChatActionContext["supabase"],
    userId: "user-1",
    outbox: {} as OutboxStore,
    kv,
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
      .mockResolvedValue({
        data: { card_posted: true },
        error: null,
        response: { status: 200 },
      });
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    expect(result).toEqual({ ok: true });
    // Still present: the server's card carries the same client_message_id and
    // mergeServerRow reconciles it in place. Removing it here would flicker.
    expect(placeholderCount(ctx)).toBe(1);
  });

  it("keeps a recorded row and warns when the card did not post", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({
        data: { card_posted: false },
        error: null,
        response: { status: 200 },
      });
    const kv = memoryStore();
    const ctx = buildCtx(post, kv);

    const result = await dispatchGrant(ctx);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warning).toMatch(/recorded/i);
    expect(placeholderCount(ctx)).toBe(1);
    const row = onlyRow(ctx);
    expect(row._status).toBe("recorded");
    expect(row._replay).toBeUndefined();
    expect(result.warning).toMatch(/don't run the command again/i);
    expect(row._error).toMatch(/don't run this command again/i);
    expect(readRecordedNotices(CHANNEL_ID, kv)).toEqual([
      expect.objectContaining({
        clientMessageId: row.client_message_id,
        note: row._error,
      }),
    ]);
  });

  // The warning must never read as a failure. `ok:false` would make the composer
  // toast it destructively and invite a retry, and a retry writes a SECOND
  // ledger row — the grant already committed.
  it("does not report the committed grant as a failure", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({
        data: { card_posted: false },
        error: null,
        response: { status: 200 },
      });

    const result = await dispatchGrant(buildCtx(post));

    expect(result.ok).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  // Pre-#544 servers (and any response that omits the field) must keep the old
  // behaviour rather than having their placeholder torn down under them.
  it("treats an absent card_posted as success", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: {}, error: null, response: { status: 200 } });
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

/** Simulate the server card's Realtime echo for a client id. */
function patchWithServerEcho(ctx: ChatActionContext, clientId: string): void {
  const key = chatMessagesKey(CHANNEL_ID);
  const cache = ctx.queryClient.getQueryData<ChannelCache>(key)!;
  ctx.queryClient.setQueryData<ChannelCache>(
    key,
    mergeServerRow(cache, {
      id: "server-1",
      channel_id: CHANNEL_ID,
      sender_id: "user-1",
      content: "+5 points",
      kind: "points",
      client_message_id: clientId,
      created_at: new Date().toISOString(),
    } as never),
  );
}

/** The replay descriptor for a client id, rebuilt after the row was re-keyed. */
function onlyRowReplay(ctx: ChatActionContext, clientId: string) {
  return {
    command: "points" as const,
    channelId: CHANNEL_ID,
    clientMessageId: clientId,
    body: {
      target_user_id: "user-2",
      amount: 5,
      category: "MANUAL" as const,
      reason: "great work",
      channel_id: CHANNEL_ID,
      client_message_id: clientId,
    },
  };
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
    // Not the `warning`-only channel: that titles the toast "partly
    // succeeded", asserting a write that may never have happened.
    expect(result.unconfirmed).toBe(true);
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

    post.mockResolvedValue({
      data: { card_posted: true },
      error: null,
      response: { status: 200 },
    });
    await retryPointsDispatch(ctx, replay);

    const [first, second] = post.mock.calls;
    expect(second![1].body.client_message_id).toBe(
      first![1].body.client_message_id,
    );
    // Same key AND same content — `resolveReplay` compares target, amount,
    // category, reason, acting admin, and origin channel before treating a
    // request as a replay, and answers 409 on any mismatch.
    expect(second![1].body).toEqual(first![1].body);
  });

  // The guard the #1733 coupling comment required before key reuse could ship.
  // On a replay of a row with no stored origin, `completeReplay` returns the
  // stored row with `card_posted` ABSENT. Falling through to `{ok:true}` would
  // leave the placeholder waiting for an echo that is never coming.
  it("does not strand the row when a replay reports no card outcome", async () => {
    const post = vi.fn().mockResolvedValue(LOST_RESPONSE);
    const ctx = buildCtx(post);
    await dispatchGrant(ctx);
    const replay = onlyRow(ctx)._replay!;

    post.mockResolvedValue({
      data: {},
      error: null,
      response: { status: 200 },
    });
    const result = await retryPointsDispatch(ctx, replay);

    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/already recorded/i);
    // The server omits `card_posted` because it knows NOTHING about the
    // original attempt — not because that card failed. Asserting failure sends
    // an officer to audit a discrepancy that usually is not there.
    expect(result.warning).not.toMatch(/couldn't be posted/i);
    expect(placeholderCount(ctx)).toBe(0);
  });

  // Same absent field, first attempt: nothing was skipped, the echo may still
  // arrive. The two must not be collapsed — this is why `isReplay` exists.
  it("still waits for the echo when a FIRST attempt reports no card outcome", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: {}, error: null, response: { status: 200 } });
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

/**
 * Regression guards for the defects `/diff-review` found in the first cut of
 * #1733. Every one of these is a path where the wrong answer re-opens the
 * append-only double-grant the change exists to prevent.
 */
describe("dispatchPoints — replay refusals and resolution (#1733 review)", () => {
  async function parkUnconfirmed(post: ReturnType<typeof vi.fn>) {
    const ctx = buildCtx(post);
    post.mockResolvedValue(LOST_RESPONSE);
    await dispatchGrant(ctx);
    return { ctx, replay: onlyRow(ctx)._replay! };
  }

  // THE critical one: a refusal of the RETRY says nothing about whether the
  // ORIGINAL attempt committed. 429 is routine — the global throttler answers
  // before the service's own replay-aware re-check ever runs.
  it.each([
    [429, "throttled"],
    [401, "session expired"],
    [403, "permission revoked"],
  ])("keeps the row when a replay is refused %i (%s)", async (status) => {
    const post = vi.fn();
    const { ctx, replay } = await parkUnconfirmed(post);

    post.mockResolvedValue({
      data: undefined,
      error: { message: "no" },
      response: { status },
    });
    const result = await retryPointsDispatch(ctx, replay);

    // Removing it here would delete the only trace of a possibly-committed
    // grant, and the officer's next move is re-typing: fresh key, no dedupe,
    // a second ledger row.
    expect(placeholderCount(ctx)).toBe(1);
    expect(onlyRow(ctx)._status).toBe("unconfirmed");
    expect(result.ok).toBe(true);
    expect(result.unconfirmed).toBe(true);
  });

  // The same statuses on a FIRST attempt are definitive: nothing was written.
  it("still tears down on a first-attempt 429", async () => {
    const post = vi.fn().mockResolvedValue({
      data: undefined,
      error: { message: "slow down" },
      response: { status: 429 },
    });
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    expect(result.ok).toBe(false);
    expect(placeholderCount(ctx)).toBe(0);
  });

  // 409 is the one refusal that tears the row down on a replay too: the key is
  // spent on a different adjustment, so replaying can never succeed.
  it("tears down on a 409 even when replaying", async () => {
    const post = vi.fn();
    const { ctx, replay } = await parkUnconfirmed(post);

    post.mockResolvedValue({
      data: undefined,
      error: { message: "different adjustment" },
      response: { status: 409 },
    });
    const result = await retryPointsDispatch(ctx, replay);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/run the command again/i);
    expect(placeholderCount(ctx)).toBe(0);
  });

  // A retry that commits as a first write must clear the row and say so.
  // Leaving it `unconfirmed` means a second press takes the replay branch and
  // reports the card missing — false by then.
  it("clears the row and reports explicitly when a retry succeeds", async () => {
    const post = vi.fn();
    const { ctx, replay } = await parkUnconfirmed(post);

    post.mockResolvedValue({
      data: { card_posted: true },
      error: null,
      response: { status: 200 },
    });
    const result = await retryPointsDispatch(ctx, replay);

    expect(result.resolved).toBeTruthy();
    // Removed, not returned to `pending`: a pending row renders the busy
    // shimmer with no Retry and no replay handle, so a lost echo would strand
    // it on "Granting…" — #544's bug at the end of the path that prevents it.
    expect(placeholderCount(ctx)).toBe(0);
  });

  // When the echo already reconciled the row, the outcome is NOT unknown: the
  // server only posts the card after the ledger row commits, so a re-keyed row
  // is positive evidence the write landed. Reporting "we couldn't confirm"
  // would put a warning above a visibly successful card.
  it("reports success when the echo already merged the row", async () => {
    const post = vi.fn().mockResolvedValue(LOST_RESPONSE);
    const ctx = buildCtx(post);
    // Park a dispatch, then let the real card echo arrive: `mergeServerRow`
    // re-keys the row under the server id while keeping its client id.
    const pending = dispatchGrant(ctx);
    const result = await pending;
    const clientId = onlyRow(ctx)._replay!.clientMessageId;

    patchWithServerEcho(ctx, clientId);
    const afterEcho = await retryPointsDispatch(ctx, {
      ...onlyRowReplay(ctx, clientId),
    });

    expect(result.unconfirmed).toBe(true);
    // The retry hits the same lost response, but the row is now server-keyed.
    expect(afterEcho.unconfirmed).toBeFalsy();
    expect(afterEcho.ok).toBe(true);
  });

  // Genuinely no trace: the copy must stand on its own rather than pointing at
  // a Retry control that does not exist.
  it("uses standalone copy when there is no row at all", async () => {
    const post = vi.fn().mockResolvedValue(LOST_RESPONSE);
    const ctx = buildCtx(post);
    (ctx as { userId: string | null }).userId = null;

    const result = await dispatchGrant(ctx);

    expect(result.unconfirmed).toBe(true);
    expect(result.warning).not.toMatch(/use retry/i);
    expect(result.warning).toMatch(/points ledger/i);
  });

  // A 2xx whose body did not parse is a SUCCESS, not a lost response.
  it("does not call a bodyless 2xx unconfirmed", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({
        data: undefined,
        error: null,
        response: { status: 204 },
      });
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    expect(result.unconfirmed).toBeFalsy();
    expect(result.ok).toBe(true);
  });
});

describe("dispatchPoints — second-pass review fixes (#1733)", () => {
  // A 4xx an INTERMEDIARY emits after the origin may already have committed is
  // not a refusal. Same "lost response" event as a 502, different band.
  it.each([408, 499, 460])(
    "treats an inconclusive %i as lost, not as a refusal",
    async (status) => {
      const post = vi.fn().mockResolvedValue({
        data: undefined,
        error: { message: "timeout" },
        response: { status },
      });
      const ctx = buildCtx(post);

      const result = await dispatchGrant(ctx);

      expect(result.ok).toBe(true);
      expect(result.unconfirmed).toBe(true);
      expect(placeholderCount(ctx)).toBe(1);
    },
  );

  // The Retry button's disabled state cannot carry this: the timeline is
  // virtualized, so scrolling away and back remounts the row with fresh state.
  it("refuses a concurrent replay of the same key", async () => {
    const post = vi.fn().mockResolvedValue(LOST_RESPONSE);
    const ctx = buildCtx(post);
    await dispatchGrant(ctx);
    const replay = onlyRow(ctx)._replay!;

    let release: (v: unknown) => void = () => {};
    post.mockReturnValue(new Promise((r) => (release = r)));
    const first = retryPointsDispatch(ctx, replay);
    const second = await retryPointsDispatch(ctx, replay);

    expect(second.warning).toMatch(/still running/i);
    // Exactly one request in flight for this key, not two racing responses.
    expect(post).toHaveBeenCalledTimes(2); // the original dispatch + one replay
    release({
      data: { card_posted: true },
      error: null,
      response: { status: 200 },
    });
    await first;
  });

  // Once it settles, the key is retryable again.
  it("releases the in-flight guard after the replay settles", async () => {
    const post = vi.fn().mockResolvedValue(LOST_RESPONSE);
    const ctx = buildCtx(post);
    await dispatchGrant(ctx);
    const replay = onlyRow(ctx)._replay!;

    await retryPointsDispatch(ctx, replay);
    const again = await retryPointsDispatch(ctx, replay);

    expect(again.warning).not.toMatch(/still running/i);
  });
});

const TASK_COMMAND: SlashCommand = {
  name: "task",
  description: "Create a task card and assign it",
  requiredModule: "tasks",
  implemented: true,
};

const EVENT_COMMAND: SlashCommand = {
  name: "event",
  description: "Create an event with an interactive card",
  requiredModule: "events",
  implemented: true,
};

function dispatchTaskCmd(ctx: ChatActionContext) {
  return dispatchSlashCommand(ctx, {
    command: TASK_COMMAND,
    args: `"Clean the house" @bobby 2099-03-15 10`,
    channelId: CHANNEL_ID,
    announcementsChannelId: null,
    resolveMember: () => ({ user_id: "user-2", display_name: "Bobby Member" }),
  });
}

function dispatchEventCmd(ctx: ChatActionContext) {
  return dispatchSlashCommand(ctx, {
    command: EVENT_COMMAND,
    args: `"Chapter Meeting" 2099-03-15 18:00-19:00`,
    channelId: CHANNEL_ID,
    announcementsChannelId: null,
  });
}

describe("dispatchTask — card_posted (#1717)", () => {
  it("leaves the placeholder for the Realtime echo when the card posted", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({
        data: { card_posted: true },
        error: null,
        response: { status: 201 },
      });
    const ctx = buildCtx(post);

    const result = await dispatchTaskCmd(ctx);

    expect(result).toEqual({ ok: true });
    expect(placeholderCount(ctx)).toBe(1);
  });

  it("keeps a recorded row and warns when the card did not post", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({
        data: { card_posted: false },
        error: null,
        response: { status: 201 },
      });
    const ctx = buildCtx(post);

    const result = await dispatchTaskCmd(ctx);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warning).toMatch(/created/i);
    expect(result.warning).toMatch(/don't run the command again/i);
    expect(placeholderCount(ctx)).toBe(1);
    expect(onlyRow(ctx)._status).toBe("recorded");
    expect(onlyRow(ctx)._replay).toBeUndefined();
  });

  it("does not report the committed create as a failure", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({
        data: { card_posted: false },
        error: null,
        response: { status: 201 },
      });

    const result = await dispatchTaskCmd(buildCtx(post));

    expect(result.ok).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("treats an absent card_posted as success", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: {}, error: null, response: { status: 201 } });
    const ctx = buildCtx(post);

    const result = await dispatchTaskCmd(ctx);

    expect(result).toEqual({ ok: true });
    expect(placeholderCount(ctx)).toBe(1);
  });

  it("still removes the placeholder and fails on a definitive 4xx", async () => {
    const post = vi.fn().mockResolvedValue({
      data: undefined,
      error: { message: "nope" },
      response: { status: 400 },
    });
    const ctx = buildCtx(post);

    const result = await dispatchTaskCmd(ctx);

    expect(result).toEqual({ ok: false, error: "nope" });
    expect(placeholderCount(ctx)).toBe(0);
  });

  // Empty-body gateway 502: openapi-fetch returns `{ error: undefined, response }`.
  // `/task` has no server-side dedupe, so a stranded placeholder invites a
  // duplicating retry. Drop it and fail — never park it as `unconfirmed`.
  it("drops the placeholder on an empty-body gateway 502", async () => {
    const post = vi.fn().mockResolvedValue({
      data: undefined,
      error: undefined,
      response: { status: 502 },
    });
    const ctx = buildCtx(post);

    const result = await dispatchTaskCmd(ctx);

    expect(result.ok).toBe(false);
    expect(result.unconfirmed).toBeUndefined();
    expect(result.error).toMatch(/Couldn't create task/i);
    expect(placeholderCount(ctx)).toBe(0);
  });

  it("drops the placeholder on a transport failure", async () => {
    const post = vi.fn().mockRejectedValue(new Error("network down"));
    const ctx = buildCtx(post);

    const result = await dispatchTaskCmd(ctx);

    expect(result).toEqual({
      ok: false,
      error: "Couldn't reach the tasks service",
    });
    expect(placeholderCount(ctx)).toBe(0);
  });
});

describe("dispatchEvent — card_posted (#1717)", () => {
  it("leaves the placeholder for the Realtime echo when the card posted", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({
        data: { card_posted: true },
        error: null,
        response: { status: 201 },
      });
    const ctx = buildCtx(post);

    const result = await dispatchEventCmd(ctx);

    expect(result).toEqual({ ok: true });
    expect(placeholderCount(ctx)).toBe(1);
  });

  it("keeps a recorded row and warns when the card did not post", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({
        data: { card_posted: false },
        error: null,
        response: { status: 201 },
      });
    const ctx = buildCtx(post);

    const result = await dispatchEventCmd(ctx);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warning).toMatch(/created/i);
    expect(result.warning).toMatch(/don't run the command again/i);
    expect(placeholderCount(ctx)).toBe(1);
    expect(onlyRow(ctx)._status).toBe("recorded");
    expect(onlyRow(ctx)._replay).toBeUndefined();
  });

  it("does not report the committed create as a failure", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({
        data: { card_posted: false },
        error: null,
        response: { status: 201 },
      });

    const result = await dispatchEventCmd(buildCtx(post));

    expect(result.ok).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("treats an absent card_posted as success", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: {}, error: null, response: { status: 201 } });
    const ctx = buildCtx(post);

    const result = await dispatchEventCmd(ctx);

    expect(result).toEqual({ ok: true });
    expect(placeholderCount(ctx)).toBe(1);
  });

  it("still removes the placeholder and fails on a definitive 4xx", async () => {
    const post = vi.fn().mockResolvedValue({
      data: undefined,
      error: { message: "nope" },
      response: { status: 400 },
    });
    const ctx = buildCtx(post);

    const result = await dispatchEventCmd(ctx);

    expect(result).toEqual({ ok: false, error: "nope" });
    expect(placeholderCount(ctx)).toBe(0);
  });

  it("drops the placeholder on an empty-body gateway 502", async () => {
    const post = vi.fn().mockResolvedValue({
      data: undefined,
      error: undefined,
      response: { status: 502 },
    });
    const ctx = buildCtx(post);

    const result = await dispatchEventCmd(ctx);

    expect(result.ok).toBe(false);
    expect(result.unconfirmed).toBeUndefined();
    expect(result.error).toMatch(/Couldn't create event/i);
    expect(placeholderCount(ctx)).toBe(0);
  });

  it("drops the placeholder on a transport failure", async () => {
    const post = vi.fn().mockRejectedValue(new Error("network down"));
    const ctx = buildCtx(post);

    const result = await dispatchEventCmd(ctx);

    expect(result).toEqual({
      ok: false,
      error: "Couldn't reach the events service",
    });
    expect(placeholderCount(ctx)).toBe(0);
  });
});

/**
 * #1718 — `/poll` and `/announce` used to `await sendMessage` with no try, so
 * a Dexie fault escaped `dispatchSlashCommand`. The composer net maps that
 * to a destructive `{ ok: false }` toast and cannot touch the optimistic
 * row. Two faults, two outcomes:
 *
 * - never sent (`enqueue`) → `{ ok: false }`, optimistic row removed
 * - sent, `dequeue` failed → `{ ok: true, warning }`, row confirmed
 */

const POLL_COMMAND: SlashCommand = {
  name: "poll",
  description: "Start a poll",
  requiredModule: "polls",
  implemented: true,
};

const ANNOUNCE_COMMAND: SlashCommand = {
  name: "announce",
  description: "Post an announcement",
  requiredModule: null,
  implemented: true,
};

const SIMPLE_CASES = [
  {
    name: "poll" as const,
    command: POLL_COMMAND,
    args: `"Who's in?" Yes No`,
    announcementsChannelId: null as string | null,
    kind: "poll",
  },
  {
    name: "announce" as const,
    command: ANNOUNCE_COMMAND,
    args: "House meeting at 7",
    announcementsChannelId: CHANNEL_ID,
    kind: "announcement",
  },
];

function buildOutbox(overrides: Partial<OutboxStore> = {}): OutboxStore {
  return {
    enqueue: vi.fn().mockImplementation(
      async (row): Promise<OutboxRow> => ({
        attempts: 0,
        status: "queued",
        queuedAt: Date.now(),
        ...row,
      }),
    ),
    dequeue: vi.fn().mockResolvedValue(undefined),
    requeue: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    bumpAttempt: vi.fn().mockResolvedValue(undefined),
    listQueued: vi.fn().mockResolvedValue([]),
    listForChannel: vi.fn().mockResolvedValue([]),
    clearDraft: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildSimpleCtx(
  post: ReturnType<typeof vi.fn>,
  outbox: OutboxStore,
): ChatActionContext {
  return {
    queryClient: new QueryClient(),
    apiClient: { POST: post } as unknown as ChatActionContext["apiClient"],
    supabase: { from: vi.fn() } as unknown as ChatActionContext["supabase"],
    userId: "user-1",
    outbox,
  };
}

function dispatchSimple(
  ctx: ChatActionContext,
  which: (typeof SIMPLE_CASES)[number],
) {
  return dispatchSlashCommand(ctx, {
    command: which.command,
    args: which.args,
    channelId: CHANNEL_ID,
    announcementsChannelId: which.announcementsChannelId,
  });
}

function echoPostedMessage(body: {
  client_message_id: string;
  content: string;
  kind: string;
}) {
  return {
    id: "server-1",
    channel_id: CHANNEL_ID,
    sender_id: "user-1",
    content: body.content,
    kind: body.kind,
    client_message_id: body.client_message_id,
    created_at: new Date().toISOString(),
  };
}

function postingApi() {
  return vi.fn().mockImplementation(
    async (
      _path: string,
      init: {
        body: { client_message_id: string; content: string; kind: string };
      },
    ) => ({
      data: { message: echoPostedMessage(init.body) },
      error: null,
      response: { status: 201 },
    }),
  );
}

describe("dispatchPoll / dispatchAnnounce — sendMessage faults (#1718)", () => {
  it.each(SIMPLE_CASES)(
    "/$name returns a failure instead of throwing when enqueue rejects",
    async (which) => {
      const post = postingApi();
      const outbox = buildOutbox({
        enqueue: vi.fn().mockRejectedValue(new Error("QuotaExceededError")),
      });
      const ctx = buildSimpleCtx(post, outbox);

      const result = await dispatchSimple(ctx, which);

      expect(result).toEqual({
        ok: false,
        error: "Couldn't run that command.",
      });
      expect(post).not.toHaveBeenCalled();
      expect(
        selectMessages(
          ctx.queryClient.getQueryData(chatMessagesKey(CHANNEL_ID)),
        ),
      ).toHaveLength(0);
    },
  );

  it.each(SIMPLE_CASES)(
    "/$name still posts when clearDraft rejects (draft clear is best-effort)",
    async (which) => {
      const post = postingApi();
      const outbox = buildOutbox({
        clearDraft: vi
          .fn()
          .mockRejectedValue(new Error("DatabaseClosedError")),
      });
      const ctx = buildSimpleCtx(post, outbox);

      const result = await dispatchSimple(ctx, which);

      expect(result).toEqual({ ok: true });
      expect(post).toHaveBeenCalledTimes(1);
      expect(onlyRow(ctx)._status).toBe("confirmed");
    },
  );

  // The composer net cannot tell this from a never-sent reject, so it would
  // toast "/poll failed" while the card is visible and invite a re-type that
  // misses the dedupe index. `{ ok: true, warning }` is the #544 channel.
  it.each(SIMPLE_CASES)(
    "/$name does not report failure when POST succeeded and dequeue rejects",
    async (which) => {
      const post = postingApi();
      const outbox = buildOutbox({
        dequeue: vi.fn().mockRejectedValue(new Error("DatabaseClosedError")),
      });
      const ctx = buildSimpleCtx(post, outbox);

      const result = await dispatchSimple(ctx, which);

      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.warning).toMatch(/don't send it again/i);
      expect(post).toHaveBeenCalledTimes(1);
      expect(onlyRow(ctx)._status).toBe("confirmed");
      expect(onlyRow(ctx).kind).toBe(which.kind);
    },
  );
});
