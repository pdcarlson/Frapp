/** @vitest-environment jsdom */
import React from "react";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import {
  CLIENT_POLICY_QUERY_KEY,
  clientPolicyQueryClient,
  readClientPolicy,
  useClientPolicy,
} from "./client-policy";
import { clearProductQueryCache, queryClient } from "./query-client";

describe("readClientPolicy", () => {
  it("blocks on true, and keeps an https link", () => {
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

  it("reads false as supported", () => {
    expect(
      readClientPolicy({ update_required: false, update_url: "https://example.com" }),
    ).toEqual({ updateRequired: false, updateUrl: null });
  });

  // Not answers: the caller treats them as failures, which keeps whatever
  // answer came before rather than overwriting it with "supported".
  it.each([
    [null],
    [undefined],
    [""],
    ["update"],
    [{}],
    [{ update_required: "true" }],
    [{ update_required: 1 }],
  ])("reads %j as no answer at all", (data) => {
    expect(readClientPolicy(data)).toBeNull();
  });

  it("still blocks, with no link, when the link isn't https", () => {
    for (const url of ["http://example.com", "javascript:alert(1)", 42, null]) {
      expect(
        readClientPolicy({ update_required: true, update_url: url }),
      ).toEqual({ updateRequired: true, updateUrl: null });
    }
  });
});

type Reply = { status?: number; data?: unknown } | Error;

describe("useClientPolicy", () => {
  function setup(replies: Reply[]) {
    // Shaped like openapi-fetch 0.17's result: a 2xx puts the body in `data`;
    // a non-2xx puts it in `error` (undefined when the body is empty) and
    // never sets `data`.
    const GET = vi.fn(async () => {
      const next = replies.shift();
      if (next instanceof Error) throw next;
      const status = next?.status ?? 200;
      const ok = status >= 200 && status < 300;
      return {
        data: ok ? next?.data : undefined,
        error: ok ? undefined : next?.data,
        response: { ok, status },
      };
    });
    const policyClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={{ GET } as unknown as ReturnType<typeof createFrappClient>}
        chapterId={null}
      >
        {children}
      </FrappClientProvider>
    );
    Wrapper.displayName = "ClientPolicyWrapper";
    const view = renderHook(() => useClientPolicy(policyClient), {
      wrapper: Wrapper,
    });
    // Waits for the fetch to finish and for its result to reach the render.
    // Asserting straight after `refetchQueries` would read the previous
    // render, and a "keeps the block" check would pass whatever the fetch did.
    const settle = async () => {
      await waitFor(() => expect(policyClient.isFetching()).toBe(0));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    };
    const refetch = async () => {
      await act(() =>
        policyClient.refetchQueries({ queryKey: CLIENT_POLICY_QUERY_KEY }),
      );
      await settle();
    };
    return { ...view, GET, refetch, settle };
  }

  const BLOCK = { data: { update_required: true, update_url: "https://a.test" } };

  it("asks the policy route and blocks on its answer", async () => {
    const { result, GET } = setup([BLOCK]);
    expect(result.current.updateRequired).toBe(false);
    await waitFor(() => expect(result.current.updateRequired).toBe(true));
    expect(GET).toHaveBeenCalledWith("/v1/client-policy");
    expect(result.current.updateUrl).toBe("https://a.test");
  });

  it.each([
    ["a JSON 5xx", { status: 503, data: undefined }],
    ["a thrown network failure", new Error("Network request failed")],
    ["a 200 in the wrong shape", { data: {} }],
  ])("fails open on %s", async (_label, reply) => {
    const { result, GET, settle } = setup([reply as Reply]);
    await waitFor(() => expect(GET).toHaveBeenCalled());
    await settle();
    expect(result.current).toEqual({ updateRequired: false, updateUrl: null });
  });

  it.each([
    ["an empty-bodied 502", { status: 502 }],
    ["a thrown network failure", new Error("offline")],
    ["a 200 in the wrong shape", { data: { hello: "portal" } }],
    // An error page that happens to carry the right keys is still not an
    // answer: only a 2xx is.
    ["a 503 whose body looks like an answer", {
      status: 503,
      data: { update_required: false, update_url: null },
    }],
  ])("keeps a block through %s on recheck", async (_label, reply) => {
    const { result, refetch } = setup([BLOCK, reply as Reply]);
    await waitFor(() => expect(result.current.updateRequired).toBe(true));
    await refetch();
    expect(result.current.updateRequired).toBe(true);
  });

  // The status check is what makes a non-2xx fail open whatever the client
  // does with its body. openapi-fetch 0.17 never sets `data` on a non-2xx, so
  // the stand-in above can't reach this; a client that did (another version,
  // a wrapper) is simulated here directly.
  it("keeps a block through a non-2xx even when the client parsed its body", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: BLOCK.data,
        error: undefined,
        response: { ok: true, status: 200 },
      })
      .mockResolvedValueOnce({
        data: { update_required: false, update_url: null },
        error: undefined,
        response: { ok: false, status: 503 },
      });
    const policyClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={{ GET } as unknown as ReturnType<typeof createFrappClient>}
        chapterId={null}
      >
        {children}
      </FrappClientProvider>
    );
    Wrapper.displayName = "ParsedErrorBodyWrapper";
    const { result } = renderHook(() => useClientPolicy(policyClient), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.updateRequired).toBe(true));
    await act(() =>
      policyClient.refetchQueries({ queryKey: CLIENT_POLICY_QUERY_KEY }),
    );
    await waitFor(() => expect(policyClient.isFetching()).toBe(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(GET).toHaveBeenCalledTimes(2);
    expect(result.current.updateRequired).toBe(true);
  });

  it("lifts a block only on an answer of false", async () => {
    const { result, refetch } = setup([
      BLOCK,
      { data: { update_required: false, update_url: "https://a.test" } },
    ]);
    await waitFor(() => expect(result.current.updateRequired).toBe(true));
    await refetch();
    expect(result.current.updateRequired).toBe(false);
  });
});

// Sign-out, an account swap and a chapter switch all clear the product cache,
// and an auth-js SIGNED_OUT gets there with no tap. None of them may erase a
// block, which is why the policy doesn't live in that cache.
describe("clientPolicyQueryClient", () => {
  it("is not the product cache, and survives it being cleared", () => {
    expect(clientPolicyQueryClient).not.toBe(queryClient);
    clientPolicyQueryClient.setQueryData(CLIENT_POLICY_QUERY_KEY, {
      updateRequired: true,
      updateUrl: "https://a.test",
    });
    clearProductQueryCache();
    queryClient.clear();
    expect(clientPolicyQueryClient.getQueryData(CLIENT_POLICY_QUERY_KEY)).toEqual({
      updateRequired: true,
      updateUrl: "https://a.test",
    });
    clientPolicyQueryClient.clear();
  });
});
