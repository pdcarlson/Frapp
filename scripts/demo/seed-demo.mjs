#!/usr/bin/env node

// Seed Signet's demo chapter into any Supabase project — the local stack, staging,
// or (with the owner's approval) production — and prove the result signs in.
//
//   node scripts/demo/seed-demo.mjs sql     --namespace <hex8> [--reviewer] [--remove]
//   node scripts/demo/seed-demo.mjs auth    --namespace <hex8> [--remove]
//   node scripts/demo/seed-demo.mjs storage --namespace <hex8> [--remove]
//   node scripts/demo/seed-demo.mjs verify  --namespace <hex8> [--reviewer] [--api-url <url>]
//
// `sql` writes SQL to stdout and talks to nothing, like
// scripts/load-chapter-directory.mjs: pipe it into `psql`, paste it into the
// Supabase SQL editor, or hand it to an MCP `execute_sql`. It is one
// transaction with no psql meta-commands, so all three run the same thing, and
// a failure part-way leaves the target untouched. The other three commands talk
// to the project's HTTP APIs (GoTrue, Storage, PostgREST, and the Signet API
// for `verify`), which is everything a hosted project exposes without Docker.
//
// Order: `auth`, then `sql`, then `storage`, then `verify`. The seed links its
// login to the auth user with the same email, and only to one `auth` created for
// this namespace, so `auth` runs first. Undo in the reverse order with `--remove`.
//
// Environment (`infisical run --env=<slug> --` supplies the Supabase three):
//   SUPABASE_URL               the project's API URL           auth, storage, verify
//   SUPABASE_SERVICE_ROLE_KEY  service key                     auth, storage
//   SUPABASE_ANON_KEY          anon key, for the password sign-in   verify
//   DEMO_EMAIL                 the login's email               sql (reviewer), auth, verify
//   DEMO_PASSWORD              the login's password — no default   auth, verify
//   DEMO_ALLOW_PRODUCTION      must be `true` for auth/storage against frapp-prod
//
// Chapter identity is `--namespace`: eight hex characters that prefix every id
// the seed writes, so two demo chapters in one project never collide. The
// marketing/screenshot chapter is `c0ffee00` (scripts/demo/setup-demo.sh); the
// App Review chapter is `a9900000`. `--reviewer` refuses `c0ffee00`.
//
// Procedure and the reasons behind each guard: docs/guides/demo-data.md.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { requireEnv } from "../ci/lib/env.mjs";
import { getEnvironment } from "../ci/lib/environments.mjs";
import { IDEMPOTENT_METHODS, fetchWithRetry } from "../ci/lib/http.mjs";

export const TEMPLATE_PATH = fileURLToPath(new URL("./demo-seed.sql", import.meta.url));

/** The namespace `demo-seed.sql` is written in, and the marketing chapter's. */
export const TEMPLATE_NAMESPACE = "c0ffee00";
/** The App Review chapter's namespace. Documented, not enforced. */
export const REVIEWER_NAMESPACE = "a9900000";

const ID_TAIL = "-0000-4000-8000-";
const SETTINGS_MARKER = "-- @settings";

/**
 * setup-demo.sh's local-only default. Committed, so it is refused for any
 * hosted project: a password printed in this repo cannot be the credential
 * App Review is handed (#2308), or any hosted account's.
 */
export const LOCAL_DEMO_PASSWORD = "DemoShowcase!2026";
/** The local marketing chapter's login: roster #1, the president. setup-demo.sh restates it. */
export const LOCAL_DEMO_EMAIL = "marcus.ellison@example.com";
export const MIN_HOSTED_PASSWORD_LENGTH = 12;

/** `app_metadata` key marking an auth user this script created. */
export const AUTH_MARKER_KEY = "frapp_demo_namespace";

export const BUCKETS = /** @type {const} */ ({
  documents: { bucket: "documents", table: "chapter_documents", folder: "documents" },
  backwork: { bucket: "backwork", table: "backwork_resources", folder: "backwork" },
});

// ── Pure helpers ────────────────────────────────────────────────────────────

