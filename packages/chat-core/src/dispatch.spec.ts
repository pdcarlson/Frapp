import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SlashCommand } from "@repo/chat-integrations";
import { dispatchSlashCommand } from "./dispatch";
import type { ChatActionContext } from "./chat-client";
import type { OutboxStore } from "./adapters";
import { chatMessagesKey, type ChannelCache } from "./types";
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

  it("still removes the placeholder and fails on an HTTP error", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: { message: "nope" } });
    const ctx = buildCtx(post);

    const result = await dispatchGrant(ctx);

    expect(result.ok).toBe(false);
    expect(result.warning).toBeUndefined();
    expect(placeholderCount(ctx)).toBe(0);
  });
});
