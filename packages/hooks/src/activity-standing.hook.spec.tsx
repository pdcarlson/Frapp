import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { localWeekStart, useActivityStanding } from "./activity-standing";
import { createHookWrapper } from "./test-utils";

describe("useActivityStanding", () => {
  it("names the member's own week, so study counts the week their calendar shows", async () => {
    const client = {
      GET: vi.fn().mockResolvedValue({ data: { unavailable: [] } }),
    };
    const wrapper = createHookWrapper({ client, chapterId: "chapter-1" });

    const { result } = renderHook(() => useActivityStanding(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.GET).toHaveBeenCalledWith("/v1/activity/standing", {
      signal: expect.any(AbortSignal),
      params: { query: { week_start: localWeekStart().toISOString() } },
    });
  });
});