export function validateNamespace(namespace) {
  if (typeof namespace !== "string" || !/^[0-9a-f]{8}$/.test(namespace)) {
    throw new Error(
      `--namespace must be exactly eight lowercase hex characters (got ${JSON.stringify(namespace)}).`,
    );
  }
  return namespace;
}

/** The fixed ids a namespace produces, in the scheme demo-seed.sql documents. */
export function demoIds(namespace) {
  validateNamespace(namespace);
  const prefix = `${namespace}${ID_TAIL}`;
  return {
    prefix,
    chapterId: `${prefix}000000000001`,
    loginUserId: `${prefix}100000000001`,
    userIdLike: `${prefix}1000%`,
  };
}

/**
 * Bare-bones shape check: one `@`, no whitespace, no quote or `$` tricks. The
 * address lands inside a dollar-quoted block (`renderSeedSql`), so `$` is
 * refused outright rather than escaped.
 */
export function validateEmail(email) {
  if (typeof email !== "string" || !/^[^\s@'"\\$]+@[^\s@'"\\$]+\.[^\s@'"\\$]+$/.test(email)) {
    throw new Error(`DEMO_EMAIL is not an email address (got ${JSON.stringify(email)}).`);
  }
  return email.toLowerCase();
}

/** A SQL string literal. Rejects NUL, which Postgres text cannot hold. */
export function sqlLiteral(value) {
  const text = String(value);
  if (text.includes("\0")) throw new Error("refusing to emit a SQL literal containing NUL");
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * Render demo-seed.sql for one namespace and variant.
 *
 * The namespace rewrite is a plain text substitution of the id prefix, which
 * is only sound if the prefix is the one place the template's namespace
 * appears. Checked here rather than trusted: a stray `c0ffee00` in a comment is
 * harmless, but one inside an id that does not carry the full prefix would
 * silently stay pointed at the marketing chapter.
 */
export function renderSeedSql({ template, namespace, loginEmail, reviewer = false }) {
  validateNamespace(namespace);
  if (reviewer && namespace === TEMPLATE_NAMESPACE) {
    throw new Error(
      `--reviewer refuses namespace ${TEMPLATE_NAMESPACE}: that is the marketing chapter, and the App Review chapter must be told apart from it. Use ${REVIEWER_NAMESPACE}.`,
    );
  }
  if (reviewer && !loginEmail) {
    throw new Error("--reviewer needs DEMO_EMAIL: the App Review login must be named, never defaulted.");
  }

  const markers = template.split("\n").filter((line) => line.trim() === SETTINGS_MARKER);
  if (markers.length !== 1) {
    throw new Error(`${TEMPLATE_PATH} must carry exactly one "${SETTINGS_MARKER}" line (found ${markers.length}).`);
  }
  const bare = template.split(TEMPLATE_NAMESPACE).length - 1;
  const prefixed = template.split(`${TEMPLATE_NAMESPACE}${ID_TAIL}`).length - 1;
  if (bare !== prefixed) {
    throw new Error(
      `${TEMPLATE_PATH} uses "${TEMPLATE_NAMESPACE}" ${bare - prefixed} time(s) outside the id prefix "${TEMPLATE_NAMESPACE}${ID_TAIL}", so rewriting the namespace would miss them.`,
    );
  }

  // A DO block rather than bare `SELECT set_config(...)`, which psql and the SQL
  // editor would each print as a result row. `true` makes both settings
  // transaction-local, so they end with the seed's COMMIT and never leak onto a
  // pooled connection.
  const assignments = [
    `  PERFORM set_config('frapp_demo.variant', ${sqlLiteral(reviewer ? "reviewer" : "marketing")}, true);`,
  ];
  if (loginEmail) {
    assignments.push(`  PERFORM set_config('frapp_demo.login_email', ${sqlLiteral(validateEmail(loginEmail))}, true);`);
  }
  const settings = ["DO $settings$", "BEGIN", ...assignments, "END $settings$;"];

  const body = template
    .split(`${TEMPLATE_NAMESPACE}${ID_TAIL}`)
    .join(`${namespace}${ID_TAIL}`)
    .split("\n")
    .map((line) => (line.trim() === SETTINGS_MARKER ? settings.join("\n") : line))
    .join("\n");

  const header =
    `-- Generated by scripts/demo/seed-demo.mjs from scripts/demo/demo-seed.sql — do not edit.\n` +
    `-- namespace ${namespace} (chapter ${demoIds(namespace).chapterId}), ` +
    `${reviewer ? "reviewer" : "marketing"} variant` +
    `${loginEmail ? `, login ${validateEmail(loginEmail)}` : ""}\n\n`;
  return header + body;
}

/**
 * The seed's own opening deletes, as a standalone teardown. The seed's first
 * two statements are exactly these (a test holds them in step), so removing a
 * chapter is the same operation re-seeding starts with.
 */
export function renderRemoveSql({ namespace }) {
  const { chapterId, userIdLike } = demoIds(namespace);
  return (
    `-- Generated by scripts/demo/seed-demo.mjs sql --remove — removes demo chapter ${chapterId}.\n` +
    `-- Run \`seed-demo.mjs storage --remove\` and \`auth --remove\` too; this touches the database only.\n` +
    `BEGIN;\n` +
    `DELETE FROM chapters WHERE id = '${chapterId}';\n` +
    `DELETE FROM users WHERE id::text LIKE '${userIdLike}';\n` +
    `COMMIT;\n`
  );
}

export function isLoopbackUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return ["127.0.0.1", "localhost", "0.0.0.0", "[::1]", "::1"].includes(parsed.hostname);
}

