/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { EVENT_CREATE_UNCONFIRMED, useCreateEvent } from "./use-events";
import { FrappClientProvider } from "./use-frapp-client";

function wrapperFor(client: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider client={client as ReturnType<typeof createFrappClient>}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "EventsHookWrapper";
  return Wrapper;
}

const body = {
  name: "Formal",
  start_time: "2026-11-20T23:00:00.000Z",
  end_time: "2026-11-21T01:00:00.000Z",
  point_value: 10,
  is_mandatory: false,
};

describe("useCreateEvent", () => {
  it("resolves the created event on a 2xx", async () => {
    const created = { id: "e1", card_posted: true };
    const POST = vi.fn().mockResolvedValue({
      data: created,
      error: undefined,
      response: { status: 201, ok: true },
    });
    const { result } = renderHook(() => useCreateEvent(), {
      wrapper: wrapperFor({ POST }),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(body)).resolves.toEqual(created);
    });
  });

  it.each([undefined, ""])(
    "rejects as unconfirmed on an empty-bodied 5xx (error %j), not as a create (#1717)",
    async (error) => {
      const POST = vi.fn().mockResolvedValue({
        data: undefined,
        error,
        response: { status: 504, ok: false },
      });
      const { result } = renderHook(() => useCreateEvent(), {
        wrapper: wrapperFor({ POST }),
      });

      await act(async () => {
        await expect(result.current.mutateAsync(body)).rejects.toThrow(
          EVENT_CREATE_UNCONFIRMED,
        );
      });
    },
  );
});
