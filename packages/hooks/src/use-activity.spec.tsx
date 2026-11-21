import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { localWeekStart } from "./activity-standing";
import { useActivity } from "./use-activity";
import { createHookWrapper, createTestQueryClient } from "./test-utils";

describe("useActivity", () => {
  it("names the member's own week, so the ring counts the week their calendar shows (#4766)", async () => {
    const client = {
      GET: vi.fn().mockResolvedValue({ data: { unavailable: [] } }),
    };
    const queryClient = createTestQueryClient();
    const wrapper = createHookWrapper({
      client,
      queryClient,
      chapterId: "chapter-1",
    });

    const { result } = renderHook(() => useActivity(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.GET).toHaveBeenCalledWith("/v1/activity", {
      signal: expect.any(AbortSignal),
      params: { query: { week_start: localWeekStart().toISOString() } },
    });
  });
});