/** Refuse a password that must not guard a hosted account. */
export function assertPasswordAllowed({ supabaseUrl, password }) {
  if (!password) {
    throw new Error("DEMO_PASSWORD is required and has no default. Choose one and pass it in the environment.");
  }
  if (isLoopbackUrl(supabaseUrl)) return;
  if (password === LOCAL_DEMO_PASSWORD) {
    throw new Error(
      "DEMO_PASSWORD is the local stack's committed default, which is printed in this repo. A hosted project needs a password of its own.",
    );
  }
  if (password.length < MIN_HOSTED_PASSWORD_LENGTH) {
    throw new Error(
      `DEMO_PASSWORD must be at least ${MIN_HOSTED_PASSWORD_LENGTH} characters for a hosted project.`,
    );
  }
}

/**
 * The production fence, in the shape of `DB_RESTORE_ALLOW_PRODUCTION`
 * (scripts/ci/lib/db-restore-target.mjs): the project ref comes from
 * .github/environments.json, and writing fictional data to frapp-prod needs the
 * owner's approval (#2308), which this flag records.
 */
export function assertProductionAllowed({ supabaseUrl, allow, lookupEnvironment = getEnvironment }) {
  const production = lookupEnvironment("production");
  let host = "";
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    throw new Error(`SUPABASE_URL is not a URL (got ${JSON.stringify(supabaseUrl)}).`);
  }
  const isProduction = host === `${production.supabaseProjectRef}.supabase.co`;
  if (isProduction && allow !== "true") {
    throw new Error(
      `refusing to write to production (${production.supabaseProjectName}, ${production.supabaseProjectRef}) ` +
        `without DEMO_ALLOW_PRODUCTION=true. Writing the demo chapter to production needs the owner's approval; ` +
        `set the flag once you have it.`,
    );
  }
  return { isProduction };
}

// ── Placeholder PDF ─────────────────────────────────────────────────────────

/**
 * Map text onto WinAnsiEncoding bytes, the encoding the two standard fonts
 * below declare. The seed's titles carry em and en dashes and the odd "·";
 * everything else they use is ASCII. Anything unmappable becomes "?".
 */
function winAnsi(text) {
  const special = { "—": 0x97, "–": 0x96, "·": 0xb7, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94 };
  const bytes = [];
  for (const ch of text) {
    if (special[ch] !== undefined) bytes.push(special[ch]);
    else {
      const code = ch.codePointAt(0);
      bytes.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
    }
  }
  return Buffer.from(bytes);
}

/** A PDF string literal: `(`, `)` and `\` escaped, bytes passed through. */
function pdfString(text) {
  const out = [];
  for (const byte of winAnsi(text)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c);
    out.push(byte);
  }
  return Buffer.concat([Buffer.from("("), Buffer.from(out), Buffer.from(")")]);
}

