import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { localWeekStart } from "./activity-standing";
import { useActivity } from "./use-activity";
import { FrappClientProvider } from "./use-frapp-client";

describe("useActivity", () => {
  it("names the member's own week, so the ring counts the week their calendar shows (#4766)", async () => {
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
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );

    const { result } = renderHook(() => useActivity(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.GET).toHaveBeenCalledWith("/v1/activity", {
      params: { query: { week_start: localWeekStart().toISOString() } },
    });
  });
});
