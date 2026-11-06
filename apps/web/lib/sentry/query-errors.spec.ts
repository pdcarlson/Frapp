import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MutationObserver, onlineManager } from "@tanstack/react-query";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { makeQueryClient } from "@/lib/providers/query-provider";
import { isWebOnline } from "./query-errors";

/**
 * The web `QueryClient` reports failed queries and mutations to Sentry
 * (#3377). The rules themselves are specified beside the shared reporter
 * (`packages/observability/src/query-errors.spec.ts`); this file proves the
 * app's client is wired to it, with the provider's real defaults.
 */

const REQUEST_ID = "req_8d7c6b5a-4f3e-4d2c-8b1a-0f9e8d7c6b5a";

function apiBody(statusCode: number) {
  return {
    statusCode,
    error: "Error",
    message: "Jamie Rivera's note",
    requestId: REQUEST_ID,
  };
}

async function failQuery(
  client: ReturnType<typeof makeQueryClient>,
  queryKey: readonly unknown[],
  error: unknown,
  networkMode: "online" | "always" = "online",
) {
  await client
    .fetchQuery({
      queryKey,
      queryFn: () => Promise.reject(error),
      retry: false,
      networkMode,
    })
    .catch(() => undefined);
}

describe("web query-error reporting", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  it("reports a failed query once, however often it fails again", async () => {
    const client = makeQueryClient();
    await failQuery(client, ["members", "chapter-1"], apiBody(503));
    await failQuery(client, ["members", "chapter-1"], apiBody(503));

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, context] = captureException.mock.calls[0]!;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('query "members" answered 503');
    expect(context).toEqual({
      level: "warning",
      fingerprint: ["react-query", "query", "members", "5xx"],
      tags: expect.objectContaining({
        query_key_root: "members",
        request_id: REQUEST_ID,
        "http.status_code": "503",
      }),
    });
    expect(JSON.stringify(context)).not.toContain("chapter-1");
    expect(JSON.stringify(context)).not.toContain("Jamie");
  });

  it("does not report a 401", async () => {
    const client = makeQueryClient();
    await failQuery(client, ["user", "me"], apiBody(401));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not report a fetch that failed while the page reads offline", async () => {
    const client = makeQueryClient();

    // A page that mounted offline: onlineManager still reads online.
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await failQuery(client, ["tasks"], new TypeError("Failed to fetch"));
    vi.restoreAllMocks();

    // The window's offline event fired. Queries pause under "online", so the
    // spec forces the attempt, the way a mutation's "always" makes it.
    onlineManager.setOnline(false);
    await failQuery(client, ["polls"], new TypeError("Failed to fetch"), "always");

    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not report a query TanStack cancelled", async () => {
    // A cancel without a revert is the one that reaches the cache's onError;
    // the binding's isCancelledError is what keeps it out.
    const client = makeQueryClient();
    const pending = client
      .fetchQuery({
        queryKey: ["chapters"],
        queryFn: () => new Promise<never>(() => undefined),
        retry: false,
      })
      .catch((error: unknown) => error);
    await client.cancelQueries({ queryKey: ["chapters"] }, { revert: false });
    expect(await pending).toMatchObject({ message: "CancelledError" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("takes the query key out of TanStack's own errors", async () => {
    // A queryFn that resolves undefined makes TanStack throw
    // `<queryHash> data is undefined`, and the hash is the whole key.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeQueryClient();
    await client
      .fetchQuery({
        queryKey: ["search", "chapter-1", "jamie's lost jacket"],
        queryFn: () => Promise.resolve(undefined as unknown),
        retry: false,
      })
      .catch(() => undefined);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, context] = captureException.mock.calls[0]!;
    expect((error as Error).message).toBe("[query-key] data is undefined");
    expect((error as Error).stack).not.toContain("chapter-1");
    expect((error as Error).stack).not.toContain("jacket");
    expect(context).toMatchObject({
      fingerprint: ["{{ default }}", "react-query", "query", "search"],
    });
  });

  it("reports a failed mutation with no mutationKey under `unkeyed`", async () => {
    const client = makeQueryClient();
    const observer = new MutationObserver(client, {
      mutationFn: () => Promise.reject(apiBody(422)),
      retry: false,
    });
    await observer.mutate().catch(() => undefined);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]![1]).toMatchObject({
      level: "warning",
      fingerprint: ["react-query", "mutation", "unkeyed", "4xx"],
    });
  });

  it("gives each client its own rate limit", async () => {
    await failQuery(makeQueryClient(), ["events"], apiBody(500));
    await failQuery(makeQueryClient(), ["events"], apiBody(500));
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  describe("isWebOnline", () => {
    it("is offline when either reading says so", () => {
      expect(isWebOnline()).toBe(true);

      onlineManager.setOnline(false);
      expect(isWebOnline()).toBe(false);
      onlineManager.setOnline(true);

      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      expect(isWebOnline()).toBe(false);
    });
  });
});
