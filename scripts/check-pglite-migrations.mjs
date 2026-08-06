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
// PGlite limitation but is a one-line fix here. Adding a bundled extension is
// the preferred answer; carving migrations out of this gate is not.

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite/vector";
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
    name: "RLS enabled on chat_messages + default-deny (no policies)",
    sql: `select c.relrowsecurity as rls,
                 (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
            from pg_class c where c.relname = 'chat_messages'`,
    ok: (rows) =>
      rows.length === 1 && rows[0].rls === true && rows[0].policies === 0,
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
  { name: "ROLE_GATED with empty required_permissions is visible to any member", uid: F.userCAuth, msg: F.msgRoleGatedOpen, expect: true },
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
      grant execute on function public.can_read_chat_message(uuid) to rls_probe;
      -- Mirrors the request context of a signed-in Supabase client. On PGlite the
      -- policy carries no TO clause (no authenticated role exists), so it
      -- applies to rls_probe and the qual is what decides visibility.
      create or replace function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
    `);

    // userA: chapter A, in member_ids of PRIVATE/DM/GROUP_DM, holds chat:secret.
    // userC: chapter A, no privileges, in no member list -> PUBLIC + open gate.
    // userB: chapter B -> nothing. null uid: no JWT -> nothing.
    const BLACKBOX = [
      { name: "member sees every action row in channels they can read", uid: F.userAAuth, expect: 6 },
      { name: "cross-chapter reader sees none of them (tenant boundary holds at the table)", uid: F.userBAuth, expect: 0 },
      { name: "chapter member sees only PUBLIC + open ROLE_GATED, not PRIVATE/DM/gated", uid: F.userCAuth, expect: 2 },
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
