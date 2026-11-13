/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import { ASK_POST_COPY, ASK_POST_REFUSALS } from "@repo/validation";
import { useAskPostFlow } from "./use-ask-post";
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

const TASKS = { key: "tool:my_tasks", kind: "tasks", title: "Your tasks" };
const MINUTES = { key: "meeting:m1", kind: "minutes", title: "Exec minutes" };

describe("useAskPostFlow", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
  });

  const flow = (
    POST: ReturnType<typeof vi.fn>,
    answer: { report_receipt?: string | null; read_chat?: boolean } = {
      report_receipt: "sealed",
    },
  ) => {
    const onPosted = vi.fn();
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={{ POST } as unknown as ReturnType<typeof createFrappClient>}
        chapterId="chapter-1"
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );
    const hook = renderHook(
      () => useAskPostFlow({ channelId: "channel-1", answer, onPosted }),
      { wrapper: Wrapper },
    );
    return { ...hook, onPosted };
  };

  it("checks first and writes nothing, then posts on confirm", async () => {
    const POST = vi
      .fn()
      .mockResolvedValueOnce(answered({ posted: false, restricted: [] }))
      .mockResolvedValueOnce(answered({ posted: true, restricted: [] }));
    const { result, onPosted } = flow(POST);
    expect(result.current.stage).toBe("idle");

    act(() => result.current.start());
    expect(result.current.stage).toBe("checking");
    await waitFor(() => expect(result.current.stage).toBe("confirm"));
    expect(POST).toHaveBeenLastCalledWith("/v1/ai/ask/posts", {
      body: {
        channel_id: "channel-1",
        receipt: "sealed",
        confirm: false,
        acknowledged: [],
      },
    });
    expect(result.current.restricted).toEqual([]);
    expect(onPosted).not.toHaveBeenCalled();

    act(() => result.current.confirm());
    expect(result.current.stage).toBe("posting");
    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1));
    expect(result.current.stage).toBe("idle");
    expect(POST).toHaveBeenLastCalledWith("/v1/ai/ask/posts", {
      body: expect.objectContaining({ confirm: true, acknowledged: [] }),
    });
  });

  it("shows what not everyone can open, and posts naming exactly that list", async () => {
    const POST = vi
      .fn()
      .mockResolvedValueOnce(answered({ posted: false, restricted: [TASKS] }))
      .mockResolvedValueOnce(answered({ posted: true, restricted: [TASKS] }));
    const { result, onPosted } = flow(POST);
    act(() => result.current.start());
    await waitFor(() => expect(result.current.stage).toBe("confirm"));
    expect(result.current.restricted).toEqual([TASKS]);
    expect(result.current.changed).toBe(false);

    act(() => result.current.confirm());
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
    expect(POST).toHaveBeenLastCalledWith("/v1/ai/ask/posts", {
      body: expect.objectContaining({
        confirm: true,
        acknowledged: ["tool:my_tasks"],
      }),
    });
  });

  it("shows the list again when it changed between the check and the post", async () => {
    const POST = vi
      .fn()
      .mockResolvedValueOnce(answered({ posted: false, restricted: [TASKS] }))
      .mockResolvedValueOnce(
        answered({ posted: false, restricted: [TASKS, MINUTES] }),
      );
    const { result, onPosted } = flow(POST);
    act(() => result.current.start());
    await waitFor(() => expect(result.current.stage).toBe("confirm"));
    act(() => result.current.confirm());
    await waitFor(() => expect(result.current.changed).toBe(true));
    expect(result.current.stage).toBe("confirm");
    expect(result.current.restricted).toEqual([TASKS, MINUTES]);
    expect(onPosted).not.toHaveBeenCalled();
  });

  it("says why an answer that read chat stays with its asker, without asking the server", () => {
    const POST = vi.fn();
    const { result } = flow(POST, {
      report_receipt: "sealed",
      read_chat: true,
    });
    act(() => result.current.start());
    expect(result.current.stage).toBe("idle");
    expect(result.current.error).toBe(
      ASK_POST_REFUSALS["ai.ask.post.read_chat"],
    );
    expect(POST).not.toHaveBeenCalled();
  });

  it("words a refusal by its code, and a failure in its own", async () => {
    const POST = vi
      .fn()
      .mockResolvedValueOnce(
        refusedWith({ statusCode: 400, code: "ai.ask.post.too_old" }),
      )
      .mockResolvedValueOnce(answered({ posted: false, restricted: [TASKS] }))
      .mockResolvedValueOnce(refusedWith({ statusCode: 500 }));
    const { result } = flow(POST);
    act(() => result.current.start());
    await waitFor(() =>
      expect(result.current.error).toBe(
        ASK_POST_REFUSALS["ai.ask.post.too_old"],
      ),
    );
    expect(result.current.stage).toBe("idle");

    // A post that fails keeps what the asker was reading.
    act(() => result.current.start());
    await waitFor(() => expect(result.current.stage).toBe("confirm"));
    act(() => result.current.confirm());
    await waitFor(() =>
      expect(result.current.error).toBe(ASK_POST_COPY.failed),
    );
    expect(result.current.stage).toBe("confirm");
    expect(result.current.restricted).toEqual([TASKS]);
  });

  it("drops a reply that lands after Cancel", async () => {
    let land: (value: unknown) => void = () => undefined;
    const POST = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    const { result } = flow(POST);
    act(() => result.current.start());
    act(() => result.current.cancel());
    expect(result.current.stage).toBe("idle");
    await act(async () => {
      land(answered({ posted: false, restricted: [TASKS] }));
      await Promise.resolve();
    });
    expect(result.current.stage).toBe("idle");
    expect(result.current.restricted).toEqual([]);
  });

  it("does nothing for an answer with no receipt", () => {
    const POST = vi.fn();
    const { result } = flow(POST, { report_receipt: null });
    act(() => result.current.start());
    expect(result.current.stage).toBe("idle");
    expect(POST).not.toHaveBeenCalled();
  });
});
