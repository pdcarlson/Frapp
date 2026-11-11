/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityKeys, type ActivityPoll } from "@repo/hooks";

/**
 * The phone's Activity poll hook (#3897): the votes read, the vote and the
 * close, over chat-core's own functions, which are stubbed here and tested
 * in `packages/chat-core`.
 */

const core = vi.hoisted(() => ({
  readVotes: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  act: vi.fn<(...args: unknown[]) => Promise<void>>(),
  close: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("@repo/chat-core/activity-cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/chat-core/activity-cards")>()),
  readActivityPollVotes: (...args: unknown[]) => core.readVotes(...args),
}));
vi.mock("@repo/chat-core/chat-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/chat-core/chat-client")>()),
  actOnDetachedCard: (...args: unknown[]) => core.act(...args),
  closeDetachedPoll: (...args: unknown[]) => core.close(...args),
}));

const apiClient = { name: "api" };
let chapterId: string | null = "chapter-1";
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useFrappClient: () => apiClient,
  useActiveChapterId: () => chapterId,
}));

const supabase = vi.hoisted(() => ({
  client: { name: "supabase" } as unknown,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => supabase.client,
}));

import { classifyChatError } from "@repo/chat-core/chat-client";
import { memberFacingRefusal } from "@repo/chat-core/polls";
import { useActivityPoll } from "./use-activity-poll";

const POLL = {
  message_id: "msg-1",
  channel_id: "chan-1",
  channel_name: "general",
  channel_type: "PUBLIC",
  question: "Formal venue?",
  closes_at: null,
  is_closed: false,
  has_voted: false,
  created_at: "2026-11-01T00:00:00.000Z",
  message: {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: "u-2",
    content: "Formal venue?",
    kind: "poll",
    payload: {},
    created_at: "2026-11-01T00:00:00.000Z",
  },
} as unknown as ActivityPoll;

const VOTE = { id: "act-1", message_id: "msg-1", action_type: "vote" };

/** The hook's latest return, handed out through an effect. */
const hook = {} as { latest: ReturnType<typeof useActivityPoll> };
function Probe({ poll }: { poll: ActivityPoll }) {
  const value = useActivityPoll(poll);
  React.useEffect(() => {
    hook.latest = value;
  });
  return null;
}

describe("useActivityPoll (#3897)", () => {
  let queryClient: QueryClient;
  let tree: ReactTestRenderer;

  async function mount(poll: ActivityPoll = POLL) {
    await act(async () => {
      tree = create(
        <QueryClientProvider client={queryClient}>
          <Probe poll={poll} />
        </QueryClientProvider>,
      );
    });
    // The votes read settles, to data or to an error: an error reaches the
    // hook a timer tick after the rejection.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    chapterId = "chapter-1";
    supabase.client = { name: "supabase" };
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    core.readVotes.mockResolvedValue([VOTE]);
    core.act.mockResolvedValue(undefined);
    core.close.mockResolvedValue({});
  });

  afterEach(() => {
    act(() => tree.unmount());
    queryClient.clear();
  });

  it("reads the poll's votes under the member's session and hands the card its message", async () => {
    await mount();
    expect(core.readVotes).toHaveBeenCalledWith(supabase.client, "msg-1");
    expect(hook.latest.votesLoading).toBe(false);
    expect(hook.latest.votesFailed).toBe(false);
    expect(hook.latest.message.id).toBe("msg-1");
    expect(hook.latest.message.actions).toEqual([VOTE]);
  });

  it("is a failed read, not an empty tally, when the votes can't be read", async () => {
    core.readVotes.mockRejectedValue(new Error("partial"));
    await mount();
    expect(hook.latest.votesFailed).toBe(true);
    expect(hook.latest.message.actions).toEqual([]);
  });

  it("is a failed read on a build with no Supabase client", async () => {
    supabase.client = null;
    await mount();
    expect(core.readVotes).not.toHaveBeenCalled();
    expect(hook.latest.votesFailed).toBe(true);
  });

  it("holds the read until there is a chapter", async () => {
    chapterId = null;
    await mount();
    expect(core.readVotes).not.toHaveBeenCalled();
    expect(hook.latest.votesLoading).toBe(true);
  });

  it("votes through chat's detached-card route, then re-reads the votes and the list", async () => {
    await mount();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await hook.latest.vote("msg-1", "vote", { option_id: "a" });
    });
    expect(core.act).toHaveBeenCalledWith(
      { queryClient, apiClient },
      {
        channelId: "chan-1",
        messageId: "msg-1",
        actionType: "vote",
        payload: { option_id: "a" },
      },
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [...activityKeys.chapter("chapter-1"), "poll-votes", "msg-1"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: activityKeys.chapter("chapter-1"),
      exact: true,
    });
    expect(hook.latest.refusal).toBeNull();
  });

  it("turns a refused vote into a line for the sheet, and clears it on the next try", async () => {
    await mount();
    const refused = new Error("This poll has closed.");
    core.act.mockRejectedValueOnce(refused);
    await act(async () => {
      await hook.latest.vote("msg-1", "vote", { option_id: "a" });
    });
    // In a member's words, as chat's own card says a refusal.
    expect(hook.latest.refusal).toBe(
      memberFacingRefusal(classifyChatError(refused).message),
    );
    expect(hook.latest.refusal).toBeTruthy();

    await act(async () => {
      await hook.latest.vote("msg-1", "vote", { option_id: "a" });
    });
    expect(hook.latest.refusal).toBeNull();
  });

  it("closes through chat's route and re-reads; a refused close rejects for the caller's alert", async () => {
    await mount();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await hook.latest.close("msg-1");
    });
    expect(core.close).toHaveBeenCalledWith(
      { queryClient, apiClient },
      { channelId: "chan-1", messageId: "msg-1" },
    );
    expect(invalidate).toHaveBeenCalledTimes(2);

    core.close.mockRejectedValueOnce(new Error("nope"));
    await expect(hook.latest.close("msg-1")).rejects.toThrow("nope");
  });

  it("re-reads an open poll's votes on an interval, and a closed poll's never", async () => {
    await mount();
    const observed = () =>
      queryClient.getQueryCache().find({
        queryKey: [...activityKeys.chapter("chapter-1"), "poll-votes", "msg-1"],
      })!.observers[0]!.options.refetchInterval;
    expect(observed()).toBe(15_000);

    act(() => tree.unmount());
    queryClient.clear();
    await mount({ ...POLL, is_closed: true });
    expect(observed()).toBe(false);
  });
});
