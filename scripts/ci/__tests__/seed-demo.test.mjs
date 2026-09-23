import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTH_MARKER_KEY,
  LOCAL_DEMO_EMAIL,
  LOCAL_DEMO_PASSWORD,
  REVIEWER_NAMESPACE,
  TEMPLATE_NAMESPACE,
  TEMPLATE_PATH,
  assertDemoObjectPath,
  assertPasswordAllowed,
  assertProductionAllowed,
  demoIds,
  ensureAuthUser,
  main,
  parseArgs,
  placeholderPdf,
  removeAuthUser,
  removePlaceholders,
  renderRemoveSql,
  renderSeedSql,
  STORAGE_LIST_PAGE,
  uploadPlaceholders,
  validateEmail,
  validateNamespace,
  verifyLogin,
} from "../../demo/seed-demo.mjs";

const TEMPLATE = readFileSync(TEMPLATE_PATH, "utf8");
const HOSTED = "https://stagingrefaaaaaaa.supabase.co";
const LOCAL = "http://127.0.0.1:54321";
const KEY = "service-key";

const ENVIRONMENTS = {
  staging: { supabaseProjectRef: "stagingrefaaaaaaa", supabaseProjectName: "frapp-staging" },
  production: { supabaseProjectRef: "productionrefbbbbb", supabaseProjectName: "frapp-prod" },
};
const lookupEnvironment = (name) => ENVIRONMENTS[name];

// ── Doubles ─────────────────────────────────────────────────────────────────

/**
 * A fetch that records every call and answers from a route table. The
 * recording is the point: most of what these guards promise is that a refusal
 * happens BEFORE a write is sent, which only the call log can show.
 */
function makeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url: String(url), method, headers: init.headers ?? {}, body: init.body });
    for (const [match, handler] of routes) {
      if (match(String(url), method)) {
        const { status = 200, json, bytes } = await handler(String(url), init);
        const body = bytes ?? (json === undefined ? "" : JSON.stringify(json));
        return new Response(body, { status });
      }
    }
    // 418, not a 5xx: fetchWithRetry re-sends a GET on 5xx, and a missing route
    // is a test bug that should fail at once rather than after its backoff.
    return new Response(`no route for ${method} ${url}`, { status: 418 });
  };
  return { fetchImpl, calls };
}

const on = (method, fragment) => (url, m) => m === method && url.includes(fragment);

// ── Namespace, ids, email ───────────────────────────────────────────────────

test("validateNamespace accepts eight lowercase hex characters and nothing else", () => {
  assert.equal(validateNamespace("a9900000"), "a9900000");
  for (const bad of ["A9900000", "a990000", "a99000000", "g9900000", "", undefined, "c0ffee0-"]) {
    assert.throws(() => validateNamespace(bad), /eight lowercase hex/);
  }
});

test("demoIds derives the chapter and login ids from the namespace", () => {
  const ids = demoIds("a9900000");
  assert.equal(ids.chapterId, "a9900000-0000-4000-8000-000000000001");
  assert.equal(ids.loginUserId, "a9900000-0000-4000-8000-100000000001");
  assert.equal(ids.userIdLike, "a9900000-0000-4000-8000-1000%");
});

test("validateEmail lower-cases, and refuses anything that could break out of a literal", () => {
  assert.equal(validateEmail("App-Review@Frapp.live"), "app-review@frapp.live");
  for (const bad of ["no-at-sign", "a@b", "x'y@frapp.live", "x$@frapp.live", "a b@frapp.live", 'q"@frapp.live']) {
    assert.throws(() => validateEmail(bad), /not an email/);
  }
});

// ── sql ─────────────────────────────────────────────────────────────────────

test("the committed template renders for both variants", () => {
  const marketing = renderSeedSql({ template: TEMPLATE, namespace: TEMPLATE_NAMESPACE });
  const reviewer = renderSeedSql({
    template: TEMPLATE,
    namespace: REVIEWER_NAMESPACE,
    loginEmail: "app-review@frapp.live",
    reviewer: true,
  });
  assert.match(marketing, /set_config\('frapp_demo\.variant', 'marketing', true\)/);
  assert.match(reviewer, /set_config\('frapp_demo\.variant', 'reviewer', true\)/);
  assert.match(reviewer, /set_config\('frapp_demo\.login_email', 'app-review@frapp\.live', true\)/);
});

test("rendering moves every id to the new namespace and leaves none behind", () => {
  const sql = renderSeedSql({ template: TEMPLATE, namespace: "a9900000", loginEmail: "r@frapp.live", reviewer: true });
  assert.equal(sql.includes(TEMPLATE_NAMESPACE), false);
  assert.ok(sql.includes("'a9900000-0000-4000-8000-000000000001'"));
  assert.ok(sql.includes("LIKE 'a9900000-0000-4000-8000-1000%'"));
});

