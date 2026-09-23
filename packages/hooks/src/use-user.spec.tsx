import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  legalAcceptanceQueryKey,
  markLegalAcceptanceRecorded,
  useAcceptLegalTerms,
  useLegalAcceptance,
  useMyPermissions,
  type LegalAcceptance,
} from "./use-user";
import { useRedeemInvite } from "./use-invites";
import { FrappClientProvider } from "./use-frapp-client";

const createWrapper = (
  queryClient: QueryClient,
  mockClient: unknown,
  chapterId: string | null = "test-chapter",
) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        mockClient as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
      chapterId={chapterId}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
};

describe("useMyPermissions", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("returns the permission set when the request succeeds", async () => {
    const mockClient = {
      GET: vi.fn().mockResolvedValue({
        data: { permissions: ["members:view", "events:create"] },
        error: undefined,
      }),
    };

    const { result } = renderHook(() => useMyPermissions(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockClient.GET).toHaveBeenCalledWith("/v1/users/me/permissions");
    expect(result.current.data).toEqual({
      permissions: ["members:view", "events:create"],
    });
  });

  it("surfaces errors from the SDK", async () => {
    const mockClient = {
      GET: vi
        .fn()
        .mockResolvedValue({ data: undefined, error: new Error("boom") }),
    };

    const { result } = renderHook(() => useMyPermissions(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("is disabled while `enabled: false`", async () => {
    const mockClient = { GET: vi.fn() };

    renderHook(() => useMyPermissions({ enabled: false }), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    // Give TanStack Query a tick to show that nothing was fetched.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockClient.GET).not.toHaveBeenCalled();
  });
});

describe("Terms acceptance hooks (#2302)", () => {
  let queryClient: QueryClient;
  const required: LegalAcceptance = {
    current_version: "2026-09",
    accepted_version: "2026-03",
    accepted_at: "2026-03-01T00:00:00.000Z",
    required: true,
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("reads the status without needing a chapter", async () => {
    const mockClient = {
      GET: vi.fn().mockResolvedValue({ data: required, error: undefined }),
    };

    const { result } = renderHook(() => useLegalAcceptance(), {
      wrapper: createWrapper(queryClient, mockClient, null),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockClient.GET).toHaveBeenCalledWith(
      "/v1/users/me/legal-acceptance",
    );
    expect(result.current.data?.required).toBe(true);
  });

  it("posts only the checkbox, and caches the server's answer", async () => {
    const accepted: LegalAcceptance = {
      ...required,
      accepted_version: "2026-09",
      accepted_at: "2026-09-23T00:00:00.000Z",
      required: false,
    };
    const mockClient = {
      POST: vi.fn().mockResolvedValue({ data: accepted, error: undefined }),
    };

    const { result } = renderHook(() => useAcceptLegalTerms(), {
      wrapper: createWrapper(queryClient, mockClient),
    });
    await result.current.mutateAsync();

    expect(mockClient.POST).toHaveBeenCalledWith(
      "/v1/users/me/legal-acceptance",
      { body: { accept_terms_privacy: true } },
    );
    expect(queryClient.getQueryData(legalAcceptanceQueryKey())).toEqual(
      accepted,
    );
  });

  it("marks the cached status accepted at once, so no gate flashes the prompt", () => {
    queryClient.setQueryData(legalAcceptanceQueryKey(), required);

    markLegalAcceptanceRecorded(queryClient);

    expect(
      queryClient.getQueryData<LegalAcceptance>(legalAcceptanceQueryKey()),
    ).toMatchObject({ accepted_version: "2026-09", required: false });
  });

  it("leaves an empty cache empty rather than inventing a status", () => {
    markLegalAcceptanceRecorded(queryClient);

    expect(
      queryClient.getQueryData(legalAcceptanceQueryKey()),
    ).toBeUndefined();
  });

  it("marks the status accepted after a join with the box ticked", async () => {
    queryClient.setQueryData(legalAcceptanceQueryKey(), required);
    const mockClient = {
      POST: vi.fn().mockResolvedValue({
        data: { chapterId: "ch-1", memberId: "m-1" },
        error: undefined,
      }),
      GET: vi.fn().mockResolvedValue({ data: required, error: undefined }),
    };

    const { result } = renderHook(() => useRedeemInvite(), {
      wrapper: createWrapper(queryClient, mockClient),
    });
    await result.current.mutateAsync({
      token: "t",
      accept_terms_privacy: true,
    });

    expect(mockClient.POST).toHaveBeenCalledWith("/v1/invites/redeem", {
      body: { token: "t", accept_terms_privacy: true },
    });
    expect(
      queryClient.getQueryData<LegalAcceptance>(legalAcceptanceQueryKey())
        ?.required,
    ).toBe(false);
  });

  it("leaves the status alone after a join without the box", async () => {
    queryClient.setQueryData(legalAcceptanceQueryKey(), {
      ...required,
      required: false,
    });
    const mockClient = {
      POST: vi.fn().mockResolvedValue({
        data: { chapterId: "ch-1", memberId: "m-1" },
        error: undefined,
      }),
    };

    const { result } = renderHook(() => useRedeemInvite(), {
      wrapper: createWrapper(queryClient, mockClient),
    });
    await result.current.mutateAsync({ token: "t" });

    expect(
      queryClient.getQueryData<LegalAcceptance>(legalAcceptanceQueryKey())
        ?.accepted_version,
    ).toBe("2026-03");
  });
});
