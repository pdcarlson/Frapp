/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock("./use-frapp-client", () => ({ useFrappClient: () => client }));

import {
  ASK_DICTATION_TIMEOUT_MS,
  useCleanDictation,
} from "./use-ask-dictation";

const SAID = "um when is chapter thursday no friday";
const ok = (text: string) => ({
  data: { text },
  response: { ok: true, status: 200 },
});

/** A request that settles only when its signal aborts, as fetch does. */
function hanging() {
  client.POST.mockImplementation(
    (_path: string, init: { signal: AbortSignal }) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
}

beforeEach(() => {
  client.POST.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useCleanDictation", () => {
  it("resolves the cleaned words, sending the raw ones", async () => {
    client.POST.mockResolvedValue(ok("When is chapter Friday?"));
    const { result } = renderHook(() => useCleanDictation());
    await expect(result.current(SAID)).resolves.toBe("When is chapter Friday?");
    expect(client.POST).toHaveBeenCalledWith("/v1/ai/ask/dictation", {
      body: { text: SAID },
      signal: expect.any(AbortSignal),
    });
  });

  it("resolves null on a refusal or a server error", async () => {
    const { result } = renderHook(() => useCleanDictation());
    client.POST.mockResolvedValueOnce({
      error: { code: "ai.consent.required" },
      response: { ok: false, status: 403 },
    });
    await expect(result.current(SAID)).resolves.toBeNull();
    client.POST.mockResolvedValueOnce({
      error: {},
      response: { ok: false, status: 500 },
    });
    await expect(result.current(SAID)).resolves.toBeNull();
  });

  it("resolves null when the request throws", async () => {
    client.POST.mockRejectedValue(new TypeError("offline"));
    const { result } = renderHook(() => useCleanDictation());
    await expect(result.current(SAID)).resolves.toBeNull();
  });

  it("gives up after the timeout, aborting the request", async () => {
    vi.useFakeTimers();
    hanging();
    const { result } = renderHook(() => useCleanDictation());
    const cleaned = result.current(SAID);
    await vi.advanceTimersByTimeAsync(ASK_DICTATION_TIMEOUT_MS);
    await expect(cleaned).resolves.toBeNull();
    const [, init] = client.POST.mock.calls[0] as [
      string,
      { signal: AbortSignal },
    ];
    expect(init.signal.aborted).toBe(true);
  });

  it("resolves null when the caller aborts, before or during the request", async () => {
    const { result } = renderHook(() => useCleanDictation());
    const before = new AbortController();
    before.abort();
    await expect(
      result.current(SAID, { signal: before.signal }),
    ).resolves.toBeNull();
    expect(client.POST).not.toHaveBeenCalled();

    hanging();
    const during = new AbortController();
    const cleaned = result.current(SAID, { signal: during.signal });
    during.abort();
    await expect(cleaned).resolves.toBeNull();
  });

  it("resolves null even when the request ignores its signal", async () => {
    vi.useFakeTimers();
    client.POST.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useCleanDictation());
    const cleaned = result.current(SAID);
    await vi.advanceTimersByTimeAsync(ASK_DICTATION_TIMEOUT_MS);
    await expect(cleaned).resolves.toBeNull();
  });
});