test("the rendered seed is one transaction with no psql meta-commands", () => {
  const sql = renderSeedSql({ template: TEMPLATE, namespace: "a9900000", loginEmail: "r@frapp.live", reviewer: true });
  const lines = sql.split("\n");
  // A backslash command (\set, \gset, \i) is what kept the old seed psql-only.
  assert.deepEqual(lines.filter((l) => /^\s*\\/.test(l)), []);
  assert.equal(lines.filter((l) => /^BEGIN;\s*$/.test(l)).length, 1);
  assert.equal(lines.filter((l) => /^COMMIT;\s*$/.test(l)).length, 1);
  assert.equal(lines.some((l) => l.trim() === "-- @settings"), false);
  // Settings are transaction-local, so they cannot leak onto a pooled connection.
  for (const call of sql.match(/set_config\([^)]*\)/g)) assert.match(call, /, true\)$/);
});

test("--reviewer refuses the marketing namespace and an unnamed login", () => {
  assert.throws(
    () => renderSeedSql({ template: TEMPLATE, namespace: TEMPLATE_NAMESPACE, loginEmail: "r@frapp.live", reviewer: true }),
    /refuses namespace c0ffee00/,
  );
  assert.throws(() => renderSeedSql({ template: TEMPLATE, namespace: "a9900000", reviewer: true }), /needs DEMO_EMAIL/);
});

test("marketing without DEMO_EMAIL keeps the roster's own login email", () => {
  const sql = renderSeedSql({ template: TEMPLATE, namespace: TEMPLATE_NAMESPACE });
  assert.equal(sql.includes("set_config('frapp_demo.login_email'"), false);
});

test("a template that names the namespace outside the id prefix is refused", () => {
  const stray = TEMPLATE.replace("\n-- @settings\n", `\n-- @settings\n-- see ${TEMPLATE_NAMESPACE} docs\n`);
  assert.throws(() => renderSeedSql({ template: stray, namespace: "a9900000", loginEmail: "r@frapp.live" }), /outside the id prefix/);
  const partial = TEMPLATE.replace("\n-- @settings\n", `\n-- @settings\nSELECT '${TEMPLATE_NAMESPACE}-1';\n`);
  assert.throws(() => renderSeedSql({ template: partial, namespace: "a9900000" }), /outside the id prefix/);
});

test("a template without exactly one settings marker is refused", () => {
  const MARKER_LINE = "\n-- @settings\n";
  assert.ok(TEMPLATE.includes(MARKER_LINE));
  assert.throws(() => renderSeedSql({ template: TEMPLATE.replace(MARKER_LINE, "\n"), namespace: "a9900000" }), /exactly one/);
  assert.throws(
    () => renderSeedSql({ template: TEMPLATE.replace(MARKER_LINE, `${MARKER_LINE}-- @settings\n`), namespace: "a9900000" }),
    /exactly one/,
  );
});

test("sql --remove is the seed's own opening deletes, and nothing more", () => {
  const seed = renderSeedSql({ template: TEMPLATE, namespace: "a9900000", loginEmail: "r@frapp.live", reviewer: true });
  const remove = renderRemoveSql({ namespace: "a9900000" });
  const statements = remove.split("\n").filter((l) => l.startsWith("DELETE"));
  assert.equal(statements.length, 2);
  for (const statement of statements) assert.ok(seed.includes(statement), `seed lacks: ${statement}`);
  // Both refuse while a demo account belongs to another chapter; the PGlite gate runs them.
  assert.match(remove, /IF EXISTS \(SELECT 1 FROM members WHERE user_id::text LIKE 'a9900000-0000-4000-8000-1000%' AND chapter_id <> 'a9900000-0000-4000-8000-000000000001'\)/);
  assert.ok(remove.indexOf("RAISE EXCEPTION") < remove.indexOf("DELETE FROM chapters"), "the guard runs before the deletes");
});

// ── Guards ──────────────────────────────────────────────────────────────────

test("DEMO_PASSWORD: required, and the committed local default never reaches a hosted project", () => {
  assert.throws(() => assertPasswordAllowed({ supabaseUrl: LOCAL, password: "" }), /no default/);
  assert.doesNotThrow(() => assertPasswordAllowed({ supabaseUrl: LOCAL, password: LOCAL_DEMO_PASSWORD }));
  assert.throws(() => assertPasswordAllowed({ supabaseUrl: HOSTED, password: LOCAL_DEMO_PASSWORD }), /committed default/);
  assert.throws(() => assertPasswordAllowed({ supabaseUrl: HOSTED, password: "short-pass" }), /at least 12/);
  assert.doesNotThrow(() => assertPasswordAllowed({ supabaseUrl: HOSTED, password: "a-long-enough-one" }));
});

