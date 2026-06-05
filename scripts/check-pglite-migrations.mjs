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
    sql: `select pg_get_expr(polqual, polrelid) as using_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_message_actions' and polcmd = 'r'`,
    // Require the two terms to be AND-ed and reject a top-level OR — a permissive
    // `auth.role()='authenticated' OR can_read_chat_message(...)` regression
    // re-opens the leak yet still contains both substrings, so a bare substring
    // match would not catch it.
    ok: (rows) =>
      rows.length >= 1 &&
      rows.some((r) => {
        const e = String(r.using_expr);
        return (
          /auth\.role\(\)\s*=\s*'authenticated'/i.test(e) &&
          /can_read_chat_message\s*\(\s*message_id\s*\)/i.test(e) &&
          /\band\b/i.test(e) &&
          !/\bor\b/i.test(e)
        );
      }),
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
    name: "chat_message_actions has REPLICA IDENTITY FULL (Realtime DELETE carries message_id for the RLS policy)",
    sql: `select relreplident from pg_class where relname = 'chat_message_actions'`,
    ok: (rows) => rows.length === 1 && rows[0].relreplident === "f",
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
  roleSecret: "0e0e0e0e-0000-0000-0000-000000000001", // chapter A, permission chat:secret
  roleBasic: "0b0b0b0b-0000-0000-0000-000000000001", // chapter A, no permissions
  roleWildcard: "0a0a0a0a-0000-0000-0000-000000000001", // chapter A, permission '*'
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

await db.exec(`
  insert into chapters (id, name, university) values
    ('${F.chapA}', 'Chapter A', 'Uni A'),
    ('${F.chapB}', 'Chapter B', 'Uni B');
  insert into users (id, supabase_auth_id, email) values
    ('${F.userAId}', '${F.userAAuth}', 'a@test.local'),
    ('${F.userBId}', '${F.userBAuth}', 'b@test.local'),
    ('${F.userCId}', '${F.userCAuth}', 'c@test.local'),
    ('${F.userDId}', '${F.userDAuth}', 'd@test.local');
  insert into roles (id, chapter_id, name, permissions) values
    ('${F.roleSecret}',   '${F.chapA}', 'Secret',   '{chat:secret}'),
    ('${F.roleBasic}',    '${F.chapA}', 'Basic',    '{}'),
    ('${F.roleWildcard}', '${F.chapA}', 'Wildcard', '{*}');
  insert into members (user_id, chapter_id, role_ids) values
    ('${F.userAId}', '${F.chapA}', '{${F.roleSecret}}'),
    ('${F.userCId}', '${F.chapA}', '{${F.roleBasic}}'),
    ('${F.userDId}', '${F.chapA}', '{${F.roleWildcard}}'),
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
  { name: "DM is denied to a non-participant", uid: F.userCAuth, msg: F.msgDM, expect: false },
  { name: "GROUP_DM is visible to a member listed in member_ids", uid: F.userAAuth, msg: F.msgGroupDM, expect: true },
  { name: "GROUP_DM is denied to a chapter member not in member_ids", uid: F.userCAuth, msg: F.msgGroupDM, expect: false },
  { name: "ROLE_GATED is denied without the required permission", uid: F.userCAuth, msg: F.msgRoleGated, expect: false },
  { name: "ROLE_GATED is visible with the required permission", uid: F.userAAuth, msg: F.msgRoleGated, expect: true },
  { name: "ROLE_GATED is visible to a '*' wildcard holder lacking the specific permission", uid: F.userDAuth, msg: F.msgRoleGated, expect: true },
  { name: "ROLE_GATED with empty required_permissions is visible to any member", uid: F.userCAuth, msg: F.msgRoleGatedOpen, expect: true },
  { name: "NULL auth.uid() (anon / no JWT) is denied", uid: null, msg: F.msgPublic, expect: false },
];

console.log("\n=== chat_message_actions read enforcement (can_read_chat_message) ===");
for (const s of READ_SCENARIOS) {
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

// Restore the default auth.uid() stub so any later assertions are unaffected.
await db.exec(
  `create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;`,
);

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
