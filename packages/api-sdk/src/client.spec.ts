import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_VERSION_HEADER,
  TIME_ZONE_HEADER,
  REQUEST_ID_HEADER,
  REQUEST_TIMEOUT_MS,
  createFrappClient,
  isRequestTimeout,
  mintRequestId,
  withRequestIdInit,
} from "./client";
import { statusOf } from "./api-error";

function sentRequest(): Request {
  const [input, init] = vi.mocked(fetch).mock.calls[0] as [
    RequestInfo | URL,
    RequestInit | undefined,
  ];
  if (input instanceof Request) {
    return input;
  }
  return new Request(String(input), init);
}

describe("mintRequestId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mints a req_ prefixed uuid, not a sentry-trace value", () => {
    const id = mintRequestId();
    expect(id).toMatch(/^req_[0-9a-f-]{36}$/i);
    expect(id).not.toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}-/);
  });

  it("gives distinct ids to distinct calls", () => {
    expect(mintRequestId()).not.toBe(mintRequestId());
  });

  it("falls back to getRandomValues when randomUUID is missing", () => {
    const getRandomValues = vi.fn(<T extends ArrayBufferView>(array: T): T => {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7);
      return array;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    const id = mintRequestId();
    expect(id).toMatch(/^req_[0-9a-f-]{36}$/i);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it("still mints when crypto is absent (React Native today)", () => {
    vi.stubGlobal("crypto", undefined);
    const id = mintRequestId();
    expect(id).toMatch(/^req_[0-9a-f-]{36}$/i);
  });
});

describe("withRequestIdInit", () => {
  it("mints x-request-id when none was supplied", () => {
    const init = withRequestIdInit({ method: "GET" });
    const headers = new Headers(init.headers);
    expect(headers.get(REQUEST_ID_HEADER)).toMatch(/^req_[0-9a-f-]{36}$/i);
    expect(headers.get("sentry-trace")).toBeNull();
  });

  it("preserves a caller-supplied x-request-id", () => {
    const init = withRequestIdInit({
      headers: { [REQUEST_ID_HEADER]: "req_already" },
    });
    expect(new Headers(init.headers).get(REQUEST_ID_HEADER)).toBe(
      "req_already",
    );
  });
});

describe("createFrappClient request id", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetch() {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("attaches a minted x-request-id when the caller did not set one", async () => {
    stubFetch();
    const client = createFrappClient({ baseUrl: "http://api.test" });

    await client.GET("/health");

    const id = sentRequest().headers.get(REQUEST_ID_HEADER);
    expect(id).toMatch(/^req_[0-9a-f-]{36}$/i);
  });

  it("preserves a caller-supplied x-request-id", async () => {
    stubFetch();
    const client = createFrappClient({ baseUrl: "http://api.test" });

    await client.GET("/health", {
      headers: { [REQUEST_ID_HEADER]: "already-set" },
    });

    expect(sentRequest().headers.get(REQUEST_ID_HEADER)).toBe("already-set");
  });

  it("does not treat Authorization or x-chapter-id as the request id", async () => {
    stubFetch();
    const client = createFrappClient({
      baseUrl: "http://api.test",
      getAuthToken: () => "token-abc",
      getChapterId: () => "chapter-1",
    });

    await client.GET("/health");

    const headers = sentRequest().headers;
    expect(headers.get("Authorization")).toBe("Bearer token-abc");
    expect(headers.get("x-chapter-id")).toBe("chapter-1");
    expect(headers.get(REQUEST_ID_HEADER)).toMatch(/^req_[0-9a-f-]{36}$/i);
    expect(headers.get(REQUEST_ID_HEADER)).not.toBe("token-abc");
    expect(headers.get(REQUEST_ID_HEADER)).not.toBe("chapter-1");
  });
});

describe("createFrappClient client version", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  }

  it("sends the configured build on every request", async () => {
    stubFetch();
    const client = createFrappClient({
      baseUrl: "http://api.test",
      clientVersion: "ios/0.9.0+12",
    });

    await client.GET("/v1/client-policy");

    expect(sentRequest().headers.get(CLIENT_VERSION_HEADER)).toBe(
      "ios/0.9.0+12",
    );
  });

  it("sends no header when none is configured, as on web", async () => {
    stubFetch();
    const client = createFrappClient({ baseUrl: "http://api.test" });

    await client.GET("/v1/client-policy");

    expect(sentRequest().headers.has(CLIENT_VERSION_HEADER)).toBe(false);
  });

  it("sends the device's zone so pushes can name local times", async () => {
    stubFetch();
    const client = createFrappClient({
      baseUrl: "http://api.test",
      getTimeZone: () => "America/Chicago",
    });

    await client.GET("/v1/client-policy");

    expect(sentRequest().headers.get(TIME_ZONE_HEADER)).toBe("America/Chicago");
  });

  it("defaults the zone to the runtime's own", async () => {
    stubFetch();
    const client = createFrappClient({ baseUrl: "http://api.test" });

    await client.GET("/v1/client-policy");

    expect(sentRequest().headers.get(TIME_ZONE_HEADER)).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
});

describe("createFrappClient onUnauthorized", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubStatus(status: number) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status })),
    );
  }

  it("reports a 401 for a request that carried a token", async () => {
    stubStatus(401);
    const onUnauthorized = vi.fn();
    const client = createFrappClient({
      baseUrl: "http://api.test",
      getAuthToken: () => "token",
      onUnauthorized,
    });

    await client.GET("/v1/client-policy");

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not report a 401 for a request sent without a token", async () => {
    stubStatus(401);
    const onUnauthorized = vi.fn();
    const client = createFrappClient({
      baseUrl: "http://api.test",
      getAuthToken: () => null,
      onUnauthorized,
    });

    await client.GET("/v1/client-policy");

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("does not report a 403, which is a refusal, not a dead session", async () => {
    stubStatus(403);
    const onUnauthorized = vi.fn();
    const client = createFrappClient({
      baseUrl: "http://api.test",
      getAuthToken: () => "token",
      onUnauthorized,
    });

    await client.GET("/v1/client-policy");

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe("createFrappClient failed calls (#3394)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const answer = (response: Response) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

  it("gives an empty-bodied 502 (Content-Length: 0) an error carrying its status", async () => {
    answer(
      new Response(null, { status: 502, headers: { "Content-Length": "0" } }),
    );
    const client = createFrappClient({ baseUrl: "http://api.test" });

    const { error } = await client.POST("/v1/events", { body: {} as never });

    expect(error).toEqual({ statusCode: 502, message: undefined });
    expect(statusOf(error)).toBe(502);
  });

  it("gives an empty text body the same, so `if (error) throw error` throws", async () => {
    answer(new Response("", { status: 503 }));
    const client = createFrappClient({ baseUrl: "http://api.test" });

    const { error } = await client.GET("/v1/events");

    expect(error).toBeTruthy();
    expect(statusOf(error)).toBe(503);
  });

  it("keeps the API's own refusal as it was sent", async () => {
    const refusal = { statusCode: 403, message: "Forbidden", code: "x.y" };
    answer(
      new Response(JSON.stringify(refusal), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createFrappClient({ baseUrl: "http://api.test" });

    const { error } = await client.GET("/v1/events");

    expect(error).toEqual(refusal);
  });

  it("drops a gateway's HTML page but keeps its status", async () => {
    answer(new Response("<html>Bad Gateway</html>", { status: 502 }));
    const client = createFrappClient({ baseUrl: "http://api.test" });

    const { error } = await client.GET("/v1/events");

    expect(error).toEqual({ statusCode: 502, message: undefined });
  });

  it("still resolves a 204 with no body and no error", async () => {
    answer(new Response(null, { status: 204 }));
    const client = createFrappClient({ baseUrl: "http://api.test" });

    const result = await client.DELETE("/v1/events/{id}", {
      params: { path: { id: "e1" } },
    });

    expect(result.error).toBeUndefined();
    expect(result.response.status).toBe(204);
  });
});

describe("createFrappClient request timeout (#3433)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A `fetch` that never answers, and records the signal it was given. */
  const hang = () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise<Response>(() => undefined);
      }),
    );
    return signals;
  };

  it.each([
    [
      "a read",
      () => createFrappClient({ baseUrl: "http://api.test" }).GET("/v1/events"),
      REQUEST_TIMEOUT_MS.read,
    ],
    [
      "a write",
      () =>
        createFrappClient({ baseUrl: "http://api.test" }).POST("/v1/events", {
          body: {} as never,
        }),
      REQUEST_TIMEOUT_MS.write,
    ],
    [
      "a chat send",
      () =>
        createFrappClient({ baseUrl: "http://api.test" }).POST(
          "/v1/channels/{id}/messages",
          { params: { path: { id: "c1" } }, body: {} as never },
        ),
      REQUEST_TIMEOUT_MS.watched,
    ],
    [
      "a model call",
      () =>
        createFrappClient({ baseUrl: "http://api.test" }).POST(
          "/v1/ai/catch-up",
          {
            body: {} as never,
          },
        ),
      REQUEST_TIMEOUT_MS.model,
    ],
  ] as const)(
    "fails %s that never answers after its limit, and aborts it",
    async (_name, send, limit) => {
      vi.useFakeTimers();
      const signals = hang();

      const settled = expect(send()).rejects.toSatisfy(isRequestTimeout);
      await vi.advanceTimersByTimeAsync(limit - 1);
      expect(signals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await settled;
      expect(signals[0]?.aborted).toBe(true);
    },
  );

  it("fails with the wording errorCopy and the Sentry reporter read as a dead request", async () => {
    vi.useFakeTimers();
    hang();
    const client = createFrappClient({
      baseUrl: "http://api.test",
      requestTimeoutMs: 10,
    });

    const call = client.GET("/v1/events").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    const error = (await call) as Error;

    expect(error.name).toBe("TimeoutError");
    expect(error.message).toBe("Network request timed out");
  });

  it("aborts the request when the caller's signal does (a cancelled query)", async () => {
    const signals = hang();
    const client = createFrappClient({ baseUrl: "http://api.test" });
    const caller = new AbortController();

    void client.GET("/v1/events", { signal: caller.signal }).catch(() => {});
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]?.aborted).toBe(false);
    caller.abort();

    expect(signals[0]?.aborted).toBe(true);
  });

  it("clears its timer once the response arrives", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const client = createFrappClient({ baseUrl: "http://api.test" });

    const { data } = await client.GET("/v1/events");

    expect(data).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