test("production needs DEMO_ALLOW_PRODUCTION=true; staging and local do not", () => {
  const prod = "https://productionrefbbbbb.supabase.co";
  assert.throws(() => assertProductionAllowed({ supabaseUrl: prod, allow: undefined, lookupEnvironment }), /DEMO_ALLOW_PRODUCTION=true/);
  assert.throws(() => assertProductionAllowed({ supabaseUrl: prod, allow: "1", lookupEnvironment }), /DEMO_ALLOW_PRODUCTION=true/);
  assert.deepEqual(assertProductionAllowed({ supabaseUrl: prod, allow: "true", lookupEnvironment }), { isProduction: true });
  assert.deepEqual(assertProductionAllowed({ supabaseUrl: HOSTED, allow: undefined, lookupEnvironment }), { isProduction: false });
  assert.deepEqual(assertProductionAllowed({ supabaseUrl: LOCAL, allow: undefined, lookupEnvironment }), { isProduction: false });
});

test("the production fence reads the committed production ref", () => {
  const { supabaseProjectRef } = JSON.parse(readFileSync(new URL("../../../.github/environments.json", import.meta.url), "utf8")).environments.production;
  assert.throws(() => assertProductionAllowed({ supabaseUrl: `https://${supabaseProjectRef}.supabase.co`, allow: undefined }), /refusing to write to production/);
});

test("assertDemoObjectPath allows only <chapter>/<kind>/<row id>/<one pdf>", () => {
  const ns = "a9900000";
  const { chapterId } = demoIds(ns);
  const rowId = `${ns}-0000-4000-8000-800000000001`;
  const ok = `chapters/${chapterId}/documents/${rowId}/chapter-bylaws.pdf`;
  assert.doesNotThrow(() => assertDemoObjectPath({ namespace: ns, kind: "documents", rowId, path: ok }));
  for (const bad of [
    `chapters/c0ffee00-0000-4000-8000-000000000001/documents/${rowId}/x.pdf`,
    `chapters/${chapterId}/backwork/${rowId}/x.pdf`,
    `chapters/${chapterId}/documents/other-row/x.pdf`,
    `chapters/${chapterId}/documents/${rowId}/../x.pdf`,
    `chapters/${chapterId}/documents/${rowId}/nested/x.pdf`,
    `chapters/${chapterId}/documents/${rowId}/x.exe`,
    `demo/x.pdf`,
  ]) {
    assert.throws(() => assertDemoObjectPath({ namespace: ns, kind: "documents", rowId, path: bad }), /refusing/, bad);
  }
});

// ── Placeholder PDF ─────────────────────────────────────────────────────────

test("placeholderPdf is a structurally valid PDF: every xref offset lands on its object", () => {
  const pdf = placeholderPdf("Chapter Meeting Minutes — Week 9 (draft)", "Beta Theta Omega  ·  Westfield University");
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.endsWith("%%EOF\n"));

  const startxref = Number(text.match(/startxref\n(\d+)\n/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");
  const entries = text.slice(startxref).match(/^\d{10} \d{5} n \n/gm);
  assert.equal(entries.length, 6);
  entries.forEach((entry, i) => {
    const offset = Number(entry.slice(0, 10));
    assert.equal(text.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
  });

  const length = Number(text.match(/\/Length (\d+) >>\nstream\n/)[1]);
  const streamStart = text.indexOf("stream\n") + "stream\n".length;
  assert.equal(text.indexOf("endstream"), streamStart + length);
});

test("placeholderPdf encodes the seed's dashes and escapes PDF string delimiters", () => {
  const bytes = placeholderPdf("A — B (c) \\ d", "Chapter");
  // WinAnsiEncoding puts the em dash at 0x97; `(`, `)` and `\` are escaped.
  assert.ok(bytes.includes(Buffer.from([0x41, 0x20, 0x97, 0x20, 0x42])));
  assert.ok(bytes.includes(Buffer.from("\\(c\\) \\\\ d", "latin1")));
});

// ── auth ────────────────────────────────────────────────────────────────────

const listUsers = (users) => [on("GET", "/auth/v1/admin/users?"), () => ({ json: { users } })];

test("auth creates a missing login, confirmed and marked with its namespace", async () => {
  const { fetchImpl, calls } = makeFetch([
    listUsers([]),
    [on("POST", "/auth/v1/admin/users"), () => ({ json: { id: "new-id" } })],
  ]);
  const result = await ensureAuthUser({ supabaseUrl: HOSTED, serviceKey: KEY, email: "r@frapp.live", password: "p", namespace: "a9900000", fetchImpl });
  assert.deepEqual(result, { action: "created", id: "new-id" });
  const body = JSON.parse(calls.find((c) => c.method === "POST").body);
  assert.deepEqual(body, { email: "r@frapp.live", password: "p", email_confirm: true, app_metadata: { [AUTH_MARKER_KEY]: "a9900000" } });
});

test("auth updates its own login in place", async () => {
  const { fetchImpl, calls } = makeFetch([
    listUsers([{ id: "u1", email: "R@frapp.live", app_metadata: { [AUTH_MARKER_KEY]: "a9900000" } }]),
    [on("PUT", "/auth/v1/admin/users/u1"), () => ({ json: {} })],
  ]);
  const result = await ensureAuthUser({ supabaseUrl: HOSTED, serviceKey: KEY, email: "r@frapp.live", password: "p", namespace: "a9900000", fetchImpl });
  assert.deepEqual(result, { action: "updated", id: "u1" });
  const puts = calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 1);
  assert.deepEqual(JSON.parse(puts[0].body).app_metadata, { [AUTH_MARKER_KEY]: "a9900000" });
});

test("auth never resets the password of a hosted account it did not create", async () => {
  for (const app_metadata of [{}, { [AUTH_MARKER_KEY]: "c0ffee00" }]) {
    const { fetchImpl, calls } = makeFetch([listUsers([{ id: "real", email: "r@frapp.live", app_metadata }])]);
    await assert.rejects(
      ensureAuthUser({ supabaseUrl: HOSTED, serviceKey: KEY, email: "r@frapp.live", password: "p", namespace: "a9900000", fetchImpl }),
      /did not create it/,
    );
    assert.deepEqual(calls.map((c) => c.method), ["GET"]);
  }
});

test("on the local stack, auth adopts an earlier unmarked login", async () => {
  const { fetchImpl, calls } = makeFetch([
    listUsers([{ id: "old", email: "m@example.com", app_metadata: {} }]),
    [on("PUT", "/auth/v1/admin/users/old"), () => ({ json: {} })],
  ]);
  await ensureAuthUser({ supabaseUrl: LOCAL, serviceKey: KEY, email: "m@example.com", password: "p", namespace: "c0ffee00", fetchImpl });
  const puts = calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 1);
  // Adoption IS the marker: without it the seed leaves roster #1 unlinked.
  assert.deepEqual(JSON.parse(puts[0].body).app_metadata, { [AUTH_MARKER_KEY]: "c0ffee00" });
});

