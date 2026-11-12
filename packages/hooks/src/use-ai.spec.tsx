/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import {
  aiAvailableFrom,
  aiConsentKey,
  useAiChapterSettings,
  useAiConsent,
  useAnswerAiConsent,
  useUpdateAiChapterSettings,
} from "./use-ai";
import { FrappClientProvider } from "./use-frapp-client";

const answered = (data: unknown) => ({
  data,
  error: undefined,
  response: { status: 200, ok: true },
});

const refusedWith = (error: { statusCode: number; code?: string }) => ({
  data: undefined,
  error,
  response: { status: error.statusCode, ok: false },
});

/** What a server with `AI_ENABLED` off answers on every AI route. */
const AI_OFF = refusedWith({ statusCode: 404, code: "ai.not_available" });

const STATE = {
  sheet: {
    version: 1,
    providers: [
      { key: "anthropic", name: "Anthropic" },
      { key: "google", name: "Google" },
    ],
    data: [{ key: "questions", label: "Questions you ask" }],
  },
  answer: null,
  answered_at: null,
  sheet_changed: false,
};

const SETTINGS = {
  ask: false,
  meeting_notes: true,
  chat_source: false,
  updated_at: "2026-11-12T03:00:00.000Z",
  can_change: true,
};

describe("the AI hooks", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  const wrapper = (client: unknown, chapterId: string | null = "chapter-1") => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={client as ReturnType<typeof createFrappClient>}
        chapterId={chapterId}
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "AiHookWrapper";
    return Wrapper;
  };

  it("reads a server with AI off as no AI, not as a failure", async () => {
    const GET = vi.fn().mockResolvedValue(AI_OFF);
    const { result } = renderHook(() => useAiConsent(), {
      wrapper: wrapper({ GET }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(aiAvailableFrom(result.current)).toBe(false);
  });

  it("says AI is available once the sheet comes back", async () => {
    const GET = vi.fn().mockResolvedValue(answered(STATE));
    const { result } = renderHook(() => useAiConsent(), {
      wrapper: wrapper({ GET }),
    });
    expect(aiAvailableFrom(result.current)).toBeUndefined();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(GET).toHaveBeenCalledWith("/v1/ai/consent");
    expect(aiAvailableFrom(result.current)).toBe(true);
  });

  it("still fails on any other refusal", async () => {
    const GET = vi
      .fn()
      .mockResolvedValue(refusedWith({ statusCode: 500, code: "internal" }));
    const { result } = renderHook(() => useAiConsent(), {
      wrapper: wrapper({ GET }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(aiAvailableFrom(result.current)).toBeUndefined();
  });

  it("writes the saved answer into the sheet's cache", async () => {
    const saved = {
      ...STATE,
      answer: "yes",
      answered_at: "2026-11-12T03:00:00.000Z",
    };
    const PUT = vi.fn().mockResolvedValue(answered(saved));
    const { result } = renderHook(() => useAnswerAiConsent(), {
      wrapper: wrapper({ PUT }),
    });
    await act(() =>
      result.current.mutateAsync({ sheet_version: 1, answer: "yes" }),
    );
    expect(PUT).toHaveBeenCalledWith("/v1/ai/consent", {
      body: { sheet_version: 1, answer: "yes" },
    });
    expect(queryClient.getQueryData(aiConsentKey)).toEqual(saved);
  });

  it("reads the sheet again when the answer was to an old version", async () => {
    queryClient.setQueryData(aiConsentKey, STATE);
    const PUT = vi
      .fn()
      .mockResolvedValue(
        refusedWith({ statusCode: 409, code: "ai.consent.stale_sheet" }),
      );
    const { result } = renderHook(() => useAnswerAiConsent(), {
      wrapper: wrapper({ PUT }),
    });
    await expect(
      act(() => result.current.mutateAsync({ sheet_version: 1, answer: "no" })),
    ).rejects.toMatchObject({ code: "ai.consent.stale_sheet" });
    expect(queryClient.getQueryState(aiConsentKey)?.isInvalidated).toBe(true);
  });

  it("reads the active chapter's switches, and nothing without a chapter", async () => {
    const GET = vi.fn().mockResolvedValue(answered(SETTINGS));
    const { result } = renderHook(() => useAiChapterSettings(), {
      wrapper: wrapper({ GET }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(SETTINGS);

    const idle = vi.fn();
    const { result: none } = renderHook(() => useAiChapterSettings(), {
      wrapper: wrapper({ GET: idle }, null),
    });
    expect(none.current.fetchStatus).toBe("idle");
    expect(idle).not.toHaveBeenCalled();
  });

  it("replaces the switches with what the server saved", async () => {
    const saved = { ...SETTINGS, ask: true };
    const PATCH = vi.fn().mockResolvedValue(answered(saved));
    const { result } = renderHook(
      () => ({
        update: useUpdateAiChapterSettings(),
        settings: useAiChapterSettings({ enabled: false }),
      }),
      { wrapper: wrapper({ PATCH }) },
    );
    await act(() => result.current.update.mutateAsync({ ask: true }));
    expect(PATCH).toHaveBeenCalledWith("/v1/ai/settings", {
      body: { ask: true },
    });
    await waitFor(() => expect(result.current.settings.data).toEqual(saved));
  });
});
