import { afterEach, describe, expect, it, vi } from "vitest";
import { INBOX_FIRST_PAGE_SIZE } from "@repo/validation";
import { createFrappClient, REQUEST_ID_HEADER } from "./client";
import {
  bootstrapSectionFor,
  FIRST_SCREEN_BATCH_TIMEOUT_MS,
  FIRST_SCREEN_COMPANION_TTL_MS,
} from "./first-screen-batch";

const BASE = "https://api.test";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch that answers the bootstrap from `sections` and any route by echoing its path. */
function stubFetch(
  bootstrap: (include: string[]) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === "/v1/bootstrap") {
        return bootstrap(url.searchParams.get("include")?.split(",") ?? []);
      }
      return json({ route: url.pathname });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function urlsOf(fetchMock: ReturnType<typeof stubFetch>): string[] {
  return fetchMock.mock.calls.map(([input, init]) => {
    const request =
      input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    return `${url.pathname}${url.search}`;
  });
}

function client(overrides: { token?: string; chapter?: string } = {}) {
  return createFrappClient({
    baseUrl: BASE,
    getAuthToken: () => overrides.token ?? "token-1",
    getChapterId: () => overrides.chapter ?? "chapter-1",
    batchFirstScreenReads: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bootstrapSectionFor", () => {
  it("names the section a covered read stands for", () => {
    expect(bootstrapSectionFor("GET", "/v1/channels/unread", undefined)).toBe(
      "channel_unread",
    );
    expect(bootstrapSectionFor("GET", "/v1/users/me", {})).toBe("user");
  });

  it("leaves writes, other routes and parameterised reads alone", () => {
    expect(bootstrapSectionFor("POST", "/v1/channels", undefined)).toBeNull();
    expect(
      bootstrapSectionFor("GET", "/v1/channels/{id}", undefined),
    ).toBeNull();
    expect(
      bootstrapSectionFor("GET", "/v1/channels", { archived: true }),
    ).toBeNull();
  });

  it("answers the inbox only at the page the bootstrap reads", () => {
    // One definition in `@repo/validation`, which the API's bootstrap reads
    // and `useNotifications` asks for by default (#4962).
    expect(
      bootstrapSectionFor("GET", "/v1/notifications", {
        limit: INBOX_FIRST_PAGE_SIZE,
      }),
    ).toBe("notifications");
    expect(
      bootstrapSectionFor("GET", "/v1/notifications", {
        limit: INBOX_FIRST_PAGE_SIZE - 1,
      }),
    ).toBeNull();
    expect(
      bootstrapSectionFor("GET", "/v1/notifications", undefined),
    ).toBeNull();
  });
});

describe("first-screen batching", () => {
  it("answers reads fired together from one bootstrap call", async () => {
    const fetchMock = stubFetch((include) =>
      json(
        Object.fromEntries(include.map((section) => [section, { section }])),
      ),
    );
    const api = client();

    const [unread, me, roster] = await Promise.all([
      api.GET("/v1/channels/unread"),
      api.GET("/v1/users/me"),
      api.GET("/v1/members/roster"),
    ]);

    expect(urlsOf(fetchMock)).toEqual([
      "/v1/bootstrap?include=channel_unread,user,member_roster,whats_new",
    ]);
    expect(unread.data).toEqual({ section: "channel_unread" });
    expect(me.data).toEqual({ section: "user" });
    expect(roster.data).toEqual({ section: "member_roster" });
  });

  it("sends the bootstrap with the reads' own credentials and a fresh request id", async () => {
    const fetchMock = stubFetch(() => json({ user: {}, settings: {} }));
    const api = client({ token: "token-9", chapter: "chapter-9" });

    await Promise.all([api.GET("/v1/users/me"), api.GET("/v1/settings")]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer token-9");
    expect(headers.get("x-chapter-id")).toBe("chapter-9");
    expect(headers.get(REQUEST_ID_HEADER)).toMatch(/^req_/);
  });

  it("sends a lone read on its own route", async () => {
    const fetchMock = stubFetch(() => json({}));
    const api = client();

    const { data } = await api.GET("/v1/channels/unread");

    expect(urlsOf(fetchMock)).toEqual(["/v1/channels/unread"]);
    expect(data).toEqual({ route: "/v1/channels/unread" });
  });

  it("sends a read the bootstrap doesn't cover straight away, outside the batch", async () => {
    const fetchMock = stubFetch(() => json({ user: {}, settings: {} }));
    const api = client();

    await Promise.all([
      api.GET("/v1/users/me"),
      api.GET("/v1/settings"),
      api.GET("/v1/channels/{id}", { params: { path: { id: "c-1" } } }),
    ]);

    expect(urlsOf(fetchMock)).toEqual([
      "/v1/channels/c-1",
      "/v1/bootstrap?include=user,settings,whats_new",
    ]);
  });

  it("reads a section that came back null on its own route", async () => {
    const fetchMock = stubFetch(() =>
      json({ user: { id: "u" }, settings: null }),
    );
    const api = client();

    const [me, settings] = await Promise.all([
      api.GET("/v1/users/me"),
      api.GET("/v1/settings"),
    ]);

    expect(me.data).toEqual({ id: "u" });
    expect(settings.data).toEqual({ route: "/v1/settings" });
    expect(urlsOf(fetchMock)).toEqual([
      "/v1/bootstrap?include=user,settings,whats_new",
      "/v1/settings",
    ]);
  });

  it("falls back to every read's own route when the bootstrap is refused", async () => {
    const fetchMock = stubFetch(() => json({ statusCode: 403 }, 403));
    const api = client();

    const [me, settings] = await Promise.all([
      api.GET("/v1/users/me"),
      api.GET("/v1/settings"),
    ]);

    expect(me.data).toEqual({ route: "/v1/users/me" });
    expect(settings.data).toEqual({ route: "/v1/settings" });
    expect(urlsOf(fetchMock).slice(1).sort()).toEqual([
      "/v1/settings",
      "/v1/users/me",
    ]);
  });

  it("falls back when the bootstrap call fails on the network", async () => {
    stubFetch(() => {
      throw new TypeError("Network request failed");
    });
    const api = client();

    const [me] = await Promise.all([
      api.GET("/v1/users/me"),
      api.GET("/v1/settings"),
    ]);

    expect(me.data).toEqual({ route: "/v1/users/me" });
  });

  it("never answers one chapter's read from another chapter's batch", async () => {
    const fetchMock = stubFetch(() => json({ user: {}, settings: {} }));
    const first = client({ chapter: "chapter-1" });
    const second = client({ chapter: "chapter-2" });

    await Promise.all([first.GET("/v1/users/me"), second.GET("/v1/settings")]);

    // One read per chapter: neither batch reaches two sections.
    expect(urlsOf(fetchMock).sort()).toEqual(["/v1/settings", "/v1/users/me"]);
  });

  it("lets a user read sent before the chapter is known join the chapter's batch", async () => {
    const fetchMock = stubFetch((include) =>
      json(Object.fromEntries(include.map((section) => [section, {}]))),
    );
    // Web builds a client per active chapter; the first exists before the
    // persisted chapter loads, and its reads name none.
    const early = createFrappClient({
      baseUrl: BASE,
      getAuthToken: () => "token-1",
      batchFirstScreenReads: true,
    });
    const api = client({ chapter: "chapter-1" });

    await Promise.all([
      early.GET("/v1/users/me"),
      early.GET("/v1/chapters"),
      api.GET("/v1/channels"),
      api.GET("/v1/channels/unread"),
    ]);

    expect(urlsOf(fetchMock)).toEqual([
      "/v1/bootstrap?include=user,chapters,channels,channel_unread,whats_new",
    ]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-chapter-id")).toBe("chapter-1");
  });

  it("keeps a chapter read that names no chapter out of another chapter's batch", async () => {
    const fetchMock = stubFetch((include) =>
      json(Object.fromEntries(include.map((section) => [section, {}]))),
    );
    const early = createFrappClient({
      baseUrl: BASE,
      getAuthToken: () => "token-1",
      batchFirstScreenReads: true,
    });
    const api = client({ chapter: "chapter-1" });

    await Promise.all([
      api.GET("/v1/users/me"),
      api.GET("/v1/settings"),
      early.GET("/v1/channels"),
    ]);

    expect(urlsOf(fetchMock).sort()).toEqual([
      "/v1/bootstrap?include=user,settings,whats_new",
      "/v1/channels",
    ]);
  });

  it("never batches one session's reads with another's", async () => {
    const fetchMock = stubFetch(() => json({}));
    const first = client({ token: "token-1" });
    const second = client({ token: "token-2" });

    await Promise.all([first.GET("/v1/users/me"), second.GET("/v1/settings")]);

    expect(urlsOf(fetchMock).sort()).toEqual(["/v1/settings", "/v1/users/me"]);
  });

  it("fetches the reads that follow and answers each one's first read from them", async () => {
    const fetchMock = stubFetch((include) =>
      json(
        Object.fromEntries(include.map((section) => [section, { section }])),
      ),
    );
    const api = client({ token: "token-companion" });

    await Promise.all([
      api.GET("/v1/users/me/permissions"),
      api.GET("/v1/channels"),
    ]);
    // The nav asks once permissions have answered; the batch already has it.
    const documents = await api.GET("/v1/documents");
    // A second read of it is a refetch, and goes out on its own route.
    const again = await api.GET("/v1/documents");

    expect(urlsOf(fetchMock)).toEqual([
      "/v1/bootstrap?include=permissions,channels,geofences,documents",
      "/v1/documents",
    ]);
    expect(documents.data).toEqual({ section: "documents" });
    expect(again.data).toEqual({ route: "/v1/documents" });
  });

  it("lets a held answer lapse", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const fetchMock = stubFetch((include) =>
        json(Object.fromEntries(include.map((section) => [section, {}]))),
      );
      const api = client({ token: "token-lapse" });

      await Promise.all([api.GET("/v1/users/me"), api.GET("/v1/settings")]);
      vi.setSystemTime(Date.now() + FIRST_SCREEN_COMPANION_TTL_MS + 1);
      await api.GET("/v1/users/me/whats-new");

      expect(urlsOf(fetchMock)).toEqual([
        "/v1/bootstrap?include=user,settings,whats_new",
        "/v1/users/me/whats-new",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("batches a read whose query names only undefined values, as the documents list sends", async () => {
    const fetchMock = stubFetch((include) =>
      json(Object.fromEntries(include.map((section) => [section, []]))),
    );
    const api = client({ token: "token-undefined-query" });

    await Promise.all([
      api.GET("/v1/documents", {
        params: { query: { folder: undefined, search: undefined } },
      }),
      api.GET("/v1/channels"),
    ]);

    expect(urlsOf(fetchMock)).toEqual([
      "/v1/bootstrap?include=documents,channels",
    ]);
  });

  it("holds no companion that came back null, so its read goes to its route", async () => {
    stubFetch(() =>
      json({ permissions: { permissions: [] }, channels: [], documents: null }),
    );
    const api = client({ token: "token-null-companion" });

    await Promise.all([
      api.GET("/v1/users/me/permissions"),
      api.GET("/v1/channels"),
    ]);
    const documents = await api.GET("/v1/documents");

    expect(documents.data).toEqual({ route: "/v1/documents" });
  });

  it("lets a chapter read take over only a batch of user reads", async () => {
    const fetchMock = stubFetch((include) =>
      json(Object.fromEntries(include.map((section) => [section, {}]))),
    );
    const early = createFrappClient({
      baseUrl: BASE,
      getAuthToken: () => "token-takeover",
      batchFirstScreenReads: true,
    });
    const api = client({ token: "token-takeover", chapter: "chapter-1" });

    // A chapter read with no chapter header is answered for whatever chapter
    // its own route resolves; a chapter-1 batch must not answer it.
    await Promise.all([
      early.GET("/v1/channels"),
      early.GET("/v1/users/me"),
      api.GET("/v1/channels/unread"),
      api.GET("/v1/settings"),
    ]);

    expect(urlsOf(fetchMock).sort()).toEqual([
      "/v1/bootstrap?include=channel_unread,settings",
      "/v1/channels",
      "/v1/users/me",
    ]);
  });

  it("never sends a batch with no chapter, which the bootstrap would refuse", async () => {
    // A member with no chapter yet (onboarding) reads only user sections.
    const fetchMock = stubFetch(() => json({}));
    const api = createFrappClient({
      baseUrl: BASE,
      getAuthToken: () => "token-no-chapter",
      batchFirstScreenReads: true,
    });

    await Promise.all([
      api.GET("/v1/users/me"),
      api.GET("/v1/chapters"),
      api.GET("/v1/settings"),
    ]);

    expect(urlsOf(fetchMock).sort()).toEqual([
      "/v1/chapters",
      "/v1/settings",
      "/v1/users/me",
    ]);
  });

  it("drops a session's held answers when it writes", async () => {
    const fetchMock = stubFetch((include) =>
      json(Object.fromEntries(include.map((section) => [section, []]))),
    );
    const api = client({ token: "token-write" });

    await Promise.all([
      api.GET("/v1/users/me/permissions"),
      api.GET("/v1/channels"),
    ]);
    // An upload, then the list's invalidation re-reads it: from the route.
    await api.POST("/v1/documents/upload-url", {
      body: { file_name: "a.pdf", content_type: "application/pdf" },
    } as never);
    await api.GET("/v1/documents");

    expect(urlsOf(fetchMock).at(-1)).toBe("/v1/documents");
  });

  it("sends the reads on their routes when the bootstrap stalls", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const request =
            input instanceof Request ? input : new Request(String(input), init);
          const url = new URL(request.url);
          if (url.pathname === "/v1/bootstrap") {
            // Never answers; only the abort ends it.
            return new Promise<Response>((_, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            });
          }
          return Promise.resolve(json({ route: url.pathname }));
        },
      );
      vi.stubGlobal("fetch", fetchMock);
      const api = client({ token: "token-stall" });

      const reads = Promise.all([
        api.GET("/v1/users/me"),
        api.GET("/v1/settings"),
      ]);
      await vi.advanceTimersByTimeAsync(FIRST_SCREEN_BATCH_TIMEOUT_MS + 50);
      const [me] = await reads;

      expect(me.data).toEqual({ route: "/v1/users/me" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is off unless the client asks for it", async () => {
    const fetchMock = stubFetch(() => json({}));
    const api = createFrappClient({ baseUrl: BASE });

    await Promise.all([api.GET("/v1/users/me"), api.GET("/v1/settings")]);

    expect(urlsOf(fetchMock).sort()).toEqual(["/v1/settings", "/v1/users/me"]);
  });
});