test("auth pages through the user list", async () => {
  const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `u${i}`, email: `x${i}@frapp.live`, app_metadata: {} }));
  const { fetchImpl } = makeFetch([
    [on("GET", "page=1&"), () => ({ json: { users: page1 } })],
    [on("GET", "page=2&"), () => ({ json: { users: [{ id: "found", email: "r@frapp.live", app_metadata: { [AUTH_MARKER_KEY]: "a9900000" } }] } })],
    [on("PUT", "/auth/v1/admin/users/found"), () => ({ json: {} })],
  ]);
  const result = await ensureAuthUser({ supabaseUrl: HOSTED, serviceKey: KEY, email: "r@frapp.live", password: "p", namespace: "a9900000", fetchImpl });
  assert.equal(result.id, "found");
});

test("auth --remove deletes only a hosted login it created", async () => {
  const mine = makeFetch([
    listUsers([{ id: "u1", email: "r@frapp.live", app_metadata: { [AUTH_MARKER_KEY]: "a9900000" } }]),
    [on("DELETE", "/auth/v1/admin/users/u1"), () => ({ json: {} })],
  ]);
  assert.deepEqual(
    await removeAuthUser({ supabaseUrl: HOSTED, serviceKey: KEY, email: "r@frapp.live", namespace: "a9900000", fetchImpl: mine.fetchImpl }),
    { action: "deleted", id: "u1" },
  );
  const theirs = makeFetch([listUsers([{ id: "u2", email: "r@frapp.live", app_metadata: {} }])]);
  await assert.rejects(
    removeAuthUser({ supabaseUrl: HOSTED, serviceKey: KEY, email: "r@frapp.live", namespace: "a9900000", fetchImpl: theirs.fetchImpl }),
    /refusing to delete/,
  );
  assert.equal(theirs.calls.some((c) => c.method === "DELETE"), false);
});

// ── storage ─────────────────────────────────────────────────────────────────

function rowsFor(ns, kind, n) {
  const { chapterId } = demoIds(ns);
  const block = kind === "documents" ? "8" : "9";
  return Array.from({ length: n }, (_, i) => {
    const id = `${ns}-0000-4000-8000-${block}000000000${String(i + 1).padStart(2, "0")}`;
    return { id, title: `Doc ${i + 1}`, storage_path: `chapters/${chapterId}/${kind}/${id}/doc-${i + 1}.pdf` };
  });
}

const chapterRow = (name = "Gamma Delta", university = "Northfield College") => [
  on("GET", "/rest/v1/chapters?"),
  () => ({ json: [{ name, university }] }),
];

