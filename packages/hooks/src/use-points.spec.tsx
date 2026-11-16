/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import { useAdjustPoints, type AdjustPointsBody } from "./use-points";
import { FrappClientProvider } from "./use-frapp-client";

/**
 * `useAdjustPoints`' idempotency key (#1906). The server dedupes a replayed
 * key into the original ledger row, so what these pin is which attempts share
 * a key: every retry of one adjustment does, and a second adjustment never
 * does.
 */

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const BODY: AdjustPointsBody = {
  target_user_id: "11111111-1111-4111-8111-111111111111",
  amount: 50,
  category: "MANUAL",
  reason: "Ran the philanthropy table",
};

const ok = () => ({
  data: { id: "txn-1" },
  error: undefined,
  response: { status: 201, ok: true },
});
/** A gateway 502: an HTML body that parses to a string carrying no status. */
const badGateway = () => ({
  data: undefined,
  error: "<html>502 Bad Gateway</html>",
  response: { status: 502, ok: false },
});
/** An edge's HTML refusal: a definitive 403 whose body carries no status. */
const edgeForbidden = () => ({
  data: undefined,
  error: "<html>403 Forbidden</html>",
  response: { status: 403, ok: false },
});
const refused = (statusCode: number) => ({
  data: undefined,
  error: { statusCode, message: "Refused", error: "Bad Request" },
  response: { status: statusCode, ok: false },
});
/**
 * openapi-fetch's shape for an empty error body: `undefined` when the response
 * says `Content-Length: 0`, `""` otherwise. Both falsy, so only `response.ok`
 * tells it from a success.
 */
const emptyBody = (status: number, error: undefined | "" = undefined) => ({
  data: undefined,
  error,
  response: { status, ok: false },
});

