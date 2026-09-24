/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import {
  CLIENT_POLICY_QUERY_KEY,
  readClientPolicy,
  useClientPolicy,
} from "./client-policy";

describe("readClientPolicy", () => {
  it("blocks only on an exact true, and keeps an https link", () => {
    expect(
      readClientPolicy({
        update_required: true,
        update_url: "https://apps.apple.com/app/id6812025642",
      }),
    ).toEqual({
      updateRequired: true,
      updateUrl: "https://apps.apple.com/app/id6812025642",
    });
  });

  it.each([
    [null],
    [undefined],
    ["update"],
    [{}],
    [{ update_required: "true" }],
    [{ update_required: 1 }],
    [{ update_required: false, update_url: "https://example.com" }],
  ])("treats %j as supported", (data) => {
    expect(readClientPolicy(data)).toEqual({
      updateRequired: false,
      updateUrl: null,
    });
  });

  it("still blocks, with no link, when the link isn't https", () => {
    for (const url of ["http://example.com", "javascript:alert(1)", 42, null]) {
      expect(
        readClientPolicy({ update_required: true, update_url: url }),
      ).toEqual({ updateRequired: true, updateUrl: null });
    }
  });
});

describe("useClientPolicy", () => {
  function setup(
    responses: Array<{ data?: unknown; error?: unknown } | Error>,
  ) {
    const GET = vi.fn(async () => {
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return { data: next?.data, error: next?.error };
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={{ GET } as unknown as ReturnType<typeof createFrappClient>}
        chapterId={null}
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "ClientPolicyWrapper";
    const view = renderHook(() => useClientPolicy(), { wrapper: Wrapper });
    const refetch = () =>
      act(() => queryClient.refetchQueries({ queryKey: CLIENT_POLICY_QUERY_KEY }));
    return { ...view, GET, refetch };
  }

  it("asks the policy route and blocks on its answer", async () => {
    const { result, GET } = setup([
      { data: { update_required: true, update_url: "https://play.google.com/x" } },
    ]);
    expect(result.current.updateRequired).toBe(false);
    await waitFor(() => expect(result.current.updateRequired).toBe(true));
    expect(GET).toHaveBeenCalledWith("/v1/client-policy");
    expect(result.current.updateUrl).toBe("https://play.google.com/x");
  });

  it.each([
    ["an error response", { error: { statusCode: 503 } }],
    ["a thrown network failure", new Error("Network request failed")],
  ])("fails open on %s", async (_label, response) => {
    const { result, GET } = setup([response]);
    await waitFor(() => expect(GET).toHaveBeenCalled());
    // Give the failure time to settle before asserting nothing changed.
    await act(async () => {});
    expect(result.current).toEqual({ updateRequired: false, updateUrl: null });
  });

  it("keeps a block through a failed recheck, and lifts it on a supported answer", async () => {
    const { result, refetch } = setup([
      { data: { update_required: true, update_url: "https://a.test" } },
      new Error("offline"),
      { data: { update_required: false, update_url: "https://a.test" } },
    ]);
    await waitFor(() => expect(result.current.updateRequired).toBe(true));

    await refetch();
    expect(result.current.updateRequired).toBe(true);

    await refetch();
    await waitFor(() => expect(result.current.updateRequired).toBe(false));
  });
});