test("storage uploads a PDF, upserting, for every row the database names", async () => {
  const ns = "a9900000";
  const { fetchImpl, calls } = makeFetch([
    chapterRow(),
    [on("GET", "/rest/v1/chapter_documents"), () => ({ json: rowsFor(ns, "documents", 3) })],
    [on("GET", "/rest/v1/backwork_resources"), () => ({ json: rowsFor(ns, "backwork", 2) })],
    [on("POST", "/storage/v1/object/"), () => ({ json: { Key: "k" } })],
  ]);
  const result = await uploadPlaceholders({ supabaseUrl: HOSTED, serviceKey: KEY, namespace: ns, fetchImpl });
  assert.deepEqual(result, [{ bucket: "documents", count: 3 }, { bucket: "backwork", count: 2 }]);
  const uploads = calls.filter((c) => c.method === "POST");
  assert.equal(uploads.length, 5);
  for (const upload of uploads) {
    assert.equal(upload.headers["x-upsert"], "true");
    assert.equal(upload.headers["Content-Type"], "application/pdf");
    assert.equal(upload.body.subarray(0, 5).toString(), "%PDF-");
    // The chapter the seed wrote, read back, not a literal that could drift from it.
    assert.ok(upload.body.toString("latin1").includes("(Gamma Delta  \xb7  Northfield College)"));
  }
  assert.ok(uploads[0].url.includes(`/storage/v1/object/documents/chapters/${demoIds(ns).chapterId}/documents/`));
});

test("storage refuses to upload anything when a row's path leaves the demo folder", async () => {
  const ns = "a9900000";
  const rows = rowsFor(ns, "documents", 2);
  rows[1].storage_path = "chapters/some-real-chapter/documents/x/y.pdf";
  const { fetchImpl, calls } = makeFetch([chapterRow(), [on("GET", "/rest/v1/chapter_documents"), () => ({ json: rows })]]);
  await assert.rejects(uploadPlaceholders({ supabaseUrl: HOSTED, serviceKey: KEY, namespace: ns, fetchImpl }), /refusing documents path/);
  assert.equal(calls.some((c) => c.method === "POST"), false);
});

test("storage names the missing step when the seed has not run", async () => {
  const noRows = makeFetch([chapterRow(), [on("GET", "/rest/v1/chapter_documents"), () => ({ json: [] })]]);
  await assert.rejects(
    uploadPlaceholders({ supabaseUrl: HOSTED, serviceKey: KEY, namespace: "a9900000", fetchImpl: noRows.fetchImpl }),
    /run `seed-demo\.mjs sql`/,
  );
  const noChapter = makeFetch([[on("GET", "/rest/v1/chapters?"), () => ({ json: [] })]]);
  await assert.rejects(
    uploadPlaceholders({ supabaseUrl: HOSTED, serviceKey: KEY, namespace: "a9900000", fetchImpl: noChapter.fetchImpl }),
    /no chapter a9900000-.* run `seed-demo\.mjs sql`/,
  );
  assert.equal(noChapter.calls.some((c) => c.method === "POST"), false);
});

test("storage --remove clears the chapter's prefix in every bucket, reviewer uploads included", async () => {
  // A reviewer's chat photo lands under chapters/<id>/chat/<channel>/<message>/ in the chat
  // bucket; walking only the placeholder folders left it behind with no row pointing at it.
  const ns = "a9900000";
  const { chapterId } = demoIds(ns);
  const root = `chapters/${chapterId}/`;
  const tree = {
    documents: { [root]: [{ name: "documents", id: null }], [`${root}documents/`]: [{ name: "row-1", id: null }], [`${root}documents/row-1/`]: [{ name: "a.pdf", id: "o1" }] },
    chat: {
      [root]: [{ name: "chat", id: null }],
      [`${root}chat/`]: [{ name: "ch1", id: null }],
      [`${root}chat/ch1/`]: [{ name: "m1", id: null }],
      [`${root}chat/ch1/m1/`]: [{ name: "photo.jpg", id: "o2" }],
    },
    backwork: {},
  };
  const listed = [];
  const { fetchImpl, calls } = makeFetch([
    [on("GET", "/storage/v1/bucket"), () => ({ json: Object.keys(tree).map((id) => ({ id, name: id })) })],
    [
      on("POST", "/storage/v1/object/list/"),
      (url, init) => {
        const bucket = url.split("/object/list/")[1];
        const { prefix } = JSON.parse(init.body);
        listed.push(prefix);
        return { json: tree[bucket][prefix] ?? [] };
      },
    ],
    [on("DELETE", "/storage/v1/object/"), () => ({ json: [] })],
  ]);
  const result = await removePlaceholders({ supabaseUrl: HOSTED, serviceKey: KEY, namespace: ns, fetchImpl });
  assert.deepEqual(result, [
    { bucket: "backwork", count: 0 },
    { bucket: "chat", count: 1 },
    { bucket: "documents", count: 1 },
  ]);
  const deletes = calls.filter((c) => c.method === "DELETE").map((c) => [c.url.split("/object/")[1], JSON.parse(c.body).prefixes]);
  assert.deepEqual(deletes, [
    ["chat", [`${root}chat/ch1/m1/photo.jpg`]],
    ["documents", [`${root}documents/row-1/a.pdf`]],
  ]);
  assert.ok(listed.every((prefix) => prefix.startsWith(root)), "nothing outside the chapter's prefix is listed");
});