describe("useAdjustPoints", () => {
  let queryClient: QueryClient;
  let post: ReturnType<typeof vi.fn>;
  /** The active chapter the provider hands the hook; a test may switch it. */
  let activeChapter: string;

  beforeEach(() => {
    // `retryDelay: 0` so the hook's own retry rule runs without real backoff.
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retryDelay: 0 } },
    });
    post = vi.fn();
    activeChapter = "chapter-a";
  });

  function render() {
    const client = { POST: post } as unknown as ReturnType<
      typeof createFrappClient
    >;
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider client={client} chapterId={activeChapter}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "AdjustPointsWrapper";
    return renderHook(() => useAdjustPoints(), { wrapper: Wrapper });
  }

  /** The `client_message_id` of each POST, in call order. */
  function sentKeys(): string[] {
    return post.mock.calls.map(
      (call) => (call[1] as { body: { client_message_id: string } }).body
        .client_message_id,
    );
  }

  async function submit(
    result: ReturnType<typeof render>["result"],
    body: AdjustPointsBody = BODY,
  ) {
    await act(async () => {
      await result.current.mutateAsync(body).catch(() => undefined);
    });
  }

  it("sends the body with a UUID v4 client_message_id", async () => {
    post.mockResolvedValue(ok());
    const { result } = render();

    await submit(result);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/v1/points/adjust", {
      body: { ...BODY, client_message_id: expect.stringMatching(UUID_V4) },
    });
  });

  it("retries a lost response under the same key", async () => {
    post.mockResolvedValueOnce(badGateway()).mockResolvedValueOnce(ok());
    const { result } = render();

    await submit(result);

    expect(post).toHaveBeenCalledTimes(2);
    const [first, second] = sentKeys();
    expect(second).toBe(first);
  });

  it("retries a dropped connection under the same key", async () => {
    post
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok());
    const { result } = render();

    await submit(result);

    expect(post).toHaveBeenCalledTimes(2);
    expect(new Set(sentKeys()).size).toBe(1);
  });

  it("retries an intermediary's 408, which may follow a commit", async () => {
    post.mockResolvedValueOnce(refused(408)).mockResolvedValueOnce(ok());
    const { result } = render();

    await submit(result);

    expect(post).toHaveBeenCalledTimes(2);
    expect(new Set(sentKeys()).size).toBe(1);
  });

  it("stops after two automatic retries", async () => {
    post.mockResolvedValue(badGateway());
    const { result } = render();

    await submit(result);

    expect(post).toHaveBeenCalledTimes(3);
    expect(new Set(sentKeys()).size).toBe(1);
  });

  it("does not retry a definitive refusal", async () => {
    post.mockResolvedValue(refused(400));
    const { result } = render();

    await submit(result);

    expect(post).toHaveBeenCalledTimes(1);
  });

  it("reuses the key when the treasurer resubmits after a lost response", async () => {
    post.mockResolvedValue(badGateway());
    const { result } = render();

    await submit(result);
    const [lostKey] = sentKeys();
    expect(lostKey).toMatch(UUID_V4);
    post.mockReset();
    post.mockResolvedValue(ok());
    await submit(result);

    // The explicit retry replays the first attempt's key, so if that attempt
    // committed the server returns its row instead of granting again.
    expect(sentKeys()).toEqual([lostKey]);
  });

  it("mints a fresh key for a second deliberate grant", async () => {
    post.mockResolvedValue(ok());
    const { result } = render();

    await submit(result);
    await submit(result);

    expect(post).toHaveBeenCalledTimes(2);
    const [first, second] = sentKeys();
    expect(second).not.toBe(first);
  });

  it("mints a fresh key after a definitive refusal", async () => {
    // A 409 means the key itself was refused, so reusing it would fail forever.
    post.mockResolvedValueOnce(refused(409)).mockResolvedValueOnce(ok());
    const { result } = render();

    await submit(result);
    await submit(result);

    const [first, second] = sentKeys();
    expect(second).not.toBe(first);
  });

  it("mints a fresh key when the body changes after a failure", async () => {
    post.mockResolvedValue(badGateway());
    const { result } = render();

    await submit(result);
    await submit(result, { ...BODY, amount: 25 });

    const keys = sentKeys();
    expect(keys.slice(0, 3)).toEqual([keys[0], keys[0], keys[0]]);
    expect(keys[3]).not.toBe(keys[0]);
  });

  it.each([
    ["an empty body", emptyBody(504)],
    ["an empty text body", emptyBody(502, "")],
  ])("retries a lost response with %s under the same key", async (_l, lost) => {
    post.mockResolvedValueOnce(lost).mockResolvedValueOnce(ok());
    const { result } = render();

    await submit(result);

    expect(post).toHaveBeenCalledTimes(2);
    expect(new Set(sentKeys()).size).toBe(1);
  });

  it("reads an edge's status-less HTML 403 as a refusal, not a lost response", async () => {
    post.mockResolvedValueOnce(edgeForbidden()).mockResolvedValueOnce(ok());
    const { result } = render();

    await submit(result);
    await submit(result);

    // No retry of the refusal, and the next submit is a fresh adjustment.
    const [first, second] = sentKeys();
    expect(post).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it.each([
    ["member", { target_user_id: "22222222-2222-4222-8222-222222222222" }],
    ["category", { category: "FINE" as const }],
    ["reason", { reason: "Ran the philanthropy table, corrected" }],
  ])("mints a fresh key when the %s changes after a failure", async (_l, change) => {
    post.mockResolvedValue(badGateway());
    const { result } = render();

    await submit(result);
    await submit(result, { ...BODY, ...change });

    const keys = sentKeys();
    expect(keys[3]).not.toBe(keys[0]);
  });

  it("keeps the key when a retry is refused after an attempt that may have committed", async () => {
    // A throttler 429 or a guard 403 runs before the server's replay check, so
    // it says nothing about whether the first attempt landed.
    post.mockResolvedValueOnce(badGateway()).mockResolvedValue(refused(429));
    const { result } = render();

    await submit(result);
    const [uncertainKey] = sentKeys();
    expect(uncertainKey).toMatch(UUID_V4);
    post.mockReset();
    post.mockResolvedValue(ok());
    await submit(result);

    expect(sentKeys()).toEqual([uncertainKey]);
  });

  it("drops a key the server says was used for another adjustment", async () => {
    post.mockResolvedValueOnce(badGateway()).mockResolvedValueOnce(refused(409));
    const { result } = render();

    await submit(result);
    const [usedKey] = sentKeys();
    post.mockReset();
    post.mockResolvedValue(ok());
    await submit(result);

    expect(sentKeys()[0]).not.toBe(usedKey);
  });

  it("mints a fresh key after reset, which the dialog calls on open", async () => {
    post.mockResolvedValue(badGateway());
    const { result } = render();

    await submit(result);
    const [heldKey] = sentKeys();
    act(() => result.current.reset());
    post.mockReset();
    post.mockResolvedValue(ok());
    await submit(result);

    expect(sentKeys()[0]).not.toBe(heldKey);
  });

  it("refuses to retry once the active chapter has changed", async () => {
    let answerFirst!: (value: ReturnType<typeof badGateway>) => void;
    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
    );
    post.mockResolvedValue(ok());
    const { result, rerender } = render();

    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = result.current.mutateAsync(BODY).catch((error) => error);
    });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // Another tab switches the chapter while the first attempt is in flight.
    activeChapter = "chapter-b";
    rerender();
    await act(async () => {
      answerFirst(badGateway());
      await outcome;
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(await outcome).toMatchObject({
      name: "AdjustmentChapterChangedError",
    });
  });

  it("mints a fresh key when the chapter changes after a failure", async () => {
    post.mockResolvedValue(badGateway());
    const { result, rerender } = render();

    await submit(result);
    activeChapter = "chapter-b";
    rerender();
    await submit(result);

    const keys = sentKeys();
    expect(keys[3]).not.toBe(keys[0]);
  });

  it("keeps the key through a chapter-change refusal, for when the treasurer switches back", async () => {
    let answerFirst!: (value: ReturnType<typeof badGateway>) => void;
    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
    );
    const { result, rerender } = render();

    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = result.current.mutateAsync(BODY).catch((error) => error);
    });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [uncertainKey] = sentKeys();
    activeChapter = "chapter-b";
    rerender();
    await act(async () => {
      answerFirst(badGateway());
      await outcome;
    });

    // Back in chapter A, the same adjustment replays the key the first,
    // possibly committed, attempt used.
    activeChapter = "chapter-a";
    rerender();
    post.mockReset();
    post.mockResolvedValue(ok());
    await submit(result);

    expect(sentKeys()).toEqual([uncertainKey]);
  });

  it("reuses an in-flight adjustment's key if the same grant is submitted beside it", async () => {
    let answerFirst!: (value: ReturnType<typeof badGateway>) => void;
    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
    );
    post.mockResolvedValue(ok());
    const { result } = render();

    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = result.current.mutateAsync(BODY).catch(() => undefined);
    });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // The dialog reopens while the first adjustment is still pending, and the
    // treasurer enters the same grant again.
    act(() => result.current.reset());
    await submit(result);
    await act(async () => {
      answerFirst(badGateway());
      await outcome;
    });

    expect(new Set(sentKeys()).size).toBe(1);
  });
});
