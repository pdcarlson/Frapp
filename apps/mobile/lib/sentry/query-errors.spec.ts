import * as Sentry from "@sentry/react-native";
import { MutationObserver, onlineManager, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_POLICY_QUERY_KEY, clientPolicyQueryClient } from "../client-policy";
import { queryClient } from "../query-client";

/**
 * Both mobile `QueryClient`s report failed queries to Sentry (#3377). The
 * rules are specified beside the shared reporter
 * (`packages/observability/src/query-errors.spec.ts`); this file proves the
 * app's clients are wired to it, with their real defaults. `@sentry/react-native`
 * is mocked globally (`vitest.setup.ts`).
 */

const captureException = vi.mocked(Sentry.captureException);
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
  client: QueryClient,
  queryKey: readonly unknown[],
  error: unknown,
) {
  await client
    .fetchQuery({ queryKey, queryFn: () => Promise.reject(error), retry: false })
    .catch(() => undefined);
}

describe("mobile query-error reporting", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    queryClient.clear();
    clientPolicyQueryClient.clear();
  });

  it("reports a client-contract 4xx at error level and a 404 at warning (#4096)", async () => {
    await failQuery(queryClient, ["channel-notification-preferences", "c-1"], {
      ...apiBody(400),
      code: "chapter.context.required",
    });
    await failQuery(queryClient, ["event-details", "c-1"], apiBody(404));

    expect(captureException).toHaveBeenCalledTimes(2);
    const [contractError, contract] = captureException.mock.calls[0]!;
    expect((contractError as Error).name).toBe("ClientContractError");
    expect(contract).toEqual({
      level: "error",
      fingerprint: [
        "react-query",
        "query",
        "channel-notification-preferences",
        "4xx",
        "chapter.context.required",
        "client-contract",
      ],
      tags: expect.objectContaining({ api_error_class: "client-contract" }),
    });
    expect(captureException.mock.calls[1]![1]).toMatchObject({
      level: "warning",
      fingerprint: ["react-query", "query", "event-details", "4xx"],
    });
  });

  it("reports a failed product query once, however often it fails again", async () => {
    await failQuery(queryClient, ["members", "chapter-1"], apiBody(503));
    await failQuery(queryClient, ["members", "chapter-1"], apiBody(503));

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, context] = captureException.mock.calls[0]!;
    expect((error as Error).message).toBe('query "members" answered 503');
    expect(context).toEqual({
      level: "warning",
      fingerprint: ["react-query", "query", "members", "5xx"],
      tags: expect.objectContaining({ request_id: REQUEST_ID }),
    });
    expect(JSON.stringify(context)).not.toContain("chapter-1");
    expect(JSON.stringify(context)).not.toContain("Jamie");
  });

  it("does not report a 401", async () => {
    await failQuery(queryClient, ["user", "me"], apiBody(401));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not report a fetch that failed while offline", async () => {
    // offlineFirst attempts the request once even offline, so it does fail.
    onlineManager.setOnline(false);
    await failQuery(queryClient, ["tasks"], new TypeError("Network request failed"));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports a fetch that got no response while online", async () => {
    await failQuery(queryClient, ["polls"], new TypeError("Network request timed out"));
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]![1]).toMatchObject({
      fingerprint: ["react-query", "query", "network"],
    });
  });

  it("reports expo/fetch's dropped connection as a network failure (#3746)", async () => {
    // expo/fetch's FetchError keeps the name Error and prefixes the native
    // message with "fetch failed: ". The client-policy client, because the
    // product client already spent its one network report on the test above
    // (one per kind per 10 minutes, whatever the root).
    await failQuery(
      clientPolicyQueryClient,
      CLIENT_POLICY_QUERY_KEY,
      new Error(
        "fetch failed: UnexpectedException: The network connection was lost. (at ExpoModulesCore/Promise.swift:56)",
      ),
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]![1]).toMatchObject({
      fingerprint: ["react-query", "query", "network"],
      tags: expect.objectContaining({
        query_failure: "network",
        query_key_root: "client-policy",
      }),
    });
  });

  it("does not report expo/fetch's already-aborted rejection", async () => {
    await failQuery(
      queryClient,
      ["tasks"],
      new Error("fetch failed: The operation was aborted."),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not report a query TanStack cancelled", async () => {
    // A cancel without a revert is the one that reaches the cache's onError;
    // the binding's isCancelledError is what keeps it out.
    const client = queryClient;
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
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await queryClient
      .fetchQuery({
        queryKey: ["search", "chapter-1", "jamie's lost jacket"],
        queryFn: () => Promise.resolve(undefined as unknown),
        retry: false,
      })
      .catch(() => undefined);
    quiet.mockRestore();

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, context] = captureException.mock.calls[0]!;
    expect((error as Error).message).toBe("[query-key] data is undefined");
    expect((error as Error).stack).not.toContain("chapter-1");
    expect((error as Error).stack).not.toContain("jacket");
    expect(context).toMatchObject({
      fingerprint: ["{{ default }}", "react-query", "query", "search"],
    });
  });

  it("reports a failed mutation", async () => {
    const observer = new MutationObserver(queryClient, {
      mutationFn: () => Promise.reject(apiBody(500)),
    });
    await observer.mutate().catch(() => undefined);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]![1]).toMatchObject({
      fingerprint: ["react-query", "mutation", "unkeyed", "5xx"],
    });
  });

  it("wires the client-policy client too", async () => {
    await failQuery(
      clientPolicyQueryClient,
      CLIENT_POLICY_QUERY_KEY,
      { statusCode: 502 },
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]![1]).toMatchObject({
      level: "warning",
      fingerprint: ["react-query", "query", "client-policy", "5xx"],
    });
  });
});