test("storage --remove refuses a project that lists no buckets, rather than reporting nothing removed", async () => {
  const { fetchImpl, calls } = makeFetch([[on("GET", "/storage/v1/bucket"), () => ({ json: [] })]]);
  await assert.rejects(removePlaceholders({ supabaseUrl: HOSTED, serviceKey: KEY, namespace: "a9900000", fetchImpl }), /listed no Storage buckets/);
  assert.equal(calls.some((c) => c.method === "DELETE"), false);
});

test("storage --remove pages a folder that holds more than one listing's worth", async () => {
  // One call returns at most STORAGE_LIST_PAGE entries; without paging, the rest
  // would stay in the bucket while --remove reported success.
  const ns = "a9900000";
  const { chapterId } = demoIds(ns);
  const folder = `chapters/${chapterId}/`;
  const total = STORAGE_LIST_PAGE + 2;
  const offsets = [];
  const { fetchImpl, calls } = makeFetch([
    [
      on("POST", "/storage/v1/object/list/documents"),
      (_url, init) => {
        const { prefix, limit, offset } = JSON.parse(init.body);
        if (prefix !== folder) return { json: [] };
        offsets.push(offset);
        const names = Array.from({ length: total }, (_, i) => ({ name: `f${i}.pdf`, id: `o${i}` }));
        return { json: names.slice(offset, offset + limit) };
      },
    ],
    [on("GET", "/storage/v1/bucket"), () => ({ json: [{ id: "documents" }] })],
    [on("DELETE", "/storage/v1/object/documents"), () => ({ json: [] })],
  ]);
  const result = await removePlaceholders({ supabaseUrl: HOSTED, serviceKey: KEY, namespace: ns, fetchImpl });
  assert.deepEqual(offsets, [0, STORAGE_LIST_PAGE]);
  assert.deepEqual(result[0], { bucket: "documents", count: total });
  // Deleted in batches no larger than a page: Storage can cap a bulk delete at 1000.
  const batches = calls.filter((c) => c.method === "DELETE").map((c) => JSON.parse(c.body).prefixes.length);
  assert.deepEqual(batches, [STORAGE_LIST_PAGE, 2]);
});

// ── verify ──────────────────────────────────────────────────────────────────

function verifyRoutes({
  meId,
  invoices = [],
  channels = [{ type: "DM" }],
  pdf = placeholderPdf("x", "Chapter"),
  ns = "a9900000",
  chapter = {},
  events = [
    { name: "Chapter Meeting", start_time: "2026-09-20T23:00:00.000Z" },
    { name: "Philanthropy 5K", start_time: "2026-10-01T13:00:00.000Z" },
    { name: "Formal", start_time: "2026-09-28T23:00:00.000Z" },
  ],
} = {}) {
  const { chapterId, loginUserId } = demoIds(ns);
  return [
    [on("POST", "/auth/v1/token"), () => ({ json: { access_token: "t" } })],
    [on("GET", "/v1/users/me"), () => ({ json: { id: meId ?? loginUserId } })],
    [
      on("GET", "/v1/chapters/current"),
      () => ({ json: { id: chapterId, name: "Beta Theta Omega", subscription_status: "active", ...chapter } }),
    ],
    [on("GET", "/v1/documents/d1"), () => ({ json: { downloadUrl: "https://signed.example/d1" } })],
    [on("GET", "/v1/documents"), () => ({ json: [{ id: "d1", title: "Bylaws" }] })],
    [on("GET", "signed.example"), () => ({ bytes: pdf })],
    [on("GET", "/v1/invoices"), () => ({ json: invoices })],
    [on("GET", "/v1/channels"), () => ({ json: channels })],
    [on("GET", "/v1/events"), () => ({ json: events })],
  ];
}

const NOW = () => Date.parse("2026-09-23T12:00:00.000Z");
const verifyArgs = {
  supabaseUrl: HOSTED,
  anonKey: "anon",
  apiUrl: "https://api.example",
  email: "r@frapp.live",
  password: "p",
  namespace: "a9900000",
  now: NOW,
};

