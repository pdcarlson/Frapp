#!/usr/bin/env node

// PGlite migration validator — applies every `supabase/migrations/*.sql` to a
// fresh in-process Postgres-in-WASM instance and asserts the schema landmarks
// reviewers care about. Always-on supplemental verification per ADR-11/ADR-12;
// runs in CI as the `pglite-migrations` job and from any cloud-agent sandbox
// without Docker or a hosted Supabase project.
//
// Coverage: migration syntax, ordering, presence of structural landmarks
// (unique indexes, generated columns), and an RLS smoke tier — every public
// table has RLS enabled (Frapp's default-deny invariant) plus the chat
// hot-path RLS posture (default-deny channels/messages; ownership-scoped
// reaction policies). Out of reach: Realtime, Presence, GoTrue with real JWTs,
// and RLS *enforcement* as the `authenticated` role (SET ROLE + real JWT) —
// tracked in #423 and the NestJS Jest tier. See
// `docs/internal/ci-cd/AGENT_INFRA.md` ("Agent dev stack").
//
// Extensions: a migration may only use what is registered on the PGlite
// constructor below — `pgcrypto` and `vector` (pgvector) today. An unregistered
// extension fails with `extension "X" is not available`, which reads like a
// PGlite limitation but is a one-line fix here. Registering the extension is
// the preferred answer; carving migrations out of this gate is not. Since
// PGlite 0.5 that can also mean adding a dependency: only `contrib/*` still
// ships inside the main package, and everything else lives in its own
// `@electric-sql/pglite-*` package.

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
// PGlite 0.5 unbundled the non-contrib extensions into their own packages —
// `./vector`, `./age`, `./pg_uuidv7` and friends all disappeared from the
// `exports` map, so this import is `@electric-sql/pglite-pgvector` now. The
// registration below is unchanged: same `vector` export, same constructor
// slot. That package peer-depends on an exact `@electric-sql/pglite`, so the
// two versions move together or `npm ci` says so.
import { vector } from "@electric-sql/pglite-pgvector";
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

// `vector` is registered ahead of any migration needing it (FRA-308). PGlite
// only makes a bundled extension *available*; `create extension vector` still
// has to be written in a migration, exactly like `pgcrypto`. Registering it
// adds no cost this gate can measure until then (the bundle is a lazily-unpacked
// tarball, not a running extension; wall-clock is unchanged within run-to-run
// noise) — and it is what lets the AI corpus migrations (ADR-13 §13) replay
// here instead of forcing a carve-out out of this gate. See the `pg_available_
// extensions` landmark below, which fails if this registration is ever dropped.
const db = new PGlite({ extensions: { pgcrypto, vector } });
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
    // `NULLS NOT DISTINCT` is load-bearing, not decoration. `sender_id` became
    // nullable for imported archive rows (20260823120000), and Postgres treats
    // NULLs in a unique index as distinct by default — so without it this index
    // silently stops enforcing anything for exactly the rows that need it, and a
    // re-run importer inserts the whole archive a second time with no error.
    name: "chat_messages dedupe partial UNIQUE (channel_id, sender_id, client_message_id) NULLS NOT DISTINCT",
    sql: `select indexdef from pg_indexes where indexname = 'idx_chat_messages_dedupe'`,
    ok: (rows) =>
      rows.length === 1 &&
      /UNIQUE/i.test(rows[0].indexdef) &&
      /client_message_id/.test(rows[0].indexdef) &&
      /NULLS NOT DISTINCT/i.test(rows[0].indexdef) &&
      /WHERE/i.test(rows[0].indexdef),
  },
  {
    // A nullable sender is only safe because the row still names its author.
    // Dropping this constraint would let a message exist with no attribution at
    // all, which every renderer would then have to invent copy for.
    name: "chat_messages requires an author: sender_id or author_name (validated)",
    sql: `select convalidated, pg_get_constraintdef(oid) as def
            from pg_constraint
           where conname = 'chat_messages_author_present'`,
    ok: (rows) =>
      rows.length === 1 &&
      rows[0].convalidated === true &&
      /sender_id IS NOT NULL/i.test(rows[0].def ?? "") &&
      /author_name IS NOT NULL/i.test(rows[0].def ?? ""),
  },
  {
    name: "chat_messages.sender_id is nullable (archive rows have no Signet user)",
    sql: `select is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'chat_messages'
             and column_name = 'sender_id'`,
    ok: (rows) => rows.length === 1 && rows[0].is_nullable === "YES",
  },
  {
    // The message search index. Without it `GET /v1/search` sequentially scans
    // `chat_messages`, which is survivable only while the table is small — and
    // the archive import is precisely what stops it being small.
    name: "chat_messages full-text search: generated tsvector + GIN index",
    sql: `select
            (select is_generated from information_schema.columns
              where table_schema = 'public' and table_name = 'chat_messages'
                and column_name = 'content_search') as generated,
            (select indexdef from pg_indexes
              where indexname = 'idx_chat_messages_content_search') as indexdef`,
    ok: (rows) =>
      rows.length === 1 &&
      rows[0].generated === "ALWAYS" &&
      /USING gin/i.test(rows[0].indexdef ?? ""),
  },
  {
    name: "chat_message_attachments exists with a message + channel FK",
    sql: `select
            (select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = 'chat_message_attachments'
                and column_name in ('message_id','channel_id','bucket','storage_path','filename'))::int as cols,
            (select count(*) from pg_constraint
              where conrelid = 'public.chat_message_attachments'::regclass
                and contype = 'u')::int as uniques`,
    ok: (rows) => rows.length === 1 && rows[0].cols === 5 && rows[0].uniques >= 1,
  },
  {
    // Default deny, like chat_channels. The table is not a Realtime carrier and
    // is read only by the API on the service-role key, so a permissive policy
    // would open a direct-PostgREST read surface nothing needs.
    name: "RLS enabled on chat_message_attachments + default-deny (no policies)",
    sql: `select c.relrowsecurity,
                 (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'chat_message_attachments'`,
    ok: (rows) =>
      rows.length === 1 &&
      rows[0].relrowsecurity === true &&
      rows[0].policies === 0,
  },
  {
    // Both halves matter and they are independent: the kind rule is what keeps a
    // freshly imported archive from handing every member a five-figure badge,
    // and `is distinct from` is what keeps the sender rule correct now that
    // `sender_id` can be NULL. Spelling only one of them leaves the other's
    // behaviour depending on three-valued logic nobody stated.
    name: "get_channel_unread_counts excludes imported rows and is null-safe on sender",
    sql: `select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'get_channel_unread_counts'`,
    ok: (rows) =>
      rows.length === 1 &&
      /kind\s*<>\s*'imported'/i.test(rows[0].prosrc ?? "") &&
      /sender_id\s+is\s+distinct\s+from/i.test(rows[0].prosrc ?? ""),
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
    name: "roles system_key partial UNIQUE on (chapter_id, system_key) (FRA-320)",
    sql: `select indexdef from pg_indexes where indexname = 'idx_roles_chapter_system_key'`,
    ok: (rows) =>
      rows.length === 1 &&
      /UNIQUE/i.test(rows[0].indexdef) &&
      /system_key/.test(rows[0].indexdef) &&
      // Partial, so the unbounded set of custom roles (system_key null) is
      // unconstrained while each chapter keeps at most one role per key.
      /WHERE/i.test(rows[0].indexdef),
  },
  {
    name: "seeded system roles are backfilled with a system_key (FRA-320)",
    sql: `select count(*)::int as missing from roles
           where is_system = true and system_key is null`,
    // Vacuously true on a fresh PGlite database (no rows), but pins the
    // backfill's shape so a later migration that seeds roles without a key
    // fails here rather than silently reopening the rename hole.
    ok: (rows) => rows.length === 1 && rows[0].missing === 0,
  },
  {
    name: "chapter_directory has GENERATED search_vector column",
    sql: `select attgenerated from pg_attribute
           where attrelid = 'chapter_directory'::regclass and attname = 'search_vector'`,
    ok: (rows) =>
      rows.length === 1 && rows[0].attgenerated && rows[0].attgenerated !== "",
  },
  {
    name: "anonymize_user RPC present, security invoker (FRA-40)",
    sql: `select prosecdef from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'anonymize_user'`,
    ok: (rows) => rows.length === 1 && rows[0].prosecdef === false,
  },
  {
    // Capability landmark, not a schema landmark: nothing creates the extension
    // yet (the AI corpus migrations are still ahead of us — FRA-309). It pins the
    // FRA-308 decision that pgvector clears this gate by registration alone, so
    // dropping the `vector` import fails here and now rather than under the first
    // corpus migration, where it would read as "pgvector doesn't work in PGlite"
    // and re-open a question that is settled. Availability is the whole contract:
    // `create extension vector` cannot succeed without it, and needs nothing else.
    name: "pgvector available to migrations (create extension vector will resolve) — FRA-308",
    sql: `select default_version from pg_available_extensions where name = 'vector'`,
    ok: (rows) => rows.length === 1 && Boolean(rows[0].default_version),
  },
];

