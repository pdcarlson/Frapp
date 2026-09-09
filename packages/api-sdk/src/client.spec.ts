import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REQUEST_ID_HEADER,
  createFrappClient,
  mintRequestId,
} from "./client";

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