test("verify passes a correctly seeded reviewer, sending the chapter header", async () => {
  const { fetchImpl, calls } = makeFetch(verifyRoutes());
  const checks = await verifyLogin({ ...verifyArgs, reviewer: true, fetchImpl });
  assert.equal(checks.length, 7);
  // The soonest future event, not the first listed or a past one.
  assert.ok(checks.includes('2 upcoming event(s); the next is "Formal" on 2026-09-28'), checks.join("\n"));
  const me = calls.find((c) => c.url.endsWith("/v1/users/me"));
  assert.equal(me.headers["x-chapter-id"], demoIds("a9900000").chapterId);
  assert.equal(me.headers.Authorization, "Bearer t");
});

test("verify reads the reviewer's OWN ledger: an unfiltered read returns the whole chapter's", async () => {
  const { fetchImpl, calls } = makeFetch(verifyRoutes());
  await verifyLogin({ ...verifyArgs, reviewer: true, fetchImpl });
  const invoices = calls.find((c) => c.url.includes("/v1/invoices"));
  // The reviewer is president (`*`), so without `user_id` the controller's
  // billing:view branch answers with every invoice in the chapter.
  assert.equal(new URL(invoices.url).searchParams.get("user_id"), demoIds("a9900000").loginUserId);
});

test("verify catches a login whose current chapter is another one, or not active", async () => {
  const elsewhere = makeFetch(verifyRoutes({ chapter: { id: "some-other-chapter" } }));
  await assert.rejects(verifyLogin({ ...verifyArgs, fetchImpl: elsewhere.fetchImpl }), /current chapter is some-other-chapter/);
  const incomplete = makeFetch(verifyRoutes({ chapter: { subscription_status: "incomplete" } }));
  await assert.rejects(verifyLogin({ ...verifyArgs, fetchImpl: incomplete.fetchImpl }), /subscription_status is incomplete, not active/);
});

test("verify catches an auth user the seed did not link", async () => {
  const { fetchImpl } = makeFetch(verifyRoutes({ meId: "some-new-user" }));
  await assert.rejects(verifyLogin({ ...verifyArgs, fetchImpl }), /did not link this auth user/);
});

test("verify catches a document whose object was never uploaded", async () => {
  const { fetchImpl } = makeFetch(verifyRoutes({ pdf: Buffer.from("<Error>not found</Error>") }));
  await assert.rejects(verifyLogin({ ...verifyArgs, fetchImpl }), /did not open as a PDF/);
});

test("verify --reviewer catches an invoice on the reviewer, and a missing DM", async () => {
  const withInvoice = makeFetch(verifyRoutes({ invoices: [{ id: "i" }] }));
  await assert.rejects(verifyLogin({ ...verifyArgs, reviewer: true, fetchImpl: withInvoice.fetchImpl }), /1 invoice/);
  const noDm = makeFetch(verifyRoutes({ channels: [{ type: "PUBLIC" }] }));
  await assert.rejects(verifyLogin({ ...verifyArgs, reviewer: true, fetchImpl: noDm.fetchImpl }), /no direct message/);
});

test("verify fails a stale seed: every event already past", async () => {
  // The seed dates events from the day it ran; weeks later sign-in and documents
  // still pass while the Events tab shows nothing ahead.
  const { fetchImpl } = makeFetch(verifyRoutes({ events: [{ name: "Old", start_time: "2026-09-01T12:00:00.000Z" }] }));
  await assert.rejects(verifyLogin({ ...verifyArgs, fetchImpl }), /no upcoming events: the seed is stale/);
});

// ── setup-demo.sh ───────────────────────────────────────────────────────────

test("demo-data.md shows the local login seed-demo.mjs owns", () => {
  const guide = readFileSync(new URL("../../../docs/guides/demo-data.md", import.meta.url), "utf8");
  assert.ok(guide.includes(`${LOCAL_DEMO_EMAIL} / ${LOCAL_DEMO_PASSWORD}`), "demo-data.md's local sign-in line drifted");
});

test("setup-demo.sh restates the local login seed-demo.mjs owns, and prints only that password", () => {
  const sh = readFileSync(new URL("../../demo/setup-demo.sh", import.meta.url), "utf8");
  assert.ok(sh.includes(`LOCAL_PASSWORD='${LOCAL_DEMO_PASSWORD}'`), "setup-demo.sh's local password drifted");
  assert.ok(sh.includes(`DEMO_EMAIL="\${DEMO_EMAIL:-${LOCAL_DEMO_EMAIL}}"`), "setup-demo.sh's local email drifted");
  // DEMO_PASSWORD can be inherited from a shell that ran the production steps.
  const echoes = sh.split("\n").filter((line) => /^\s*echo .*\$DEMO_PASSWORD/.test(line));
  assert.equal(echoes.length, 1);
  assert.match(sh, /if \[ "\$DEMO_PASSWORD" = "\$LOCAL_PASSWORD" \]; then\n\s*echo "[^"]*\$DEMO_PASSWORD/);
});

// ── CLI ─────────────────────────────────────────────────────────────────────