// ─── RLS smoke (ADR-12) ─────────────────────────────────────────────────────
//
// Frapp's data model is default-deny RLS + service-role bypass: the API holds
// the service-role key and enforces access control in NestJS, while direct
// Supabase-client access is denied unless a policy explicitly opens it. This
// tier guards that invariant — it asserts policy *presence* and shape, not
// enforcement as the `authenticated` role (that's #423 + the NestJS Jest tier).

// Tables intentionally exempt from the "RLS enabled" invariant. Empty today —
// all 38 tables enable RLS. Add a table here ONLY with a reviewed justification
// (e.g. a stateless lookup view), and prefer keeping RLS on with a deny policy.
const RLS_EXEMPT_TABLES = new Set([]);

const RLS_SMOKE = [
  {
    name: "RLS enabled on chat_channels + default-deny (no policies)",
    sql: `select c.relrowsecurity as rls,
                 (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
            from pg_class c where c.relname = 'chat_channels'`,
    ok: (rows) =>
      rows.length === 1 && rows[0].rls === true && rows[0].policies === 0,
  },
  {
    name: "RLS enabled on chat_messages",
    sql: `select relrowsecurity from pg_class where relname = 'chat_messages'`,
    ok: (rows) => rows.length === 1 && rows[0].relrowsecurity === true,
  },
  {
    // Was "default-deny (no policies)" until 2026-08-16. That assertion was
    // correct for the schema but described a table nothing could read — and the
    // `postgres_changes` subscription that depended on reading it had been dead
    // since the first deploy (#867: `supabase_realtime` held no tables at all in
    // prod or staging). Repairing the carrier required publishing the table,
    // and Realtime enforces RLS per subscriber, so a policy became mandatory.
    //
    // The landmark is therefore TIGHTENED, not dropped: "no policies" is no
    // longer the invariant, but "no policy broader than channel membership"
    // still is, and that is the property that actually protects the table now
    // that the browser can reach it. Same construction and same caveats as the
    // chat_message_actions assertion below — read its comment for why
    // `rows.length === 1`, `polpermissive` and `polcmd in ('r','*')` are each
    // load-bearing, and for why the expression match is a smoke test rather
    // than a proof.
    name: "chat_messages SELECT gated to authenticated AND scoped via can_read_chat_message (#867)",
    sql: `select pg_get_expr(polqual, polrelid) as using_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_messages'
             and p.polpermissive
             and p.polcmd in ('r', '*')`,
    ok: (rows) =>
      rows.length === 1 &&
      /can_read_chat_message\((?:\w+\.)?id\)/.test(rows[0].using_expr ?? "") &&
      /authenticated/.test(rows[0].using_expr ?? "") &&
      // The imported-row exclusion is the Realtime fan-out control, not a
      // cosmetic filter. Supabase Realtime evaluates THIS policy per subscriber
      // (`realtime.apply_rls`), and a publication row filter cannot do the job —
      // `realtime.list_changes` builds wal2json's `add-tables` from table names
      // only and never reads `prqual`. Drop this clause and a bulk archive
      // import fans a frame per row out to every open client.
      /kind\s*<>\s*'imported'/i.test(rows[0].using_expr ?? ""),
  },
  {
    name: "RLS enabled on chat_message_actions",
    sql: `select relrowsecurity from pg_class where relname = 'chat_message_actions'`,
    ok: (rows) => rows.length === 1 && rows[0].relrowsecurity === true,
  },
  {
    name: "chat_message_actions SELECT gated to authenticated AND scoped via can_read_chat_message (FRA-38)",
    // `polcmd in ('r','*')` — a FOR ALL policy (polcmd '*') also applies to SELECT
    // and OR-s in, so filtering on 'r' alone would let `for all using (true)`
    // reopen the leak with this assertion still green.
    // `polpermissive` — only permissive policies OR together. A RESTRICTIVE policy
    // can only narrow, so counting one would fail CI on a legitimate hardening.
    sql: `select pg_get_expr(polqual, polrelid) as using_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_message_actions'
             and p.polpermissive
             and p.polcmd in ('r', '*')`,
    // EXACTLY ONE permissive read-applicable policy, AND-ing the two terms.
    //
    // `rows.length === 1` is the load-bearing half. Postgres OR-s permissive
    // policies together, so a second `using (true)` added later restores "any
    // authenticated user reads every row" — the whole FRA-38 leak — while the
    // hardened policy sits untouched and a `some()` check still passes.
    //
    // The expression check is a cheap smoke test, NOT a proof. It is substring
    // shaped, so a determined rewrite slips past it — `... AND
    // can_read_chat_message(message_id) IS NOT NULL` is constant-true (the helper
    // is an `exists`, never null), and De Morgan spells an OR using only `AND`
    // and `NOT`. The real enforcement guarantee comes from the black-box tier
    // below, which reads the table as an unprivileged role; treat this assertion
    // as "the policy still looks like what we wrote", nothing stronger.
    //
    // `message_id` is matched with an optional table qualifier because hoisting
    // the helper into an initplan — `(select can_read_chat_message(message_id))`,
    // the FRA-291 optimization — makes Postgres render it as
    // `chat_message_actions.message_id`. Likewise `auth.role()` is accepted in the
    // initplan form `( SELECT auth.role() AS role)`.
    ok: (rows) => {
      if (rows.length !== 1) return false;
      const e = String(rows[0].using_expr);
      return (
        /auth\.role\(\)/i.test(e) &&
        /'authenticated'/i.test(e) &&
        /can_read_chat_message\s*\(\s*(?:\w+\.)?message_id\s*\)/i.test(e) &&
        /\band\b/i.test(e) &&
        !/\bor\b/i.test(e)
      );
    },
  },
  {
    name: "users stays default-deny to client roles (the invariant that closes the action-write path)",
    // chat_message_actions' INSERT/DELETE policies gate on
    // `user_id in (select id from users where supabase_auth_id = auth.uid())`.
    // That subselect is what refuses direct-client writes — but only while `users`
    // has no permissive policy reachable by a client role. Adding a routine
    // "read your own row" policy to `users` would flip cross-channel action writes
    // live without touching chat_message_actions at all. The auth-hook policies
    // added by 20260802120000 are scoped `TO supabase_auth_admin` and don't count.
    sql: `select count(*)::int as n
            from pg_policy p
            join pg_class c on c.oid = p.polrelid
           where c.relname = 'users'
             and p.polpermissive
             and p.polcmd in ('r', '*')
             and (
               p.polroles = '{0}'::oid[]
               or exists (
                 select 1 from pg_roles r
                  where r.oid = any (p.polroles)
                    and r.rolname in ('anon', 'authenticated', 'public')
               )
             )`,
    ok: (rows) => rows.length === 1 && rows[0].n === 0,
  },
  {
    name: "can_read_chat_message() EXECUTE is revoked from PUBLIC (not a wide-open PostgREST RPC oracle)",
    // The helper is SECURITY DEFINER and answers "may I read this message?", so
    // exposing it as an RPC hands out a membership oracle. A later `drop function;
    // create function` silently restores the default PUBLIC grant, so pin it.
    //
    // LIMITATION: this checks the PUBLIC bit only, because PGlite has no `anon`
    // role to check. Hosted Supabase grants `anon` EXECUTE *directly* via ALTER
    // DEFAULT PRIVILEGES, not through PUBLIC — so a drop/recreate there could
    // restore anon's grant while this assertion stays green. The
    // `has_function_privilege('anon', ...)` check in DB_PROMOTION_RUNBOOK.md is
    // what covers that; it is a promotion-time check, not a CI one.
    sql: `select has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'can_read_chat_message'`,
    ok: (rows) => rows.length === 1 && rows[0].public_exec === false,
  },
  {
    name: "can_read_chat_message() is SECURITY DEFINER with search_path pinned to exactly public",
    sql: `select prosecdef, proconfig
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'can_read_chat_message'`,
    // The pin must be exactly `search_path = public` (a single schema). Parse each
    // proconfig item, tolerate optional quoting (`public` vs `"public"`), and reject
    // any extra schema (e.g. `public, pg_catalog`) so a weakened pin fails.
    ok: (rows) => {
      if (rows.length !== 1 || rows[0].prosecdef !== true) return false;
      const cfg = rows[0].proconfig;
      const items = Array.isArray(cfg)
        ? cfg
        : String(cfg ?? "")
            .replace(/^\{|\}$/g, "")
            .split(",");
      return items.some((it) =>
        /^\s*search_path\s*=\s*"?public"?\s*$/i.test(String(it)),
      );
    },
  },
  {
    name: "chat_message_actions keeps DEFAULT replica identity (FULL is permanent WAL cost that cannot feed this policy)",
    // Pins the deliberate choice documented in the migration. Realtime does not
    // apply RLS to DELETE, and with RLS enabled the `old` record is trimmed to
    // primary keys regardless of replica identity — so FULL cannot feed
    // message_id to this policy or to the client, and only adds WAL volume to
    // every delete. 'd' is the default; anything else means someone re-added it
    // on the disproven rationale.
    sql: `select relreplident from pg_class where relname = 'chat_message_actions'`,
    ok: (rows) => rows.length === 1 && rows[0].relreplident === "d",
  },
  {
    name: "chat_message_actions INSERT scoped to the caller's own user_id (auth.uid())",
    sql: `select pg_get_expr(polwithcheck, polrelid) as check_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_message_actions' and polcmd = 'a'`,
    ok: (rows) =>
      rows.length >= 1 &&
      rows.some(
        (r) =>
          /user_id/i.test(String(r.check_expr)) &&
          /auth\.uid\(\)/i.test(String(r.check_expr)),
      ),
  },
  {
    name: "chat_message_actions DELETE scoped to the caller's own user_id (auth.uid())",
    sql: `select pg_get_expr(polqual, polrelid) as using_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_message_actions' and polcmd = 'd'`,
    ok: (rows) =>
      rows.length >= 1 &&
      rows.some(
        (r) =>
          /user_id/i.test(String(r.using_expr)) &&
          /auth\.uid\(\)/i.test(String(r.using_expr)),
      ),
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
];

let missing = 0;

async function runOne(lm) {
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

async function runAssertions(title, list) {
  console.log(`\n=== ${title} ===`);
  for (const lm of list) await runOne(lm);
}

await runAssertions("Schema landmarks", LANDMARKS);

// Default-deny invariant (#360): every base table in `public` must enable RLS.
// Catalog-driven, so it covers CREATE TABLE IF NOT EXISTS / quoted / schema-
// qualified forms for free — it inspects the applied schema, not the SQL text.
console.log("\n=== RLS smoke ===");
{
  const res = await db.query(
    `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
      order by c.relname`,
  );
  const offenders = res.rows
    .map((r) => r.relname)
    .filter((t) => !RLS_EXEMPT_TABLES.has(t));
  if (offenders.length === 0) {
    console.log("OK    every public table enables RLS (default-deny invariant)");
  } else {
    missing += 1;
    console.log(
      `MISS  ${offenders.length} public table(s) without RLS enabled\n        ↳ ${offenders.join(", ")}`,
    );
  }
}
for (const lm of RLS_SMOKE) await runOne(lm);

// ─── Functional smoke: anonymize_user (FRA-40) ──────────────────────────────
//
// The account-deletion contract (spec/behavior/data-retention.md "Individual
// Account Deletion") is a *data* invariant — "history preserved, PII gone" —
// so shape assertions alone can't pin it. This tier seeds a user with
// preserved history (point transaction, chat messages, task card) plus
// current-state rows (membership, settings, push token), runs the RPC twice
// (the second call proves idempotent retry), asserts the tombstone contract,
// and rolls the whole thing back so the validated schema stays untouched.

console.log("\n=== Functional smoke: anonymize_user ===");
{
  const U = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // doomed user
  const C = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // chapter
  const CH = "cccccccc-cccc-cccc-cccc-cccccccccccc"; // channel
  const CARD = "dddddddd-dddd-dddd-dddd-dddddddddddd"; // task-card message
  const EVCARD = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"; // event-card message
  const PCARD = "ffffffff-ffff-ffff-ffff-ffffffffffff"; // punctuation-name card
  const LATECARD = "99999999-9999-9999-9999-999999999999"; // card racing the scrub

  // ─── change-ping tables stay writable without a `realtime` schema ──────────
  //
  // 20260816140000 (#867) puts AFTER-ROW triggers on notifications / events /
  // event_attendance that call `realtime.send()`. plpgsql resolves that at RUN
  // time, not CREATE time, so a migration referencing a schema this substrate
  // does not have applies perfectly and then makes three core tables
  // unwritable on the first insert — an AFTER trigger raising unwinds the
  // caller's statement, `return null` notwithstanding.
  //
  // This tier exists because nothing else here writes to those three tables:
  // every assertion above stayed green while inserts into them were broken,
  // which is precisely how the defect reached review. Keep at least one write
  // per ping table here.
  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university)
        values ('11111111-1111-1111-1111-111111111111', 'Ping', 'RPI');
      insert into users (id, supabase_auth_id, email, display_name)
        values ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), 'ping@example.com', 'Ping');
      insert into notifications (chapter_id, user_id, title, body)
        values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 't', 'b');
      insert into events (id, chapter_id, name, start_time, end_time)
        values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
                'probe', now(), now() + interval '1 hour');
      insert into event_attendance (event_id, user_id, status)
        values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'PRESENT');
      commit;
    `);
    console.log("OK    change-ping tables accept writes with no `realtime` schema");
  } catch (e) {
    missing += 1;
    console.log(
      `ERR   change-ping tables accept writes with no \`realtime\` schema\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
    );
  }

  let seeded = false;
  try {
    await db.exec(`
      begin;
      insert into users (id, supabase_auth_id, email, display_name, bio, avatar_url, graduation_year, current_city)
      values ('${U}', gen_random_uuid(), 'doomed@example.com', 'Doomed User', 'bio', 'chapters/${C}/profiles/${U}/a.png', 2027, 'Troy');
      insert into chapters (id, name, university) values ('${C}', 'Smoke', 'RPI');
      insert into members (user_id, chapter_id) values ('${U}', '${C}');
      insert into point_transactions (chapter_id, user_id, amount, category, description)
      values ('${C}', '${U}', 5, 'SERVICE', 'helped');
      insert into chat_channels (id, chapter_id, name, type) values ('${CH}', '${C}', 'general', 'PUBLIC');
      insert into chat_messages (channel_id, sender_id, content) values ('${CH}', '${U}', 'hi, Doomed User here');
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload)
      values ('${CARD}', '${CH}', '${U}',
              'Assigned "T" to Doomed User (due tomorrow) cc Doomed Userling', 'task',
              '{"assigner_user_id":"someone-else","assigner_name":"Someone Else","assignee_user_id":"${U}","assignee_name":"Doomed User"}'::jsonb);
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload)
      values ('${EVCARD}', '${CH}', '${U}',
              'Doomed User scheduled "BBQ" — Aug 9, 6:00 PM UTC', 'event',
              '{"event_id":"ev1","name":"BBQ"}'::jsonb);
      -- Punctuation-bounded snapshot: word boundaries can never match it, so
      -- the helper must fall back to exact-substring replacement.
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload)
      values ('${PCARD}', '${CH}', '${U}',
              'Granted 5 points to (DU) Doomed: nice work', 'points',
              '{"actor_user_id":"someone-else","actor_name":"Someone Else","recipient_user_id":"${U}","recipient_name":"(DU) Doomed"}'::jsonb);
      insert into user_settings (user_id) values ('${U}');
      insert into push_tokens (user_id, token) values ('${U}', 'ExponentPushToken[smoke]');
      -- Rename before deletion: the content rewrite must key on the card's own
      -- payload snapshot ('Doomed User'), not the live display name.
      update users set display_name = 'D' where id = '${U}';
      select anonymize_user('${U}');
      -- Simulate the retry window: the tombstone gets PII written back onto it
      -- (PATCH /users/me is possible while the auth account still exists). The
      -- second call must RE-scrub the users row — no tombstone early-return —
      -- while skipping the card scan (retries stay cheap).
      update users set display_name = 'Sneaky Comeback', bio = 'still here' where id = '${U}';
      select anonymize_user('${U}');
      -- Simulate a card writer that raced the first scrub: its snapshot lands
      -- after the one gated card scan. The convergence call (rescan=true) must
      -- repair it.
      insert into chat_messages (id, channel_id, sender_id, content, kind, payload)
      values ('${LATECARD}', '${CH}', '${U}',
              'Assigned "Z" to Doomed User (due later)', 'task',
              '{"assigner_user_id":"someone-else","assigner_name":"Someone Else","assignee_user_id":"${U}","assignee_name":"Doomed User"}'::jsonb);
      select anonymize_user('${U}', true);
    `);
    seeded = true;
  } catch (e) {
    missing += 1;
    console.log(
      `ERR   anonymize_user functional seed\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
    );
  }

  if (seeded) {
    const FUNCTIONAL = [
      {
        name: "users row tombstoned in place, re-scrubbed on retry (PII re-added in the window is gone)",
        sql: `select display_name, email, bio, avatar_url, graduation_year, current_city,
                     (deleted_at is not null) as tombstoned
                from users where id = '${U}'`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].display_name === "Deleted User" &&
          rows[0].email === `deleted+${U}@anonymized.invalid` &&
          rows[0].bio === null &&
          rows[0].avatar_url === null &&
          rows[0].graduation_year === null &&
          rows[0].current_city === null &&
          rows[0].tombstoned === true,
      },
      {
        name: "history preserved: point transaction + chat messages keep their user FKs",
        sql: `select (select count(*)::int from point_transactions where user_id = '${U}') as points,
                     (select count(*)::int from chat_messages where sender_id = '${U}') as messages`,
        ok: (rows) =>
          rows.length === 1 && rows[0].points === 1 && rows[0].messages === 5,
      },
      {
        name: "current-state purged: membership, settings, push token",
        sql: `select (select count(*)::int from members where user_id = '${U}')
                   + (select count(*)::int from user_settings where user_id = '${U}')
                   + (select count(*)::int from push_tokens where user_id = '${U}') as leftovers`,
        ok: (rows) => rows.length === 1 && rows[0].leftovers === 0,
      },
      {
        name: "task card rewritten in payload AND content via payload snapshot (rename-proof, word-boundary safe)",
        sql: `select payload->>'assigner_name' as assigner, payload->>'assignee_name' as assignee,
                     content
                from chat_messages where id = '${CARD}'`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].assigner === "Someone Else" &&
          rows[0].assignee === "Deleted User" &&
          // 'Doomed Userling' must survive — word boundaries prevent the
          // substring collision the raw replace() had.
          rows[0].content ===
            'Assigned "T" to Deleted User (due tomorrow) cc Doomed Userling',
      },
      {
        name: "event card creator prefix rewritten in content (no payload name to rewrite)",
        sql: `select content, payload->>'name' as event_name
                from chat_messages where id = '${EVCARD}'`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].content === 'Deleted User scheduled "BBQ" — Aug 9, 6:00 PM UTC' &&
          rows[0].event_name === "BBQ",
      },
      {
        name: "punctuation-bounded snapshot rewritten via exact-substring fallback",
        sql: `select payload->>'recipient_name' as recipient, content
                from chat_messages where id = '${PCARD}'`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].recipient === "Deleted User" &&
          rows[0].content === "Granted 5 points to Deleted User: nice work",
      },
      {
        name: "card that raced the first scrub is repaired by the rescan (convergence) call",
        sql: `select payload->>'assignee_name' as assignee, content
                from chat_messages where id = '${LATECARD}'`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].assignee === "Deleted User" &&
          rows[0].content === 'Assigned "Z" to Deleted User (due later)',
      },
      {
        name: "member-typed free text is NOT rewritten (only system-generated cards)",
        sql: `select content from chat_messages
               where sender_id = '${U}' and kind = 'text'`,
        ok: (rows) => rows.length === 1 && rows[0].content === "hi, Doomed User here",
      },
    ];
    for (const lm of FUNCTIONAL) await runOne(lm);
  }

  await db.exec("rollback;");
}