/**
 * A one-page PDF naming the document and its chapter, and saying plainly that
 * it is demo content. Hand-built rather than generated by a dependency: the format needs
 * only five objects, and this script stays runnable before `npm install`.
 */
export function placeholderPdf(title, chapterLine) {
  const lines = [
    ["F1", 22, 700, title],
    ["F2", 12, 668, chapterLine],
    ["F2", 11, 628, "This is a sample document in Signet's demo chapter. The chapter, its"],
    ["F2", 11, 612, "members and this file are fictional, created so the app can be shown"],
    ["F2", 11, 596, "with realistic content."],
  ];
  const content = Buffer.concat(
    lines.map(([font, size, y, text]) =>
      Buffer.concat([
        Buffer.from(`BT /${font} ${size} Tf 72 ${y} Td `),
        pdfString(text),
        Buffer.from(" Tj ET\n"),
      ]),
    ),
  );

  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from("endstream"),
    ]),
  ];

  const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let length = chunks[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    length += chunk.length;
  });
  // Each xref entry is exactly 20 bytes: 10-digit offset, generation, type, 2-byte EOL.
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

// ── HTTP ────────────────────────────────────────────────────────────────────

function serviceHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/**
 * One API call through `fetchWithRetry`: a timeout on every request, and a
 * bounded retry on 429/5xx for the ones safe to re-send. `idempotent` extends
 * that to a POST or DELETE whose repeat changes nothing (a Storage upsert, a
 * listing, a bulk delete); a create keeps its single attempt.
 */
