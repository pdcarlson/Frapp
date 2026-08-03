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
    name: "chat_message_actions SELECT gated to the authenticated role",
    sql: `select pg_get_expr(polqual, polrelid) as using_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_message_actions' and polcmd = 'r'`,
    ok: (rows) =>
      rows.length >= 1 &&
      rows.some((r) => /auth\.role\(\)\s*=\s*'authenticated'/i.test(String(r.using_expr))),
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
      insert into user_settings (user_id) values ('${U}');
      insert into push_tokens (user_id, token) values ('${U}', 'ExponentPushToken[smoke]');
      -- Rename before deletion: the content rewrite must key on the card's own
      -- payload snapshot ('Doomed User'), not the live display name.
      update users set display_name = 'D' where id = '${U}';
      select anonymize_user('${U}');
      -- Simulate the retry window: the tombstone gets PII written back onto it
      -- (PATCH /users/me is possible while the auth account still exists). The
      -- second call must RE-scrub — the RPC has no tombstone early-return.
      update users set display_name = 'Sneaky Comeback', bio = 'still here' where id = '${U}';
      select anonymize_user('${U}');
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
          rows.length === 1 && rows[0].points === 1 && rows[0].messages === 3,
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