test("parseArgs rejects what the commands cannot do", () => {
  assert.throws(() => parseArgs(["seed", "--namespace", "a9900000"]), /usage/);
  assert.throws(() => parseArgs(["sql"]), /eight lowercase hex/);
  assert.throws(() => parseArgs(["verify", "--namespace", "a9900000", "--remove"]), /read-only/);
  assert.throws(() => parseArgs(["auth", "--namespace", "a9900000", "--reviewer"]), /applies to sql and verify/);
  assert.throws(() => parseArgs(["sql", "--namespace"]), /needs a value/);
  assert.throws(() => parseArgs(["sql", "--namespace", "a9900000", "--force"]), /unknown argument/);
  assert.deepEqual(parseArgs(["storage", "--namespace", "a9900000", "--remove"]), {
    command: "storage", reviewer: false, remove: true, namespace: "a9900000", apiUrl: undefined,
  });
});

const sink = () => {
  const chunks = [];
  return { write: (s) => chunks.push(s), text: () => chunks.join("") };
};

test("main refuses a hosted auth write with the committed password before sending anything", async () => {
  const { fetchImpl, calls } = makeFetch([]);
  const env = { SUPABASE_URL: HOSTED, SUPABASE_SERVICE_ROLE_KEY: KEY, DEMO_EMAIL: "r@frapp.live", DEMO_PASSWORD: LOCAL_DEMO_PASSWORD };
  await assert.rejects(main(["auth", "--namespace", "a9900000"], env, { out: sink(), err: sink() }, fetchImpl), /committed default/);
  assert.deepEqual(calls, []);
});

test("main refuses production storage writes without the flag, before sending anything", async () => {
  const { supabaseProjectRef } = JSON.parse(readFileSync(new URL("../../../.github/environments.json", import.meta.url), "utf8")).environments.production;
  const { fetchImpl, calls } = makeFetch([]);
  const env = { SUPABASE_URL: `https://${supabaseProjectRef}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: KEY };
  for (const args of [["storage", "--namespace", "a9900000"], ["storage", "--namespace", "a9900000", "--remove"]]) {
    await assert.rejects(main(args, env, { out: sink(), err: sink() }, fetchImpl), /DEMO_ALLOW_PRODUCTION=true/);
  }
  assert.deepEqual(calls, []);
});

test("main refuses a production auth write without the flag, before sending anything", async () => {
  // A strong password passes assertPasswordAllowed, so only the production fence stands
  // between this and creating, confirming and marking a login in frapp-prod.
  const { supabaseProjectRef } = JSON.parse(readFileSync(new URL("../../../.github/environments.json", import.meta.url), "utf8")).environments.production;
  const { fetchImpl, calls } = makeFetch([]);
  const env = {
    SUPABASE_URL: `https://${supabaseProjectRef}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: KEY,
    DEMO_EMAIL: "app-review@example.test",
    DEMO_PASSWORD: "a-long-enough-password",
  };
  for (const args of [["auth", "--namespace", "a9900000"], ["auth", "--namespace", "a9900000", "--remove"]]) {
    await assert.rejects(main(args, env, { out: sink(), err: sink() }, fetchImpl), /DEMO_ALLOW_PRODUCTION=true/);
  }
  assert.deepEqual(calls, []);
});

test("main refuses to verify a hosted login with the committed password, before signing in", async () => {
  const { fetchImpl, calls } = makeFetch([]);
  const env = { SUPABASE_URL: HOSTED, SUPABASE_ANON_KEY: "anon", DEMO_EMAIL: "r@frapp.live", DEMO_PASSWORD: LOCAL_DEMO_PASSWORD };
  await assert.rejects(
    main(["verify", "--namespace", "a9900000", "--api-url", "https://api.example"], env, { out: sink(), err: sink() }, fetchImpl),
    /committed default/,
  );
  assert.deepEqual(calls, []);
});

test("a missing variable is reported through the shared requireEnv, before anything is sent", async () => {
  const { fetchImpl, calls } = makeFetch([]);
  const err = sink();
  await assert.rejects(
    main(["auth", "--namespace", "a9900000"], { SUPABASE_URL: HOSTED, SUPABASE_SERVICE_ROLE_KEY: KEY }, { out: sink(), err }, fetchImpl),
    /DEMO_EMAIL environment variable is required/,
  );
  assert.match(err.text(), /Error: DEMO_EMAIL environment variable is required\. auth names the login by it\./);
  assert.deepEqual(calls, []);
});

test("main sql writes the rendered seed to stdout and nothing else", async () => {
  const out = sink();
  const err = sink();
  await main(["sql", "--namespace", "a9900000", "--reviewer"], { DEMO_EMAIL: "r@frapp.live" }, { out, err });
  assert.ok(out.text().startsWith("-- Generated by scripts/demo/seed-demo.mjs"));
  assert.equal(err.text(), "");
});