async function request(fetchImpl, url, init, what, { idempotent = false } = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const retryMethods = idempotent ? new Set([...IDEMPOTENT_METHODS, method]) : IDEMPOTENT_METHODS;
  const response = await fetchWithRetry(url, init, { fetchImpl, retryMethods });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${what} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Encode each segment of an object path, keeping the slashes. */
function encodeObjectPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

// ── auth ────────────────────────────────────────────────────────────────────

const USERS_PER_PAGE = 1000;
const MAX_USER_PAGES = 50;

export async function findAuthUserByEmail({ supabaseUrl, serviceKey, email, fetchImpl = fetch }) {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
    const body = await request(
      fetchImpl,
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${USERS_PER_PAGE}`,
      { headers: serviceHeaders(serviceKey) },
      "listing auth users",
    );
    const users = body?.users ?? [];
    const match = users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (match) return match;
    if (users.length < USERS_PER_PAGE) return null;
  }
  throw new Error(`gave up listing auth users after ${MAX_USER_PAGES} pages`);
}

/**
 * Create the login, or bring an existing one in line with DEMO_PASSWORD.
 *
 * On a hosted project an existing account is only touched when this script
 * created it (its `app_metadata` carries this namespace). Anything else could be
 * a real person's account, and resetting its password is not recoverable. The
 * seed applies the same rule from the other side — it links only a login
 * carrying this namespace's marker — so a login made by hand in the Supabase
 * dashboard is never adopted by either; create it here instead.
 *
 * The marker cannot catch a mistyped address that has no account yet: that one
 * is created, confirmed and marked like the intended one, and the seed then
 * makes whoever owns that inbox the demo chapter's president. The address this
 * prints on creation is the check.
 */
export async function ensureAuthUser({ supabaseUrl, serviceKey, email, password, namespace, fetchImpl = fetch }) {
  const existing = await findAuthUserByEmail({ supabaseUrl, serviceKey, email, fetchImpl });
  const marker = { [AUTH_MARKER_KEY]: namespace };
  if (!existing) {
    const created = await request(
      fetchImpl,
      `${supabaseUrl}/auth/v1/admin/users`,
      {
        method: "POST",
        headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
        body: JSON.stringify({ email, password, email_confirm: true, app_metadata: marker }),
      },
      "creating the auth user",
    );
    return { action: "created", id: created.id };
  }
  const ours = existing.app_metadata?.[AUTH_MARKER_KEY] === namespace;
  if (!ours && !isLoopbackUrl(supabaseUrl)) {
    throw new Error(
      `an auth user with ${email} already exists and this script did not create it for namespace ${namespace}. ` +
        `Refusing to change its password, and the seed will not link it either. Choose another DEMO_EMAIL, or ` +
        `delete that account yourself if it is a stray demo login.`,
    );
  }
  await request(
    fetchImpl,
    `${supabaseUrl}/auth/v1/admin/users/${existing.id}`,
    {
      method: "PUT",
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
      body: JSON.stringify({ password, email_confirm: true, app_metadata: marker }),
    },
    "updating the auth user",
    { idempotent: true },
  );
  return { action: "updated", id: existing.id };
}

export async function removeAuthUser({ supabaseUrl, serviceKey, email, namespace, fetchImpl = fetch }) {
  const existing = await findAuthUserByEmail({ supabaseUrl, serviceKey, email, fetchImpl });
  if (!existing) return { action: "absent" };
  const ours = existing.app_metadata?.[AUTH_MARKER_KEY] === namespace;
  if (!ours && !isLoopbackUrl(supabaseUrl)) {
    throw new Error(
      `refusing to delete ${email}: this script did not create it for namespace ${namespace}.`,
    );
  }
  await request(
    fetchImpl,
    `${supabaseUrl}/auth/v1/admin/users/${existing.id}`,
    { method: "DELETE", headers: serviceHeaders(serviceKey) },
    "deleting the auth user",
  );
  return { action: "deleted", id: existing.id };
}

// ── storage ─────────────────────────────────────────────────────────────────

/** The folder every object of one kind lives under for this chapter. */
export function objectFolder(namespace, kind) {
  return `chapters/${demoIds(namespace).chapterId}/${BUCKETS[kind].folder}/`;
}

/**
 * Refuse any path that is not `<folder><row id>/<one safe file name>`. The
 * rows come from the database, and this is the last check before the service
 * key writes: a path outside the demo chapter's own folder is never ours.
 */
export function assertDemoObjectPath({ namespace, kind, rowId, path }) {
  const expected = `${objectFolder(namespace, kind)}${rowId}/`;
  const file = path.startsWith(expected) ? path.slice(expected.length) : null;
  if (!file || !/^[a-z0-9][a-z0-9.-]*\.pdf$/.test(file) || file.includes("..")) {
    throw new Error(`refusing ${kind} path ${JSON.stringify(path)}: not a demo object under ${expected}`);
  }
}

export async function uploadPlaceholders({ supabaseUrl, serviceKey, namespace, fetchImpl = fetch }) {
  const { chapterId } = demoIds(namespace);
  // The chapter's name as the seed wrote it, so a PDF never names a chapter the app does not.
  const chapters = await request(
    fetchImpl,
    `${supabaseUrl}/rest/v1/chapters?select=name,university&id=eq.${chapterId}`,
    { headers: serviceHeaders(serviceKey) },
    "reading the demo chapter",
  );
  const chapter = Array.isArray(chapters) ? chapters[0] : undefined;
  if (!chapter?.name) {
    throw new Error(`no chapter ${chapterId} in this project: run \`seed-demo.mjs sql\` against it first.`);
  }
  const chapterLine = [chapter.name, chapter.university].filter(Boolean).join("  ·  ");
  const results = [];
  for (const kind of Object.keys(BUCKETS)) {
    const { bucket, table } = BUCKETS[kind];
    const rows = await request(
      fetchImpl,
      `${supabaseUrl}/rest/v1/${table}?select=id,title,storage_path&chapter_id=eq.${chapterId}&order=id`,
      { headers: serviceHeaders(serviceKey) },
      `reading ${table}`,
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`no ${table} rows for chapter ${chapterId}: run \`seed-demo.mjs sql\` against this project first.`);
    }
    for (const row of rows) {
      assertDemoObjectPath({ namespace, kind, rowId: row.id, path: row.storage_path });
    }
    for (const row of rows) {
      await request(
        fetchImpl,
        `${supabaseUrl}/storage/v1/object/${bucket}/${encodeObjectPath(row.storage_path)}`,
        {
          method: "POST",
          headers: serviceHeaders(serviceKey, { "Content-Type": "application/pdf", "x-upsert": "true" }),
          body: placeholderPdf(row.title ?? "Document", chapterLine),
        },
        `uploading ${bucket}/${row.storage_path}`,
        { idempotent: true },
      );
    }
    results.push({ bucket, count: rows.length });
  }
  return results;
}

