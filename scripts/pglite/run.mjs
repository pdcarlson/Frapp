#!/usr/bin/env node

// PGlite migration validator — applies every `supabase/migrations/*.sql` to a
// fresh in-process Postgres-in-WASM instance and asserts the schema landmarks
// reviewers care about. Always-on supplemental verification per ADR-11/ADR-12;
// runs in CI as the `pglite-migrations` job and from any cloud-agent sandbox
// without Docker or a hosted Supabase project.
//
// Coverage: migration syntax, ordering, presence of structural landmarks
// (unique indexes, generated columns), and a two-part RLS tier:
//
//   - POSTURE, from the catalog — every public table has RLS enabled (Frapp's
//     default-deny invariant), plus the chat hot-path posture (`chat_channels`
//     default-deny with no policies; `chat_messages` and `chat_message_actions`
//     carry client-read policies that must stay scoped to `auth.uid()` — "no
//     policies" stopped being the invariant for `chat_messages` when
//     20260816140000 gave it one) and an exact policy inventory.
//   - ENFORCEMENT, black-box — non-owner probe roles with `auth.uid()` and
//     `auth.role()` stubbed per scenario read the tables for real, as a
//     signed-in client and as the anon key. Positive sets for
//     `chat_messages` / `chat_message_actions`, which
//     carry client-reachable policies; zero-row denial for `members` and
//     `financial_invoices`, which carry none (#423). Posture alone cannot see
//     a policy whose predicate is wrong but whose shape is fine.
//
// Out of reach: Realtime, Presence, and GoTrue with real JWTs — the enforcement
// tier stubs the two `auth.*` functions rather than minting a token, so claims
// beyond `sub` and `role` are not exercised here. That half stays with the
// NestJS Jest tier. See `docs/ci-cd/agent-infra.md` ("Agent dev
// stack").
//
// Extensions: a migration may only use what is registered on the PGlite
// constructor in `harness.mjs` — `pgcrypto` and `vector` (pgvector) today. An unregistered
// extension fails with `extension "X" is not available`, which reads like a
// PGlite limitation but is a one-line fix there. Registering the extension is
// the preferred answer; carving migrations out of this gate is not. Since
// PGlite 0.5 that can also mean adding a dependency: only `contrib/*` still
// ships inside the main package, and everything else lives in its own
// `@electric-sql/pglite-*` package.
//
// `apps/web/lib/realtime/change-topics.spec.ts` replays the same migrations on
// its own PGlite (with a stand-in `realtime` schema and an `anon` role), so a
// new extension or pre-existing role has to be registered there as well. CI
// runs that spec in this job, so a missing extension fails the same PR. A
// missing role does not: migrations guard role-targeted statements on
// `pg_roles`, so both harnesses skip them silently.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  AUTH_STUBS_SQL,
  DEFAULT_PRIVILEGES_SQL,
  SUPABASE_ROLES_SQL,
} from "./bootstrap.mjs";
import { REPO_ROOT, db, missing } from "./harness.mjs";
import { runTiers } from "./tier-list.mjs";

const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`No .sql files found in ${MIGRATIONS_DIR}`);
  process.exit(1);
}

// What a bare Postgres needs before the migrations apply as they do on hosted
// Supabase: the `auth.*` stubs, Supabase's four roles, and its default
// privileges. Why each matters for this gate (#423, #1557, #3052) is written
// beside the SQL in `bootstrap.mjs`, which the two-connection lock harness
// (`scripts/db-race/`) applies too.
await db.exec(AUTH_STUBS_SQL);
await db.exec(SUPABASE_ROLES_SQL);
await db.exec(DEFAULT_PRIVILEGES_SQL);

const migrationResults = [];
const tApplyStart = performance.now();

for (const f of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
  const start = performance.now();
  try {
    await db.exec(sql);
    migrationResults.push({ file: f, ok: true, ms: performance.now() - start });
  } catch (e) {
    migrationResults.push({
      file: f,
      ok: false,
      ms: performance.now() - start,
      err: String(e?.message ?? e),
    });
  }
}

const totalApplyMs = performance.now() - tApplyStart;
const failed = migrationResults.filter((r) => !r.ok);

console.log("=== Migration apply ===");
for (const r of migrationResults) {
  const tag = r.ok ? "OK  " : "FAIL";
  const line = `${tag}  ${r.ms.toFixed(0).padStart(5)}ms  ${r.file}`;
  console.log(r.ok ? line : `${line}\n        ↳ ${r.err.split("\n")[0]}`);
}
console.log(
  `\nApplied ${files.length - failed.length}/${files.length} in ${totalApplyMs.toFixed(0)}ms`,
);

if (failed.length > 0) {
  console.error(`\nFAILED: ${failed.length} migration(s) errored.`);
  await db.close();
  process.exit(1);
}

// ─── Tiers ──────────────────────────────────────────────────────────────────
//
// Every file in `tiers/`, in filename order, each awaited before the next
// starts. Adding a tier is adding its file. How the order is set, and what a
// tier that needs a place in it does: `tier-list.mjs`.
await runTiers();

const tableCount = await db.query(
  `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
);
console.log(`\nPublic tables: ${tableCount.rows[0].n}`);

await db.close();

if (missing > 0) {
  console.error(
    `\nFAILED: ${missing} schema landmark / RLS smoke assertion(s) missing or wrong.`,
  );
  process.exit(1);
}

console.log(
  "\nOK — all migrations applied; schema landmarks + RLS smoke assertions present.",
);
