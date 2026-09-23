import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  JOIN_TERMS_REQUIRED_COPY,
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  TERMS_PROMPT_COPY,
} from "@repo/validation";
import {
  isTermsRequiredError,
  legalAcceptanceQueryKey,
  markLegalAcceptanceRecorded,
  termsPromptErrorCopy,
  useAcceptLegalTerms,
  useJoinTermsCheckbox,
  useLegalAcceptance,
  type LegalAcceptance,
} from "./legal-acceptance";
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

/**
 * What a refused join looks like on the wire today: `AllExceptionsFilter`
 * sends no `code` (#1020), so this is the shape the detection has to handle.
 */
const refusalAsServed = {
  statusCode: 403,
  error: "FORBIDDEN",
  message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  requestId: "req_1",
};

describe("isTermsRequiredError (#2302)", () => {
  it("recognises the refusal as the API serves it, without a code", () => {
    expect(isTermsRequiredError(refusalAsServed)).toBe(true);
  });

  it("still recognises it once codes reach clients (#1020)", () => {
    expect(isTermsRequiredError({ code: "legal.acceptance_required" })).toBe(
      true,
    );
  });

  it("does not read the subscription lock, also a 403, as a Terms refusal", () => {
    expect(
      isTermsRequiredError({
        statusCode: 403,
        message: "This chapter isn't accepting new members right now.",
      }),
    ).toBe(false);
  });

  it("does not read the same words on another status as a refusal", () => {
    expect(
      isTermsRequiredError({
        statusCode: 400,
        message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
      }),
    ).toBe(false);
  });
});

describe("termsPromptErrorCopy (#2302)", () => {
  it("names a deleted account, and otherwise says to retry", () => {
    expect(termsPromptErrorCopy({ statusCode: 410 })).toBe(
      TERMS_PROMPT_COPY.deleted,
    );
    expect(termsPromptErrorCopy({ statusCode: 500 })).toBe(
      TERMS_PROMPT_COPY.failed,
    );
  });
});

describe("useJoinTermsCheckbox (#2302)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const render = (required: boolean | "pending" | "error") => {
    const GET = vi.fn(() =>
      required === "pending"
        ? new Promise(() => {})
        : Promise.resolve(
            required === "error"
              ? { data: undefined, error: { statusCode: 500 } }
              : { data: { required }, error: undefined },
          ),
    );
    return renderHook(() => useJoinTermsCheckbox({ enabled: true }), {
      wrapper: createWrapper(queryClient, { GET }, null),
    });
  };

  it("doesn't ask a user the server says already accepted", async () => {
    const { result } = render(false);
    await waitFor(() => expect(result.current.needed).toBe(false));
    expect(result.current.blocker).toBeNull();
    expect(result.current.redeemBody("t")).toEqual({ token: "t" });
  });

  it("asks, and blocks the join until the box is ticked", async () => {
    const { result } = render(true);
    await waitFor(() => expect(result.current.needed).toBe(true));
    expect(result.current.blocker).toBe(JOIN_TERMS_REQUIRED_COPY);

    act(() => result.current.setAccepted(true));
    expect(result.current.blocker).toBeNull();
    expect(result.current.redeemBody("t")).toEqual({
      token: "t",
      accept_terms_privacy: true,
    });
  });

  it("asks while the status is loading or failed, rather than earn a refusal", async () => {
    expect(render("pending").result.current.needed).toBe(true);
    const failed = render("error");
    await waitFor(() => expect(failed.result.current.needed).toBe(true));
  });

  it("asks again, with the box cleared, when the server refuses a join", async () => {
    const { result } = render(false);
    await waitFor(() => expect(result.current.needed).toBe(false));

    act(() => result.current.onJoinError(refusalAsServed));

    expect(result.current.needed).toBe(true);
    expect(result.current.accepted).toBe(false);
  });

  it("ignores other failures", async () => {
    const { result } = render(false);
    await waitFor(() => expect(result.current.needed).toBe(false));

    act(() => result.current.onJoinError({ statusCode: 410 }));

    expect(result.current.needed).toBe(false);
  });
});