// ─── chat_message_actions read enforcement (FRA-38) ─────────────────────────
//
// The membership-scoped SELECT policy delegates to can_read_chat_message(). PGlite
// runs as a single superuser with no `authenticated` role, so we cannot SET ROLE
// and exercise the policy black-box (real-JWT enforcement lives in #423 / the
// NestJS Jest tier). Instead we test the SECURITY DEFINER predicate directly —
// seeding two chapters with one channel per type — and drive it by swapping the
// auth.uid() stub per scenario. Combined with the shape assertion above (the policy
// wires `auth.role()='authenticated' AND can_read_chat_message(message_id)`), a
// correct predicate closes the cross-tenant / private / DM / role-gated read leak.

const F = {
  chapA: "aaaaaaaa-0000-0000-0000-000000000001",
  chapB: "bbbbbbbb-0000-0000-0000-000000000001",
  userAId: "aaaa1111-0000-0000-0000-000000000001", // chapter A member, holds chat:secret
  userAAuth: "aaaa2222-0000-0000-0000-000000000001",
  userBId: "bbbb1111-0000-0000-0000-000000000001", // chapter B member (other tenant)
  userBAuth: "bbbb2222-0000-0000-0000-000000000001",
  userCId: "cccc1111-0000-0000-0000-000000000001", // chapter A member, no privileges / not in DMs
  userCAuth: "cccc2222-0000-0000-0000-000000000001",
  userDId: "dddd1111-0000-0000-0000-000000000001", // chapter A member, holds '*' wildcard only
  userDAuth: "dddd2222-0000-0000-0000-000000000001",
  // Chapter A member carrying a chapter-B role id in members.role_ids. That column
  // is an unconstrained text[], so a stale/cross-chapter id is a real possibility;
  // the predicate must re-scope roles by chapter_id or this user gets chapter B's
  // permissions inside chapter A.
  userEId: "eeee1111-0000-0000-0000-000000000001",
  userEAuth: "eeee2222-0000-0000-0000-000000000001",
  // Chapter A member whose stored role id is the correct role, UPPERCASED. The
  // API takes role ids as z.string().uuid(), which accepts uppercase, so this is
  // reachable through a normal PATCH of member roles.
  userFId: "ffff1111-0000-0000-0000-000000000001",
  userFAuth: "ffff2222-0000-0000-0000-000000000001",
  roleSecret: "0e0e0e0e-0000-0000-0000-000000000001", // chapter A, permission chat:secret
  roleBasic: "0b0b0b0b-0000-0000-0000-000000000001", // chapter A, no permissions
  roleWildcard: "0a0a0a0a-0000-0000-0000-000000000001", // chapter A, permission '*'
  roleSecretChapB: "0c0c0c0c-0000-0000-0000-000000000001", // chapter B, permission chat:secret
  chPublic: "c0000001-0000-0000-0000-000000000001",
  chPrivate: "c0000002-0000-0000-0000-000000000001",
  chDM: "c0000003-0000-0000-0000-000000000001",
  chRoleGated: "c0000004-0000-0000-0000-000000000001",
  chRoleGatedOpen: "c0000005-0000-0000-0000-000000000001",
  chGroupDM: "c0000006-0000-0000-0000-000000000001",
  msgPublic: "10000001-0000-0000-0000-000000000001",
  msgPrivate: "10000002-0000-0000-0000-000000000001",
  msgDM: "10000003-0000-0000-0000-000000000001",
  msgRoleGated: "10000004-0000-0000-0000-000000000001",
  msgRoleGatedOpen: "10000005-0000-0000-0000-000000000001",
  msgGroupDM: "10000006-0000-0000-0000-000000000001",
};

