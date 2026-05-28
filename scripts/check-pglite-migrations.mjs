#!/usr/bin/env node

// PGlite migration validator — applies every `supabase/migrations/*.sql` to a
// fresh in-process Postgres-in-WASM instance and asserts the schema landmarks
// reviewers care about. Always-on supplemental verification per ADR-11; runs
// in CI alongside `edge-fn-tests` and from any cloud-agent sandbox without
// Docker or a hosted Supabase project.
//
// Coverage: migration syntax, ordering, presence of structural landmarks
// (unique indexes, RLS policy DDL, generated columns). Out of reach:
// Realtime, Presence, GoTrue with real JWTs, RLS enforcement via auth.uid().
// See `docs/internal/AGENT_INFRA.md` ("Agent dev stack") for the integration
// tier (NestJS Jest + hosted Supabase).

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`No .sql files found in ${MIGRATIONS_DIR}`);
  process.exit(1);
}

const db = new PGlite({ extensions: { pgcrypto } });
await db.waitReady;

// PGlite ships without the `auth.*` namespace Supabase RLS policies reference.
// Stub the three functions so policy DDL parses; we don't run as the
// `authenticated` role here, we only verify policy *presence*. Integration
// enforcement lives in the NestJS Jest tier per ADR-11.
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid()  returns uuid language sql as $$ select null::uuid $$;
  create or replace function auth.role() returns text language sql as $$ select 'service_role'::text $$;
  create or replace function auth.jwt()  returns jsonb language sql as $$ select '{}'::jsonb $$;
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

// ─── Schema landmark assertions ─────────────────────────────────────────────
//
// New landmarks added here when a chunk lands a structural invariant a future
// reviewer needs to confirm without spinning up Docker. Each is named for the
// behavior it pins, not the migration that introduced it — migrations rename
// over time, behaviors don't.

const LANDMARKS = [
  {
    name: "chat_messages dedupe partial UNIQUE on (channel_id, sender_id, client_message_id)",
    sql: `select indexdef from pg_indexes where indexname = 'idx_chat_messages_dedupe'`,
    ok: (rows) =>
      rows.length === 1 &&
      /UNIQUE/i.test(rows[0].indexdef) &&
      /client_message_id/.test(rows[0].indexdef) &&
      /WHERE/i.test(rows[0].indexdef),
  },
  {
    name: "chat_message_actions UNIQUE on (message_id, user_id, action_type)",
    sql: `select indexdef from pg_indexes where indexname = 'idx_chat_message_actions_dedupe'`,
    ok: (rows) =>
      rows.length === 1 &&
      /UNIQUE/i.test(rows[0].indexdef) &&
      /message_id/.test(rows[0].indexdef) &&
      /action_type/.test(rows[0].indexdef),
  },
  {
    name: "chapter_audit_log denies UPDATE via RLS policy (qual = false)",
    sql: `select pg_get_expr(polqual, polrelid) as expr
            from pg_policy p
            join pg_class c on c.oid = p.polrelid
           where c.relname = 'chapter_audit_log' and polcmd = 'w'`,
    ok: (rows) =>
      rows.length >= 1 && rows.some((r) => /false/i.test(String(r.expr))),
  },
  {
    name: "chapter_audit_log denies DELETE via RLS policy (qual = false)",
    sql: `select pg_get_expr(polqual, polrelid) as expr
            from pg_policy p
            join pg_class c on c.oid = p.polrelid
           where c.relname = 'chapter_audit_log' and polcmd = 'd'`,
    ok: (rows) =>
      rows.length >= 1 && rows.some((r) => /false/i.test(String(r.expr))),
  },
  {
    name: "chapter_directory has GENERATED search_vector column",
    sql: `select attgenerated from pg_attribute
           where attrelid = 'chapter_directory'::regclass and attname = 'search_vector'`,
    ok: (rows) =>
      rows.length === 1 && rows[0].attgenerated && rows[0].attgenerated !== "",
  },
  {
    name: "RLS enabled on chat_message_actions",
    sql: `select relrowsecurity from pg_class where relname = 'chat_message_actions'`,
    ok: (rows) => rows.length === 1 && rows[0].relrowsecurity === true,
  },
];

console.log("\n=== Schema landmarks ===");
let missing = 0;
for (const lm of LANDMARKS) {
  try {
    const res = await db.query(lm.sql);
    if (lm.ok(res.rows)) {
      console.log(`OK    ${lm.name}`);
    } else {
      missing += 1;
      console.log(
        `MISS  ${lm.name}\n        ↳ rows=${JSON.stringify(res.rows).slice(0, 200)}`,
      );
    }
  } catch (e) {
    missing += 1;
    console.log(
      `ERR   ${lm.name}\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
    );
  }
}

const tableCount = await db.query(
  `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
);
console.log(`\nPublic tables: ${tableCount.rows[0].n}`);

await db.close();

if (missing > 0) {
  console.error(`\nFAILED: ${missing} schema landmark(s) missing or wrong.`);
  process.exit(1);
}

console.log("\nOK — all migrations applied; all schema landmarks present.");
