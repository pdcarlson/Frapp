import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComingUpReviewRow } from "@repo/validation";
import { useTrackComingUpDates } from "./coming-up-tracking";
import { createHookWrapper } from "./test-utils";

const row = (over: Partial<ComingUpReviewRow>): ComingUpReviewRow => ({
  index: 0,
  date: "2026-11-21",
  text: "Dues due to the treasurer",
  kind: "task",
  title: "Dues due to the treasurer",
  description: null,
  assigneeId: "u-marcus",
  suggestion: null,
  checked: true,
  ...over,
});

function setup(post: ReturnType<typeof vi.fn>) {
  const client = { POST: post, GET: vi.fn() };
  const wrapper = createHookWrapper({ client, chapterId: "chapter-1" });
  return renderHook(() => useTrackComingUpDates(), { wrapper });
}

describe("useTrackComingUpDates", () => {
  it("makes a task, or accepts the suggestion with only what changed", async () => {
    const post = vi.fn().mockResolvedValue({
      data: { id: "x" },
      response: { ok: true, status: 200 },
    });
    const { result } = setup(post);
    let answer: { made: number; failed: number } | undefined;
    await act(async () => {
      answer = await result.current.mutateAsync({
        viewerId: "u-me",
        rows: [
          row({ assigneeId: null, description: "Whole line" }),
          row({
            index: 1,
            suggestion: { id: "s1", due_date: null, assignee_id: "u-marcus" },
          }),
          row({
            index: 2,
            suggestion: {
              id: "s2",
              due_date: "2026-11-21",
              assignee_id: "u-marcus",
            },
          }),
          row({ index: 3, kind: "calendar" }),
        ],
      });
    });
    expect(answer).toEqual({ made: 3, failed: 0 });
    expect(post).toHaveBeenNthCalledWith(1, "/v1/tasks", {
      body: {
        title: "Dues due to the treasurer",
        description: "Whole line",
        assignee_id: "u-me",
        due_date: "2026-11-21",
      },
    });
    expect(post).toHaveBeenNthCalledWith(2, "/v1/ai/suggestions/{id}/accept", {
      params: { path: { id: "s1" } },
      body: { task: { due_date: "2026-11-21" } },
    });
    expect(post).toHaveBeenNthCalledWith(3, "/v1/ai/suggestions/{id}/accept", {
      params: { path: { id: "s2" } },
      body: {},
    });
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("counts a line that fails and still makes the rest", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "nope" } })
      .mockResolvedValue({ data: { id: "x" } });
    const { result } = setup(post);
    let answer: { made: number; failed: number } | undefined;
    await act(async () => {
      answer = await result.current.mutateAsync({
        viewerId: "u-me",
        rows: [row({}), row({ index: 1 })],
      });
    });
    expect(answer).toEqual({ made: 1, failed: 1 });
  });
});