/** Storage's page size for one listing call, and the batch size for one bulk delete. */
export const STORAGE_LIST_PAGE = 1000;

/**
 * Every object under a folder, walking sub-folders (Storage lists one level) and
 * paging each level: one call returns at most STORAGE_LIST_PAGE entries, so a
 * single call would silently leave the rest behind (storage-backup.mjs pages for
 * the same reason; its lister walks a whole bucket, so it does not fit here).
 */
async function listObjects({ supabaseUrl, serviceKey, bucket, prefix, fetchImpl, depth = 0 }) {
  if (depth > 4) throw new Error(`storage listing under ${bucket}/${prefix} is deeper than the demo layout`);
  const entries = [];
  for (let offset = 0; ; offset += STORAGE_LIST_PAGE) {
    const page = await request(
      fetchImpl,
      `${supabaseUrl}/storage/v1/object/list/${bucket}`,
      {
        method: "POST",
        headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
        body: JSON.stringify({ prefix, limit: STORAGE_LIST_PAGE, offset }),
      },
      `listing ${bucket}/${prefix}`,
      { idempotent: true },
    );
    const rows = Array.isArray(page) ? page : [];
    entries.push(...rows);
    if (rows.length < STORAGE_LIST_PAGE) break;
  }
  const paths = [];
  for (const entry of entries) {
    // Storage reports a folder as an entry with no id.
    if (entry.id === null || entry.id === undefined) {
      paths.push(
        ...(await listObjects({
          supabaseUrl,
          serviceKey,
          bucket,
          prefix: `${prefix}${entry.name}/`,
          fetchImpl,
          depth: depth + 1,
        })),
      );
    } else {
      paths.push(`${prefix}${entry.name}`);
    }
  }
  return paths;
}

/**
 * Delete every object under the demo chapter's documents and backwork folders.
 * Reads Storage, not the database, so it works before or after `sql --remove`
 * and also clears objects a renamed row left behind.
 */
export async function removePlaceholders({ supabaseUrl, serviceKey, namespace, fetchImpl = fetch }) {
  const results = [];
  for (const kind of Object.keys(BUCKETS)) {
    const { bucket } = BUCKETS[kind];
    const prefix = objectFolder(namespace, kind);
    const paths = await listObjects({ supabaseUrl, serviceKey, bucket, prefix, fetchImpl });
    for (const path of paths) {
      if (!path.startsWith(prefix)) throw new Error(`refusing to delete ${bucket}/${path}: outside ${prefix}`);
    }
    // In batches of a listing page: Storage can cap a bulk delete at 1000 objects
    // per request (its per-tenant request limits), and paging the listing is
    // exactly what lets more than that arrive here.
    for (let start = 0; start < paths.length; start += STORAGE_LIST_PAGE) {
      const batch = paths.slice(start, start + STORAGE_LIST_PAGE);
      await request(
        fetchImpl,
        `${supabaseUrl}/storage/v1/object/${bucket}`,
        {
          method: "DELETE",
          headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
          body: JSON.stringify({ prefixes: batch }),
        },
        `deleting ${batch.length} object(s) from ${bucket}`,
        { idempotent: true },
      );
    }
    results.push({ bucket, count: paths.length });
  }
  return results;
}

// ── verify ──────────────────────────────────────────────────────────────────

/**
 * Sign in the way the app does and read what a reviewer would see: a password
 * grant, then GETs against the Signet API. It writes nothing of its own, but it
 * is a real sign-in, and the API's first-sign-in sync creates a chapterless
 * `users` row for a login the seed has not linked yet. The next seed adopts that
 * row (demo-seed.sql § Link the login), so running `verify` early costs a
 * re-seed, never a stuck account. Each check is reported, and the first failure
 * stops the run, since later checks assume earlier ones.
 */
