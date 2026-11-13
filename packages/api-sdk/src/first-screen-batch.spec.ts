import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrappClient, REQUEST_ID_HEADER } from "./client";
import {
  bootstrapSectionFor,
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
    expect(bootstrapSectionFor("GET", "/v1/notifications", { limit: 50 })).toBe(
      "notifications",
    );
    expect(
      bootstrapSectionFor("GET", "/v1/notifications", { limit: 20 }),
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

  it("is off unless the client asks for it", async () => {
    const fetchMock = stubFetch(() => json({}));
    const api = createFrappClient({ baseUrl: BASE });

    await Promise.all([api.GET("/v1/users/me"), api.GET("/v1/settings")]);

    expect(urlsOf(fetchMock).sort()).toEqual(["/v1/settings", "/v1/users/me"]);
  });
});