// Seeded outside a transaction (these rows are read-only fixtures for the
// scenarios below and nothing later depends on the table being empty). Guarded
// the same way the anonymize tier guards its seed: an unhandled rejection here
// would skip db.close() and the `FAILED: N` summary, so a broken seed would exit
// without the report that tells you it broke.
let readSeeded = false;
try {
  await db.exec(`
  begin;
  insert into chapters (id, name, university) values
    ('${F.chapA}', 'Chapter A', 'Uni A'),
    ('${F.chapB}', 'Chapter B', 'Uni B');
  insert into users (id, supabase_auth_id, email) values
    ('${F.userAId}', '${F.userAAuth}', 'a@test.local'),
    ('${F.userBId}', '${F.userBAuth}', 'b@test.local'),
    ('${F.userCId}', '${F.userCAuth}', 'c@test.local'),
    ('${F.userDId}', '${F.userDAuth}', 'd@test.local'),
    ('${F.userEId}', '${F.userEAuth}', 'e@test.local'),
    ('${F.userFId}', '${F.userFAuth}', 'f@test.local');
  insert into roles (id, chapter_id, name, permissions) values
    ('${F.roleSecret}',       '${F.chapA}', 'Secret',   '{chat:secret}'),
    ('${F.roleBasic}',        '${F.chapA}', 'Basic',    '{}'),
    ('${F.roleWildcard}',     '${F.chapA}', 'Wildcard', '{*}'),
    ('${F.roleSecretChapB}',  '${F.chapB}', 'Secret B', '{chat:secret}');
  insert into members (user_id, chapter_id, role_ids) values
    ('${F.userAId}', '${F.chapA}', '{${F.roleSecret}}'),
    ('${F.userCId}', '${F.chapA}', '{${F.roleBasic}}'),
    ('${F.userDId}', '${F.chapA}', '{${F.roleWildcard}}'),
    ('${F.userEId}', '${F.chapA}', '{${F.roleSecretChapB}}'),
    ('${F.userFId}', '${F.chapA}', '{${F.roleSecret.toUpperCase()}}'),
    ('${F.userBId}', '${F.chapB}', '{}');
  insert into chat_channels (id, chapter_id, name, type, member_ids, required_permissions) values
    ('${F.chPublic}',        '${F.chapA}', 'public',     'PUBLIC',     null,              null),
    ('${F.chPrivate}',       '${F.chapA}', 'private',    'PRIVATE',    '{${F.userAId}}',  null),
    ('${F.chDM}',            '${F.chapA}', 'dm',         'DM',         '{${F.userAId}}',  null),
    ('${F.chRoleGated}',     '${F.chapA}', 'gated',      'ROLE_GATED', null,              '{chat:secret}'),
    ('${F.chRoleGatedOpen}', '${F.chapA}', 'gated-open', 'ROLE_GATED', null,              '{}'),
    ('${F.chGroupDM}',       '${F.chapA}', 'groupdm',    'GROUP_DM',   '{${F.userAId}}',  null);
  insert into chat_messages (id, channel_id, sender_id) values
    ('${F.msgPublic}',        '${F.chPublic}',        '${F.userAId}'),
    ('${F.msgPrivate}',       '${F.chPrivate}',       '${F.userAId}'),
    ('${F.msgDM}',            '${F.chDM}',            '${F.userAId}'),
    ('${F.msgRoleGated}',     '${F.chRoleGated}',     '${F.userAId}'),
    ('${F.msgRoleGatedOpen}', '${F.chRoleGatedOpen}', '${F.userAId}'),
    ('${F.msgGroupDM}',       '${F.chGroupDM}',       '${F.userAId}');
`);
  readSeeded = true;
} catch (e) {
  missing += 1;
  console.log(
    `ERR   chat_message_actions read-enforcement seed\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}

async function canReadAs(authUid, messageId) {
  await db.exec(
    authUid === null
      ? `create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;`
      : `create or replace function auth.uid() returns uuid language sql as $$ select '${authUid}'::uuid $$;`,
  );
  const res = await db.query(
    `select public.can_read_chat_message('${messageId}'::uuid) as ok`,
  );
  return res.rows[0].ok === true;
}

const READ_SCENARIOS = [
  { name: "own-chapter PUBLIC is visible to a chapter member", uid: F.userAAuth, msg: F.msgPublic, expect: true },
  { name: "cross-chapter PUBLIC is denied (tenant boundary)", uid: F.userBAuth, msg: F.msgPublic, expect: false },
  { name: "PRIVATE is denied to a chapter member not in member_ids", uid: F.userCAuth, msg: F.msgPrivate, expect: false },
  { name: "PRIVATE is visible to a member listed in member_ids", uid: F.userAAuth, msg: F.msgPrivate, expect: true },
  { name: "DM is visible to a participant listed in member_ids", uid: F.userAAuth, msg: F.msgDM, expect: true },
  { name: "DM is denied to a non-participant", uid: F.userCAuth, msg: F.msgDM, expect: false },
  { name: "GROUP_DM is visible to a member listed in member_ids", uid: F.userAAuth, msg: F.msgGroupDM, expect: true },
  { name: "GROUP_DM is denied to a chapter member not in member_ids", uid: F.userCAuth, msg: F.msgGroupDM, expect: false },
  { name: "ROLE_GATED is denied without the required permission", uid: F.userCAuth, msg: F.msgRoleGated, expect: false },
  { name: "ROLE_GATED is visible with the required permission", uid: F.userAAuth, msg: F.msgRoleGated, expect: true },
  { name: "ROLE_GATED is visible to a '*' wildcard holder lacking the specific permission", uid: F.userDAuth, msg: F.msgRoleGated, expect: true },
  // FRA-321: this asserted `true` — a ROLE_GATED channel that gates on nothing
  // was visible to every chapter member, i.e. functionally PUBLIC. Both the SQL
  // predicate and canAccessChannel now deny it; the backfill guarantees no
  // existing row is in that shape and the API rejects creating one.
  { name: "ROLE_GATED with empty required_permissions is denied (no longer falls open)", uid: F.userCAuth, msg: F.msgRoleGatedOpen, expect: false },
  // ...but the wildcard still wins, exactly as canAccessChannel has it. Spelling
  // the deny as a length test placed *before* the wildcard branch would deny a
  // President here and silently re-introduce SQL/TypeScript drift.
  { name: "ROLE_GATED with empty required_permissions still admits a '*' wildcard holder", uid: F.userDAuth, msg: F.msgRoleGatedOpen, expect: true },
  { name: "ROLE_GATED denies a chapter-B role id held by a chapter-A member (roles re-scoped by chapter)", uid: F.userEAuth, msg: F.msgRoleGated, expect: false },
  { name: "ROLE_GATED matches an UPPERCASE stored role id (uuid compare, not text)", uid: F.userFAuth, msg: F.msgRoleGated, expect: true },
  { name: "NULL auth.uid() (anon / no JWT) is denied", uid: null, msg: F.msgPublic, expect: false },
];

console.log("\n=== chat_message_actions read enforcement (can_read_chat_message) ===");
if (!readSeeded) {
  console.log("SKIP  seed failed above — read-enforcement scenarios not run");
}
for (const s of readSeeded ? READ_SCENARIOS : []) {
  try {
    const got = await canReadAs(s.uid, s.msg);
    if (got === s.expect) {
      console.log(`OK    ${s.name}`);
    } else {
      missing += 1;
      console.log(`MISS  ${s.name}\n        ↳ expected ${s.expect}, got ${got}`);
    }
  } catch (e) {
    missing += 1;
    console.log(`ERR   ${s.name}\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

// ─── BLACK-BOX policy enforcement (FRA-38) ──────────────────────────────────
//
// The tier above calls can_read_chat_message() directly, which proves the
// PREDICATE is right but says nothing about whether the POLICY is wired to it.
// The shape assertion covers the wiring only by pattern-matching the policy
// expression, and a pattern match is defeatable — `... AND
// can_read_chat_message(message_id) IS NOT NULL` is constant-true, and De Morgan
// spells an OR out of AND and NOT.
//
// So read the table for real, as a role that is not the owner. RLS does not
// apply to superusers or table owners, which is why this needs its own role.
// A permissive `using (true)` policy of ANY command shape (FOR SELECT or FOR
// ALL), a neutered predicate, or a dropped policy all change these counts, and
// none of them can be papered over by how the expression is spelled.
console.log("\n=== chat_message_actions policy enforcement (black-box, SET ROLE) ===");
if (readSeeded) {
  try {
    await db.exec(`
      insert into chat_message_actions (message_id, user_id, action_type) values
        ('${F.msgPublic}',        '${F.userAId}', 'reaction'),
        ('${F.msgPrivate}',       '${F.userAId}', 'reaction'),
        ('${F.msgDM}',            '${F.userAId}', 'reaction'),
        ('${F.msgRoleGated}',     '${F.userAId}', 'reaction'),
        ('${F.msgRoleGatedOpen}', '${F.userAId}', 'reaction'),
        ('${F.msgGroupDM}',       '${F.userAId}', 'reaction');

      drop role if exists rls_probe;
      create role rls_probe nologin;
      grant usage on schema public to rls_probe;
      grant select on public.chat_message_actions to rls_probe;
      grant select on public.chat_messages to rls_probe;
      grant execute on function public.can_read_chat_message(uuid) to rls_probe;
      -- Mirrors the request context of a signed-in Supabase client. On PGlite the
      -- policy carries no TO clause (no authenticated role exists), so it
      -- applies to rls_probe and the qual is what decides visibility.
      create or replace function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
    `);

    // userA: chapter A, in member_ids of PRIVATE/DM/GROUP_DM, holds chat:secret.
    // userC: chapter A, no privileges, in no member list -> PUBLIC only.
    // userB: chapter B -> nothing. null uid: no JWT -> nothing.
    //
    // FRA-321 moved both non-zero counts down by one, and the row that left each
    // is the same one: the ROLE_GATED channel with an empty requirement list.
    // It used to be readable by every chapter member; it is now readable by
    // none of them (userA holds chat:secret, which the open channel does not
    // ask for, and neither user holds the wildcard).
    const BLACKBOX = [
      { name: "member sees every action row in channels they can read (all but the empty-gated one)", uid: F.userAAuth, expect: 5 },
      { name: "cross-chapter reader sees none of them (tenant boundary holds at the table)", uid: F.userBAuth, expect: 0 },
      { name: "chapter member sees only PUBLIC, not PRIVATE/DM/gated (incl. empty-gated)", uid: F.userCAuth, expect: 1 },
      { name: "no JWT (null auth.uid()) sees nothing", uid: null, expect: 0 },
    ];

    for (const s of BLACKBOX) {
      await db.exec(
        s.uid === null
          ? `create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;`
          : `create or replace function auth.uid() returns uuid language sql as $$ select '${s.uid}'::uuid $$;`,
      );
      await db.exec("set role rls_probe;");
      let got;
      try {
        const res = await db.query(
          `select count(*)::int as n from public.chat_message_actions`,
        );
        got = res.rows[0].n;
      } finally {
        await db.exec("reset role;");
      }
      if (got === s.expect) {
        console.log(`OK    ${s.name}`);
      } else {
        missing += 1;
        console.log(`MISS  ${s.name}\n        ↳ expected ${s.expect} visible row(s), got ${got}`);
      }
    }

    // ─── chat_messages: the imported-archive exclusion (Discord import) ──────
    //
    // This is the Realtime fan-out control, and it only works if it is enforced
    // at the POLICY. Supabase Realtime evaluates this exact policy per subscriber
    // in `realtime.apply_rls`, and emits a frame only for rows that pass — so an
    // imported archive row that is invisible here is a frame that is never sent.
    //
    // A publication row filter cannot substitute: `realtime.list_changes` builds
    // wal2json's `add-tables` parameter from `pg_publication_tables` NAMES and
    // never reads `prqual`, so `alter publication ... where (kind <> 'imported')`
    // is silently ignored.
    //
    // The second scenario is the one that pins WHERE the rule lives. The
    // predicate `can_read_chat_message` must still answer true for an imported
    // row, because it is also the `chat_message_actions` SELECT policy — pushing
    // `kind` into the function would break reactions and votes on archived
    // messages. So: invisible through the table, still readable through the
    // predicate.
    const IMPORTED_MSG = "a5a5a5a5-0000-4000-8000-00000000aaaa";
    await db.exec(`
      insert into chat_messages (id, channel_id, sender_id, author_name, author_external_id, kind, content)
      values ('${IMPORTED_MSG}', '${F.chPublic}', null, 'DiscordUser', '9911', 'imported', 'a message from 2019');
    `);

    const ARCHIVE = [
      {
        name: "an imported archive row is invisible to a member who CAN read the channel",
        uid: F.userAAuth,
        sql: `select count(*)::int as n from public.chat_messages where id = '${IMPORTED_MSG}'`,
        expect: 0,
      },
      {
        name: "a live row in the same channel is still visible (the rule is `kind`, not a blanket deny)",
        uid: F.userAAuth,
        sql: `select count(*)::int as n from public.chat_messages where id = '${F.msgPublic}'`,
        expect: 1,
      },
    ];

    for (const s of ARCHIVE) {
      await db.exec(
        `create or replace function auth.uid() returns uuid language sql as $$ select '${s.uid}'::uuid $$;`,
      );
      await db.exec("set role rls_probe;");
      let got;
      try {
        const res = await db.query(s.sql);
        got = res.rows[0].n;
      } finally {
        await db.exec("reset role;");
      }
      if (got === s.expect) {
        console.log(`OK    ${s.name}`);
      } else {
        missing += 1;
        console.log(`MISS  ${s.name}\n        ↳ expected ${s.expect} visible row(s), got ${got}`);
      }
    }

    // ─── Unread counts: the "47,000 unread" case, end to end ────────────────
    //
    // A member with no `channel_read_receipts` row has never opened the channel,
    // so `get_channel_unread_counts` counts EVERYTHING (the `-infinity` cursor
    // branch). That is correct for live chat and catastrophic for an archive:
    // importing a chapter's Discord history would hand every member a badge the
    // size of the import that no amount of reading could clear.
    //
    // Both halves are asserted because they are independent rules that happened
    // to overlap. `sender_id is distinct from` is null-safety; `kind <>
    // 'imported'` is the archive rule. Before this migration the archive was
    // excluded only as a side effect of `NULL <> uuid` being NULL — invisible,
    // and undone by the obvious null-safety "fix".
    {
      const name = "unread counts skip imported rows but still count a live null-sender row";
      await db.exec(`
        insert into chat_messages (id, channel_id, sender_id, author_name, kind, content)
        values ('a5a5a5a5-0000-4000-8000-00000000bbbb', '${F.chPublic}', null, 'Webhook Bot', 'text', 'live, no sender');
      `);
      // userC is a chapter-A member with no read receipt for any channel.
      const res = await db.query(
        `select unread_count::int as n from public.get_channel_unread_counts(
           '${F.chapA}'::uuid, '${F.userCId}'::uuid)
          where channel_id = '${F.chPublic}'::uuid`,
      );
      // Visible to userC in #public: msgPublic (userA's) + the live null-sender
      // row. NOT the imported row.
      const got = res.rows[0]?.n;
      if (got === 2) {
        console.log(`OK    ${name}`);
      } else {
        missing += 1;
        console.log(`MISS  ${name}\n        ↳ expected 2 unread, got ${got}`);
      }
    }

    // The predicate must NOT have learned about `kind` — it is shared with the
    // chat_message_actions policy, so narrowing it would silently kill reactions
    // and poll votes on every imported message.
    {
      await db.exec(
        `create or replace function auth.uid() returns uuid language sql as $$ select '${F.userAAuth}'::uuid $$;`,
      );
      const res = await db.query(
        `select public.can_read_chat_message('${IMPORTED_MSG}'::uuid) as ok`,
      );
      const name =
        "can_read_chat_message still answers true for an imported row (reactions keep working)";
      if (res.rows[0].ok === true) {
        console.log(`OK    ${name}`);
      } else {
        missing += 1;
        console.log(`MISS  ${name}\n        ↳ the kind rule leaked into the shared predicate`);
      }
    }
  } catch (e) {
    missing += 1;
    console.log(
      `ERR   black-box policy enforcement\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
    );
  }
} else {
  console.log("SKIP  seed failed above — black-box scenarios not run");
}

// Discard both tiers' fixtures (rows, the probe role, the stub redefinitions) so
// the validated schema is exactly what the migrations produced and anything
// appended after this does not inherit dirty state — same contract as the
// anonymize tier. Safe when the seed failed too: the transaction is already
// aborted, and rollback is what clears it.
await db.exec("rollback;");

// Restore the default stubs so any later assertions are unaffected.
await db.exec(`
  create or replace function auth.uid()  returns uuid language sql as $$ select null::uuid $$;
  create or replace function auth.role() returns text language sql as $$ select 'service_role'::text $$;
`);

// ─── Functional smoke: the legacy attachment-sigil backfill ─────────────────
//
// 20260823121000 recovers `📎 <name> (<storagePath>)` out of message bodies into
// `chat_message_attachments`. The backfill runs during replay against an empty
// table, so migration replay alone proves nothing about it — this tier feeds it
// the bodies the old composer actually produced.
//
// The case that matters is a filename containing `)`. Storage keys end in
// `path.basename(filename)` verbatim, so `Budget (2025).xlsx` puts a `)` inside
// the key; an earlier draft used `[^)]*` for the path group, which cut the key
// off at `.../Budget (2025`, wrote a row pointing at an object that does not
// exist, and then rewrote the body around the truncation leaving `.xlsx)`
// behind. Neither half is self-healing on a re-run.
console.log("\n=== Functional smoke: legacy attachment backfill ===");
{
  const INSERT_RE =
    "📎 ([^\\n]+?) \\((chapters/[0-9a-fA-F-]{36}/chat/[^\\n]*?\\1)\\)";
  const STRIP_RE =
    "[[:space:]]*📎 ([^\\n]+?) \\(chapters/[0-9a-fA-F-]{36}/chat/[^\\n]*?\\1\\)";
  const KEY = "chapters/11111111-2222-3333-4444-555555555555/chat/c/m";

  const CASES = [
    {
      name: "a filename containing ')' keeps its whole storage path",
      body: `📎 Budget (2025).xlsx (${KEY}/Budget (2025).xlsx)`,
      path: `${KEY}/Budget (2025).xlsx`,
      stripped: "",
    },
    {
      name: "two attachments on separate lines stay separate",
      body: `both\n📎 a.png (${KEY}/a.png)\n📎 b.png (${KEY}/b.png)`,
      path: `${KEY}/a.png`,
      stripped: "both",
    },
    {
      // The old composer inserted at the cursor and left the caret after the
      // `)`, so a caption typed afterwards is ordinary, not exotic. An
      // end-of-line anchor skips these messages entirely.
      name: "a caption typed after the sigil still backfills",
      body: `📎 minutes.pdf (${KEY}/minutes.pdf) — signed copy`,
      path: `${KEY}/minutes.pdf`,
      stripped: "— signed copy",
    },
    {
      name: "text a member typed that merely looks like a sigil is untouched",
      body: "lol 📎 nice (not a path)",
      path: null,
      stripped: "lol 📎 nice (not a path)",
    },
  ];

  for (const c of CASES) {
    try {
      const res = await db.query(
        `select (regexp_matches($1, $2, 'g'))[2] as path`,
        [c.body, INSERT_RE],
      );
      const got = res.rows[0]?.path ?? null;
      const strip = await db.query(
        `select btrim(regexp_replace($1, $2, '', 'g')) as body`,
        [c.body, STRIP_RE],
      );
      const gotBody = strip.rows[0]?.body ?? null;

      if (got === c.path && gotBody === c.stripped) {
        console.log(`OK    ${c.name}`);
      } else {
        missing += 1;
        console.log(
          `MISS  ${c.name}\n        ↳ path ${JSON.stringify(got)} (want ${JSON.stringify(c.path)}), body ${JSON.stringify(gotBody)} (want ${JSON.stringify(c.stripped)})`,
        );
      }
    } catch (e) {
      missing += 1;
      console.log(`ERR   ${c.name}\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`);
    }
  }
}

// ─── Chapter directory seed load (#840) ─────────────────────────────────────
// The loader's SQL runs against a real Postgres nowhere else in CI: no job here
// stands up a database, so `chapter-directory-seed` can only validate the CSV
// statically. This is where the generated SQL actually executes.
//
// Two properties are asserted, and idempotency is the one that matters. The
// obvious delete-then-insert loader would satisfy "row count is stable" while
// silently nulling `chapters.directory_id` on every bootstrap — that column is
// `on delete set null` — so the second run additionally proves row ids survive.
console.log("\n=== chapter directory seed load (#840) ===");
try {
  const { execFileSync } = await import("node:child_process");
  const loadSql = execFileSync(
    process.execPath,
    [join(process.cwd(), "scripts", "load-chapter-directory.mjs")],
    { encoding: "utf8", cwd: process.cwd() },
  );

  const idsOf = async () => {
    const r = await db.query(
      `select id::text from public.chapter_directory order by org_letters, university, coalesce(chapter_designation,'')`,
    );
    return r.rows.map((x) => x.id).join(",");
  };

  await db.exec(loadSql);
  const firstCount = (
    await db.query(`select count(*)::int as n from public.chapter_directory`)
  ).rows[0].n;
  const firstIds = await idsOf();

  await db.exec(loadSql);
  const secondCount = (
    await db.query(`select count(*)::int as n from public.chapter_directory`)
  ).rows[0].n;
  const secondIds = await idsOf();

  const badColors = (
    await db.query(
      // `accent` is the only key in `default_colors` since #1225; the `dark`
      // half went with #1224's removal of `branding.colors.dark`. Asserting it
      // here would have been quietly useless anyway: `->>'dark'` on a row
      // without the key is NULL, and `NULL !~ pattern` is NULL rather than
      // true, so a missing key never counted.
      `select count(*)::int as n from public.chapter_directory
       where default_colors->>'accent' !~ '^#[0-9A-F]{6}$'`,
    )
  ).rows[0].n;

  const checks = [
    [firstCount > 0, `seed loads rows (got ${firstCount})`],
    [
      secondCount === firstCount,
      `re-running is idempotent (${firstCount} → ${secondCount} rows)`,
    ],
    [
      secondIds === firstIds && firstIds !== "",
      "row ids survive a re-run (chapters.directory_id stays valid)",
    ],
    [badColors === 0, `every loaded color is canonical #RRGGBB (${badColors} bad)`],
  ];

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      missing += 1;
      console.log(`MISS  ${name}`);
    }
  }

  // Leave the schema as the migrations produced it — same contract as the tiers
  // above, so anything appended later does not inherit seeded rows.
  await db.exec("delete from public.chapter_directory;");
} catch (e) {
  // Same contract as the tiers above: a thrown error becomes a counted MISS with a
  // one-line reason, not a stack trace that buries the other 40-odd assertions. The
  // generator exits non-zero on an invalid seed, and execFileSync turns that into a
  // throw — which is a legitimate failure to report, not a crash to propagate.
  missing += 1;
  console.log(
    `MISS  chapter directory seed load\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}

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
