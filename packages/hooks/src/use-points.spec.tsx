/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
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
  response: { status: 201 },
});
/** A gateway 502: an HTML body that parses to a string carrying no status. */
const badGateway = () => ({
  data: undefined,
  error: "<html>502 Bad Gateway</html>",
  response: { status: 502 },
});
const refused = (statusCode: number) => ({
  data: undefined,
  error: { statusCode, message: "Refused", error: "Bad Request" },
  response: { status: statusCode },
});

describe("useAdjustPoints", () => {
  let queryClient: QueryClient;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // `retryDelay: 0` so the hook's own retry rule runs without real backoff.
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retryDelay: 0 } },
    });
    post = vi.fn();
  });

  function render() {
    const client = { POST: post } as unknown as ReturnType<
      typeof createFrappClient
    >;
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider client={client}>
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
});
