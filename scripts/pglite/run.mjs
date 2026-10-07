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

import { REPO_ROOT, db, missing } from "./harness.mjs";

const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`No .sql files found in ${MIGRATIONS_DIR}`);
  process.exit(1);
}

// PGlite ships without the `auth.*` namespace Supabase RLS policies reference.
// Stub the three functions so policy DDL parses. These are the DEFAULTS: the
// black-box tiers (`tiers/chat-*.mjs`) replace `auth.uid()` and `auth.role()` per
// scenario to impersonate a signed-in or anonymous client, and read the tables
// through non-owner probe roles granted `authenticated` or `anon`. So this gate does
// verify enforcement, not only presence — what stays with the NestJS Jest tier
// is a real GoTrue-minted JWT (claims beyond `sub`/`role`), per ADR-11/ADR-12.
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid()  returns uuid language sql as $$ select null::uuid $$;
  create or replace function auth.role() returns text language sql as $$ select 'service_role'::text $$;
  create or replace function auth.jwt()  returns jsonb language sql as $$ select '{}'::jsonb $$;
`);

// Stand up Supabase's four roles BEFORE applying migrations. Migrations wrap
// policy, grant and revoke statements in `if exists (select 1 from pg_roles
// where rolname = '<role>')` — the repo's dominant idiom for anything that
// targets a Supabase role, because the roles exist on hosted Supabase but not
// in a bare Postgres. Without a role here, every block guarded on it is skipped
// silently, so the harness validates a schema the hosted project does not run.
//
// That was a live false-PASS, not a theoretical one (#423): a permissive
// `create policy ... to authenticated using (true)` written in that idiom left
// this entire script green while handing every signed-in client every row of
// the table. Creating `authenticated` is what makes the black-box tiers below
// see the policies they exist to check, and it exercises the `to
// authenticated` clause itself (`v_role_clause`).
//
// The other three close the same class for their own guards (#1557): about 35
// blocks guard on `anon` and 34 on `service_role`. A `revoke ... from anon`
// naming the wrong function signature is the case that matters: with the role
// absent the statement never ran, this job stayed green, and `supabase db
// push` aborted on the hosted project, where the role exists.
// `supabase_auth_admin` guards the custom-access-token hook's grants and its
// two `auth_admin_can_read_*` policies, which now exist here too.
//
// Attributes follow the local Supabase image's `pg_roles`, except LOGIN, which
// nothing here uses: `service_role` alone bypasses RLS, `supabase_auth_admin`
// is NOINHERIT and CREATEROLE, and neither client role is a member of the
// other. The last is the one that matters, because a policy binds every
// member of the roles it names.
await db.exec(`
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
  create role supabase_auth_admin nologin noinherit createrole;
`);

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
// Each tier is a module under `tiers/` whose body runs when it is imported.
// They share one database and run in this order, each awaited before the next
// starts: two sibling static imports with top-level `await` are not
// guaranteed to finish in order, so the order lives here, as awaited dynamic
// imports. Several tiers open and roll back their own transaction, and the
// chat read-enforcement fixtures stay seeded across the two chat tiers, so
// reordering them is a behaviour change, not a tidy-up.
await import("./tiers/schema-and-rls-smoke.mjs");
await import("./tiers/policy-inventory.mjs");
await import("./tiers/anonymize-user.mjs");
await import("./tiers/chat-read-enforcement.mjs");
await import("./tiers/chat-black-box.mjs");
await import("./tiers/attachment-backfill.mjs");
await import("./tiers/chapter-directory-seed.mjs");
await import("./tiers/demo-seed.mjs");
await import("./tiers/security-definer-search-path.mjs");
await import("./tiers/points-leaderboard.mjs");
await import("./tiers/subscription-webhook-cas.mjs");
await import("./tiers/hide-direct-message.mjs");
await import("./tiers/private-channel-members.mjs");
await import("./tiers/sidebar-section-fold.mjs");
await import("./tiers/unread-counts-blocked-sender.mjs");
await import("./tiers/discord-author-links.mjs");
await import("./tiers/discord-import-purge.mjs");
await import("./tiers/discord-import-merge-target.mjs");
await import("./tiers/dm-one-per-pair.mjs");

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
