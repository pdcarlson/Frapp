import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recapWeek, useActivityRecap } from "./activity-recap";
import { createHookWrapper } from "./test-utils";

function setup() {
  const client = {
    GET: vi.fn().mockResolvedValue({ data: { unavailable: [] } }),
  };
  const wrapper = createHookWrapper({ client, chapterId: "chapter-1" });
  return { client, wrapper };
}

describe("useActivityRecap", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the member's own last week on Sunday to Tuesday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 16, 9));
    const { client, wrapper } = setup();

    const { result } = renderHook(() => useActivityRecap(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.GET).toHaveBeenCalledWith("/v1/activity/recap", {
      signal: expect.any(AbortSignal),
      params: { query: recapWeek(new Date(2026, 10, 16, 9)) },
    });
  });

  it("reads nothing the rest of the week", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 18, 9));
    const { client, wrapper } = setup();

    const { result } = renderHook(() => useActivityRecap(), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(client.GET).not.toHaveBeenCalled();
  });
});