export async function verifyLogin({
  supabaseUrl,
  anonKey,
  apiUrl,
  email,
  password,
  namespace,
  reviewer = false,
  fetchImpl = fetch,
  log = () => {},
  now = () => Date.now(),
}) {
  const { chapterId, loginUserId } = demoIds(namespace);
  const checks = [];
  const pass = (name) => {
    checks.push(name);
    log(`OK    ${name}`);
  };
  const fail = (name) => {
    throw new Error(`FAIL  ${name}`);
  };

  const session = await request(
    fetchImpl,
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    "signing in with DEMO_EMAIL / DEMO_PASSWORD",
  );
  if (!session?.access_token) fail("password sign-in returned no access token");
  pass(`password sign-in as ${email}`);

  const api = (path) =>
    request(
      fetchImpl,
      `${apiUrl}${path}`,
      { headers: { Authorization: `Bearer ${session.access_token}`, "x-chapter-id": chapterId } },
      `GET ${path}`,
    );

  const me = await api("/v1/users/me");
  if (me?.id !== loginUserId) {
    fail(
      `signed in as users.id ${me?.id}, not the seeded login ${loginUserId} — the seed did not link this auth user. ` +
        "Run `sql` for this namespace (after `auth`), then verify again.",
    );
  }
  pass(`linked to the seeded login (users.id ${loginUserId})`);

  const chapter = await api("/v1/chapters/current");
  if (chapter?.id !== chapterId) fail(`current chapter is ${chapter?.id}, not ${chapterId}`);
  if (chapter?.subscription_status !== "active") {
    fail(`chapter subscription_status is ${chapter?.subscription_status}, not active (#2297)`);
  }
  pass(`member of ${chapter.name} (${chapterId}), subscription active`);

  const documents = await api("/v1/documents");
  if (!Array.isArray(documents) || documents.length === 0) fail("the Documents list is empty");
  const opened = await api(`/v1/documents/${documents[0].id}`);
  const downloadUrl = opened?.downloadUrl ?? opened?.download_url;
  if (!downloadUrl) fail(`GET /v1/documents/${documents[0].id} returned no downloadUrl`);
  const file = await fetchWithRetry(downloadUrl, {}, { fetchImpl });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!file.ok || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    fail(`"${documents[0].title}" did not open as a PDF (HTTP ${file.status}) — run \`seed-demo.mjs storage\``);
  }
  pass(`${documents.length} documents; "${documents[0].title}" opens as a ${bytes.length}-byte PDF`);

  // The seed dates events from the day it ran, so an old seed signs in and opens
  // documents like a fresh one while its Events tab shows nothing ahead.
  const events = await api("/v1/events");
  const upcoming = (Array.isArray(events) ? events : [])
    .filter((e) => Date.parse(e.start_time) > now())
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  if (upcoming.length === 0) {
    fail("no upcoming events: the seed is stale. Re-run `sql` and `storage` for this namespace, then verify again");
  }
  pass(`${upcoming.length} upcoming event(s); the next is "${upcoming[0].name}" on ${upcoming[0].start_time.slice(0, 10)}`);

  if (reviewer) {
    const invoices = await api(`/v1/invoices?user_id=${loginUserId}`);
    if (!Array.isArray(invoices) || invoices.length !== 0) {
      fail(`the reviewer has ${Array.isArray(invoices) ? invoices.length : "unreadable"} invoice(s); § Seed the reviewer's chapter wants none`);
    }
    pass("no invoices on the reviewer's own ledger");

    const channels = await api("/v1/channels");
    const dms = Array.isArray(channels) ? channels.filter((c) => c.type === "DM") : [];
    if (dms.length === 0) fail("no direct message in the reviewer's channel list");
    pass(`${dms.length} direct message(s) in the reviewer's channel list`);
  }
  return checks;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export const COMMANDS = ["sql", "auth", "storage", "verify"];

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) {
    throw new Error(`usage: seed-demo.mjs <${COMMANDS.join("|")}> --namespace <hex8> [--reviewer] [--remove] [--api-url <url>]`);
  }
  const options = { command, reviewer: false, remove: false, namespace: undefined, apiUrl: undefined };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--reviewer") options.reviewer = true;
    else if (arg === "--remove") options.remove = true;
    else if (arg === "--namespace" || arg === "--api-url") {
      const value = rest[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      options[arg === "--namespace" ? "namespace" : "apiUrl"] = value;
      i += 1;
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  validateNamespace(options.namespace);
  if (options.remove && options.command === "verify") throw new Error("verify is read-only; it takes no --remove");
  if (options.reviewer && !["sql", "verify"].includes(options.command)) {
    throw new Error(`--reviewer applies to sql and verify, not ${options.command}`);
  }
  return options;
}

/** Thrown after `requireEnv` has already printed why; the CLI adds nothing. */
class ReportedError extends Error {}

/** The shared `requireEnv`, with its exit turned into a throw `main` can own. */
function needEnv(env, io, name, hint) {
  return requireEnv(name, {
    env,
    hint,
    log: (line) => io.err.write(`${line}\n`),
    exit: () => {
      throw new ReportedError(`${name} environment variable is required.`);
    },
  });
}

export async function main(argv, env = process.env, io = { out: process.stdout, err: process.stderr }, fetchImpl = fetch) {
  const options = parseArgs(argv);
  const { namespace } = options;
  const say = (line) => io.err.write(`${line}\n`);

  if (options.command === "sql") {
    if (options.remove) {
      io.out.write(renderRemoveSql({ namespace }));
      return;
    }
    const template = readFileSync(TEMPLATE_PATH, "utf8");
    io.out.write(renderSeedSql({ template, namespace, loginEmail: env.DEMO_EMAIL || undefined, reviewer: options.reviewer }));
    return;
  }

  const supabaseUrl = needEnv(env, io, "SUPABASE_URL", `${options.command} needs the project's API URL.`).replace(/\/+$/, "");

  if (options.command === "verify") {
    const email = validateEmail(needEnv(env, io, "DEMO_EMAIL", "verify signs in as the login."));
    const password = needEnv(env, io, "DEMO_PASSWORD", "verify signs in as the login.");
    // A hosted login that accepts the committed local password is exactly the
    // credential #2308 must never hand App Review, whichever route created it.
    assertPasswordAllowed({ supabaseUrl, password });
    const apiUrl = (options.apiUrl ?? (isLoopbackUrl(supabaseUrl) ? "http://localhost:3001" : null))?.replace(/\/+$/, "");
    if (!apiUrl) throw new Error("--api-url is required for a hosted project (the Signet API that project backs).");
    await verifyLogin({
      supabaseUrl,
      anonKey: needEnv(env, io, "SUPABASE_ANON_KEY", "verify signs in with the anon key."),
      apiUrl,
      email,
      password,
      namespace,
      reviewer: options.reviewer,
      fetchImpl,
      log: say,
    });
    say(`verify: every check passed for namespace ${namespace}`);
    return;
  }

  // auth and storage write with the service key.
  const serviceKey = needEnv(env, io, "SUPABASE_SERVICE_ROLE_KEY", `${options.command} writes with the service key.`);
  assertProductionAllowed({ supabaseUrl, allow: env.DEMO_ALLOW_PRODUCTION });

  if (options.command === "auth") {
    const email = validateEmail(needEnv(env, io, "DEMO_EMAIL", "auth names the login by it."));
    if (options.remove) {
      const result = await removeAuthUser({ supabaseUrl, serviceKey, email, namespace, fetchImpl });
      say(`auth: ${email} ${result.action}${result.id ? ` (${result.id})` : ""}`);
      return;
    }
    const password = env.DEMO_PASSWORD;
    assertPasswordAllowed({ supabaseUrl, password });
    const result = await ensureAuthUser({ supabaseUrl, serviceKey, email, password, namespace, fetchImpl });
    say(`auth: ${email} ${result.action} (${result.id})`);
    return;
  }

  if (options.command === "storage") {
    const results = options.remove
      ? await removePlaceholders({ supabaseUrl, serviceKey, namespace, fetchImpl })
      : await uploadPlaceholders({ supabaseUrl, serviceKey, namespace, fetchImpl });
    for (const { bucket, count } of results) {
      say(`storage: ${options.remove ? "deleted" : "uploaded"} ${count} object(s) in ${bucket}`);
    }
  }
}

// The loose suffix form, for the reason scripts/run-migration.mjs gives: an
// exact-path comparison silently runs nothing from a path with a space or a
// symlink, and exits 0.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith("seed-demo.mjs");
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    if (!(error instanceof ReportedError)) process.stderr.write(`seed-demo: ${error.message}\n`);
    process.exit(1);
  });
}
