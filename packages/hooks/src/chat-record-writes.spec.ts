import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  chatRecordKindForCommand,
  withChatRecordRefresh,
} from "./chat-record-writes";

/**
 * #3912: a task, hours entry or points adjustment written from chat must
 * refresh the dashboard page that reads it, as the page's own create hook does.
 */
describe("chatRecordKindForCommand", () => {
  it("maps the commands whose write lands on a dashboard page", () => {
    expect(chatRecordKindForCommand("task")).toBe("task");
    expect(chatRecordKindForCommand("hours")).toBe("hours");
    expect(chatRecordKindForCommand("points")).toBe("points");
  });

  it("maps nothing for commands no page reads, or a prototype key", () => {
    // `/event`: the Events page refetches over Realtime. `/rush`: no list.
    for (const name of ["event", "rush", "poll", "announce", "toString"]) {
      expect(chatRecordKindForCommand(name)).toBeNull();
    }
  });
});

describe("withChatRecordRefresh", () => {
  function client() {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    return { queryClient, invalidate };
  }

  it.each([
    ["task", ["tasks"]],
    ["hours", ["service-entries"]],
    ["points", ["points"]],
  ] as const)("refreshes %s's page on ok", async (kind, queryKey) => {
    const { queryClient, invalidate } = client();
    const result = await withChatRecordRefresh(queryClient, kind, async () => ({
      ok: true,
    }));
    expect(result).toEqual({ ok: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  });

  it("refreshes after an unconfirmed answer: the write may have committed", async () => {
    const { queryClient, invalidate } = client();
    await withChatRecordRefresh(queryClient, "task", async () => ({
      ok: true,
      unconfirmed: true,
    }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tasks"] });
  });

  it("refreshes, and rethrows, when the write throws", async () => {
    const { queryClient, invalidate } = client();
    const failure = new Error("cache bookkeeping failed");
    await expect(
      withChatRecordRefresh(queryClient, "hours", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["service-entries"] });
  });

  it("refreshes nothing after a refusal, or with no kind", async () => {
    const { queryClient, invalidate } = client();
    await withChatRecordRefresh(queryClient, "points", async () => ({
      ok: false,
    }));
    await withChatRecordRefresh(queryClient, null, async () => ({ ok: true }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
