import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { recapWeek, useActivityRecap } from "./activity-recap";
import { FrappClientProvider } from "./use-frapp-client";

function setup() {
  const client = {
    GET: vi.fn().mockResolvedValue({ data: { unavailable: [] } }),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        client as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
      chapterId="chapter-1"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
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
