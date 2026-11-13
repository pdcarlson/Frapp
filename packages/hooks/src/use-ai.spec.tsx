/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import {
  aiAvailableFrom,
  aiConsentKey,
  chapterAiNeverSet,
  isFirstAiReadInFlight,
  shouldMeetFrappAi,
  useAiChapterSettings,
  useAiConsent,
  useAnswerAiConsent,
  useFrappAiChoice,
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

describe("Meet Frapp AI's answers (#4790)", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });
  const wrapper = (client: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={client as ReturnType<typeof createFrappClient>}
        chapterId="chapter-1"
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "MeetAiWrapper";
    return Wrapper;
  };
  const NEVER_SET = {
    ask: false,
    meeting_notes: false,
    chat_source: false,
    updated_at: null,
    can_change: true,
  };

  it("is put in front of a member only while they have never answered", () => {
    expect(shouldMeetFrappAi(STATE as never)).toBe(true);
    expect(shouldMeetFrappAi({ ...STATE, answer: "no" } as never)).toBe(false);
    expect(shouldMeetFrappAi({ ...STATE, answer: "yes" } as never)).toBe(false);
    expect(shouldMeetFrappAi(null)).toBe(false);
    expect(shouldMeetFrappAi(undefined)).toBe(false);
  });

  it("covers the chapter only for its president, and only before anyone set its switches", () => {
    expect(chapterAiNeverSet(NEVER_SET)).toBe(true);
    expect(chapterAiNeverSet({ ...NEVER_SET, can_change: false })).toBe(false);
    expect(chapterAiNeverSet(SETTINGS)).toBe(false);
    expect(
      chapterAiNeverSet({ ...NEVER_SET, updated_at: "2026-11-12T03:00:00Z" }),
    ).toBe(false);
    expect(chapterAiNeverSet(null)).toBe(false);
  });

  it("Continue records the yes and, for a new chapter's president, turns its switches on", async () => {
    const GET = vi.fn((path: string) =>
      Promise.resolve(answered(path === "/v1/ai/consent" ? STATE : NEVER_SET)),
    );
    const PUT = vi.fn().mockResolvedValue(answered({ ...STATE, answer: "yes" }));
    const PATCH = vi.fn().mockResolvedValue(answered({ ...NEVER_SET, ask: true }));
    const { result } = renderHook(() => useFrappAiChoice(), {
      wrapper: wrapper({ GET, PUT, PATCH }),
    });
    await waitFor(() => expect(result.current.forChapter).toBe(true));
    await act(async () => {
      await expect(result.current.turnOn()).resolves.toBe(true);
    });
    expect(PUT).toHaveBeenCalledWith("/v1/ai/consent", {
      body: { sheet_version: 1, answer: "yes" },
    });
    expect(PATCH).toHaveBeenCalledWith("/v1/ai/settings", {
      body: { ask: true, meeting_notes: true, chat_source: true },
    });
  });

  it("never touches a chapter's switches when told not to, or once someone set them", async () => {
    const GET = vi.fn((path: string) =>
      Promise.resolve(answered(path === "/v1/ai/consent" ? STATE : SETTINGS)),
    );
    const PUT = vi.fn().mockResolvedValue(answered({ ...STATE, answer: "yes" }));
    const PATCH = vi.fn();
    const { result } = renderHook(() => useFrappAiChoice(), {
      wrapper: wrapper({ GET, PUT, PATCH }),
    });
    await waitFor(() => expect(result.current.consent).toBeTruthy());
    await act(async () => {
      await result.current.turnOn();
    });
    expect(PUT).toHaveBeenCalledTimes(1);
    expect(PATCH).not.toHaveBeenCalled();

  });

  it("leaves a never-set chapter alone when told not to, and never reads it", async () => {
    const GET = vi.fn((path: string) =>
      Promise.resolve(answered(path === "/v1/ai/consent" ? STATE : NEVER_SET)),
    );
    const PUT = vi.fn().mockResolvedValue(answered({ ...STATE, answer: "yes" }));
    const PATCH = vi.fn();
    const { result } = renderHook(
      () => useFrappAiChoice({ includeChapter: false }),
      { wrapper: wrapper({ GET, PUT, PATCH }) },
    );
    await waitFor(() => expect(result.current.consent).toBeTruthy());
    expect(result.current.forChapter).toBe(false);
    expect(result.current.chapterSettled).toBe(true);
    await act(async () => {
      await expect(result.current.turnOn()).resolves.toBe(true);
    });
    expect(PATCH).not.toHaveBeenCalled();
    expect(GET).not.toHaveBeenCalledWith("/v1/ai/settings");
  });

  it("counts Continue as on once the yes is saved, even when the chapter's switches fail", async () => {
    const GET = vi.fn((path: string) =>
      Promise.resolve(answered(path === "/v1/ai/consent" ? STATE : NEVER_SET)),
    );
    const PUT = vi.fn().mockResolvedValue(answered({ ...STATE, answer: "yes" }));
    const PATCH = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useFrappAiChoice(), {
      wrapper: wrapper({ GET, PUT, PATCH }),
    });
    await waitFor(() => expect(result.current.forChapter).toBe(true));
    await act(async () => {
      await expect(result.current.turnOn()).resolves.toBe(true);
    });
    expect(PUT).toHaveBeenCalledTimes(1);
    expect(PATCH).toHaveBeenCalledTimes(1);
  });

  it("Not now records a No", async () => {
    const GET = vi.fn().mockResolvedValue(answered(STATE));
    const PUT = vi.fn().mockResolvedValue(answered({ ...STATE, answer: "no" }));
    const { result } = renderHook(() => useFrappAiChoice(), {
      wrapper: wrapper({ GET, PUT }),
    });
    await act(async () => {
      await result.current.notNow();
    });
    expect(PUT).toHaveBeenCalledWith("/v1/ai/consent", {
      body: { sheet_version: 1, answer: "no" },
    });
  });
});

describe("isFirstAiReadInFlight (#4504)", () => {
  const read = (failureCount: number, fetchStatus = "fetching" as const) => ({
    isPending: true,
    fetchStatus,
    failureCount,
  });

  it("holds only for the first attempt, not the retries after a failure", () => {
    expect(isFirstAiReadInFlight(read(0))).toBe(true);
    expect(isFirstAiReadInFlight(read(1))).toBe(false);
  });

  it("never holds for a paused read or one that has answered", () => {
    expect(
      isFirstAiReadInFlight({ ...read(0), fetchStatus: "paused" }),
    ).toBe(false);
    expect(isFirstAiReadInFlight({ ...read(0), isPending: false })).toBe(
      false,
    );
  });
});
