import { renderHook, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  TERMS_PROMPT_COPY,
} from "@repo/validation";
import {
  isTermsRequiredError,
  legalAcceptanceQueryKey,
  markLegalAcceptanceRecorded,
  termsPromptErrorCopy,
  useAcceptLegalTerms,
  joinRedeemBody,
  useLegalAcceptance,
  type LegalAcceptance,
} from "./legal-acceptance";
import { useRedeemInvite } from "./use-invites";
import { createHookWrapper, createTestQueryClient } from "./test-utils";

const createWrapper = (
  queryClient: QueryClient,
  mockClient: unknown,
  chapterId: string | null = "test-chapter",
) =>
  createHookWrapper({
    client: mockClient,
    queryClient,
    chapterId,
    displayName: "Wrapper",
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
    queryClient = createTestQueryClient();
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
      { signal: expect.any(AbortSignal) },
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

    expect(queryClient.getQueryData(legalAcceptanceQueryKey())).toBeUndefined();
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
 * A refused join without its `code`, as the API sent it until #1020. Installed
 * builds and a not-yet-deployed API still depend on the message fallback.
 */
const refusalWithoutCode = {
  statusCode: 403,
  error: "FORBIDDEN",
  message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  requestId: "req_1",
};

describe("isTermsRequiredError (#2302)", () => {
  it("recognises a code-less refusal by its message", () => {
    expect(isTermsRequiredError(refusalWithoutCode)).toBe(true);
  });

  it("recognises the refusal by its code, as the API serves it since #1020", () => {
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

describe("joinRedeemBody (#5625)", () => {
  it("always carries the acceptance the Terms line stands for", () => {
    expect(joinRedeemBody("t")).toEqual({
      token: "t",
      accept_terms_privacy: true,
    });
  });
});
