/**
 * `deno test` suite for the copy handler. No network: `fetch` is a fake that
 * plays both Discord's CDN and Supabase Storage, keyed on the URL it is given.
 */
import assert from "node:assert/strict";
import {
  type CopyResponse,
  handleCopyRequest,
  type HandlerDeps,
  isDiscordCdnHost,
  isSafeObjectPath,
  MAX_ITEMS,
  MAX_OBJECT_BYTES,
} from "./handler.ts";

const LEGACY_KEY = "eyJhbGciOiJIUzI1NiJ9.service-role.signature";
const SECRET_KEY = "sb_secret_example";
const SUPABASE_URL = "https://project.supabase.co";
const STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/`;
const PATH = "chapters/c1/chat-archive/imports/i1/media/ab12-111_photo.png";
const CDN_URL = "https://cdn.discordapp.com/attachments/1/111/photo.png?ex=1";

interface Call {
  url: string;
  init: RequestInit;
}

interface FakeOptions {
  /** CDN answer per URL; default 200 with a small body. */
  cdn?: (url: string, init: RequestInit) => Response | Promise<Response>;
  /** Storage answer per upload; default 200. */
  storage?: (url: string, init: RequestInit) => Response | Promise<Response>;
  env?: Record<string, string>;
  now?: () => number;
  limits?: HandlerDeps["limits"];
}

function harness(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const env: Record<string, string> = options.env ?? {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY,
  };
  const fakeFetch = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    if (url.startsWith(STORAGE_PREFIX)) {
      // Drain the body, as Storage would, so the CDN stream is consumed.
      if (init.body instanceof ReadableStream) {
        await new Response(init.body).arrayBuffer();
      }
      return options.storage?.(url, init) ??
        new Response('{"Key":"ok"}', { status: 200 });
    }
    return options.cdn?.(url, init) ??
      new Response("image-bytes", {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "11" },
      });
  };
  const deps: HandlerDeps = {
    fetch: fakeFetch as typeof fetch,
    now: options.now ?? (() => 0),
    env: (name) => env[name],
    limits: options.limits,
  };
  return { calls, deps };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    url: CDN_URL,
    bucket: "chat-archive",
    path: PATH,
    contentType: "image/png",
    declaredSize: 11,
    ...overrides,
  };
}

function post(
  body: unknown,
  headers: Record<string, string> = { apikey: LEGACY_KEY },
): Request {
  return new Request("https://project.supabase.co/functions/v1/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function results(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return ((await response.json()) as CopyResponse).results;
}

// ── the host pin ────────────────────────────────────────────────────────────

Deno.test("isDiscordCdnHost accepts Discord's hosts and nothing that merely contains them", () => {
  for (
    const host of [
      "cdn.discordapp.com",
      "media.discordapp.net",
      "images-ext-1.discordapp.net",
      "CDN.DISCORDAPP.COM",
      "anything.discordapp.net",
    ]
  ) {
    assert.equal(isDiscordCdnHost(host), true, host);
  }
  for (
    const host of [
      "cdn.discordapp.com.evil.com",
      "discordapp.com.evil.com",
      "evildiscordapp.com",
      "discord.com",
      "localhost",
      "169.254.169.254",
    ]
  ) {
    assert.equal(isDiscordCdnHost(host), false, host);
  }
});

Deno.test("isSafeObjectPath refuses anything a URL parser would resolve", () => {
  assert.equal(isSafeObjectPath(PATH), true);
  for (
    const path of [
      "",
      "a/../b",
      "a/./b",
      "a//b",
      "/a",
      "a/%2e%2e/b",
      "a/b\tc",
      "a\\b",
      "a/b?c",
      "a/b#c",
      "x".repeat(1025),
    ]
  ) {
    assert.equal(isSafeObjectPath(path), false, JSON.stringify(path));
  }
});

// ── the request's shape and credential ──────────────────────────────────────

Deno.test("anything but POST is refused", async () => {
  const { deps } = harness();
  const response = await handleCopyRequest(
    new Request("https://x/", { method: "GET" }),
    deps,
  );
  assert.equal(response.status, 405);
});

Deno.test("a request without the service credential is refused before its body is read", async () => {
  const { deps, calls } = harness();
  const refused: Record<string, string>[] = [
    {},
    { apikey: "wrong" },
    { authorization: "Bearer wrong" },
    { apikey: LEGACY_KEY.slice(0, -1) },
  ];
  for (const headers of refused) {
    const response = await handleCopyRequest(
      post({ items: [item()] }, headers),
      deps,
    );
    assert.equal(response.status, 401, JSON.stringify(headers));
  }
  assert.equal(calls.length, 0);
});

Deno.test("the legacy key is accepted on apikey or as a Bearer token", async () => {
  const accepted: Record<string, string>[] = [
    { apikey: LEGACY_KEY },
    { authorization: `Bearer ${LEGACY_KEY}` },
  ];
  for (const headers of accepted) {
    const { deps } = harness();
    const [result] = await results(
      await handleCopyRequest(post({ items: [item()] }, headers), deps),
    );
    assert.equal(result.status, "stored");
  }
});

Deno.test("a new secret key is accepted, and Storage gets it on apikey alone", async () => {
  const { deps, calls } = harness({
    env: {
      SUPABASE_URL,
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET_KEY }),
    },
  });
  const [result] = await results(
    await handleCopyRequest(
      post({ items: [item()] }, { apikey: SECRET_KEY }),
      deps,
    ),
  );
  assert.equal(result.status, "stored");
  const upload = calls.find((call) => call.url.startsWith(STORAGE_PREFIX))!;
  const headers = new Headers(upload.init.headers);
  assert.equal(headers.get("apikey"), SECRET_KEY);
  assert.equal(headers.get("authorization"), null);
});

Deno.test("a function without its Supabase config answers 500", async () => {
  const { deps } = harness({ env: { SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY } });
  const response = await handleCopyRequest(post({ items: [item()] }), deps);
  assert.equal(response.status, 500);
});

Deno.test("a malformed body is a 400", async () => {
  const { deps } = harness();
  for (
    const body of [
      "not json",
      {},
      { items: "x" },
      { items: [] },
      { items: [{ url: 1 }] },
      { items: Array.from({ length: MAX_ITEMS + 1 }, () => item()) },
    ]
  ) {
    const response = await handleCopyRequest(post(body), deps);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
  }
});

// ── refusals, before any transfer ───────────────────────────────────────────

Deno.test("an item outside the pin is rejected and never fetched", async () => {
  const { deps, calls } = harness();
  const refused = [
    item({ url: "http://cdn.discordapp.com/a.png" }),
    item({ url: "https://cdn.discordapp.com.evil.com/a.png" }),
    item({ url: "https://169.254.169.254/latest/meta-data" }),
    item({ url: "not a url" }),
    item({ bucket: "profiles" }),
    item({ path: "chapters/c1/../../profiles/x" }),
    item({ declaredSize: MAX_OBJECT_BYTES + 1 }),
  ];
  const all = await results(
    await handleCopyRequest(post({ items: refused }), deps),
  );
  assert.deepEqual(
    all.map((result) => result.status),
    refused.map(() => "rejected"),
  );
  assert.equal(calls.length, 0);
});

// ── the copy ────────────────────────────────────────────────────────────────

Deno.test("an attachment is streamed from the CDN into Storage, upserted", async () => {
  const { deps, calls } = harness();
  const [result] = await results(
    await handleCopyRequest(post({ items: [item()] }), deps),
  );
  assert.deepEqual(result, { path: PATH, status: "stored", bytes: 11 });

  const [cdn, upload] = calls;
  assert.equal(cdn.url, CDN_URL);
  assert.equal(cdn.init.redirect, "error");
  assert.equal(upload.url, `${STORAGE_PREFIX}chat-archive/${PATH}`);
  assert.equal(upload.init.method, "POST");
  assert.equal(upload.init.redirect, "error");
  assert.ok(upload.init.body instanceof ReadableStream);
  const headers = new Headers(upload.init.headers);
  assert.equal(headers.get("x-upsert"), "true");
  assert.equal(headers.get("content-type"), "image/png");
  assert.equal(headers.get("apikey"), LEGACY_KEY);
  assert.equal(headers.get("authorization"), `Bearer ${LEGACY_KEY}`);
});

Deno.test("with no declared type, the CDN's own Content-Type is stored", async () => {
  const { deps, calls } = harness();
  await results(
    await handleCopyRequest(
      post({ items: [item({ contentType: null })] }),
      deps,
    ),
  );
  const upload = calls.find((call) => call.url.startsWith(STORAGE_PREFIX))!;
  assert.equal(
    new Headers(upload.init.headers).get("content-type"),
    "image/png",
  );
});

Deno.test("a 404 from the CDN is gone; a 503 or 429 is a failure", async () => {
  for (
    const [status, expected] of [
      [404, "gone"],
      [403, "gone"],
      [503, "failed"],
      [
        429,
        "failed",
      ],
    ] as const
  ) {
    const { deps, calls } = harness({
      cdn: () => new Response("nope", { status }),
    });
    const [result] = await results(
      await handleCopyRequest(post({ items: [item()] }), deps),
    );
    assert.equal(result.status, expected, String(status));
    assert.equal(calls.length, 1, "nothing is uploaded");
  }
});

Deno.test("an object the CDN says is too large is rejected without uploading", async () => {
  const { deps, calls } = harness({
    cdn: () =>
      new Response("x", {
        status: 200,
        headers: { "content-length": String(MAX_OBJECT_BYTES + 1) },
      }),
  });
  const [result] = await results(
    await handleCopyRequest(post({ items: [item()] }), deps),
  );
  assert.equal(result.status, "rejected");
  assert.equal(calls.length, 1);
});

Deno.test("a CDN fetch that throws is a failure, not a crash", async () => {
  const { deps } = harness({
    cdn: () => {
      throw new TypeError("redirect was not allowed");
    },
  });
  const [result] = await results(
    await handleCopyRequest(post({ items: [item()] }), deps),
  );
  assert.equal(result.status, "failed");
  assert.match(result.reason ?? "", /redirect/);
});

Deno.test("Storage refusing one object fails that item only", async () => {
  let uploads = 0;
  const { deps } = harness({
    storage: () => {
      uploads += 1;
      return uploads === 1
        ? new Response('{"error":"boom"}', { status: 500 })
        : new Response("{}", { status: 200 });
    },
    limits: { concurrency: 1 },
  });
  const all = await results(
    await handleCopyRequest(
      post({ items: [item(), item({ path: `${PATH}-2` })] }),
      deps,
    ),
  );
  assert.deepEqual(all.map((result) => result.status), ["failed", "stored"]);
  assert.match(all[0].reason ?? "", /500/);
});

Deno.test("Storage refusing the function's own credential ends the request with a 502", async () => {
  const { deps } = harness({
    storage: () => new Response("unauthorized", { status: 403 }),
  });
  const response = await handleCopyRequest(
    post({ items: [item(), item({ path: `${PATH}-2` })] }),
    deps,
  );
  assert.equal(response.status, 502);
});

// ── the budget ──────────────────────────────────────────────────────────────

Deno.test("past the start budget, unstarted items come back deferred, but the first always runs", async () => {
  let clock = 0;
  const { deps } = harness({
    now: () => clock,
    // Every CDN answer takes the clock past the budget.
    cdn: () => {
      clock += 61_000;
      return new Response("bytes", { status: 200 });
    },
    limits: { concurrency: 1 },
  });
  const all = await results(
    await handleCopyRequest(
      post({
        items: [
          item(),
          item({ path: `${PATH}-2` }),
          item({ path: `${PATH}-3` }),
        ],
      }),
      deps,
    ),
  );
  assert.deepEqual(all.map((result) => result.status), [
    "stored",
    "deferred",
    "deferred",
  ]);
});

Deno.test("past the byte budget, unstarted items come back deferred", async () => {
  const { deps } = harness({
    cdn: () =>
      new Response("x", { status: 200, headers: { "content-length": "1" } }),
    limits: { concurrency: 1, startByteBudget: 1 },
  });
  const all = await results(
    await handleCopyRequest(
      post({ items: [item(), item({ path: `${PATH}-2` })] }),
      deps,
    ),
  );
  assert.deepEqual(all.map((result) => result.status), ["stored", "deferred"]);
});

Deno.test("the first concurrent wave is bounded by declared sizes", async () => {
  const { deps } = harness({ limits: { concurrency: 6, startByteBudget: 20 } });
  const all = await results(
    await handleCopyRequest(
      post({
        items: [1, 2, 3, 4].map((n) =>
          item({ path: `${PATH}-${n}`, declaredSize: 11 })
        ),
      }),
      deps,
    ),
  );
  assert.deepEqual(all.map((result) => result.status), [
    "stored",
    "stored",
    "deferred",
    "deferred",
  ]);
});

Deno.test("an image larger than Discord declared counts at its real size", async () => {
  // #2830: stored images run up to 12x `attachment.size`.
  const { deps } = harness({
    cdn: () =>
      new Response("x", { status: 200, headers: { "content-length": "1000" } }),
    limits: { concurrency: 1, startByteBudget: 500 },
  });
  const all = await results(
    await handleCopyRequest(
      post({
        items: [
          item({ declaredSize: 1 }),
          item({ path: `${PATH}-2`, declaredSize: 1 }),
        ],
      }),
      deps,
    ),
  );
  assert.deepEqual(all.map((result) => result.status), ["stored", "deferred"]);
});

Deno.test("a transfer still running at the hard deadline is aborted and reported failed", async () => {
  const { deps } = harness({
    cdn: (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
        );
      }),
    limits: { hardDeadlineMs: 20 },
  });
  const [result] = await results(
    await handleCopyRequest(post({ items: [item()] }), deps),
  );
  assert.equal(result.status, "failed");
  assert.match(result.reason ?? "", /Timed out/);
});
