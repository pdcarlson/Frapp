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
// constructor below — `pgcrypto` and `vector` (pgvector) today. An unregistered
// extension fails with `extension "X" is not available`, which reads like a
// PGlite limitation but is a one-line fix here. Registering the extension is
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

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

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
// Stub the three functions so policy DDL parses. These are the DEFAULTS: the
// black-box tiers further down replace `auth.uid()` and `auth.role()` per
// scenario to impersonate a signed-in or anonymous client, and read the tables
// through non-owner probe roles granted `authenticated` or `anon`. So this file does
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

// ─── Schema landmark assertions ─────────────────────────────────────────────
//
// New landmarks added here when a chunk lands a structural invariant a future
// reviewer needs to confirm without spinning up Docker. Each is named for the
// behavior it pins, not the migration that introduced it — migrations rename
// over time, behaviors don't.

const LANDMARKS = [
  {
    // Every claiming sweep in `modules/scheduled-jobs` dedups by inserting
    // here (report retention and the stale-palette sweep take no claim), so a
    // threshold missing from this CHECK is not a validation nicety — the claim
    // raises 23505's cousin (23514), `claimDispatch` reads it as "not a unique
    // violation", logs, and returns false, and that sweep silently never sends
    // anything. The failure is indistinguishable from "nothing to do".
    //
    // Asserted as a set so adding a sweep without widening the constraint —
    // or widening it and dropping an existing value — fails here rather than
    // in production silence.
    name: "scheduled_notification_dispatches admits every sweep's threshold",
    sql: `select pg_get_constraintdef(oid) as def
            from pg_constraint
           where conname = 'scheduled_notification_dispatches_threshold_check'`,
    ok: (rows) =>
      rows.length === 1 &&
      ["DUE_SOON", "OVERDUE", "AUTO_ABSENT", "EXPIRED", "EVENT_REMINDER"].every(
        (threshold) => new RegExp(`'${threshold}'`).test(rows[0].def ?? ""),
      ),
  },
  {
    // Pins an index the **initial schema** owns, not one any later migration
    // added — stated plainly because the reverse would be the more useful-
    // sounding lie. The pre-event reminder sweep filters `events` on a bounded
    // `start_time` window 288 times a day and the auto-absent sweep does the
    // same on `end_time`, so both are load-bearing for a scheduler that
    // otherwise sequentially scans the table; neither is referenced by the
    // migration that introduced its sweep.
    name: "events start_time/end_time stay indexed for the scheduled sweeps",
    sql: `select indexname from pg_indexes
           where indexname in ('idx_events_start_time', 'idx_events_end_time')`,
    ok: (rows) => rows.length === 2,
  },
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
    // Both plain unique indexes on chat_notification_preferences are ON CONFLICT
    // targets for one arm each of the mute API, and neither can be replaced by
    // the original expression index `idx_chat_notif_prefs_unique`: PostgREST's
    // `on_conflict` takes column names and cannot express its
    // `coalesce(scope_id::text, scope_kind)`. Nor can either substitute for the
    // other — a unique index treats NULLs as distinct, and the arms are exactly
    // complementary in which of scope_id/scope_kind is NULL.
    //
    // So dropping either one does not fail a build or a test; it makes the
    // corresponding endpoint 500 with `42P10 there is no unique or exclusion
    // constraint matching the ON CONFLICT specification` on every call, at
    // runtime, in production. That is precisely the class of thing this file
    // exists to pin, and it is why the pairing is asserted here rather than
    // recorded as a one-time manual observation in a migration header.
    name: "chat_notification_preferences carries a plain UNIQUE ON CONFLICT target for BOTH the channel and kind arms",
    sql: `select indexname, indexdef from pg_indexes
            where tablename = 'chat_notification_preferences'
              and indexname in ('idx_chat_notif_prefs_channel_unique',
                                'idx_chat_notif_prefs_kind_unique')
            order by indexname`,
    ok: (rows) => {
      if (rows.length !== 2) return false;
      const byName = Object.fromEntries(
        rows.map((r) => [r.indexname, r.indexdef]),
      );
      const channel = byName.idx_chat_notif_prefs_channel_unique ?? "";
      const kind = byName.idx_chat_notif_prefs_kind_unique ?? "";
      const scoped = (def) =>
        // `CREATE UNIQUE INDEX`, not a bare /UNIQUE/ — both index NAMES end in
        // `_unique`, so matching the word anywhere in the definition passes a
        // plain non-unique index on its name alone. Caught by mutation-testing
        // this predicate rather than by reading it.
        /CREATE UNIQUE INDEX/i.test(def) &&
        /user_id/.test(def) &&
        /chapter_id/.test(def) &&
        /\bscope\b/.test(def) &&
        // Neither may be partial or expression-based, or ON CONFLICT stops
        // matching it — the whole point of these two existing.
        !/WHERE/i.test(def) &&
        !/coalesce/i.test(def);
      return (
        scoped(channel) &&
        scoped(kind) &&
        /scope_id/.test(channel) &&
        !/scope_kind/.test(channel) &&
        /scope_kind/.test(kind) &&
        !/scope_id/.test(kind)
      );
    },
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
    name: "chat_messages.sender_id is nullable (archive rows have no Frapp user)",
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
    ok: (rows) =>
      rows.length === 1 && rows[0].cols === 5 && rows[0].uniques >= 1,
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
    // The importer's idempotency key. Phase 1 put the Discord snowflake in
    // `client_message_id`; phase 2 reversed that, and the whole re-run-safety
    // story now rests on this index existing and being UNIQUE. A migration that
    // dropped it would leave a re-run silently duplicating an entire archive.
    name: "chat_messages.external_message_id has a UNIQUE per-channel dedupe index",
    sql: `select
            (select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = 'chat_messages'
                and column_name = 'external_message_id')::int as col,
            (select indexdef from pg_indexes
              where indexname = 'idx_chat_messages_external_dedupe') as indexdef`,
    ok: (rows) =>
      rows.length === 1 &&
      rows[0].col === 1 &&
      /UNIQUE/i.test(rows[0].indexdef ?? "") &&
      /channel_id/.test(rows[0].indexdef ?? "") &&
      /external_message_id/.test(rows[0].indexdef ?? ""),
  },
  {
    // `consent_acknowledged_at` is NOT NULL because the compliance step is the
    // point: a friction point enforced only in the web wizard is skippable by
    // anything that calls the API directly. If this column ever goes nullable,
    // an import can exist that nobody acknowledged.
    name: "discord_imports requires a consent acknowledgement",
    sql: `select is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'discord_imports'
             and column_name = 'consent_acknowledged_at'`,
    ok: (rows) => rows.length === 1 && rows[0].is_nullable === "NO",
  },
  {
    // Default deny on both import tables, same reasoning as
    // chat_message_attachments above: the API reads them on the service-role
    // key, so a policy would open a PostgREST surface nothing needs. These rows
    // name a chapter's Discord guild and its channel list.
    name: "RLS enabled on all three discord import tables + default-deny (no policies)",
    sql: `select c.relname, c.relrowsecurity,
                 (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname in ('discord_imports', 'discord_import_channels',
                               'discord_import_files')
           order by c.relname`,
    ok: (rows) =>
      rows.length === 3 &&
      rows.every((r) => r.relrowsecurity === true && r.policies === 0),
  },
  {
    // The purge's only handle on "which rows belong to import X". Two imports
    // can merge into one live channel, so without this the purge cannot tell
    // them apart and would take the other import's history with it.
    //
    // The PREDICATE is asserted, not just the index's existence. `kind =
    // 'imported'` is load-bearing and the obvious alternative is silently
    // broken: Postgres must prove the query's WHERE implies the index
    // predicate, and it cannot derive `metadata ? 'discord_import_id'` from
    // `metadata ->> 'discord_import_id' = $1`. Measured — with the `?`
    // predicate the purge query does not use this index even with
    // `enable_seqscan = off`. An index that exists but is unreachable looks
    // exactly like one that works until an import gets large.
    name: "the discord_import_id purge index is predicated so the purge can use it",
    sql: `select indexdef from pg_indexes
           where indexname = 'idx_chat_messages_discord_import'`,
    ok: (rows) =>
      rows.length === 1 &&
      /discord_import_id/.test(rows[0].indexdef ?? "") &&
      /WHERE \(kind = 'imported'/i.test(rows[0].indexdef ?? ""),
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
    // The block rule (#2521). The behavioural tier near the end of this file
    // proves what it does; this pins that the function still consults the
    // caller's block list at all, so a re-create copied from an older body
    // fails here by name.
    name: "get_channel_unread_counts skips senders the caller blocked (#2521)",
    sql: `select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'get_channel_unread_counts'`,
    ok: (rows) =>
      rows.length === 1 &&
      /not\s+exists\s*\(\s*select\s+1\s+from\s+chat_member_blocks/i.test(
        rows[0].prosrc ?? "",
      ) &&
      /blocker_user_id\s*=\s*p_user_id/i.test(rows[0].prosrc ?? "") &&
      /blocked_user_id\s*=\s*m\.sender_id/i.test(rows[0].prosrc ?? ""),
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
    // The historical seed inserts 'Frapp System', #1935 renamed it to Signet
    // System, and ADR-25 step 3 (#2578) renamed it back, so replay must end on
    // Frapp System.
    name: "seeded system actor display_name is Frapp System (#2578)",
    sql: `select display_name from public.users
           where id = '00000000-0000-0000-0000-000000000000'`,
    ok: (rows) => rows.length === 1 && rows[0].display_name === "Frapp System",
  },
  {
    name: "chapter_directory has GENERATED search_vector column",
    sql: `select attgenerated from pg_attribute
           where attrelid = 'chapter_directory'::regclass and attname = 'search_vector'`,
    ok: (rows) =>
      rows.length === 1 && rows[0].attgenerated && rows[0].attgenerated !== "",
  },
  {
    // The other three `GET /v1/search` sources (#284). `chat_messages` got its
    // index first because the archive import made it urgent; these finish the
    // set, and each replaces an `ILIKE '%q%'` the planner could only answer with
    // a sequential scan. `users.display_name_search` is the one to protect
    // hardest: `users` is GLOBAL, so its scan cost is shared across every
    // chapter and grows with total signups rather than with any one chapter.
    //
    // Pinned as generated-column + GIN together, because losing either half
    // silently returns the source to a sequential scan while search still works.
    name: "backwork/events/users full-text search: generated tsvector + GIN index",
    sql: `select
            (select count(*) from pg_attribute
              where attrelid = 'backwork_resources'::regclass
                and attname = 'search_vector' and attgenerated <> '')::int as bw_gen,
            (select count(*) from pg_attribute
              where attrelid = 'events'::regclass
                and attname = 'search_vector' and attgenerated <> '')::int as ev_gen,
            (select count(*) from pg_attribute
              where attrelid = 'users'::regclass
                and attname = 'display_name_search' and attgenerated <> '')::int as us_gen,
            (select count(*) from pg_indexes
              where indexname in (
                'idx_backwork_resources_search',
                'idx_events_search',
                'idx_users_display_name_search'
              ) and indexdef ilike '%using gin%')::int as gin_indexes`,
    ok: (rows) =>
      rows.length === 1 &&
      rows[0].bw_gen === 1 &&
      rows[0].ev_gen === 1 &&
      rows[0].us_gen === 1 &&
      rows[0].gin_indexes === 3,
  },
  {
    // Schema-drift guard for the two explicit select lists in
    // `SupabaseSearchRepository`. They enumerate columns rather than `select('*')` so the
    // generated tsvector is not shipped back per row -- but an explicit list
    // stops tracking its table the moment a migration adds a column, and the
    // rows are cast to the entity type, so nothing else would notice: the new
    // field just silently stops appearing in search results.
    //
    // That already happened once while writing #284 -- the first draft dropped
    // `check_in_zone` / `check_in_zone_name` from event results, which
    // `apps/web/components/events/event-editor-dialog.tsx` reads to populate the
    // geofence editor. This landmark is why it cannot happen quietly again.
    //
    // Expected set: every column of the table EXCEPT the generated tsvector.
    name: "SupabaseSearchRepository select lists cover every column of events + backwork_resources",
    sql: `select table_name, string_agg(column_name, ', ' order by ordinal_position) as cols
            from information_schema.columns
           where table_schema = 'public'
             and table_name in ('events', 'backwork_resources')
             and column_name <> 'search_vector'
           group by table_name`,
    ok: (rows) => {
      const source = readFileSync(
        join(
          REPO_ROOT,
          "apps/api/src/infrastructure/supabase/repositories/supabase-search.repository.ts",
        ),
        "utf8",
      );
      const listFor = (constName) => {
        const m = source.match(
          new RegExp(`export const ${constName}\\s*=\\s*\\n?\\s*'([^']*)'`),
        );
        return m ? m[1] : null;
      };
      const expected = {
        events: listFor("EVENT_SEARCH_COLUMNS"),
        backwork_resources: listFor("BACKWORK_SEARCH_COLUMNS"),
      };
      const norm = (s) =>
        (s ?? "")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
          .sort()
          .join(",");
      return rows.every((row) => {
        const want = norm(row.cols);
        const got = norm(expected[row.table_name]);
        if (want !== got) {
          const missing = want
            .split(",")
            .filter((c) => !got.split(",").includes(c));
          const extra = got
            .split(",")
            .filter((c) => !want.split(",").includes(c));
          console.error(
            `      ${row.table_name}: select list drift` +
              (missing.length ? ` -- MISSING ${missing.join(", ")}` : "") +
              (extra.length ? ` -- NOT A COLUMN ${extra.join(", ")}` : ""),
          );
        }
        return want === got;
      });
    },
  },
  {
    name: "apply_subscription_webhook RPC present, security invoker (#731)",
    sql: `select prosecdef from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'apply_subscription_webhook'`,
    ok: (rows) => rows.length === 1 && rows[0].prosecdef === false,
  },
  {
    name: "apply_subscription_webhook returns previous_subscription_status (#1979)",
    sql: `select pg_get_function_result(p.oid) as result
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'apply_subscription_webhook'`,
    ok: (rows) =>
      rows.length === 1 &&
      String(rows[0].result).includes("previous_subscription_status"),
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
// tier guards that invariant by asserting policy *presence* and shape. The
// black-box tier further down then reads the tables as a non-owner role to
// check that the policies actually behave; what neither can do is mint a real
// GoTrue JWT, which stays with the NestJS Jest tier.

// Tables intentionally exempt from the "RLS enabled" invariant. Empty today —
// all 48 tables enable RLS. Add a table here ONLY with a reviewed justification
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
    name: "chat_message_actions SELECT withholds a blocked member's reactions via chat_viewer_has_blocked (#2494)",
    // The same smoke-test caveat as the assertion above: this says the policy
    // still carries the block clause, and the block-enforcement tier below is
    // what proves the clause hides the right rows. Kept separate from the
    // FRA-38 assertion so a lost block clause fails with its own name.
    sql: `select pg_get_expr(polqual, polrelid) as using_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_message_actions'
             and p.polpermissive
             and p.polcmd in ('r', '*')`,
    ok: (rows) => {
      if (rows.length !== 1) return false;
      const e = String(rows[0].using_expr);
      return (
        /\bnot\b/i.test(e) &&
        /starts_with\s*\(\s*(?:\w+\.)?action_type\s*,\s*'reaction:'/i.test(e) &&
        /chat_viewer_has_blocked\s*\(\s*(?:\w+\.)?user_id\s*,\s*(?:\w+\.)?message_id\s*\)/i.test(
          e,
        )
      );
    },
  },
  {
    name: "chat_viewer_has_blocked() EXECUTE is revoked from PUBLIC and anon",
    // Same reasoning, and the same default-privileges limitation, as the
    // can_read_chat_message() assertion below. The helper answers only about
    // the caller's own block list, so an RPC call leaks nothing today; the
    // revoke keeps it that way if a later edit adds a parameter.
    sql: `select has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
                 has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'chat_viewer_has_blocked'`,
    ok: (rows) =>
      rows.length === 1 &&
      rows[0].public_exec === false &&
      rows[0].anon_exec === false,
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
    name: "can_read_chat_message() EXECUTE is revoked from PUBLIC and anon (not a wide-open PostgREST RPC oracle)",
    // The helper is SECURITY DEFINER and answers "may I read this message?", so
    // exposing it as an RPC hands out a membership oracle. A later `drop function;
    // create function` silently restores the default PUBLIC grant, so pin it.
    //
    // `anon` is checked directly too, now that the role exists here (#1557):
    // that catches an explicit `grant execute ... to anon` in a migration.
    // LIMITATION: hosted Supabase also grants `anon` EXECUTE through ALTER
    // DEFAULT PRIVILEGES, and this harness does not replay those defaults. So a
    // drop/recreate that restores anon's grant on hosted (by forgetting the
    // `revoke ... from anon`) still leaves this green. For this function the
    // promotion-time `has_function_privilege('anon', ...)` check in
    // docs/ops/database/promotion-log.md covers that case. Not every function has such an
    // entry, so in general nothing does (#3052).
    sql: `select has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
                 has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'can_read_chat_message'`,
    ok: (rows) =>
      rows.length === 1 &&
      rows[0].public_exec === false &&
      rows[0].anon_exec === false,
  },
  {
    name: "can_read_chat_message() is SECURITY DEFINER with search_path pinned to exactly `public, pg_temp`",
    sql: `select prosecdef, proconfig
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'can_read_chat_message'`,
    // The pin must be exactly `public, pg_temp` — that list, in that order.
    //
    // This asserted "exactly public" until #985. That was the weaker pin, not the
    // stronger one: omitting `pg_temp` does not exclude the temp schema, it moves it
    // to the FRONT of the resolution order implicitly, so a caller-created temp table
    // shadowed `chat_messages` inside the RLS predicate while it ran with the
    // definer's privileges. Naming `pg_temp` LAST is what demotes it. It is therefore
    // not a widening, and the original intent — reject an extra readable schema like
    // `public, pg_catalog` — is preserved by pinning the exact list rather than
    // merely looking for `pg_temp` somewhere in it.
    //
    // Order is asserted, not just membership: `pg_temp, public` would reinstate the
    // exact shadowing this exists to prevent. The repo-wide version of this check
    // lives in the `security definer search_path` tier below and covers every such
    // function; this landmark stays because this one backs chat RLS and deserves its
    // own named assertion.
    ok: (rows) => {
      if (rows.length !== 1 || rows[0].prosecdef !== true) return false;
      const cfg = rows[0].proconfig;
      // proconfig arrives as a JS array from PGlite; the string branch is
      // defensive. It must NOT split on "," -- the value we are looking for is
      // `search_path=public, pg_temp`, a SINGLE element that itself contains a
      // comma, which Postgres therefore renders quoted inside the array literal.
      // Splitting naively would tear it in half and fail a correctly-pinned
      // function. Match quoted elements whole, unquoted ones up to the next comma.
      const items = Array.isArray(cfg)
        ? cfg
        : (
            String(cfg ?? "")
              .replace(/^\{|\}$/g, "")
              .match(/"(?:[^"\\]|\\.)*"|[^,]+/g) ?? []
          ).map((it) => it.trim().replace(/^"|"$/g, "").replace(/\\"/g, '"'));
      const sp = items
        .map((it) => String(it).trim())
        .find((it) => /^search_path\s*=/i.test(it));
      if (!sp) return false;
      const schemas = sp
        .replace(/^search_path\s*=\s*/i, "")
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, "").toLowerCase());
      return (
        schemas.length === 2 &&
        schemas[0] === "public" &&
        schemas[1] === "pg_temp"
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
    console.log(
      "OK    every public table enables RLS (default-deny invariant)",
    );
  } else {
    missing += 1;
    console.log(
      `MISS  ${offenders.length} public table(s) without RLS enabled\n        ↳ ${offenders.join(", ")}`,
    );
  }
}
for (const lm of RLS_SMOKE) await runOne(lm);

// ─── Policy inventory (#977) ────────────────────────────────────────────────
//
// `authorization-model.md` §4 heads its table "The policies that do exist (N
// statements)". That number had drifted and was reconciled by hand, which is
// precisely why it drifted again: nothing re-checked it. This checks it against
// the catalog.
//
// The counting convention, written down because ambiguity was the actual defect:
// **N counts individual policy statements — rows in `pg_policies` — not rows in
// the doc's table**, several of which name two policies each.
//
// PGlite legitimately sees fewer than a hosted project, and both absences are
// schema-gated rather than a defect: `realtime.messages.realtime_messages_
// scoped_select` and `realtime.messages.realtime_messages_scoped_insert` (#1552
// phase 1) live in the `realtime` schema, which PGlite does not have at all.
// (`users.auth_admin_can_read_users` and `members.auth_admin_can_read_members`
// were a third and fourth absence until #1557 created `supabase_auth_admin`,
// whose `if exists` guard in 20260802120000_active_chapter_jwt_claim.sql:137
// they sit behind.) So: 10 in `public` here; 12 hosted (10 in `public` + 2 in
// `realtime`). The printed hosted figure is derived from this list + those 2,
// so it cannot silently contradict itself the way a second hardcoded literal
// would.
//
// Asserted as an exact SET rather than a count: a bare count lets a dropped
// policy be masked by an added one, which is the failure mode that matters — a
// silently removed policy widens access without changing the total.
// A policy whose `roles` is exactly this binds no client: `supabase_auth_admin`
// is the role Supabase Auth runs the custom-access-token hook as. Every other
// role list counts as client-reachable, `{public}` above all. Shared by the
// tautology tripwire below and the default-deny tier's catalog check.
const AUTH_ADMIN_ONLY = "{supabase_auth_admin}";

{
  const HOSTED_ONLY_POLICIES = 2;
  const EXPECTED_PUBLIC_POLICIES = [
    "chapter_audit_log.audit_log_no_delete [DELETE] to {public}",
    "chapter_audit_log.audit_log_no_update [UPDATE] to {public}",
    "chat_message_actions.chat_message_actions_delete [DELETE] to {public}",
    "chat_message_actions.chat_message_actions_insert [INSERT] to {public}",
    "chat_message_actions.chat_message_actions_select [SELECT] to {authenticated}",
    "chat_messages.chat_messages_select [SELECT] to {authenticated}",
    "chat_notification_preferences.chat_notification_preferences_select_own [SELECT] to {public}",
    // FOR ALL, so an in-place rewrite here would widen writes as well as reads —
    // which is why the unconditional check below matters most for this one.
    "member_custom_field_values.member_custom_field_values_service_role [ALL] to {public}",
    "members.auth_admin_can_read_members [SELECT] to {supabase_auth_admin}",
    "users.auth_admin_can_read_users [SELECT] to {supabase_auth_admin}",
  ];
  // `cmd` is part of the identity, not decoration: flipping a policy from SELECT
  // to ALL widens it to writes while the name set is unchanged.
  //
  // So are the roles (#1557). `chat_messages_select` is written through a
  // `v_role_clause` DO block, and a plain `create policy` now works here, so
  // tidying that block into one would be the natural edit — and dropping its
  // `to authenticated` on the way changes neither name nor cmd. The policy
  // then binds `anon` on hosted, where `can_read_chat_message` is not
  // executable by anon: a read returns zero rows or raises 42501 depending on
  // plan shape (security-fixes.md § the chat_message_actions tiers), and
  // `use-chat-channel.ts` discards the error. Naming the roles makes that edit
  // a REMOVED-and-ADDED pair instead of a silent pass.
  const res = await db.query(
    `select tablename, policyname, cmd, permissive,
            roles::text as roles,
            coalesce(qual, '') as qual,
            coalesce(with_check, '') as with_check
       from pg_policies
      where schemaname = 'public'
      order by tablename, policyname`,
  );
  const got = res.rows.map(
    (r) => `${r.tablename}.${r.policyname} [${r.cmd}] to ${r.roles}`,
  );
  const added = got.filter((p) => !EXPECTED_PUBLIC_POLICIES.includes(p));
  const removed = EXPECTED_PUBLIC_POLICIES.filter((p) => !got.includes(p));

  // A name, cmd and roles set still cannot see a policy REWRITTEN in place, and
  // two of these ten have no other coverage anywhere in the repo
  // (`chat_notification_preferences_select_own`,
  // `member_custom_field_values_service_role`). Dropping and recreating one with
  // `using (true)` under the same name would keep the set identical and hand
  // every row to any authenticated PostgREST client. None of the eight a client
  // role can reach is unconditional today, so assert that directly.
  //
  // Only a policy a client can reach counts, which is every policy except one
  // bound to `supabase_auth_admin` alone (AUTH_ADMIN_ONLY). The two
  // `auth_admin_can_read_*` policies are `using (true)` by design: that is the
  // role the custom-access-token hook runs as, and no PostgREST request can
  // assume it.
  // BOTH halves, deliberately. `qual` governs reads (and the row a write may
  // target); `with_check` governs what a write may create. A FOR INSERT policy
  // like `chat_message_actions_insert` has a NULL `qual` and carries its entire
  // predicate in `with_check`, so a qual-only check can never fire for it — and
  // on the FOR ALL policy it is `with_check` that gates the write path. Reading
  // only `qual` would leave the write side of both entirely unpinned.
  //
  // This is a tripwire for the obvious rewrite, not a proof: it catches the
  // literal tautologies, and an adversarial `using (id = id)` would still pass.
  // It exists because two of these ten have no other coverage anywhere in the
  // repo (`chat_notification_preferences_select_own`,
  // `member_custom_field_values_service_role`).
  const TAUTOLOGY = /^\s*\(*\s*(true|1\s*=\s*1)\s*\)*\s*$/i;
  const unconditional = res.rows
    .filter(
      (r) =>
        r.permissive === "PERMISSIVE" &&
        r.roles !== AUTH_ADMIN_ONLY &&
        (TAUTOLOGY.test(r.qual) || TAUTOLOGY.test(r.with_check)),
    )
    .map(
      (r) =>
        `${r.tablename}.${r.policyname}` +
        (TAUTOLOGY.test(r.with_check) && !TAUTOLOGY.test(r.qual)
          ? " (with check)"
          : ""),
    );

  // Independent, not mutually exclusive: a migration that both drops a policy
  // and neuters another must report — and count — both. Reporting only one
  // hides "a silently removed policy", which this block's header calls the
  // failure mode that matters.
  let drifted = false;
  if (added.length > 0 || removed.length > 0) {
    drifted = true;
    missing += 1;
    console.log(
      "MISS  public policy inventory drifted from authorization-model.md §4" +
        (added.length
          ? `\n        ↳ ADDED (a new policy widens access — update §4): ${added.join(", ")}`
          : "") +
        (removed.length ? `\n        ↳ REMOVED: ${removed.join(", ")}` : ""),
    );
  }
  if (unconditional.length > 0) {
    drifted = true;
    missing += 1;
    console.log(
      `MISS  a permissive public policy is unconditional (\`true\`)\n        ↳ ${unconditional.join(", ")}`,
    );
  }
  if (!drifted) {
    console.log(
      `OK    public policy inventory matches authorization-model.md §4 (${got.length} here, ${EXPECTED_PUBLIC_POLICIES.length + HOSTED_ONLY_POLICIES} hosted)`,
    );
  }
}

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
  const OTHER = "77777777-7777-7777-7777-777777777777"; // the other member in a block pair
  const CAND = "88888888-8888-8888-8888-888888888888"; // rush candidate the doomed user voted on

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
  // A swallowed ping-trigger failure must still be observable (#978) — each
  // trigger's exception handler now `raise warning`s with SQLERRM before
  // swallowing (labeled "ping trigger failed", not "realtime.send failed":
  // the handler also wraps the `changed` scan above the send call). PGlite
  // has no `realtime` schema, so every insert below already exercises the
  // swallow; capture the notices this exec produces and assert exactly one
  // WARNING per ping table rather than only that the writes survived.
  try {
    const notices = [];
    await db.exec(
      `
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
    `,
      { onNotice: (n) => notices.push(n) },
    );
    console.log(
      "OK    change-ping tables accept writes with no `realtime` schema",
    );

    const warnings = notices.filter((n) => n.severity === "WARNING");
    const pingTables = ["notifications", "events", "event_attendance"];
    // Exact count, not merely "at least one": each table's trigger fires
    // once for this transaction (one INSERT each), so a table reporting
    // zero or more than one WARNING is itself a regression worth catching
    // — e.g. a future migration accidentally double-registering a trigger.
    const counts = Object.fromEntries(
      pingTables.map((t) => [
        t,
        warnings.filter((n) =>
          new RegExp(`ping trigger failed for ${t}\\b`).test(n.message ?? ""),
        ).length,
      ]),
    );
    const wrongCount = pingTables.filter((t) => counts[t] !== 1);
    if (wrongCount.length === 0) {
      console.log(
        "OK    each swallowed realtime.send failure raised exactly one observable WARNING",
      );
    } else {
      missing += 1;
      console.log(
        `ERR   each swallowed realtime.send failure raised exactly one observable WARNING\n        ↳ wrong count for: ${wrongCount.map((t) => `${t}=${counts[t]}`).join(", ")} (got ${warnings.length} warning(s) total: ${JSON.stringify(warnings.map((n) => n.message))})`,
      );
    }
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
      -- #2257 safety state. The asymmetry below is the property under test:
      -- the doomed user's OWN block goes, the block another member placed
      -- AGAINST them stays (purging it would let a reported member clear every
      -- block standing against him by deleting his account), and the report
      -- they filed stays because it is moderation history. Plus #494's rush
      -- ballot, whose purge line this same migration adds.
      insert into users (id, supabase_auth_id, email, display_name)
      values ('${OTHER}', gen_random_uuid(), 'other@example.com', 'Other Member');
      insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
      values ('${C}', '${U}', '${OTHER}'), ('${C}', '${OTHER}', '${U}');
      insert into chat_message_reports (chapter_id, message_id, reporter_user_id, reason, reported_content)
      values ('${C}', '${CARD}', '${U}', 'harassment',
              'Assigned "T" to Doomed User (due tomorrow) cc Doomed Userling');
      -- The other direction, which is the one carrying the abuse vector: a
      -- report filed BY someone else ABOUT the departing member. A symmetric
      -- "purge everything about them" would wipe the moderation queue about a
      -- member who is deleting his account to escape it.
      insert into chat_message_reports (chapter_id, message_id, reporter_user_id, reported_sender_id, reason)
      values ('${C}', '${EVCARD}', '${OTHER}', '${U}', 'spam');
      insert into rush_candidates (id, chapter_id, display_name, created_by)
      values ('${CAND}', '${C}', 'Prospect', '${OTHER}');
      insert into rush_candidate_votes (candidate_id, chapter_id, voter_id)
      values ('${CAND}', '${C}', '${U}');
      -- #2877: the member's own sidebar arrangement.
      insert into chat_sidebar_preferences (user_id, chapter_id, hide_muted, collapsed_sections)
      values ('${U}', '${C}', true, array['direct']);
      insert into chat_sidebar_pins (user_id, chapter_id, channel_id)
      values ('${U}', '${C}', '${CH}');
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
        // #2257. The delete block has been hand-copied forward twice
        // (20260803140000 -> 20260902160000 -> 20260915210100) and each
        // omission so far was caught only by a human diffing the body. These
        // two assertions are the regression guard for the safety-relevant
        // half, in BOTH directions: a future copy that drops the purge fails
        // the first, and one that over-purges -- deleting blocks against the
        // departing member, or their reports -- fails the second.
        name: "current-state purged: own block list, rush ballots",
        sql: `select (select count(*)::int from chat_member_blocks where blocker_user_id = '${U}')
                   + (select count(*)::int from rush_candidate_votes where voter_id = '${U}') as leftovers`,
        ok: (rows) => rows.length === 1 && rows[0].leftovers === 0,
      },
      {
        // #2877. The fourth hand copy of the delete block
        // (20260929213000); a copy that drops either line fails here.
        name: "current-state purged: sidebar preferences, sidebar pins",
        sql: `select (select count(*)::int from chat_sidebar_preferences where user_id = '${U}')
                   + (select count(*)::int from chat_sidebar_pins where user_id = '${U}') as leftovers`,
        ok: (rows) => rows.length === 1 && rows[0].leftovers === 0,
      },
      {
        // Exact counts, not `>= 0`: an over-purge gives 0 and a spurious
        // duplicate gives 2, so both directions fail. reports_against is the
        // one that matters most -- it is the queue ABOUT the departing member,
        // which a symmetric purge would let him erase by leaving.
        name: "safety state RETAINED: blocks against them, reports they filed, reports about them",
        sql: `select (select count(*)::int from chat_member_blocks where blocked_user_id = '${U}') as blocked_by,
                     (select count(*)::int from chat_message_reports where reporter_user_id = '${U}') as reports,
                     (select count(*)::int from chat_message_reports where reported_sender_id = '${U}') as reports_against`,
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].blocked_by === 1 &&
          rows[0].reports === 1 &&
          rows[0].reports_against === 1,
      },
      {
        // #2257. reported_content is a second copy of chat_messages.content, so
        // the card scrub has to reach it too or a scrubbed display name
        // survives verbatim in a table nothing ever purges.
        name: "report evidence snapshot scrubbed alongside the card it copies",
        sql: `select reported_content from chat_message_reports where message_id = '${CARD}'`,
        // Exactly the string the sibling assertion above pins for
        // chat_messages.content, including the 'Doomed Userling' that word
        // boundaries must leave alone -- the snapshot has to track the message
        // it copies precisely, not merely stop saying 'Doomed User'.
        ok: (rows) =>
          rows.length === 1 &&
          rows[0].reported_content ===
            'Assigned "T" to Deleted User (due tomorrow) cc Doomed Userling',
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
          rows[0].content ===
            'Deleted User scheduled "BBQ" — Aug 9, 6:00 PM UTC' &&
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
        ok: (rows) =>
          rows.length === 1 && rows[0].content === "hi, Doomed User here",
      },
    ];
    for (const lm of FUNCTIONAL) await runOne(lm);
  }

  await db.exec("rollback;");
}

// ─── chat_message_actions read enforcement (FRA-38) ─────────────────────────
//
// The membership-scoped SELECT policy delegates to can_read_chat_message(). The
// black-box tiers below stand up an `rls_probe` role because RLS does not apply
// to superusers or table owners — a non-owner is required to be subject to a
// policy at all. That role is deliberately GRANTED `authenticated` (see the
// grant below); without that membership every `TO authenticated` policy stops
// applying to it and every read silently falls back to default-deny, so the
// visibility-set assertions would pass on empty results for the wrong reason.
// Real-JWT enforcement (claims beyond `sub`/`role`) still lives in the NestJS
// Jest tier. This tier is the layer under that: it tests the SECURITY DEFINER
// predicate directly —
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
  // Chapter B's own PUBLIC channel. Exists so the cross-chapter reader has
  // something it legitimately CAN see: without it, "userB sees zero chapter-A
  // rows" is satisfied just as well by a uuid the schema has never heard of,
  // and proves nothing about tenant scoping.
  chPublicB: "c0000007-0000-0000-0000-000000000001",
  msgPublic: "10000001-0000-0000-0000-000000000001",
  msgPrivate: "10000002-0000-0000-0000-000000000001",
  msgDM: "10000003-0000-0000-0000-000000000001",
  msgRoleGated: "10000004-0000-0000-0000-000000000001",
  msgRoleGatedOpen: "10000005-0000-0000-0000-000000000001",
  msgGroupDM: "10000006-0000-0000-0000-000000000001",
  msgPublicB: "10000007-0000-0000-0000-000000000001",
  // One invoice per chapter, so the default-deny tier below has both a
  // same-chapter row (the one a naive "scope by tenant" policy would expose)
  // and a cross-chapter row to deny.
  invA: "20000001-0000-0000-0000-000000000001",
  invB: "20000002-0000-0000-0000-000000000001",
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
  -- A DM holds exactly two members (chat_channels_dm_two_members, #2788). Its
  -- other participant is userF, whom no scenario below reads the DM as.
  insert into chat_channels (id, chapter_id, name, type, member_ids, required_permissions) values
    ('${F.chPublic}',        '${F.chapA}', 'public',     'PUBLIC',     null,              null),
    ('${F.chPrivate}',       '${F.chapA}', 'private',    'PRIVATE',    '{${F.userAId}}',  null),
    ('${F.chDM}',            '${F.chapA}', 'dm',         'DM',         '{${F.userAId},${F.userFId}}', null),
    ('${F.chRoleGated}',     '${F.chapA}', 'gated',      'ROLE_GATED', null,              '{chat:secret}'),
    ('${F.chRoleGatedOpen}', '${F.chapA}', 'gated-open', 'ROLE_GATED', null,              '{}'),
    ('${F.chGroupDM}',       '${F.chapA}', 'groupdm',    'GROUP_DM',   '{${F.userAId}}',  null),
    ('${F.chPublicB}',       '${F.chapB}', 'public-b',   'PUBLIC',     null,              null);
  insert into chat_messages (id, channel_id, sender_id) values
    ('${F.msgPublic}',        '${F.chPublic}',        '${F.userAId}'),
    ('${F.msgPrivate}',       '${F.chPrivate}',       '${F.userAId}'),
    ('${F.msgDM}',            '${F.chDM}',            '${F.userAId}'),
    ('${F.msgRoleGated}',     '${F.chRoleGated}',     '${F.userAId}'),
    ('${F.msgRoleGatedOpen}', '${F.chRoleGatedOpen}', '${F.userAId}'),
    ('${F.msgGroupDM}',       '${F.chGroupDM}',       '${F.userAId}'),
    ('${F.msgPublicB}',       '${F.chPublicB}',       '${F.userBId}');
`);
  readSeeded = true;
} catch (e) {
  missing += 1;
  console.log(
    `ERR   chat_message_actions read-enforcement seed\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}

// ─── Who a tier reads as (#1556) ────────────────────────────────────────────
//
// A reader is three things, and a scenario that sets only one of them is a
// different reader from the one its name claims:
//   - `uid`: what `auth.uid()` returns, the JWT's `sub`; null with no JWT.
//   - `jwtRole`: what `auth.role()` returns, the JWT's `role` claim.
//   - `dbRole`: the Postgres role the read runs as, which is what a policy's
//     `TO` clause binds. RLS skips superusers and table owners, so a
//     black-box read needs a non-owner probe role at all.
//
// Every reader is built here, and setAuth() stubs both auth functions for it,
// so no scenario inherits the previous one's role. There are three null-uid
// readers because each binds a different set of policies, and none of them
// covers what the other two do.
const signedIn = (uid) => ({
  uid,
  jwtRole: "authenticated",
  dbRole: "rls_probe",
});

// A signed-in session with no `sub`. GoTrue never mints one, so hosted never
// receives this request. It is the chat tiers' "no JWT" reader because it is
// the only one that reaches a null-uid branch behind an `auth.role() =
// 'authenticated'` conjunct, which both chat policies carry. So a predicate
// spelled `... and (can_read_chat_message(id) or auth.uid() is null)` leaks
// every row to this reader and to neither of the two below. (ANON_CLAIM
// reaches a null-uid branch too, in a `to authenticated` policy that does not
// test the role.)
const NULL_SUB = { uid: null, jwtRole: "authenticated", dbRole: "rls_probe" };

// The anon claim, read through the `authenticated` grant: the deny tier's
// anonymous reader (#423). With `auth.role()` left at 'authenticated' it would
// be NULL_SUB under another name, and a policy spelled `using (auth.role() =
// 'anon')` would read as default-deny.
const ANON_CLAIM = { uid: null, jwtRole: "anon", dbRole: "rls_probe" };

// The anon key as hosted runs it (#1557 created the role): no uid, the anon
// claim, and the read made as a member of `anon` and not of `authenticated`.
// It is the only reader a policy spelled `to anon` binds, since the two above
// hold the `authenticated` grant instead. Every black-box table is read as it:
// both chat matrices, the post-archive re-check and the default-deny tier.
const ANON_KEY = { uid: null, jwtRole: "anon", dbRole: "rls_probe_anon" };

const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

// Point `auth.uid()` and `auth.role()` at a reader. Both, always: this is the
// one place either stub is rewritten per scenario.
async function setAuth({ uid, jwtRole }) {
  // A mistyped `F.` key yields undefined, which would interpolate
  // 'undefined'::uuid and read as a denial: a scenario that silently tests
  // nothing. Fail loudly instead.
  if (uid !== null && typeof uid !== "string") {
    throw new Error(`a reader has a non-fixture uid (${String(uid)})`);
  }
  const sub = uid === null ? "null" : `'${uid}'`;
  await db.exec(`
    create or replace function auth.uid()  returns uuid language sql as $$ select ${sub}::uuid $$;
    create or replace function auth.role() returns text language sql as $$ select '${jwtRole}'::text $$;
  `);
}

// One black-box read as `who`, in its own savepoint. Returns `{ rows, failure }`
// and does not throw: a bad reader (a non-fixture uid) comes back as that
// scenario's failure too, so the verdict names the scenario to fix.
//
// The savepoint is the point (#1556). A policy that references a table the
// probe cannot read raises `permission denied` instead of returning rows, and
// an error inside the open transaction poisons it (25P02) for everything after.
// Before this helper, one such policy in the first tier unwound to the
// tier-wide catch, and every later tier never ran: the log showed one chat
// error and no deny header at all. Rolling back to the savepoint keeps the
// transaction usable, so each scenario reports its own verdict and the tiers
// after it still run.
async function probeAs(who, sql) {
  try {
    await setAuth(who);
  } catch (e) {
    return { rows: null, failure: firstLine(e) };
  }
  await db.exec("savepoint probe;");
  let rows = null;
  let failure = null;
  try {
    await db.exec(`set role ${who.dbRole};`);
    rows = (await db.query(sql)).rows;
  } catch (e) {
    failure = firstLine(e);
  } finally {
    try {
      await db.exec("reset role;");
    } catch {
      /* the savepoint rollback below is what actually recovers */
    }
    // Guarded like the `reset role` above, and for the same reason: a throw
    // raised in `finally` REPLACES the verdict the try/catch just computed.
    //
    // `rollback to savepoint` does NOT destroy the savepoint (verified while
    // building the #423 deny tier: rolling back to the same name three times
    // succeeds), so the error branch releases it explicitly. Otherwise every
    // failing read leaves another live subtransaction open.
    try {
      await db.exec(
        failure === null
          ? "release savepoint probe;"
          : "rollback to savepoint probe; release savepoint probe;",
      );
    } catch (e) {
      failure ??= `savepoint cleanup failed: ${firstLine(e)}`;
    }
  }
  return { rows, failure };
}

// The exact-set verdict the visibility tiers print. A count is satisfied by the
// right NUMBER of wrong rows, so each reader's set is compared both ways. Reads
// select their row id as `id`.
function expectSet(name, probe, visible, labelOf) {
  if (probe.failure !== null) {
    missing += 1;
    console.log(
      `MISS  ${name}\n        ↳ the read raised instead: ${probe.failure}`,
    );
    return;
  }
  const got = probe.rows.map((r) => r.id).sort();
  const want = [...visible].sort();
  const leaked = got.filter((g) => !want.includes(g));
  const absent = want.filter((w) => !got.includes(w));
  if (leaked.length === 0 && absent.length === 0) {
    console.log(`OK    ${name}`);
  } else {
    missing += 1;
    console.log(
      `MISS  ${name}` +
        (leaked.length
          ? `\n        ↳ LEAKED: ${leaked.map(labelOf).join(", ")}`
          : "") +
        (absent.length
          ? `\n        ↳ wrongly hidden: ${absent.map(labelOf).join(", ")}`
          : ""),
    );
  }
}

async function canReadAs(authUid, messageId) {
  await setAuth(authUid === null ? NULL_SUB : signedIn(authUid));
  const res = await db.query(
    `select public.can_read_chat_message('${messageId}'::uuid) as ok`,
  );
  return res.rows[0].ok === true;
}

const READ_SCENARIOS = [
  {
    name: "own-chapter PUBLIC is visible to a chapter member",
    uid: F.userAAuth,
    msg: F.msgPublic,
    expect: true,
  },
  {
    name: "cross-chapter PUBLIC is denied (tenant boundary)",
    uid: F.userBAuth,
    msg: F.msgPublic,
    expect: false,
  },
  {
    name: "PRIVATE is denied to a chapter member not in member_ids",
    uid: F.userCAuth,
    msg: F.msgPrivate,
    expect: false,
  },
  {
    name: "PRIVATE is visible to a member listed in member_ids",
    uid: F.userAAuth,
    msg: F.msgPrivate,
    expect: true,
  },
  {
    name: "DM is visible to a participant listed in member_ids",
    uid: F.userAAuth,
    msg: F.msgDM,
    expect: true,
  },
  {
    name: "DM is denied to a non-participant",
    uid: F.userCAuth,
    msg: F.msgDM,
    expect: false,
  },
  {
    name: "GROUP_DM is visible to a member listed in member_ids",
    uid: F.userAAuth,
    msg: F.msgGroupDM,
    expect: true,
  },
  {
    name: "GROUP_DM is denied to a chapter member not in member_ids",
    uid: F.userCAuth,
    msg: F.msgGroupDM,
    expect: false,
  },
  {
    name: "ROLE_GATED is denied without the required permission",
    uid: F.userCAuth,
    msg: F.msgRoleGated,
    expect: false,
  },
  {
    name: "ROLE_GATED is visible with the required permission",
    uid: F.userAAuth,
    msg: F.msgRoleGated,
    expect: true,
  },
  {
    name: "ROLE_GATED is visible to a '*' wildcard holder lacking the specific permission",
    uid: F.userDAuth,
    msg: F.msgRoleGated,
    expect: true,
  },
  // FRA-321: this asserted `true` — a ROLE_GATED channel that gates on nothing
  // was visible to every chapter member, i.e. functionally PUBLIC. Both the SQL
  // predicate and canAccessChannel now deny it; the backfill guarantees no
  // existing row is in that shape and the API rejects creating one.
  {
    name: "ROLE_GATED with empty required_permissions is denied (no longer falls open)",
    uid: F.userCAuth,
    msg: F.msgRoleGatedOpen,
    expect: false,
  },
  // ...but the wildcard still wins, exactly as canAccessChannel has it. Spelling
  // the deny as a length test placed *before* the wildcard branch would deny a
  // President here and silently re-introduce SQL/TypeScript drift.
  {
    name: "ROLE_GATED with empty required_permissions still admits a '*' wildcard holder",
    uid: F.userDAuth,
    msg: F.msgRoleGatedOpen,
    expect: true,
  },
  {
    name: "ROLE_GATED denies a chapter-B role id held by a chapter-A member (roles re-scoped by chapter)",
    uid: F.userEAuth,
    msg: F.msgRoleGated,
    expect: false,
  },
  {
    name: "ROLE_GATED matches an UPPERCASE stored role id (uuid compare, not text)",
    uid: F.userFAuth,
    msg: F.msgRoleGated,
    expect: true,
  },
  {
    name: "NULL auth.uid() (anon / no JWT) is denied",
    uid: null,
    msg: F.msgPublic,
    expect: false,
  },
];

console.log(
  "\n=== chat_message_actions read enforcement (can_read_chat_message) ===",
);
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
      console.log(
        `MISS  ${s.name}\n        ↳ expected ${s.expect}, got ${got}`,
      );
    }
  } catch (e) {
    missing += 1;
    console.log(
      `ERR   ${s.name}\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
    );
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
console.log(
  "\n=== chat_message_actions policy enforcement (black-box, SET ROLE) ===",
);
if (readSeeded) {
  try {
    await db.exec(`
      insert into chat_message_actions (message_id, user_id, action_type) values
        ('${F.msgPublic}',        '${F.userAId}', 'reaction'),
        ('${F.msgPrivate}',       '${F.userAId}', 'reaction'),
        ('${F.msgDM}',            '${F.userAId}', 'reaction'),
        ('${F.msgRoleGated}',     '${F.userAId}', 'reaction'),
        ('${F.msgRoleGatedOpen}', '${F.userAId}', 'reaction'),
        ('${F.msgGroupDM}',       '${F.userAId}', 'reaction'),
        -- userB's own reaction in their own chapter. Without it the
        -- cross-chapter expectation below is a negative control with no
        -- positive half: a predicate that denied every chapter-B member
        -- outright, rather than scoping by tenant, would still satisfy it.
        ('${F.msgPublicB}',       '${F.userBId}', 'reaction');

      drop role if exists rls_probe;
      create role rls_probe nologin;
      -- Membership in the authenticated role is what subjects the probe to
      -- policies carrying a TO authenticated clause. Without it those policies
      -- exist but never apply to this role, and every read below is answered
      -- by default-deny rather than by the policy under test.
      grant authenticated to rls_probe;
      grant usage on schema public to rls_probe;
      grant select on public.chat_message_actions to rls_probe;
      grant select on public.chat_messages to rls_probe;
      -- #423: both are default-deny (no policy a client role can reach), so the
      -- grant is what makes "reads nothing" mean RLS rather than a missing
      -- privilege. See the default-deny tier at the end of this block.
      grant select on public.members to rls_probe;
      grant select on public.financial_invoices to rls_probe;
      grant execute on function public.can_read_chat_message(uuid) to rls_probe;

      -- The anon key's reader (ANON_KEY). A member of anon and NOT of
      -- authenticated, as on hosted, so a policy bound to anon or public
      -- applies to it and one bound to authenticated does not. It gets the same
      -- table grants: hosted's default grant all on tables to anon is never
      -- revoked at table level, so RLS is what stands between the anon key and
      -- these rows there too. It gets no EXECUTE on can_read_chat_message,
      -- which is revoked from anon on hosted.
      drop role if exists rls_probe_anon;
      create role rls_probe_anon nologin;
      grant anon to rls_probe_anon;
      grant usage on schema public to rls_probe_anon;
      grant select on public.chat_message_actions to rls_probe_anon;
      grant select on public.chat_messages to rls_probe_anon;
      grant select on public.members to rls_probe_anon;
      grant select on public.financial_invoices to rls_probe_anon;
    `);

    // userA: chapter A, in member_ids of PRIVATE/DM/GROUP_DM, holds chat:secret.
    // userC: chapter A, no privileges, in no member list -> PUBLIC only.
    // userB: chapter B -> its own chapter's row only. No JWT, read either way
    // (NULL_SUB, ANON_KEY) -> nothing.
    //
    // FRA-321 moved both non-zero counts down by one, and the row that left each
    // is the same one: the ROLE_GATED channel with an empty requirement list.
    // It used to be readable by every chapter member; it is now readable by
    // none of them (userA holds chat:secret, which the open channel does not
    // ask for, and neither user holds the wildcard).
    const MSG_LABEL = {
      [F.msgPublic]: "PUBLIC",
      [F.msgPrivate]: "PRIVATE",
      [F.msgDM]: "DM",
      [F.msgRoleGated]: "ROLE_GATED(chat:secret)",
      [F.msgRoleGatedOpen]: "ROLE_GATED(empty-req)",
      [F.msgGroupDM]: "GROUP_DM",
      [F.msgPublicB]: "chapterB/PUBLIC",
    };
    const ALL_MSG_IDS = Object.keys(MSG_LABEL);
    const label = (id) => MSG_LABEL[id] ?? id;

    // Exact sets, not counts. A count is satisfied by the right NUMBER of wrong
    // rows — a policy that swapped one PRIVATE row for one cross-chapter row
    // would still total 5 here and stay green, which is the whole failure this
    // tier exists to catch.
    const BLACKBOX = [
      {
        name: "member sees every action row in channels they can read (all but the empty-gated one)",
        as: signedIn(F.userAAuth),
        visible: [
          F.msgPublic,
          F.msgPrivate,
          F.msgDM,
          F.msgRoleGated,
          F.msgGroupDM,
        ],
      },
      {
        name: "cross-chapter reader sees only their own chapter's row (tenant boundary holds at the table)",
        as: signedIn(F.userBAuth),
        visible: [F.msgPublicB],
      },
      {
        name: "chapter member sees only PUBLIC, not PRIVATE/DM/gated (incl. empty-gated)",
        as: signedIn(F.userCAuth),
        visible: [F.msgPublic],
      },
      {
        name: "no JWT (null auth.uid()) sees nothing",
        as: NULL_SUB,
        visible: [],
      },
      {
        name: "the anon key (role anon, no JWT) sees nothing",
        as: ANON_KEY,
        visible: [],
      },
    ];

    for (const s of BLACKBOX) {
      const probe = await probeAs(
        s.as,
        `select message_id::text as id from public.chat_message_actions`,
      );
      expectSet(s.name, probe, s.visible, label);
    }

    // ─── chat_message_actions: a block hides the blocked member's reactions (#2494)
    //
    // `spec/behavior/chat/README.md` § What a block does and does not hide: a
    // blocked member's reactions are hidden from the blocker on every message,
    // and their poll votes are counted, not hidden. Both clients read reaction
    // chips straight from this table, so the policy is the only place that can
    // enforce it for PostgREST and for the Realtime echo alike.
    //
    // userC blocks userA in chapter A. Every expectation is an exact set over
    // the rows this tier inserts, read as `rls_probe`:
    //   - userC loses userA's `reaction:*` rows in chapter A, on userA's own
    //     message and on userC's;
    //   - userC keeps userA's `vote`, userA's reaction in chapter B (both are
    //     members there, and the block is chapter A's), and other members'
    //     reactions. The last is the control: a clause that hid every reaction
    //     would pass the first check;
    //   - userA still reads every row. The block must not be observable from
    //     the blocked side.
    //
    // Runs in a savepoint that is always rolled back, so the chat_messages tier
    // below still sees exactly the six seeded messages it counts.
    //
    // Scenario names are cited by `chat-read-surface-ledger.spec.ts` as the
    // proof for `chat_message_actions_select`, which that spec checks is still
    // a `name:` here. Rename one there too.
    console.log(
      "\n=== chat_message_actions block enforcement (black-box, SET ROLE) — #2494 ===",
    );
    await db.exec("savepoint block_tier;");
    try {
      const K = {
        blockerMsg: "10000008-0000-0000-0000-000000000001", // userC's message in chapter A's PUBLIC channel
        blockedOnOwn: "30000001-0000-0000-0000-000000000001", // userA reaction on userA's message
        blockedOnBlockers: "30000002-0000-0000-0000-000000000001", // userA reaction on userC's message
        blockedVote: "30000003-0000-0000-0000-000000000001", // userA vote, chapter A
        blockedInChapB: "30000004-0000-0000-0000-000000000001", // userA reaction, chapter B
        otherReaction: "30000005-0000-0000-0000-000000000001", // userD reaction, chapter A
        blockerReaction: "30000006-0000-0000-0000-000000000001", // userC's own reaction
      };
      const ROW_LABEL = {
        [K.blockedOnOwn]: "userA reaction on userA's message",
        [K.blockedOnBlockers]: "userA reaction on userC's message",
        [K.blockedVote]: "userA vote",
        [K.blockedInChapB]: "userA reaction in chapter B",
        [K.otherReaction]: "userD reaction",
        [K.blockerReaction]: "userC reaction",
      };
      const ROW_IDS = Object.keys(ROW_LABEL);
      const rowLabel = (id) => ROW_LABEL[id] ?? id;

      await db.exec(`
        insert into members (user_id, chapter_id) values
          ('${F.userAId}', '${F.chapB}'),
          ('${F.userCId}', '${F.chapB}');
        insert into chat_messages (id, channel_id, sender_id) values
          ('${K.blockerMsg}', '${F.chPublic}', '${F.userCId}');
        insert into chat_message_actions (id, message_id, user_id, action_type) values
          ('${K.blockedOnOwn}',      '${F.msgPublic}',  '${F.userAId}', 'reaction:👍'),
          ('${K.blockedOnBlockers}', '${K.blockerMsg}', '${F.userAId}', 'reaction:👎'),
          ('${K.blockedVote}',       '${F.msgPublic}',  '${F.userAId}', 'vote'),
          ('${K.blockedInChapB}',    '${F.msgPublicB}', '${F.userAId}', 'reaction:👍'),
          ('${K.otherReaction}',     '${F.msgPublic}',  '${F.userDId}', 'reaction:👍'),
          ('${K.blockerReaction}',   '${F.msgPublic}',  '${F.userCId}', 'reaction:🎉');
      `);

      const readRowsAs = (uid) =>
        probeAs(
          signedIn(uid),
          `select id::text as id from public.chat_message_actions
            where id in (${ROW_IDS.map((id) => `'${id}'`).join(", ")})`,
        );

      // Read before the block, so "unchanged" has something to compare with.
      const blockedBefore = await readRowsAs(F.userAAuth);
      const blockerBefore = await readRowsAs(F.userCAuth);

      await db.exec(`
        insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
        values ('${F.chapA}', '${F.userCId}', '${F.userAId}');
      `);

      const blockerAfter = await readRowsAs(F.userCAuth);
      const blockedAfter = await readRowsAs(F.userAAuth);

      // Both members can read every channel these rows sit in, so before the
      // block each reads all six. Those two are the positive controls: without
      // them, a fixture that never landed would pass the "unchanged" check.
      const BLOCK_SCENARIOS = [
        {
          name: "before any block, the blocker-to-be reads every reaction and vote in both chapters",
          probe: blockerBefore,
          visible: ROW_IDS,
        },
        {
          name: "before any block, the member about to be blocked reads every reaction and vote in both chapters",
          probe: blockedBefore,
          visible: ROW_IDS,
        },
        {
          name: "a blocker reads none of a blocked member's reaction rows in that chapter, and keeps everything else",
          probe: blockerAfter,
          visible: [
            K.blockedVote,
            K.blockedInChapB,
            K.otherReaction,
            K.blockerReaction,
          ],
        },
        {
          name: "the blocked member still reads every row after being blocked (no oracle)",
          probe: blockedAfter,
          visible: ROW_IDS,
        },
      ];
      for (const s of BLOCK_SCENARIOS)
        expectSet(s.name, s.probe, s.visible, rowLabel);

      // The helper takes no blocker parameter. Called over RPC it must answer
      // only about the caller's own list: userA learns nothing about userC's
      // block, and userC's answer stays inside chapter A.
      const HELPER_SCENARIOS = [
        {
          name: "chat_viewer_has_blocked answers true for the caller's own block in the message's chapter",
          uid: F.userCAuth,
          actor: F.userAId,
          msg: F.msgPublic,
          expect: true,
        },
        {
          name: "chat_viewer_has_blocked answers false in another chapter (blocks are per chapter)",
          uid: F.userCAuth,
          actor: F.userAId,
          msg: F.msgPublicB,
          expect: false,
        },
        {
          name: "chat_viewer_has_blocked answers false to the blocked member asking about their blocker",
          uid: F.userAAuth,
          actor: F.userCId,
          msg: F.msgPublic,
          expect: false,
        },
        {
          // userC holds the block in chapter A but is not in the DM. A true
          // here would tell them the message exists.
          name: "chat_viewer_has_blocked answers false for a message the caller cannot read (no existence oracle)",
          uid: F.userCAuth,
          actor: F.userAId,
          msg: F.msgDM,
          expect: false,
        },
      ];
      for (const s of HELPER_SCENARIOS) {
        await setAuth(signedIn(s.uid));
        const res = await db.query(
          `select public.chat_viewer_has_blocked('${s.actor}'::uuid, '${s.msg}'::uuid) as ok`,
        );
        const got = res.rows[0].ok === true;
        if (got === s.expect) {
          console.log(`OK    ${s.name}`);
        } else {
          missing += 1;
          console.log(
            `MISS  ${s.name}\n        ↳ expected ${s.expect}, got ${got}`,
          );
        }
      }
    } catch (e) {
      missing += 1;
      console.log(
        `ERR   chat_message_actions block enforcement\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
      );
    } finally {
      await db.exec(
        "rollback to savepoint block_tier; release savepoint block_tier;",
      );
    }

    // ─── chat_messages read enforcement (black-box, SET ROLE) — #977 ─────────
    //
    // The tier above proves the POLICY on `chat_message_actions` is wired to the
    // predicate. `chat_messages` had only the shape assertion in the RLS smoke
    // list, plus (since #974) the two archive-rule reads below — and a shape
    // assertion is defeatable by construction. The harness says so itself about
    // the sibling: substring-shaped, so a determined rewrite slips past it.
    // That check tests three substrings — `can_read_chat_message(id)`,
    // `authenticated`, and `kind <> 'imported'` — so a defeating rewrite keeps
    // all three and neuters only the one doing the work:
    //     and (public.can_read_chat_message(id) or true)
    // which satisfies all three AND `rows.length === 1`, turning every message
    // in every chapter's private channels and DMs into an authenticated read.
    // Only reading the table as a non-owner role catches that.
    //
    // Placement is deliberate: this runs BEFORE the archive block below inserts
    // its imported row and its live null-sender row, so the fixture here is
    // exactly the six seeded live messages. An expectation in this tier means
    // "of those six" and cannot silently absorb rows added later.
    //
    // Asserted as an exact SET per reader, not a count. A total can be right for
    // the wrong reason — userD sees three rows, but *which* three is the whole
    // question: '*' opens both ROLE_GATED channels and must still not open a DM.

    const MSG_BLACKBOX = [
      {
        who: "chapter member in member_ids holding chat:secret",
        as: signedIn(F.userAAuth),
        visible: [
          F.msgPublic,
          F.msgPrivate,
          F.msgDM,
          F.msgRoleGated,
          F.msgGroupDM,
        ],
      },
      {
        // The positive control is what makes this assertion mean anything. userB
        // is a real, functioning reader — it sees its OWN chapter's PUBLIC
        // message — and still sees none of chapter A's six. Without that half,
        // "sees zero of chapter A" is equally satisfied by a uuid belonging to
        // nobody, and the tenant boundary is never actually exercised.
        who: "cross-chapter member (sees only their own chapter)",
        as: signedIn(F.userBAuth),
        visible: [F.msgPublicB],
      },
      {
        who: "chapter member with no privileges, in no member list",
        as: signedIn(F.userCAuth),
        visible: [F.msgPublic],
      },
      {
        // The case the sibling tier never exercises black-box, and the sharpest
        // one: permission and membership are independent axes. '*' grants both
        // ROLE_GATED channels (including the empty-requirement one) and still
        // must not grant PRIVATE / DM / GROUP_DM, which gate on member_ids.
        who: "chapter member holding the '*' wildcard, in no member list",
        as: signedIn(F.userDAuth),
        visible: [F.msgPublic, F.msgRoleGated, F.msgRoleGatedOpen],
      },
      { who: "no JWT (null auth.uid())", as: NULL_SUB, visible: [] },
      { who: "the anon key (role anon, no JWT)", as: ANON_KEY, visible: [] },
    ];

    // Every expectation below is stated as a set over ALL_MSG_IDS. That is only
    // equivalent to "what this reader can see in the table" if the fixtures ARE
    // the table — so assert it once, as owner, instead of re-counting per
    // scenario. If a future seed adds a message and forgets this tier, this
    // fails loudly rather than letting the set assertions quietly go partial.
    {
      const total = await db.query(
        `select count(*)::int as n from public.chat_messages`,
      );
      const name =
        "the message fixtures are the whole table (set assertions below are table-wide)";
      if (total.rows[0].n === ALL_MSG_IDS.length) {
        console.log(`OK    ${name}`);
      } else {
        missing += 1;
        console.log(
          `MISS  ${name}\n        ↳ expected ${ALL_MSG_IDS.length} row(s), found ${total.rows[0].n}`,
        );
      }
    }

    for (const s of MSG_BLACKBOX) {
      const want = [...s.visible].sort();
      const probe = await probeAs(
        s.as,
        `select id::text as id from public.chat_messages
          where id in (${ALL_MSG_IDS.map((m) => `'${m}'`).join(", ")})`,
      );
      expectSet(
        `${s.who} reads exactly ${want.length}/${ALL_MSG_IDS.length} (${want.map(label).join(", ") || "nothing"})`,
        probe,
        s.visible,
        label,
      );
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
        as: signedIn(F.userAAuth),
        sql: `select count(*)::int as n from public.chat_messages where id = '${IMPORTED_MSG}'`,
        expect: 0,
      },
      {
        name: "a live row in the same channel is still visible (the rule is `kind`, not a blanket deny)",
        as: signedIn(F.userAAuth),
        sql: `select count(*)::int as n from public.chat_messages where id = '${F.msgPublic}'`,
        expect: 1,
      },
    ];

    for (const s of ARCHIVE) {
      const probe = await probeAs(s.as, s.sql);
      const got = probe.rows?.[0]?.n;
      if (probe.failure === null && got === s.expect) {
        console.log(`OK    ${s.name}`);
      } else {
        missing += 1;
        console.log(
          `MISS  ${s.name}\n        ↳ ` +
            (probe.failure === null
              ? `expected ${s.expect} visible row(s), got ${got}`
              : `the read raised instead: ${probe.failure}`),
        );
      }
    }

    // ─── The archive row must not reopen the table to unauthorised readers ──
    //
    // The membership tier above runs before IMPORTED_MSG exists, which is what
    // keeps its expectations readable — but it also means no assertion there can
    // see a policy that special-cases imported rows. That gap is reachable:
    //
    //   using ((auth.role() = 'authenticated' and kind <> 'imported'
    //           and can_read_chat_message(id))
    //          or (auth.uid() is null and kind = 'imported'))
    //
    // hands every archived message in every chapter to an unauthenticated
    // PostgREST client. It satisfies all three shape regexes, keeps one
    // permissive policy, and passes every membership expectation — because the
    // row it leaks does not exist yet when those run. So re-check the readers
    // that must see nothing of another tenant, now that it does.
    // Exact sets over the WHOLE table, matching the membership tier — a count
    // can be right for the wrong reason (a policy hiding chapterB/PUBLIC from
    // userB while exposing one imported row keeps the total at 1).
    const POST_ARCHIVE = [
      { who: "no JWT (null auth.uid())", as: NULL_SUB, visible: [] },
      { who: "the anon key (role anon, no JWT)", as: ANON_KEY, visible: [] },
      {
        who: "cross-chapter member",
        as: signedIn(F.userBAuth),
        visible: [F.msgPublicB], // their own chapter's PUBLIC message, nothing else
      },
    ];
    const postLabel = (id) => (id === IMPORTED_MSG ? "IMPORTED" : label(id));
    for (const s of POST_ARCHIVE) {
      const probe = await probeAs(
        s.as,
        `select id::text as id from public.chat_messages`,
      );
      expectSet(
        `${s.who} still reads exactly ${s.visible.length} row(s) once an imported archive row exists`,
        probe,
        s.visible,
        postLabel,
      );
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
      const name =
        "unread counts skip imported rows but still count a live null-sender row";
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
      await setAuth(signedIn(F.userAAuth));
      const res = await db.query(
        `select public.can_read_chat_message('${IMPORTED_MSG}'::uuid) as ok`,
      );
      const name =
        "can_read_chat_message still answers true for an imported row (reactions keep working)";
      if (res.rows[0].ok === true) {
        console.log(`OK    ${name}`);
      } else {
        missing += 1;
        console.log(
          `MISS  ${name}\n        ↳ the kind rule leaked into the shared predicate`,
        );
      }
    }

    // ─── members / financial_invoices: default-deny enforcement (#423) ───────
    //
    // The two tiers above cover the tables that carry a client-reachable
    // policy. These two carry none, and that is the point rather than a gap:
    //
    //   - `financial_invoices` has no policy anywhere in the tree.
    //   - `members`' only policy, `auth_admin_can_read_members`, is
    //     `to supabase_auth_admin`, the role Supabase Auth runs the
    //     custom-access-token hook as. It exists here since #1557 created that
    //     role, so the catalog check below excludes it by its roles, not by
    //     its absence.
    //
    // Under RLS, no reachable policy means default-deny, and per ADR-11 the API
    // reads both tables exclusively through the service-role client, which
    // bypasses RLS entirely. So the assertion that carries the value is the
    // negative one: a signed-in reader sees NOTHING, including in their own
    // chapter. The day a migration adds `using (true)`, or a chapter-scoped
    // policy whose tenant predicate is wrong, this tier goes red.
    //
    // NOTE this is deliberately NOT "at least one policy per table is exercised
    // as authenticated", the way #423's first acceptance criterion words it.
    // That phrasing presumes a policy that does not exist for either table; the
    // enforceable form of the same intent is the deny below.
    //
    // Scope, stated so nobody reads more into it than it proves: this covers
    // THESE TWO TABLES. A permissive policy added to any of the other ~46
    // RLS-enabled tables changes no assertion here — the every-public-table
    // invariant further up checks `relrowsecurity`, not what the policies do.
    // `chat_notification_preferences` is the known uncovered one: it carries a
    // client-reachable SELECT policy and only a name-set + tautology tripwire.
    //
    // A bare "sees zero rows" check would be worthless on its own — a missing
    // GRANT, a fixture that never inserted, or a typo'd table name each produce
    // zero just as convincingly as working RLS, and all three fail SILENTLY
    // green forever. So each table goes through guards in order: the privilege
    // is held, the rows exist when read as owner, the catalog carries no
    // client-reachable policy of any command shape, and only then that the
    // probe sees none of the rows.
    console.log(
      "\n=== members / financial_invoices default-deny (black-box, SET ROLE) ===",
    );
    // Seeded in its own savepoint. A future NOT NULL column on
    // financial_invoices would otherwise raise straight past the header just
    // printed, into the tier-wide catch, and the log would show this heading
    // with nothing under it — a reader scanning for the deny assertions sees
    // absence, not failure, and `missing` counts 1 instead of the dozen
    // assertions that never ran.
    let denySeeded = true;
    await db.exec("savepoint deny_seed;");
    try {
      await db.exec(`
        insert into financial_invoices (id, chapter_id, user_id, title, amount, due_date) values
          ('${F.invA}', '${F.chapA}', '${F.userAId}', 'Chapter A dues', 15000, '2026-01-31'),
          ('${F.invB}', '${F.chapB}', '${F.userBId}', 'Chapter B dues', 25000, '2026-01-31');
      `);
      await db.exec("release savepoint deny_seed;");
    } catch (e) {
      denySeeded = false;
      missing += 1;
      await db.exec(
        "rollback to savepoint deny_seed; release savepoint deny_seed;",
      );
      console.log(
        `SKIP  members / financial_invoices default-deny — fixture seed failed, 0 of its assertions ran` +
          `\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
      );
    }

    const FIXTURE_CHAPTERS = `('${F.chapA}', '${F.chapB}')`;
    // Deliberately NOT a row-count assertion. The exact cardinality is not
    // load-bearing — the guard only needs "there is something to deny" — and
    // pinning it couples this tier to the shared chat fixture, which has grown
    // twice already (userE for the cross-chapter role_ids case, userF for the
    // uppercased one). A third addition would fail here, in a tier its author
    // never touched, with a message naming neither the seed block nor the
    // literal to bump.
    const DENY_TABLES = ["members", "financial_invoices"];

    const DENY_READERS = [
      {
        who: "a chapter-A member reading their own chapter",
        as: signedIn(F.userAAuth),
      },
      { who: "a chapter-B member (cross-tenant)", as: signedIn(F.userBAuth) },
      {
        who: "a chapter-A member holding the '*' wildcard",
        as: signedIn(F.userDAuth),
      },
      // Null uid AND auth.role() = 'anon'. Stubbing only the uid would leave
      // this indistinguishable from a signed-in reader, which is how an
      // `auth.role() = 'anon'` policy stays invisible.
      {
        who: "an anonymous reader (no JWT, auth.role() = 'anon')",
        as: ANON_CLAIM,
      },
      { who: "the anon key (role anon, no JWT)", as: ANON_KEY },
    ];

    // Asserted once, before any table: every `reads 0 rows` line below is only
    // meaningful because each probe role is a MEMBER of the client role it
    // stands in for. Without that membership a `to authenticated` (or `to
    // anon`) policy simply does not bind the probe, so the read is answered by
    // default-deny and the assertion passes while testing nothing. The anon
    // probe must also NOT be a member of `authenticated`, or it is a second
    // signed-in reader under another name. Today the `authenticated`
    // membership is also load-bearing for the chat visibility sets, which
    // would fail loudly, but this tier must not borrow its validity from
    // another tier's failure.
    for (const [name, sql] of [
      [
        "rls_probe is a member of authenticated (so `to authenticated` policies bind it)",
        `select pg_has_role('rls_probe', 'authenticated', 'member') as ok`,
      ],
      [
        "rls_probe_anon is a member of anon and not of authenticated (so it binds exactly what the anon key binds)",
        `select pg_has_role('rls_probe_anon', 'anon', 'member')
                and not pg_has_role('rls_probe_anon', 'authenticated', 'member') as ok`,
      ],
    ]) {
      const res = await db.query(sql);
      if (res.rows[0].ok === true) {
        console.log(`OK    ${name}`);
      } else {
        missing += 1;
        console.log(
          `MISS  ${name}\n        ↳ every deny assertion below is vacuous for such a policy`,
        );
      }
    }

    for (const table of denySeeded ? DENY_TABLES : []) {
      // Both guards below `continue` on failure rather than falling through.
      // Printing four confident `OK ... reads 0 rows` lines underneath a MISS
      // that just declared them meaningless is worse than printing nothing:
      // `missing` goes up either way, but anyone reading the log — or grepping
      // it for the deny assertions — sees green on a property never tested.
      const privileged = await db.query(
        `select has_table_privilege('rls_probe', 'public.${table}', 'select')
                and has_table_privilege('rls_probe_anon', 'public.${table}', 'select') as ok`,
      );
      const privName = `both probe roles hold SELECT on ${table} (so a zero-row read means RLS, not a missing grant)`;
      if (privileged.rows[0].ok !== true) {
        missing += 1;
        console.log(
          `MISS  ${privName}\n        ↳ skipping ${table}: its deny assertions would pass vacuously`,
        );
        continue;
      }
      console.log(`OK    ${privName}`);

      const seeded = await db.query(
        `select count(*)::int as n from public.${table} where chapter_id in ${FIXTURE_CHAPTERS}`,
      );
      const seedName = `${table} holds fixture rows as owner (the deny below has something to deny)`;
      if (seeded.rows[0].n < 1) {
        missing += 1;
        console.log(
          `MISS  ${seedName}\n        ↳ skipping ${table}: 0 rows, so denying them proves nothing`,
        );
        continue;
      }
      console.log(`OK    ${seedName} — ${seeded.rows[0].n} row(s)`);

      // The read probe below is `select`-only, so it is structurally blind to
      // the WRITE half of default-deny: `for insert with check (true)` or
      // `for update using (true)` leaves every read assertion green. That
      // matters more than it sounds — Supabase's default
      // `grant all on all tables in schema public to anon, authenticated`
      // stands (no table-level revoke exists in supabase/migrations/), so on a
      // permissive UPDATE policy any signed-in client could rewrite
      // `members.role_ids` and grant itself permissions.
      //
      // Both tables are supposed to carry NO policy a client role can reach,
      // in any command shape, so assert exactly that from the catalog — it
      // covers INSERT/UPDATE/DELETE/ALL without needing a write probe per
      // command. A policy bound to `supabase_auth_admin` alone is excluded
      // (AUTH_ADMIN_ONLY): that is a Supabase-internal role, not a client, and
      // `members` legitimately carries one such policy.
      // `permissive = 'PERMISSIVE'` is not optional, and every sibling policy
      // check in this file filters it for the same reason: a RESTRICTIVE policy
      // can only ever NARROW access, so flagging one would fail CI on a
      // legitimate hardening — e.g. `as restrictive for all to authenticated
      // using (false)` — and the path of least resistance out of a red build is
      // to delete the hardening.
      const clientPolicies = await db.query(
        `select policyname, cmd, roles::text as roles
           from pg_policies
          where schemaname = 'public' and tablename = '${table}'
            and permissive = 'PERMISSIVE'
            and roles::text <> '${AUTH_ADMIN_ONLY}'`,
      );
      const anyCmdName = `${table} carries no client-reachable policy of ANY command (covers the write path)`;
      if (clientPolicies.rows.length === 0) {
        console.log(`OK    ${anyCmdName}`);
      } else {
        missing += 1;
        console.log(
          `MISS  ${anyCmdName}\n        ↳ ` +
            clientPolicies.rows
              .map((r) => `${r.policyname} [${r.cmd}] to ${r.roles}`)
              .join("\n        ↳ "),
        );
      }

      for (const s of DENY_READERS) {
        const probe = await probeAs(
          s.as,
          `select count(*)::int as n from public.${table}`,
        );
        const failure = probe.failure;
        const seen = probe.rows?.[0]?.n;

        const name = `${table}: ${s.who} reads 0 rows`;
        if (failure !== null) {
          missing += 1;
          // Still a failure, not an excuse: the table is supposed to be
          // default-deny, and a policy that errors is a policy that exists.
          console.log(
            `MISS  ${name}\n        ↳ the read raised instead: ${failure}`,
          );
        } else if (seen === 0) {
          console.log(`OK    ${name}`);
        } else {
          missing += 1;
          console.log(
            `MISS  ${name}\n        ↳ read ${seen} row(s) — a policy now exposes ${table} to a client role`,
          );
        }
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
      console.log(
        `ERR   ${c.name}\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
      );
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
    [
      badColors === 0,
      `every loaded color is canonical #RRGGBB (${badColors} bad)`,
    ],
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

// ─── Demo seed load (#2308) ──────────────────────────────────────────────────
// `scripts/demo/demo-seed.sql` is what App Review signs in to, and until this
// block nothing in CI ran it: a migration that renamed a column it writes would
// have surfaced on submission day, against production. This is where both
// variants actually execute against the migrated schema.
//
// Beyond "it runs", the properties asserted are each a way the reviewer's
// chapter has been wrong or could be:
//   - the login is linked to its auth user, since sign-in matches on
//     `users.supabase_auth_id` alone and an unlinked login signs in chapterless;
//   - only a login `seed-demo.mjs auth` marked for this namespace is linked, so
//     an existing account the script did not create (a real person's, or one
//     made by hand in the dashboard) is never handed the presidency. The marker
//     cannot catch a mistyped address with no account yet; `auth` would create
//     and mark that one (see ensureAuthUser);
//   - a chapterless row that a sign-in made before the seed is adopted, not a
//     permanent refusal;
//   - the reviewer variant carries what `apps/mobile/store/README.md` § Seed the
//     reviewer's chapter asks for — no invoice on the reviewer, one DM into them,
//     a study zone with past sessions of their own, a message from another
//     member in a channel they can read (the one that offers Block), and a
//     service entry of their own;
//   - re-running is idempotent, which also proves the delete-then-rebuild clears
//     every foreign key onto `users` before it removes them;
//   - a re-seed that fails leaves the chapter it was replacing exactly as it was,
//     the property that makes it safe to run against production at all.
//
// PGlite has no GoTrue, so `auth.users` is stubbed with the three columns the
// seed reads, for the length of this block.
console.log("\n=== demo seed load (#2308) ===");
{
  const seedDemo = await import("./demo/seed-demo.mjs");
  const template = readFileSync(seedDemo.TEMPLATE_PATH, "utf8");
  const REVIEWER_EMAIL = "app-review@example.test";
  const REVIEWER_AUTH_ID = "0a0a0a0a-0000-4000-8000-00000000a001";
  const STRANGER_EMAIL = "stranger@example.test";
  const STRANGER_AUTH_ID = "0a0a0a0a-0000-4000-8000-00000000a002";
  // Marked by `auth`, but for the marketing namespace: the marker must name THIS chapter.
  const OTHER_NS_EMAIL = "other-namespace@example.test";
  const OTHER_NS_AUTH_ID = "0a0a0a0a-0000-4000-8000-00000000a003";
  const namespaces = [seedDemo.TEMPLATE_NAMESPACE, seedDemo.REVIEWER_NAMESPACE];
  const render = (namespace, loginEmail, reviewer) =>
    seedDemo.renderSeedSql({ template, namespace, loginEmail, reviewer });
  const marketingSql = render(seedDemo.TEMPLATE_NAMESPACE, undefined, false);
  const reviewerSql = render(seedDemo.REVIEWER_NAMESPACE, REVIEWER_EMAIL, true);

  const n = async (sql) => (await db.query(sql)).rows[0].n;
  const snapshot = async (namespace) => {
    const { chapterId, loginUserId, userIdLike } = seedDemo.demoIds(namespace);
    return {
      chapters: await n(
        `select count(*)::int as n from chapters where id = '${chapterId}'`,
      ),
      members: await n(
        `select count(*)::int as n from members where chapter_id = '${chapterId}'`,
      ),
      users: await n(
        `select count(*)::int as n from users where id::text like '${userIdLike}'`,
      ),
      events: await n(
        `select count(*)::int as n from events where chapter_id = '${chapterId}'`,
      ),
      documents: await n(
        `select count(*)::int as n from chapter_documents where chapter_id = '${chapterId}'`,
      ),
      backwork: await n(
        `select count(*)::int as n from backwork_resources where chapter_id = '${chapterId}'`,
      ),
      offLayout: await n(
        `select (select count(*) from chapter_documents
                  where chapter_id = '${chapterId}'
                    and storage_path not like 'chapters/${chapterId}/documents/' || id || '/%.pdf')
              + (select count(*) from backwork_resources
                  where chapter_id = '${chapterId}'
                    and storage_path not like 'chapters/${chapterId}/backwork/' || id || '/%.pdf') as n`,
      ),
      loginInvoices: await n(
        `select count(*)::int as n from financial_invoices where user_id = '${loginUserId}'`,
      ),
      loginServiceEntries: await n(
        `select count(*)::int as n from service_entries where user_id = '${loginUserId}'`,
      ),
      dms: await n(
        `select count(*)::int as n from chat_channels where chapter_id = '${chapterId}' and type = 'DM'`,
      ),
      dmMessages: await n(
        `select count(*)::int as n from chat_messages m join chat_channels c on c.id = m.channel_id
          where c.chapter_id = '${chapterId}' and c.type = 'DM'`,
      ),
      studyZones: await n(
        `select count(*)::int as n from study_geofences where chapter_id = '${chapterId}' and is_active`,
      ),
      loginPastSessions: await n(
        `select count(*)::int as n from study_sessions where user_id = '${loginUserId}' and status = 'COMPLETED'`,
      ),
      // A text message in #general from a member other than the login: what the
      // README's Block row points the reviewer at. The system actor is no member,
      // so the join leaves its posts out, as the app's Block control does.
      blockable: await n(
        `select count(*)::int as n from chat_messages m
           join chat_channels c on c.id = m.channel_id
           join members mb on mb.user_id = m.sender_id and mb.chapter_id = c.chapter_id
          where c.chapter_id = '${chapterId}' and c.type = 'PUBLIC' and c.name = 'general'
            and m.type = 'TEXT' and m.sender_id <> '${loginUserId}'`,
      ),
      loginAuthId:
        (
          await db.query(
            `select supabase_auth_id::text as a from users where id = '${loginUserId}'`,
          )
        ).rows[0]?.a ?? null,
    };
  };
  // A seed expected to raise. The simple-query protocol leaves an explicit
  // transaction aborted, not closed (psql and the SQL editor end the session
  // instead), so roll it back here.
  const refuses = async (sql) => {
    try {
      await db.exec(sql);
      return false;
    } catch {
      await db.exec("rollback;");
      return true;
    }
  };

  try {
    await db.exec(
      `create table auth.users (id uuid primary key, email text not null, raw_app_meta_data jsonb not null default '{}');`,
    );
    await db.exec(`
      insert into auth.users (id, email, raw_app_meta_data) values
        ('${REVIEWER_AUTH_ID}', '${REVIEWER_EMAIL}', '{"frapp_demo_namespace": "${seedDemo.REVIEWER_NAMESPACE}"}'),
        ('${STRANGER_AUTH_ID}', '${STRANGER_EMAIL}', '{}'),
        ('${OTHER_NS_AUTH_ID}', '${OTHER_NS_EMAIL}', '{"frapp_demo_namespace": "${seedDemo.TEMPLATE_NAMESPACE}"}');
    `);

    await db.exec(marketingSql);
    await db.exec(reviewerSql);
    const first = await Promise.all(namespaces.map(snapshot));
    await db.exec(marketingSql);
    await db.exec(reviewerSql);
    const second = await Promise.all(namespaces.map(snapshot));
    const [marketing, reviewer] = second;

    // Re-seeding the live reviewer chapter with a login that cannot be linked —
    // missing, or an account the script does not own — must raise and leave the
    // chapter it would have replaced untouched.
    const refusedMissing = await refuses(
      render(seedDemo.REVIEWER_NAMESPACE, "nobody@example.test", true),
    );
    const afterMissing = await snapshot(seedDemo.REVIEWER_NAMESPACE);
    const refusedStranger = await refuses(
      render(seedDemo.REVIEWER_NAMESPACE, STRANGER_EMAIL, true),
    );
    const afterStranger = await snapshot(seedDemo.REVIEWER_NAMESPACE);
    const refusedOtherNs = await refuses(
      render(seedDemo.REVIEWER_NAMESPACE, OTHER_NS_EMAIL, true),
    );
    const afterOtherNs = await snapshot(seedDemo.REVIEWER_NAMESPACE);

    // A seeded account that is also a member of another chapter (the App Review login
    // founding one, say): deleting it would cascade through that membership, so both the
    // re-seed and `sql --remove` refuse, and the membership survives. The marketing chapter
    // stands in for the other chapter.
    const { loginUserId: reviewerLogin } = seedDemo.demoIds(
      seedDemo.REVIEWER_NAMESPACE,
    );
    const { chapterId: marketingChapter } = seedDemo.demoIds(
      seedDemo.TEMPLATE_NAMESPACE,
    );
    await db.exec(
      `insert into members (user_id, chapter_id) values ('${reviewerLogin}', '${marketingChapter}');`,
    );
    const refusedCrossReseed = await refuses(reviewerSql);
    const refusedCrossRemove = await refuses(
      seedDemo.renderRemoveSql({ namespace: seedDemo.REVIEWER_NAMESPACE }),
    );
    const crossKept = await n(
      `select count(*)::int as n from members where user_id = '${reviewerLogin}' and chapter_id = '${marketingChapter}'`,
    );
    const afterCross = await snapshot(seedDemo.REVIEWER_NAMESPACE);
    await db.exec(
      `delete from members where user_id = '${reviewerLogin}' and chapter_id = '${marketingChapter}';`,
    );

    // The same without a membership: rows the login wrote in another chapter before leaving
    // it. The membership check this replaced let them cascade away with the account.
    await db.exec(
      `insert into point_transactions (chapter_id, user_id, amount, category) values ('${marketingChapter}', '${reviewerLogin}', 5, 'MANUAL');`,
    );
    const refusedLeftRows = await refuses(reviewerSql);
    const leftRowsKept = await n(
      `select count(*)::int as n from point_transactions where user_id = '${reviewerLogin}' and chapter_id = '${marketingChapter}'`,
    );
    await db.exec(
      `delete from point_transactions where user_id = '${reviewerLogin}' and chapter_id = '${marketingChapter}';`,
    );

    // A reference deleting the account would only null out refuses too: in another chapter
    // that null is its audit log losing the actor, rewritten with no error. A directory
    // request the login filed stands in for it here, and is left as it was.
    await db.exec(
      `insert into chapter_directory_requests (requested_by, university) values ('${reviewerLogin}', 'Demo University');`,
    );
    const refusedNullable = await refuses(reviewerSql);
    const requestKept = await n(
      `select count(*)::int as n from chapter_directory_requests where university = 'Demo University' and requested_by = '${reviewerLogin}'`,
    );
    await db.exec(
      `delete from chapter_directory_requests where university = 'Demo University';`,
    );

    // What the account owns outright goes with it: a push token or settings row is no reason to refuse.
    await db.exec(
      `insert into push_tokens (user_id, token) values ('${reviewerLogin}', 'demo-token');`,
    );
    await db.exec(
      `insert into user_settings (user_id) values ('${reviewerLogin}');`,
    );
    await db.exec(reviewerSql);
    const ownedLeft = await n(
      `select (select count(*) from push_tokens where user_id = '${reviewerLogin}') + (select count(*) from user_settings where user_id = '${reviewerLogin}') as n`,
    );

    // The marketing variant seeds an unmarked account's email unlinked.
    await db.exec(render(seedDemo.TEMPLATE_NAMESPACE, STRANGER_EMAIL, false));
    const strangerLink = (await snapshot(seedDemo.TEMPLATE_NAMESPACE))
      .loginAuthId;

    // A sign-in before the seed leaves a chapterless row on the login's auth id;
    // the next seed adopts it.
    await db.exec(
      seedDemo.renderRemoveSql({ namespace: seedDemo.REVIEWER_NAMESPACE }),
    );
    await db.exec(
      `insert into users (supabase_auth_id, email) values ('${REVIEWER_AUTH_ID}', '${REVIEWER_EMAIL}');`,
    );
    await db.exec(reviewerSql);
    const adopted = await snapshot(seedDemo.REVIEWER_NAMESPACE);
    const shells = await n(
      `select count(*)::int as n from users where supabase_auth_id = '${REVIEWER_AUTH_ID}'`,
    );

    // ...but a row on the login's auth id that is a member of a chapter is an account in
    // use: the seed refuses instead of deleting it.
    await db.exec(
      seedDemo.renderRemoveSql({ namespace: seedDemo.REVIEWER_NAMESPACE }),
    );
    const inUse = (
      await db.query(
        `insert into users (supabase_auth_id, email) values ('${REVIEWER_AUTH_ID}', '${REVIEWER_EMAIL}') returning id::text as id`,
      )
    ).rows[0].id;
    await db.exec(
      `insert into members (user_id, chapter_id) values ('${inUse}', '${marketingChapter}');`,
    );
    const refusedInUse = await refuses(reviewerSql);
    const inUseKept = await n(
      `select count(*)::int as n from members where user_id = '${inUse}'`,
    );
    await db.exec(`delete from members where user_id = '${inUse}';`);
    // ...and so is one with no membership left but points in a chapter it has left.
    await db.exec(
      `insert into point_transactions (chapter_id, user_id, amount, category) values ('${marketingChapter}', '${inUse}', 5, 'MANUAL');`,
    );
    const refusedLeftOwner = await refuses(reviewerSql);
    const leftOwnerKept = await n(
      `select count(*)::int as n from point_transactions where user_id = '${inUse}'`,
    );
    await db.exec(
      `delete from point_transactions where user_id = '${inUse}'; delete from users where id = '${inUse}';`,
    );

    for (const namespace of namespaces)
      await db.exec(seedDemo.renderRemoveSql({ namespace }));
    const removed = await Promise.all(namespaces.map(snapshot));

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const checks = [
      [
        marketing.members === 26 && reviewer.members === 26,
        `both variants seed 26 members (marketing ${marketing.members}, reviewer ${reviewer.members})`,
      ],
      [
        marketing.events === 12 &&
          marketing.documents === 10 &&
          marketing.backwork === 11,
        `the chapter's events, documents and backwork land (${marketing.events}/${marketing.documents}/${marketing.backwork})`,
      ],
      [
        marketing.offLayout === 0 && reviewer.offLayout === 0,
        `every document and backwork path is the API's own chapters/<chapter>/<kind>/<id>/ layout (${marketing.offLayout + reviewer.offLayout} off it)`,
      ],
      [
        reviewer.loginAuthId === REVIEWER_AUTH_ID,
        `the reviewer login is linked to its marked auth user (got ${reviewer.loginAuthId})`,
      ],
      [
        marketing.loginAuthId?.startsWith("c0ffee00-0000-4000-8000-2000"),
        "with no matching auth user, the marketing login keeps a synthetic auth id",
      ],
      [
        strangerLink?.startsWith("c0ffee00-0000-4000-8000-2000"),
        `an unmarked account with the login's email is never linked (got ${strangerLink})`,
      ],
      [
        reviewer.loginInvoices === 0 && marketing.loginInvoices > 0,
        `no invoices on the reviewer (reviewer ${reviewer.loginInvoices}, marketing ${marketing.loginInvoices})`,
      ],
      [
        reviewer.loginServiceEntries > 0,
        `the reviewer has a service entry of their own (${reviewer.loginServiceEntries})`,
      ],
      [
        reviewer.dms === 1 && reviewer.dmMessages === 3 && marketing.dms === 0,
        `one DM into the reviewer, none in marketing (${reviewer.dms} with ${reviewer.dmMessages} messages / ${marketing.dms})`,
      ],
      [
        reviewer.studyZones > 0 && reviewer.loginPastSessions > 0,
        `the reviewer has study zones and past sessions of their own (${reviewer.studyZones} zones, ${reviewer.loginPastSessions} sessions)`,
      ],
      [
        reviewer.blockable > 0,
        `#general holds text from another member, so Block is offered there (${reviewer.blockable} messages)`,
      ],
      [same(first, second), "re-running both variants is idempotent"],
      [
        refusedMissing && same(afterMissing, reviewer),
        "a reviewer re-seed with no auth user raises and leaves the existing chapter untouched",
      ],
      [
        refusedStranger && same(afterStranger, reviewer),
        "a reviewer re-seed naming an unmarked account raises and leaves the existing chapter untouched",
      ],
      [
        refusedOtherNs && same(afterOtherNs, reviewer),
        "a login marked for another namespace is never linked: the reviewer re-seed raises",
      ],
      [
        refusedCrossReseed &&
          refusedCrossRemove &&
          crossKept === 1 &&
          same(afterCross, reviewer),
        "a seeded account in another chapter makes the re-seed and sql --remove refuse, and that membership survives",
      ],
      [
        refusedLeftRows && leftRowsKept === 1,
        "rows a seeded account left in another chapter, with no membership there, also make the re-seed refuse",
      ],
      [
        Number(ownedLeft) === 0,
        "a push token and a settings row go with the account, without a refusal",
      ],
      [
        refusedNullable && requestKept === 1,
        "a reference the delete would only null (a directory request) refuses too, and is left intact",
      ],
      [
        adopted.loginAuthId === REVIEWER_AUTH_ID && shells === 1,
        `a chapterless row from an early sign-in is adopted (linked ${adopted.loginAuthId}, ${shells} row on the auth id)`,
      ],
      [
        refusedInUse && inUseKept === 1,
        "a row on the login's auth id that is a member of a chapter is refused, not taken over",
      ],
      [
        refusedLeftOwner && leftOwnerKept === 1,
        "so is one with no membership but points in a chapter it has left",
      ],
      [
        removed.every(
          (r) =>
            r.chapters === 0 &&
            r.members === 0 &&
            r.users === 0 &&
            r.documents === 0,
        ),
        "sql --remove clears both chapters and their people",
      ],
    ];
    for (const [ok, name] of checks) {
      if (ok) {
        console.log(`OK    ${name}`);
      } else {
        missing += 1;
        console.log(`MISS  ${name}`);
      }
    }
  } catch (e) {
    missing += 1;
    console.log(
      `MISS  demo seed load\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
    );
    await db.exec("rollback;").catch(() => {});
  } finally {
    // Leave the schema as the migrations produced it, as every block here does.
    for (const namespace of namespaces)
      await db.exec(seedDemo.renderRemoveSql({ namespace })).catch(() => {});
    await db
      .exec(
        `delete from users where supabase_auth_id in ('${REVIEWER_AUTH_ID}', '${STRANGER_AUTH_ID}', '${OTHER_NS_AUTH_ID}');`,
      )
      .catch(() => {});
    await db.exec("drop table if exists auth.users;");
  }
}

// ─── `security definer` search_path guard (#985) ─────────────────────────────
//
// Postgres resolves unqualified relation names against `pg_temp` FIRST unless
// `pg_temp` is itself listed in `search_path`. A `security definer` function
// declared `set search_path = public` therefore reads a caller-created temp table
// in place of the real one while holding the DEFINER's privileges. Four of the
// functions this guards are authorization code — `can_read_chat_message` backs
// chat RLS, and the `realtime_can_read_*_scope` trio gates realtime delivery — so
// a shadowed read there is an authorization decision made against attacker-
// supplied rows.
//
// Catalog-driven on purpose. The obvious alternative — grep migration SQL for
// `security definer` without `pg_temp` — cannot work here: migrations are
// immutable, so the three files that introduced the bare setting (20260803150000,
// 20260807220000, 20260816140000) keep it in their text forever. A regex would
// flag them permanently and tempt someone into editing applied history. Reading
// the applied catalog asserts the END STATE instead, which is exactly the query
// #985 specifies, and it catches the eighth function regardless of which file
// declares it or in what syntax.
//
// `pg_temp` must be LAST, so POSITION is asserted rather than mere presence:
// listing it first would reinstate the very shadowing this exists to prevent.
//
// The `search_path` entry is read out of the raw `proconfig` array rather than a
// comma-joined string. A function may carry unrelated settings (`statement_timeout`
// and friends), and in a joined string those are indistinguishable from further
// search_path entries — which would let a genuinely-unpinned function pass.
console.log("\n=== security definer search_path ===");
{
  const res = await db.query(
    `select p.proname,
            (select cfg from unnest(coalesce(p.proconfig, '{}')) as cfg
              where cfg like 'search_path=%' limit 1) as sp
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname = 'public'
      order by p.proname`,
  );
  const offenders = res.rows.filter((r) => {
    if (!r.sp) return true; // security definer with no search_path pinned at all
    const entries = String(r.sp)
      .slice("search_path=".length)
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""));
    return entries[entries.length - 1] !== "pg_temp";
  });
  if (offenders.length === 0) {
    console.log(
      `OK    all ${res.rows.length} security definer function(s) pin pg_temp last in search_path`,
    );
  } else {
    missing += 1;
    console.log(
      `MISS  ${offenders.length} security definer function(s) without pg_temp last in search_path` +
        `\n        \u21b3 ${offenders.map((o) => `${o.proname} (${o.sp ?? "<no search_path>"})`).join("; ")}` +
        `\n        \u21b3 fix: declare \`set search_path = public, pg_temp\` with pg_temp LAST (#985)`,
    );
  }
}

// ─── `get_points_leaderboard` executes and bounds correctly (#522) ───────────
//
// `CREATE FUNCTION` on a plpgsql body is a SYNTAX check only — identifier
// resolution, aggregate semantics and ORDER BY binding are all deferred to the
// first call. So "the migration applied" proves almost nothing about this
// function, and it is the one that carries the points leaderboard's chapter
// predicate since the aggregation moved out of Node.
//
// The unit suite cannot cover it either: it swaps the repository for a
// TypeScript transcription of the SQL, so flipping `>` to `>=` here leaves it
// green. `apps/api/test/integration/points-leaderboard.integration-spec.ts`
// does execute the real function, but `test:integration` runs in no CI job
// (#1568) — so without this section a boundary regression merges green.
//
// Deliberately minimal: one row sits exactly ON the shared bound instant, and
// that same instant is passed as `p_since` in one call and `p_until` in the
// next, so an inclusive/exclusive mix-up moves it between boards rather than
// merely changing a count.
console.log("\n=== get_points_leaderboard bounds + scoping (#522) ===");
try {
  const CH_A = "aaaaaaaa-0000-4000-8000-000000000001";
  const CH_B = "aaaaaaaa-0000-4000-8000-000000000002";
  // Ids are chosen so that ranking by total and ranking by user_id DISAGREE:
  // U_A sorts first by id but last-but-one by total. Without that, `order by
  // pt.user_id asc` alone — and, worse, `order by total desc` where bare
  // `total` binds to the NULL plpgsql OUT parameter rather than the aggregate,
  // the exact trap this function's header warns about — both reproduce the
  // expected order, and the ordering check passes while the sort is broken.
  const U_A = "bbbbbbbb-0000-4000-8000-00000000000a"; // smallest id, middle total
  const U_B = "bbbbbbbb-0000-4000-8000-00000000000b"; // middle id, TOP total
  const U_C = "bbbbbbbb-0000-4000-8000-00000000000c"; // largest id, the bound member
  const ON_BOUND = "2026-03-01T00:00:00Z";

  await db.exec(`
    insert into public.chapters (id, name, university) values
      ('${CH_A}', 'PGlite A', 'U'), ('${CH_B}', 'PGlite B', 'U');
    insert into public.users (id, supabase_auth_id, email, display_name) values
      ('${U_A}', '${U_A}', 'lb-a@pglite.test', 'A'),
      ('${U_B}', '${U_B}', 'lb-b@pglite.test', 'B'),
      ('${U_C}', '${U_C}', 'lb-c@pglite.test', 'C');
    insert into public.point_transactions (chapter_id, user_id, amount, category, created_at) values
      ('${CH_A}', '${U_A}', 5,  'MANUAL', '2026-01-01T00:00:00Z'),
      ('${CH_A}', '${U_B}', 10, 'MANUAL', '2026-01-01T00:00:00Z'),
      ('${CH_A}', '${U_B}', 5,  'MANUAL', '2026-09-01T00:00:00Z'),
      ('${CH_A}', '${U_C}', 30, 'MANUAL', '${ON_BOUND}'),
      ('${CH_A}', '${U_C}', -35,'FINE',   '2026-09-01T00:00:00Z'),
      ('${CH_B}', '${U_A}', 999,'MANUAL', '2026-01-01T00:00:00Z');
  `);

  const board = async (chapter, since, until) => {
    const r = await db.query(
      `select user_id::text as user_id, total::int as total
         from get_points_leaderboard($1::uuid, $2::timestamptz, $3::timestamptz)`,
      [chapter, since, until],
    );
    return r.rows;
  };

  // Runs the body at all — an unqualified `user_id`/`total` would raise
  // "column reference is ambiguous" HERE and nowhere earlier.
  const allTime = await board(CH_A, null, null);
  const exclusiveLower = await board(CH_A, ON_BOUND, null);
  const inclusiveUpper = await board(CH_A, null, ON_BOUND);
  const otherChapter = await board(CH_B, null, null);

  const totalFor = (rows, u) => rows.find((r) => r.user_id === u)?.total;
  // Every check below indexes with `?.` so one broken assertion reports itself
  // rather than throwing into the outer catch, which would flatten all seven
  // into a single opaque "Cannot read properties of undefined" MISS and point a
  // CI reader at this script instead of at the migration.
  const order = allTime.map((r) => r.user_id);

  const checks = [
    [
      allTime.length === 3,
      `all-time returns one row per member (got ${allTime.length}, want 3)`,
    ],
    [
      totalFor(allTime, U_B) === 15,
      `sums per member (u_b = ${totalFor(allTime, U_B)}, want 15)`,
    ],
    [
      totalFor(allTime, U_C) === -5,
      `negative totals survive (u_c = ${totalFor(allTime, U_C)}, want -5)`,
    ],
    [
      // U_B (15) outranks U_A (5) despite having the LARGER id, so this fails
      // for `order by user_id` alone and for a `total` that binds to the NULL
      // OUT parameter — both of which would otherwise look correct.
      order[0] === U_B && order[1] === U_A && order[2] === U_C,
      `orders by total descending, not by user_id (got ${order
        .map((u) => u.slice(-1))
        .join(",")}, want b,a,c)`,
    ],
    [
      totalFor(exclusiveLower, U_C) === -35,
      `p_since is EXCLUSIVE — the row ON the bound is dropped (u_c = ${totalFor(exclusiveLower, U_C)}, want -35)`,
    ],
    [
      totalFor(inclusiveUpper, U_C) === 30,
      `p_until is INCLUSIVE — the row ON the bound is kept (u_c = ${totalFor(inclusiveUpper, U_C)}, want 30)`,
    ],
    [
      otherChapter.length === 1 && otherChapter[0]?.total === 999,
      "chapter_id scopes the aggregation (no cross-chapter rows)",
    ],
  ];

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      missing += 1;
      console.log(`MISS  ${name}`);
    }
  }

  // Leave the schema as the migrations produced it, same contract as the tiers
  // above. Chapters cascade to point_transactions; users do not.
  await db.exec(`
    delete from public.chapters where id in ('${CH_A}', '${CH_B}');
    delete from public.users where email like 'lb-%@pglite.test';
  `);
} catch (e) {
  missing += 1;
  console.log(
    `MISS  get_points_leaderboard bounds + scoping\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}

// ─── `apply_subscription_webhook` CAS (#731 / #1979) ────────────────────────
//
// `CREATE FUNCTION` on a plpgsql body is a syntax check only. The unit suite
// mocks the repository, so a flipped `<=` to `<` (or dropping the mark stamp)
// stays green. This section inserts two chapters and applies older-then-newer
// vs newer-then-older; the newer status must win both commit orders. #1979
// adds `previous_subscription_status` on the return so notify can key off
// the committed row; two into-past_due applies must report active then
// past_due.
console.log("\n=== apply_subscription_webhook CAS (#731 / #1979) ===");
try {
  const CH_OLD_FIRST = "cccccccc-0000-4000-8000-000000000001";
  const CH_NEW_FIRST = "cccccccc-0000-4000-8000-000000000002";
  const T_OLD = "2026-06-01T12:00:00Z";
  const T_NEW = "2026-06-02T12:00:00Z";

  await db.exec(`
    insert into public.chapters (id, name, university, subscription_status) values
      ('${CH_OLD_FIRST}', 'CAS old-first', 'U', 'active'),
      ('${CH_NEW_FIRST}', 'CAS new-first', 'U', 'active');
  `);

  const apply = async (chapter, eventAt, patch) => {
    const r = await db.query(
      `select (applied).subscription_status as subscription_status,
              (applied).last_stripe_webhook_at as last_stripe_webhook_at,
              (applied).past_due_since as past_due_since,
              previous_subscription_status
         from apply_subscription_webhook($1::uuid, $2::timestamptz, $3::jsonb)`,
      [chapter, eventAt, JSON.stringify(patch)],
    );
    return r.rows;
  };

  const row = async (chapter) => {
    const r = await db.query(
      `select subscription_status, last_stripe_webhook_at::text as last_stripe_webhook_at,
              past_due_since::text as past_due_since
         from public.chapters where id = $1::uuid`,
      [chapter],
    );
    return r.rows[0];
  };

  const oldFirstOlder = await apply(CH_OLD_FIRST, T_OLD, {
    subscription_status: "past_due",
  });
  const oldFirstNewer = await apply(CH_OLD_FIRST, T_NEW, {
    subscription_status: "canceled",
  });
  const newFirstNewer = await apply(CH_NEW_FIRST, T_NEW, {
    subscription_status: "canceled",
  });
  const newFirstOlder = await apply(CH_NEW_FIRST, T_OLD, {
    subscription_status: "past_due",
  });

  const afterOldFirst = await row(CH_OLD_FIRST);
  const afterNewFirst = await row(CH_NEW_FIRST);

  const checks = [
    [
      oldFirstOlder.length === 1 &&
        oldFirstOlder[0].subscription_status === "past_due",
      `old-first: older event applies (got ${oldFirstOlder.length} row(s))`,
    ],
    [
      oldFirstOlder[0]?.previous_subscription_status === "active",
      `old-first: older event reports previous=active (got ${oldFirstOlder[0]?.previous_subscription_status})`,
    ],
    [
      oldFirstNewer.length === 1 &&
        oldFirstNewer[0].subscription_status === "canceled",
      `old-first: newer event overwrites (got ${oldFirstNewer[0]?.subscription_status})`,
    ],
    [
      afterOldFirst?.subscription_status === "canceled",
      `old-first: stored status is canceled (got ${afterOldFirst?.subscription_status})`,
    ],
    [
      newFirstNewer.length === 1 &&
        newFirstNewer[0].subscription_status === "canceled",
      `new-first: newer event applies (got ${newFirstNewer.length} row(s))`,
    ],
    [
      newFirstOlder.length === 0,
      `new-first: older event loses the CAS (got ${newFirstOlder.length} row(s))`,
    ],
    [
      afterNewFirst?.subscription_status === "canceled",
      `new-first: stored status stays canceled (got ${afterNewFirst?.subscription_status})`,
    ],
  ];

  const CH_ACTIVATE = "cccccccc-0000-4000-8000-000000000003";
  const CH_CLOCK = "cccccccc-0000-4000-8000-000000000004";
  const CH_RECOVER = "cccccccc-0000-4000-8000-000000000005";
  const CH_RESTART = "cccccccc-0000-4000-8000-000000000006";
  await db.exec(`
    insert into public.chapters (id, name, university, subscription_status, past_due_since) values
      ('${CH_ACTIVATE}', 'CAS activate_if', 'U', 'canceled', null),
      ('${CH_CLOCK}', 'CAS past_due clock', 'U', 'active', null),
      ('${CH_RECOVER}', 'CAS activate recover', 'U', 'past_due', '${T_OLD}'),
      ('${CH_RESTART}', 'CAS clock restart', 'U', 'canceled', null);
  `);

  const activateCanceled = await apply(CH_ACTIVATE, T_NEW, {
    activate_if: ["past_due", "incomplete"],
  });
  const afterActivate = await row(CH_ACTIVATE);

  const clockFirst = await apply(CH_CLOCK, T_OLD, {
    subscription_status: "past_due",
    past_due_since: T_OLD,
  });
  const clockSecond = await apply(CH_CLOCK, T_NEW, {
    subscription_status: "past_due",
    past_due_since: T_NEW,
  });
  const afterClock = await row(CH_CLOCK);

  const recover = await apply(CH_RECOVER, T_NEW, {
    activate_if: ["past_due", "incomplete"],
  });
  const afterRecover = await row(CH_RECOVER);

  const restart = await apply(CH_RESTART, T_NEW, {
    subscription_status: "past_due",
    past_due_since: T_NEW,
  });
  const afterRestart = await row(CH_RESTART);

  checks.push(
    [
      activateCanceled.length === 1 &&
        afterActivate?.subscription_status === "canceled",
      `activate_if on canceled does not un-cancel (got ${afterActivate?.subscription_status})`,
    ],
    [
      afterActivate?.last_stripe_webhook_at != null,
      `activate_if on canceled still stamps the mark`,
    ],
    [
      recover.length === 1 && afterRecover?.subscription_status === "active",
      `activate_if on past_due activates (got ${afterRecover?.subscription_status})`,
    ],
    [
      afterRecover?.past_due_since == null,
      `activate_if on past_due clears the grace clock`,
    ],
    [
      clockFirst.length === 1 &&
        clockFirst[0].subscription_status === "past_due",
      `clock: first past_due applies`,
    ],
    [
      clockFirst[0]?.previous_subscription_status === "active",
      `clock: first past_due reports previous=active (got ${clockFirst[0]?.previous_subscription_status})`,
    ],
    [
      clockSecond.length === 1 &&
        String(afterClock?.past_due_since ?? "").includes("2026-06-01"),
      `clock: second past_due keeps T_OLD (got ${afterClock?.past_due_since})`,
    ],
    [
      clockSecond[0]?.previous_subscription_status === "past_due",
      `clock: second past_due reports previous=past_due (got ${clockSecond[0]?.previous_subscription_status})`,
    ],
    [
      restart.length === 1 &&
        restart[0]?.previous_subscription_status === "canceled" &&
        String(afterRestart?.past_due_since ?? "").includes("2026-06-02"),
      `clock: canceled→past_due restarts the stamp (got previous=${restart[0]?.previous_subscription_status} since=${afterRestart?.past_due_since})`,
    ],
  );

  let activateIfNullOk = false;
  try {
    const nullPatch = await apply(CH_ACTIVATE, T_NEW, { activate_if: null });
    activateIfNullOk =
      nullPatch.length === 1 &&
      (await row(CH_ACTIVATE))?.subscription_status === "canceled";
  } catch (e) {
    activateIfNullOk = false;
    console.log(
      `MISS  activate_if JSON null must not raise (got ${String(e?.message ?? e).split("\n")[0]})`,
    );
  }
  checks.push([
    activateIfNullOk,
    `activate_if JSON null is ignored (does not raise, does not un-cancel)`,
  ]);

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      missing += 1;
      console.log(`MISS  ${name}`);
    }
  }

  await db.exec(`
    delete from public.chapters where id in (
      '${CH_OLD_FIRST}', '${CH_NEW_FIRST}', '${CH_ACTIVATE}', '${CH_CLOCK}',
      '${CH_RECOVER}', '${CH_RESTART}'
    );
  `);
} catch (e) {
  missing += 1;
  console.log(
    `MISS  apply_subscription_webhook CAS\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}

// ─── Hide a 1:1 DM for yourself (#2303) ─────────────────────────────────────
//
// `hide_direct_message` and `get_hidden_channel_ids` are called only through
// mocked repositories in the Jest suites, so this is the one place their SQL
// runs. What each check pins, and the edit it catches:
// - per member: dropping `r.user_id = p_user_id` hides the DM for both members;
// - strictly newer: `>=` instead of `>` would let the hide's own instant count;
// - a deleted message, or one from someone the hider blocked in THIS chapter,
//   does not resurface it (a block in another chapter does not count);
// - the hide never moves an existing read cursor backwards, and matches only a
//   DM in the named chapter.
try {
  const CH = "d0d0d0d0-0000-4000-8000-000000002303";
  const CH_OTHER = "d0d0d0d0-0000-4000-8000-000000012303";
  const U = {
    a: "d1d1d1d1-0000-4000-8000-00000000000a",
    b: "d1d1d1d1-0000-4000-8000-00000000000b",
    c: "d1d1d1d1-0000-4000-8000-00000000000c",
  };
  const DM = "d2d2d2d2-0000-4000-8000-0000000000ab";
  const DM_AC = "d2d2d2d2-0000-4000-8000-0000000000ac";
  const GROUP = "d2d2d2d2-0000-4000-8000-000000000abc";
  const DM_FOREIGN = "d2d2d2d2-0000-4000-8000-0000000100ab";
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Hide DM', 'U'), ('${CH_OTHER}', 'Hide DM other', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'hide-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'hide-b@example.com', 'B'),
      ('${U.c}', gen_random_uuid(), 'hide-c@example.com', 'C');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${DM}', '${CH}', 'dm-a-b', 'DM', array['${U.a}', '${U.b}']::uuid[]),
      ('${DM_AC}', '${CH}', 'dm-a-c', 'DM', array['${U.a}', '${U.c}']::uuid[]),
      ('${GROUP}', '${CH}', 'group-dm', 'GROUP_DM', array['${U.a}', '${U.b}', '${U.c}']::uuid[]),
      ('${DM_FOREIGN}', '${CH_OTHER}', 'dm-a-b', 'DM', array['${U.a}', '${U.b}']::uuid[]);
    insert into chat_messages (channel_id, sender_id, content) values ('${DM}', '${U.b}', 'before');
  `);
  const hide = async (channel, user, chapter = CH) =>
    (
      await db.query(`select * from public.hide_direct_message($1, $2, $3)`, [
        channel,
        chapter,
        user,
      ])
    ).rows;
  const hidden = async (user, chapter = CH) =>
    (
      await db.query(
        `select channel_id::text as id from public.get_hidden_channel_ids($1, $2)`,
        [chapter, user],
      )
    ).rows
      .map((r) => r.id)
      .sort()
      .join(",");
  const send = (channel, sender, deleted = false) =>
    db.query(
      `insert into chat_messages (channel_id, sender_id, content, is_deleted, created_at)
       values ($1, $2, 'after', $3, now() + interval '1 second')`,
      [channel, sender, deleted],
    );
  const count = async (sql) => (await db.query(sql)).rows[0].n;
  const checks = [];

  const messagesBefore = await count(
    `select count(*)::int as n from chat_messages where channel_id = '${DM}'`,
  );
  const hideRows = await hide(DM, U.a);
  checks.push(
    [
      hideRows.length === 1 && hideRows[0].hidden_at !== null,
      "hide_direct_message stamps the caller's receipt",
    ],
    [(await hidden(U.a)) === DM, "the hider's DM is hidden"],
    [
      (await hidden(U.b)) === "",
      "the other member's DM is not hidden (per member)",
    ],
    [
      (await count(
        `select count(*)::int as n from chat_messages where channel_id = '${DM}'`,
      )) === messagesBefore,
      "hiding deletes no message",
    ],
    [
      (await count(
        `select unread_count::int as n from public.get_channel_unread_counts('${CH}', '${U.a}') where channel_id = '${DM}'`,
      )) === 0,
      "hiding marks the DM read",
    ],
    [(await hide(GROUP, U.a)).length === 0, "a Group DM is never hidden"],
    [
      (await hide(DM, U.a, CH_OTHER)).length === 0,
      "a DM named under another chapter is not matched",
    ],
  );

  await send(DM, U.b, true);
  checks.push([
    (await hidden(U.a)) === DM,
    "a deleted message does not resurface it",
  ]);

  await db.exec(`
    insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
    values ('${CH}', '${U.a}', '${U.b}');
  `);
  await send(DM, U.b);
  checks.push([
    (await hidden(U.a)) === DM,
    "a message from a member the hider blocked does not resurface it",
  ]);

  await db.exec(`
    delete from chat_member_blocks where blocker_user_id = '${U.a}';
    insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
    values ('${CH_OTHER}', '${U.a}', '${U.b}');
  `);
  checks.push([
    (await hidden(U.a)) === "",
    "a block in another chapter does not keep it hidden",
  ]);

  await db.exec(
    `delete from chat_messages where channel_id = '${DM}' and content = 'after';`,
  );
  await hide(DM, U.a);
  await db.exec(
    `update chat_messages set created_at = (select hidden_at from channel_read_receipts where channel_id = '${DM}' and user_id = '${U.a}') where channel_id = '${DM}'`,
  );
  checks.push([
    (await hidden(U.a)) === DM,
    "a message at the hide's own instant does not resurface it",
  ]);

  await send(DM, U.a);
  checks.push([
    (await hidden(U.a)) === "",
    "the hider's own new message resurfaces it",
  ]);

  // `send` stamps a second ahead, so clear it before hiding again.
  await db.exec(
    `delete from chat_messages where channel_id = '${DM}' and content = 'after';`,
  );
  await hide(DM, U.a);
  await hide(DM_AC, U.a);
  checks.push(
    [
      (await hidden(U.a)) === [DM, DM_AC].sort().join(","),
      "every hidden DM is returned",
    ],
    [
      (await hidden(U.a, CH_OTHER)) === "",
      "hidden DMs are scoped to the chapter asked about",
    ],
  );

  await db.exec(
    `update channel_read_receipts set last_read_at = now() + interval '1 day' where channel_id = '${DM}' and user_id = '${U.a}'`,
  );
  const [rehide] = await hide(DM, U.a);
  checks.push([
    new Date(rehide.last_read_at).getTime() > Date.now() + 3_600_000,
    "a hide never moves the read cursor backwards",
  ]);

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name} (#2303)`);
    } else {
      missing += 1;
      console.log(`MISS  ${name} (#2303)`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${CH_OTHER}');
    delete from users where id in ('${U.a}', '${U.b}', '${U.c}');
  `);
} catch (e) {
  missing += 1;
  console.log(
    `MISS  hide a 1:1 DM (#2303)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}

// ─── Add and remove a PRIVATE channel's members (#1302) ─────────────────────
//
// `add_private_channel_member`, `remove_private_channel_member` and
// `remove_user_from_private_channels` are called only through mocked
// repositories in the Jest suites, so this is the one place their SQL runs.
// What each check pins, and the edit it catches:
// - an add appends once: dropping the `any(...)` guard lists a member twice;
// - an add repairs a NULL list (a PRIVATE row from before #1008);
// - the last-member guard counts current members of THIS chapter: dropping it
//   lets a removal empty the channel, counting array entries instead lets a
//   removal leave only an id whose member has left, and dropping its chapter
//   filter lets a member of another chapter count (U.gone is one). Each is
//   #1008's defect again;
// - an id whose member has left the chapter can always be removed, even when
//   nobody would remain, since it admits nobody;
// - removing someone not listed is a no-op that still returns the row, on a
//   NULL list too;
// - add and remove match only a PRIVATE channel in the named chapter (the
//   remove probe uses a no-op removal, which returns the row whenever the
//   chapter predicate is missing);
// - the chapter-removal prune takes the member off this chapter's PRIVATE
//   channels only: no Group DM, no other chapter.
try {
  const CH = "d0d0d0d0-0000-4000-8000-000000001302";
  const CH_OTHER = "d0d0d0d0-0000-4000-8000-000000011302";
  const U = {
    a: "d1d1d1d1-0000-4000-8000-0000000013a0",
    b: "d1d1d1d1-0000-4000-8000-0000000013b0",
    gone: "d1d1d1d1-0000-4000-8000-0000000013f0",
  };
  const PRIV = "d2d2d2d2-0000-4000-8000-000000001302";
  const PRIV_NULL = "d2d2d2d2-0000-4000-8000-000000011302";
  const PRIV_NULL_2 = "d2d2d2d2-0000-4000-8000-000000041302";
  const PRIV_STALE = "d2d2d2d2-0000-4000-8000-000000051302";
  const PRIV_ONLY_STALE = "d2d2d2d2-0000-4000-8000-000000061302";
  const GROUP = "d2d2d2d2-0000-4000-8000-000000021302";
  const PRIV_FOREIGN = "d2d2d2d2-0000-4000-8000-000000031302";
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Private members', 'U'), ('${CH_OTHER}', 'Private members other', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'priv-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'priv-b@example.com', 'B'),
      ('${U.gone}', gen_random_uuid(), 'priv-gone@example.com', 'Gone');
    -- U.gone has left CH but is still a member of CH_OTHER, so a guard
    -- that forgot its chapter filter would count them as someone remaining.
    insert into members (user_id, chapter_id) values
      ('${U.a}', '${CH}'), ('${U.b}', '${CH}'),
      ('${U.a}', '${CH_OTHER}'), ('${U.b}', '${CH_OTHER}'),
      ('${U.gone}', '${CH_OTHER}');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${PRIV}', '${CH}', 'exec', 'PRIVATE', array['${U.a}']::uuid[]),
      ('${PRIV_NULL}', '${CH}', 'legacy', 'PRIVATE', null),
      ('${PRIV_NULL_2}', '${CH}', 'legacy-2', 'PRIVATE', null),
      ('${PRIV_STALE}', '${CH}', 'stale', 'PRIVATE', array['${U.a}', '${U.gone}']::uuid[]),
      ('${PRIV_ONLY_STALE}', '${CH}', 'only-stale', 'PRIVATE', array['${U.gone}']::uuid[]),
      ('${GROUP}', '${CH}', 'group-dm', 'GROUP_DM', array['${U.a}', '${U.b}']::uuid[]),
      ('${PRIV_FOREIGN}', '${CH_OTHER}', 'exec', 'PRIVATE', array['${U.a}', '${U.b}']::uuid[]);
  `);
  const call = async (fn, channel, user, chapter = CH) =>
    (
      await db.query(
        `select member_ids::text[] as m from public.${fn}($1, $2, $3)`,
        [channel, chapter, user],
      )
    ).rows;
  const add = (channel, user, chapter) =>
    call("add_private_channel_member", channel, user, chapter);
  const remove = (channel, user, chapter) =>
    call("remove_private_channel_member", channel, user, chapter);
  const members = async (channel) =>
    (
      await db.query(
        `select member_ids::text[] as m from chat_channels where id = $1`,
        [channel],
      )
    ).rows[0].m;
  const same = (got, want) =>
    Array.isArray(got) && got.join(",") === want.join(",");
  const checks = [];

  checks.push([
    same((await add(PRIV, U.b))[0]?.m, [U.a, U.b]),
    "an add appends the member",
  ]);
  checks.push([
    same((await add(PRIV, U.b))[0]?.m, [U.a, U.b]),
    "adding a listed member changes nothing and still returns the row",
  ]);
  checks.push([
    same((await add(PRIV_NULL, U.b))[0]?.m, [U.b]),
    "an add repairs a NULL list",
  ]);
  checks.push(
    [(await add(GROUP, U.a)).length === 0, "an add never matches a Group DM"],
    [
      (await add(PRIV_FOREIGN, U.b, CH)).length === 0,
      "an add never matches a channel named under another chapter",
    ],
  );

  checks.push([
    same((await remove(PRIV, U.b))[0]?.m, [U.a]),
    "a removal drops the member",
  ]);
  checks.push([
    same((await remove(PRIV, U.b))[0]?.m, [U.a]),
    "removing someone not listed is a no-op that returns the row",
  ]);
  const nullRemove = await remove(PRIV_NULL_2, U.b);
  checks.push([
    nullRemove.length === 1 && nullRemove[0].m === null,
    "removing from a NULL list is a no-op that returns the row",
  ]);
  checks.push(
    [
      (await remove(PRIV, U.a)).length === 0,
      "removing the last member is refused",
    ],
    [same(await members(PRIV), [U.a]), "the refused removal changed nothing"],
    [
      (await remove(PRIV_STALE, U.a)).length === 0,
      "a removal that leaves only an id whose member has left is refused",
    ],
    [
      same(await members(PRIV_STALE), [U.a, U.gone]),
      "the refused stale-id removal changed nothing",
    ],
    [
      same((await remove(PRIV_STALE, U.gone))[0]?.m, [U.a]),
      "an id whose member has left can be removed",
    ],
    [
      same((await remove(PRIV_ONLY_STALE, U.gone))[0]?.m, []),
      "an id whose member has left can be removed even when nobody remains",
    ],
    [
      (await remove(GROUP, U.b)).length === 0,
      "a removal never matches a Group DM",
    ],
    [
      (await remove(PRIV_FOREIGN, U.gone, CH)).length === 0,
      "a removal never matches a channel named under another chapter",
    ],
    [
      same(await members(PRIV_FOREIGN), [U.a, U.b]),
      "the foreign chapter's channel is untouched",
    ],
  );

  // Chapter removal: U.b is listed in PRIV (re-added), PRIV_NULL, GROUP and
  // the other chapter's PRIV_FOREIGN.
  await add(PRIV, U.b);
  const pruned = (
    await db.query(
      `select c::text as id from public.remove_user_from_private_channels($1, $2) as c`,
      [CH, U.b],
    )
  ).rows
    .map((r) => r.id)
    .sort()
    .join(",");
  checks.push(
    [
      pruned === [PRIV, PRIV_NULL].sort().join(","),
      "the prune returns exactly the chapter's PRIVATE channels it changed",
    ],
    [same(await members(PRIV), [U.a]), "the prune takes the member off"],
    [
      same(await members(PRIV_NULL), []),
      "the prune empties a channel whose only member leaves",
    ],
    [
      same(await members(GROUP), [U.a, U.b]),
      "the prune leaves Group DMs alone",
    ],
    [
      same(await members(PRIV_FOREIGN), [U.a, U.b]),
      "the prune leaves other chapters alone",
    ],
  );

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name} (#1302)`);
    } else {
      missing += 1;
      console.log(`MISS  ${name} (#1302)`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${CH_OTHER}');
    delete from users where id in ('${U.a}', '${U.b}', '${U.gone}');
  `);
} catch (e) {
  missing += 1;
  console.log(
    `MISS  private channel members (#1302)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}

// ─── Fold and unfold a sidebar section (#2877) ──────────────────────────────
//
// `set_chat_sidebar_section_collapsed` is called only through a mocked
// repository in the Jest suites, so this is the one place its SQL runs. What
// each check pins, and the edit it catches:
// - the first fold creates the row with just that key;
// - folding a folded key appends nothing: dropping the `any(...)` guard lists
//   it twice;
// - unfolding removes only that key, and unfolding an unfolded one is a no-op
//   that still returns the row;
// - unfolding before any row exists creates an empty row, not a row holding
//   the key (a swapped `case` arm would fold it);
// - a fold touches only the caller's own (member, chapter) row.
try {
  const CH = "d0d0d0d0-0000-4000-8000-000000002877";
  const CH_OTHER = "d0d0d0d0-0000-4000-8000-000000012877";
  const U = {
    a: "d1d1d1d1-0000-4000-8000-0000000028a0",
    b: "d1d1d1d1-0000-4000-8000-0000000028b0",
  };
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Sidebar', 'U'), ('${CH_OTHER}', 'Sidebar other', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'sidebar-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'sidebar-b@example.com', 'B');
  `);
  const fold = async (user, chapter, key, collapsed) =>
    (
      await db.query(
        `select collapsed_sections::text[] as k from public.set_chat_sidebar_section_collapsed($1, $2, $3, $4)`,
        [user, chapter, key, collapsed],
      )
    ).rows;
  const keys = async (user, chapter) =>
    (
      await db.query(
        `select collapsed_sections::text[] as k from chat_sidebar_preferences where user_id = $1 and chapter_id = $2`,
        [user, chapter],
      )
    ).rows[0]?.k;
  const same = (got, want) =>
    Array.isArray(got) && got.join(",") === want.join(",");
  const checks = [];

  checks.push([
    same((await fold(U.a, CH, "direct", true))[0]?.k, ["direct"]),
    "the first fold creates the row with that key",
  ]);
  checks.push([
    same((await fold(U.a, CH, "pinned", true))[0]?.k, ["direct", "pinned"]),
    "a second fold appends",
  ]);
  checks.push([
    same((await fold(U.a, CH, "pinned", true))[0]?.k, ["direct", "pinned"]),
    "folding a folded key changes nothing",
  ]);
  checks.push([
    same((await fold(U.a, CH, "direct", false))[0]?.k, ["pinned"]),
    "unfolding removes only that key",
  ]);
  checks.push([
    same((await fold(U.a, CH, "direct", false))[0]?.k, ["pinned"]),
    "unfolding an unfolded key is a no-op that returns the row",
  ]);
  checks.push([
    same((await fold(U.b, CH, "channels", false))[0]?.k, []),
    "unfolding before any row exists creates an empty row",
  ]);
  checks.push(
    [
      same(await keys(U.a, CH), ["pinned"]),
      "another member's fold leaves this row alone",
    ],
    [
      (await keys(U.a, CH_OTHER)) === undefined,
      "a fold writes no row in another chapter",
    ],
  );

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name} (#2877)`);
    } else {
      missing += 1;
      console.log(`MISS  ${name} (#2877)`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${CH_OTHER}');
    delete from users where id in ('${U.a}', '${U.b}');
  `);
} catch (e) {
  missing += 1;
  console.log(
    `MISS  sidebar section folds (#2877)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}

// ─── Unread and mention counts skip a blocked sender (#2521) ─────────────────
//
// `get_channel_unread_counts` is called only through a mocked repository in the
// Jest suites, so this is the one place its block rule runs. userA blocks userB
// in CH. What each scenario pins, and the edit it catches:
// - the blocker stops counting userB's messages and mentions in CH, while a
//   bystander's and a null-sender row still count, and a channel whose every
//   message is now skipped still returns its row, as zero;
// - nobody else's counts move: not a bystander's (a predicate keyed on the
//   sender alone), not the blocked member's own (an oracle);
// - the block is per chapter, in both directions;
// - unblocking gives back exactly the pre-block counts, from a read cursor
//   that never moved.
//
// Scenario names are cited by `chat-read-surface-ledger.spec.ts` as the proof
// for `ChatController_getUnreadCounts_v1`, which that spec checks is still a
// `name:` here. Rename one there too.
try {
  const CH = "e0e0e0e0-0000-4000-8000-000000002521";
  const CH_OTHER = "e0e0e0e0-0000-4000-8000-000000012521";
  const U = {
    a: "e1e1e1e1-0000-4000-8000-00000000000a", // the blocker
    b: "e1e1e1e1-0000-4000-8000-00000000000b", // the blocked member
    c: "e1e1e1e1-0000-4000-8000-00000000000c", // a bystander
  };
  const PUB = "e2e2e2e2-0000-4000-8000-000000000001";
  const DM = "e2e2e2e2-0000-4000-8000-0000000000ab";
  const PUB_OTHER = "e2e2e2e2-0000-4000-8000-000000010001";
  // Explicit timestamps, so the read cursor can sit between messages. Every
  // insert in one statement would otherwise share one `now()`.
  const at = (minutes) => `now() - interval '${60 - minutes} minutes'`;
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Unread blocks', 'U'), ('${CH_OTHER}', 'Unread blocks other', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'unread-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'unread-b@example.com', 'B'),
      ('${U.c}', gen_random_uuid(), 'unread-c@example.com', 'C');
    insert into chat_channels (id, chapter_id, name, type, member_ids) values
      ('${PUB}', '${CH}', 'general', 'PUBLIC', '{}'::uuid[]),
      ('${DM}', '${CH}', 'dm-a-b', 'DM', array['${U.a}', '${U.b}']::uuid[]),
      ('${PUB_OTHER}', '${CH_OTHER}', 'general', 'PUBLIC', '{}'::uuid[]);
    insert into chat_messages (channel_id, sender_id, author_name, content, mentions, created_at) values
      -- Before userA's cursor on PUB, so never unread to userA.
      ('${PUB}', '${U.b}', null, '@A early', array['${U.a}']::uuid[], ${at(1)}),
      ('${PUB}', '${U.c}', null, '@A from C', array['${U.a}']::uuid[], ${at(2)}),
      ('${PUB}', '${U.b}', null, 'plain from B', '{}'::uuid[], ${at(3)}),
      ('${PUB}', '${U.b}', null, '@A from B', array['${U.a}']::uuid[], ${at(4)}),
      ('${PUB}', null, 'Webhook Bot', 'live, no sender', '{}'::uuid[], ${at(5)}),
      -- The blocker's own messages. Never unread to userA, but userB counts
      -- them, so a predicate that also hid a blocker from the member they
      -- blocked (the oracle) would move userB's counts.
      ('${PUB}', '${U.a}', null, '@B from A', array['${U.b}']::uuid[], ${at(5.5)}),
      ('${DM}', '${U.a}', null, 'dm from A', '{}'::uuid[], ${at(5.5)}),
      ('${DM}', '${U.b}', null, 'dm one', '{}'::uuid[], ${at(6)}),
      ('${DM}', '${U.b}', null, '@A dm two', array['${U.a}']::uuid[], ${at(7)}),
      ('${PUB_OTHER}', '${U.b}', null, '@A elsewhere', array['${U.a}']::uuid[], ${at(8)});
    insert into channel_read_receipts (channel_id, user_id, last_read_at) values
      ('${PUB}', '${U.a}', ${at(1.5)});
  `);

  // "<channel>=<unread>/<mentions>" per channel, sorted: one string to compare.
  const LABEL = { [PUB]: "PUB", [DM]: "DM", [PUB_OTHER]: "PUB_OTHER" };
  const counts = async (user, chapter) =>
    (
      await db.query(
        `select channel_id::text as id, unread_count::int as u, mention_count::int as m
           from public.get_channel_unread_counts($1, $2)`,
        [chapter, user],
      )
    ).rows
      .map((r) => `${LABEL[r.id] ?? r.id}=${r.u}/${r.m}`)
      .sort()
      .join(" ");
  const snapshot = async () => ({
    aHere: await counts(U.a, CH),
    aThere: await counts(U.a, CH_OTHER),
    b: await counts(U.b, CH),
    c: await counts(U.c, CH),
  });
  const block = (chapter) =>
    db.exec(`
      insert into chat_member_blocks (chapter_id, blocker_user_id, blocked_user_id)
      values ('${chapter}', '${U.a}', '${U.b}');
    `);
  const unblockAll = () =>
    db.exec(`delete from chat_member_blocks where blocker_user_id = '${U.a}';`);

  const before = await snapshot();
  await block(CH);
  const blocked = await snapshot();
  await unblockAll();
  await block(CH_OTHER);
  const blockedElsewhere = await snapshot();
  await unblockAll();
  const unblocked = await snapshot();

  const UNREAD_BLOCK_SCENARIOS = [
    {
      // The control. Without it a fixture that never landed would pass every
      // "unchanged" check below. userA's PUB cursor sits after the first
      // message; userB and userC have no receipt, so everything counts except
      // their own messages.
      name: "before any block, unread and mention counts include every sender (#2521)",
      got: `${before.aHere} | ${before.aThere} | ${before.b} | ${before.c}`,
      want: "DM=2/1 PUB=4/2 | PUB_OTHER=1/1 | DM=1/0 PUB=3/1 | DM=3/0 PUB=5/0",
    },
    {
      name: "a blocker's unread and mention counts skip the blocked member's messages in that chapter (#2521)",
      got: blocked.aHere,
      // PUB keeps userC's mention and the null-sender row; DM keeps its row.
      want: "DM=0/0 PUB=2/1",
    },
    {
      name: "a bystander's counts are unchanged by someone else's block (#2521)",
      got: blocked.c,
      want: before.c,
    },
    {
      name: "the blocked member's own counts are unchanged by being blocked (no oracle) (#2521)",
      got: blocked.b,
      want: before.b,
    },
    {
      name: "a block is per chapter: one in CH leaves CH_OTHER's counts, and one in CH_OTHER leaves CH's (#2521)",
      got: `${blocked.aThere} | ${blockedElsewhere.aHere}`,
      want: `${before.aThere} | ${before.aHere}`,
    },
    {
      name: "unblocking restores the pre-block counts from the unmoved read cursor (#2521)",
      got: unblocked.aHere,
      want: before.aHere,
    },
  ];
  for (const s of UNREAD_BLOCK_SCENARIOS) {
    if (s.got === s.want) {
      console.log(`OK    ${s.name}`);
    } else {
      missing += 1;
      console.log(
        `MISS  ${s.name}\n        ↳ expected ${s.want}, got ${s.got}`,
      );
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${CH_OTHER}');
    delete from users where id in ('${U.a}', '${U.b}', '${U.c}');
  `);
} catch (e) {
  missing += 1;
  console.log(
    `MISS  unread counts skip a blocked sender (#2521)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}

// ─── Functional: Discord author links (#2878) ───────────────────────────────
//
// Linking makes a member the sender of their imported Discord history. Every
// promise that makes that safe is SQL, so it is proved here against the real
// functions rather than through a mocked repository:
//
//   - tenant isolation: linking in chapter A attaches only chapter A's rows,
//     even when chapter B imported the same Discord author;
//   - the insert trigger attaches rows imported after the link, in the linked
//     chapter only;
//   - one Discord account is one member (23505) and only a member links
//     (42501);
//   - switching accounts detaches what the first attached, and unlinking
//     restores the Discord name;
//   - reports on those rows follow the sender when linking, so the officer
//     queue's "not about the viewer" rule covers reports filed before the
//     link, and unlinking never points a report back at nobody;
//   - unlinking or switching in one chapter leaves the same account's link,
//     rows and reports in another chapter alone;
//   - a deleted account cannot link;
//   - account deletion clears the Discord snapshot on the deleted member's
//     linked rows and on reports about them, and deletes their links.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: Discord author links (#2878) ===");
{
  const A = "a2878000-0000-4000-8000-00000000000a"; // chapter A
  const B = "b2878000-0000-4000-8000-00000000000b"; // chapter B
  const JAKE = "a2878000-0000-4000-8000-000000000001"; // member of A and B
  const PIN = "a2878000-0000-4000-8000-000000000002"; // member of A
  const OUT = "a2878000-0000-4000-8000-000000000003"; // member of neither
  const CH_A = "a2878000-0000-4000-8000-0000000000c1";
  const CH_B = "b2878000-0000-4000-8000-0000000000c1";
  const JK = "900000000000000001"; // jkslayer's Discord id
  const PS = "900000000000000002"; // Pinstripe's Discord id

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const q = async (sql) => (await db.query(sql)).rows;
  // The code, and whether the message carries the function's prefix: the API
  // maps 23505 / 42501 to 409 / 403 only for the function's own refusals
  // (`SupabaseDiscordAuthorLinkRepository.link`), so rewording a `raise`
  // without the prefix would turn them into 500s.
  const errCode = async (sql) => {
    await db.exec("savepoint author_link_probe;");
    try {
      await db.query(sql);
      return null;
    } catch (e) {
      const prefixed = String(e?.message ?? "").startsWith(
        "link_discord_author:",
      );
      return `${e?.code ?? String(e?.message ?? e)}${prefixed ? "" : " (no link_discord_author: prefix)"}`;
    } finally {
      await db.exec("rollback to savepoint author_link_probe;");
    }
  };
  const senders = async (channel) =>
    Object.fromEntries(
      (
        await q(
          `select content, sender_id from chat_messages where channel_id = '${channel}' order by content`,
        )
      ).map((r) => [r.content, r.sender_id]),
    );

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into users (id, supabase_auth_id, email, display_name) values
        ('${JAKE}', gen_random_uuid(), 'jake@2878.test', 'Jake'),
        ('${PIN}', gen_random_uuid(), 'pin@2878.test', 'Pin'),
        ('${OUT}', gen_random_uuid(), 'out@2878.test', 'Out');
      insert into members (user_id, chapter_id) values
        ('${JAKE}', '${A}'), ('${JAKE}', '${B}'), ('${PIN}', '${A}');
      insert into chat_channels (id, chapter_id, name, type) values
        ('${CH_A}', '${A}', 'general', 'PUBLIC'), ('${CH_B}', '${B}', 'general', 'PUBLIC');
      insert into chat_messages (channel_id, content, kind, author_name, author_external_id, external_message_id, payload) values
        ('${CH_A}', 'a1', 'imported', 'jkslayer', '${JK}', 'm1', '{"author_username":"jk"}'),
        ('${CH_A}', 'a2', 'imported', 'Pinstripe', '${PS}', 'm2', null),
        ('${CH_B}', 'b1', 'imported', 'jkslayer', '${JK}', 'm3', null);
      -- Filed while the row had no sender: it names only the Discord author.
      insert into chat_message_reports (chapter_id, message_id, reporter_user_id, reason, reported_content, reported_author_name)
        select '${A}', id, '${PIN}', 'spam', content, author_name from chat_messages where content = 'a1';
      insert into chat_message_reports (chapter_id, message_id, reporter_user_id, reason, reported_content, reported_author_name)
        select '${B}', id, '${JAKE}', 'spam', content, author_name from chat_messages where content = 'b1';
    `);
    const reportSender = async (chapter = A) =>
      (
        await q(
          `select reported_sender_id, reported_author_name from chat_message_reports where chapter_id = '${chapter}' and message_id is not null`,
        )
      )[0];

    const linked = await q(
      `select messages_linked from link_discord_author('${A}', '${JAKE}', '${JK}', 'jkslayer')`,
    );
    check(
      "linking attaches the author's imported rows in that chapter",
      linked[0]?.messages_linked === 1,
      linked,
    );
    const afterLink = { a: await senders(CH_A), b: await senders(CH_B) };
    check(
      "linking in chapter A never attaches chapter B's rows by the same Discord author",
      afterLink.a.a1 === JAKE &&
        afterLink.a.a2 === null &&
        afterLink.b.b1 === null,
      afterLink,
    );

    await db.exec(`
      insert into chat_messages (channel_id, content, kind, author_name, author_external_id, external_message_id) values
        ('${CH_A}', 'a3', 'imported', 'jkslayer', '${JK}', 'm4'),
        ('${CH_B}', 'b2', 'imported', 'jkslayer', '${JK}', 'm5');
    `);
    const linkedReport = await reportSender();
    check(
      "a report filed before the link names the linked member afterwards",
      linkedReport?.reported_sender_id === JAKE,
      linkedReport,
    );

    const afterImport = { a: await senders(CH_A), b: await senders(CH_B) };
    check(
      "a row imported after the link attaches in the linked chapter only",
      afterImport.a.a3 === JAKE && afterImport.b.b2 === null,
      afterImport,
    );

    // The same account linked in B too, before anything changes in A.
    await q(
      `select * from link_discord_author('${B}', '${JAKE}', '${JK}', 'jkslayer')`,
    );

    check(
      "another member claiming a linked account is refused with 23505",
      (await errCode(
        `select * from link_discord_author('${A}', '${PIN}', '${JK}', 'x')`,
      )) === "23505",
    );
    check(
      "a non-member cannot link in the chapter (42501)",
      (await errCode(
        `select * from link_discord_author('${A}', '${OUT}', '${PS}', 'x')`,
      )) === "42501",
    );

    await q(
      `select * from link_discord_author('${A}', '${JAKE}', '${PS}', 'pin')`,
    );
    const afterSwitch = await senders(CH_A);
    const switchedReport = await reportSender();
    check(
      "switching accounts leaves reports naming the member who proved the account",
      switchedReport?.reported_sender_id === JAKE,
      switchedReport,
    );
    check(
      "linking a different account detaches the first and attaches the second",
      afterSwitch.a1 === null &&
        afterSwitch.a3 === null &&
        afterSwitch.a2 === JAKE,
      afterSwitch,
    );

    const restored = await q(
      `select unlink_discord_author('${A}', '${JAKE}') as n`,
    );
    const afterUnlink = await senders(CH_A);
    const linksLeft = await q(
      `select count(*)::int as n from discord_author_links where chapter_id = '${A}'`,
    );
    check(
      "unlinking returns the rows to their Discord name and removes the link",
      restored[0]?.n === 1 && afterUnlink.a2 === null && linksLeft[0]?.n === 0,
      { restored, afterUnlink, linksLeft },
    );
    const bAfterA = await senders(CH_B);
    const bReport = await reportSender(B);
    const bLink = await q(
      `select count(*)::int as n from discord_author_links where chapter_id = '${B}' and user_id = '${JAKE}'`,
    );
    check(
      "switching and unlinking in chapter A leave chapter B's link, rows and reports alone",
      bAfterA.b1 === JAKE &&
        bAfterA.b2 === JAKE &&
        bReport?.reported_sender_id === JAKE &&
        bLink[0]?.n === 1,
      { bAfterA, bReport, bLink },
    );

    await q(
      `select * from link_discord_author('${A}', '${JAKE}', '${JK}', 'jkslayer')`,
    );
    // A report whose message is gone (a purged import sets message_id null):
    // only its reported sender ties it to the member.
    await db.exec(`
      insert into chat_message_reports (chapter_id, message_id, reporter_user_id, reported_sender_id, reason, reported_content, reported_author_name)
        values ('${A}', null, '${PIN}', '${JAKE}', 'spam', 'gone', 'jkslayer');
    `);
    await q(`select anonymize_user('${JAKE}')`);
    const orphanReport = await q(
      `select reported_author_name from chat_message_reports where chapter_id = '${A}' and message_id is null`,
    );
    const deletedReport = await reportSender();
    const scrubbed = await q(
      `select content, sender_id, author_name, author_avatar_path, author_external_id, payload
         from chat_messages where author_external_id is null and kind = 'imported' order by content`,
    );
    const pinstripe = await q(
      `select author_name, author_external_id from chat_messages where content = 'a2'`,
    );
    const jakeLinks = await q(
      `select count(*)::int as n from discord_author_links where user_id = '${JAKE}'`,
    );
    check(
      "account deletion clears the Discord snapshot on the member's linked rows and their reports, keeps the rows, and deletes the links",
      scrubbed.length === 4 &&
        scrubbed.every(
          (r) =>
            r.sender_id === JAKE &&
            r.author_name === null &&
            r.author_avatar_path === null &&
            (r.payload === null || !("author_username" in r.payload)),
        ) &&
        pinstripe[0]?.author_name === "Pinstripe" &&
        pinstripe[0]?.author_external_id === PS &&
        jakeLinks[0]?.n === 0 &&
        deletedReport?.reported_sender_id === JAKE &&
        deletedReport?.reported_author_name === null &&
        orphanReport[0]?.reported_author_name === null,
      { scrubbed, pinstripe, jakeLinks, deletedReport, orphanReport },
    );

    // `anonymize_user` also deletes the membership, so the membership check
    // alone would refuse this. Put the membership back so only the tombstone
    // guard stands between a deleted account and a link: the state a first
    // link racing account deletion sees.
    await db.exec(
      `insert into members (user_id, chapter_id) values ('${JAKE}', '${A}');`,
    );
    const tombstoneLink = await errCode(
      `select * from link_discord_author('${A}', '${JAKE}', '${JK}', 'jkslayer')`,
    );
    const tombstoneLinks = await q(
      `select count(*)::int as n from discord_author_links where user_id = '${JAKE}'`,
    );
    check(
      "a deleted account cannot link",
      tombstoneLink === "42501" && tombstoneLinks[0]?.n === 0,
      { tombstoneLink, tombstoneLinks },
    );
  } catch (e) {
    check(
      "Discord author links scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      missing += 1;
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`,
      );
    }
  }
}

// ─── Functional: a deleted import takes its emptied channels (#2905) ─────────
//
// The purge deletes an import's messages, then calls
// `delete_empty_discord_import_channels` for the channels the import created.
// Before #2905 each one it left behind met a re-import of the same server as a
// name clash, or as a duplicate when hidden from the admin. Proved against the
// real function:
//
//   - a channel the import created and left empty is deleted, whether it is
//     recorded in `discord_import_created_channels` or, for an import from
//     before that table, named by a `create_new` row (once, even when a
//     thread's row shares it); a recorded channel no mapping row names any
//     more, as after remapping a failed import, is deleted too;
//   - a created channel is kept while it holds a live message, a deleted
//     one, another import's messages, or a points-ledger link;
//   - a created channel another import merged into is kept while that
//     import isn't deleted, a finished one included; a merge by a `purging`
//     or `purged` import, this one included, pins nothing (#2922);
//   - a channel this import merged into is a candidate only when a
//     `purging` or `purged` import recorded creating it, which re-reaps what
//     that import's purge had to keep (#2922; `purging` too, since a purge
//     writes `purged` only after its channel step, and two can run at once);
//   - a `create_new` row naming a channel older than the import, or one
//     without the worker's "Imported from Discord #…" description (an upload
//     mapped before #2859), doesn't make it a candidate;
//   - another import's `create_new` row doesn't pin a channel; only a
//     `use_existing` one does;
//   - chapter scope: a row pointing into another chapter deletes nothing
//     there, and the wrong chapter id deletes nothing at all;
//   - an import that isn't `purging` loses nothing;
//   - a signed-in client may not call it, and the new table has RLS on.
//
// The row lock that keeps a send landing mid-purge from being cascaded away
// needs two connections, which this harness doesn't have; the PR for #2905
// records the two-session proof against the local stack.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: a deleted import takes its emptied channels (#2905) ===",
);
{
  const A = "a2905000-0000-4000-8000-00000000000a";
  const B = "b2905000-0000-4000-8000-00000000000b";
  const U = "a2905000-0000-4000-8000-000000000001";
  const PURGING = "a2905000-0000-4000-8000-0000000000d1";
  const OTHER = "a2905000-0000-4000-8000-0000000000d2";
  const RUNNING = "a2905000-0000-4000-8000-0000000000d3";
  const PURGED = "a2905000-0000-4000-8000-0000000000d4";
  const OTHER_PURGING = "a2905000-0000-4000-8000-0000000000d5";
  const CH = {
    EMPTY: "a2905000-0000-4000-8000-0000000000c1", // recorded and mapped: deleted
    THREADED: "a2905000-0000-4000-8000-0000000000c2", // mapped only, two rows: deleted once
    ORPHAN: "a2905000-0000-4000-8000-0000000000c3", // recorded only (remapped): deleted
    LIVE: "a2905000-0000-4000-8000-0000000000c4",
    DELETED_MSG: "a2905000-0000-4000-8000-0000000000c5",
    OTHER_MSGS: "a2905000-0000-4000-8000-0000000000c6",
    POINTS: "a2905000-0000-4000-8000-0000000000c7",
    MERGED_INTO: "a2905000-0000-4000-8000-0000000000c8",
    EXISTING: "a2905000-0000-4000-8000-0000000000c9",
    LEGACY: "a2905000-0000-4000-8000-0000000000ca",
    LEGACY_NEWER: "a2905000-0000-4000-8000-0000000000cc",
    RUNNING_CH: "a2905000-0000-4000-8000-0000000000cb",
    IN_B: "b2905000-0000-4000-8000-0000000000c1",
    // #2922: merges by deleted imports, and the re-reap.
    SELF_MERGED: "a2905000-0000-4000-8000-0000000000e1", // created here, merged into by this import: deleted
    MERGED_BY_PURGED: "a2905000-0000-4000-8000-0000000000e2", // created here, merged into by a purged import: deleted
    MERGED_BY_PURGING: "a2905000-0000-4000-8000-0000000000e3", // created here, merged into by another purging import: deleted
    REREAP: "a2905000-0000-4000-8000-0000000000e4", // a purged import created it, this one merged into it: deleted
    REREAP_PINNED: "a2905000-0000-4000-8000-0000000000e5", // as REREAP, but a running import merges into it too: kept
    REREAP_PURGING: "a2905000-0000-4000-8000-0000000000e7", // an import still purging created it, this one merged into it: deleted
    OTHERS_CREATED: "a2905000-0000-4000-8000-0000000000e6", // a completed import created it, this one merged into it: kept
  };
  const DELETABLE = [
    CH.EMPTY,
    CH.THREADED,
    CH.ORPHAN,
    CH.SELF_MERGED,
    CH.MERGED_BY_PURGED,
    CH.MERGED_BY_PURGING,
    CH.REREAP,
    CH.REREAP_PURGING,
  ].sort();

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const q = async (sql) => (await db.query(sql)).rows;
  const ids = Object.values(CH)
    .map((id) => `'${id}'`)
    .join(", ");
  const channelsLeft = async () =>
    (
      await q(`select id from chat_channels where id in (${ids}) order by id`)
    ).map((r) => r.id);

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into users (id, supabase_auth_id, email) values ('${U}', gen_random_uuid(), 'u@2905.test');
      insert into discord_imports (id, chapter_id, status, consent_acknowledged_at) values
        ('${PURGING}', '${A}', 'purging', now()),
        ('${OTHER}', '${A}', 'completed', now()),
        ('${RUNNING}', '${A}', 'running', now()),
        ('${PURGED}', '${A}', 'purged', now()),
        ('${OTHER_PURGING}', '${A}', 'purging', now());
      insert into chat_channels (id, chapter_id, name, type) values
        ('${CH.EMPTY}', '${A}', 'rush', 'PUBLIC'),
        ('${CH.ORPHAN}', '${A}', 'exec', 'PUBLIC'),
        ('${CH.LIVE}', '${A}', 'general', 'PUBLIC'),
        ('${CH.DELETED_MSG}', '${A}', 'memes', 'PUBLIC'),
        ('${CH.OTHER_MSGS}', '${A}', 'archive', 'PUBLIC'),
        ('${CH.POINTS}', '${A}', 'service', 'PUBLIC'),
        ('${CH.MERGED_INTO}', '${A}', 'social', 'PUBLIC'),
        ('${CH.EXISTING}', '${A}', 'announcements', 'PUBLIC'),
        ('${CH.RUNNING_CH}', '${A}', 'sports', 'PUBLIC'),
        ('${CH.IN_B}', '${B}', 'rush', 'PUBLIC'),
        ('${CH.SELF_MERGED}', '${A}', 'pledges', 'PUBLIC'),
        ('${CH.MERGED_BY_PURGED}', '${A}', 'alumni', 'PUBLIC'),
        ('${CH.MERGED_BY_PURGING}', '${A}', 'treasury', 'PUBLIC'),
        ('${CH.REREAP}', '${A}', 'philanthropy', 'PUBLIC'),
        ('${CH.REREAP_PINNED}', '${A}', 'brotherhood', 'PUBLIC'),
        ('${CH.OTHERS_CREATED}', '${A}', 'chapter', 'PUBLIC'),
        ('${CH.REREAP_PURGING}', '${A}', 'recruitment', 'PUBLIC');
      -- Named only by mapping rows, as for an import from before the created-
      -- channel record: the worker's description is what marks it as made.
      insert into chat_channels (id, chapter_id, name, type, description) values
        ('${CH.THREADED}', '${A}', 'formal', 'PUBLIC', 'Imported from Discord #formal');
      -- An officer's channel from before the import, and one made after the
      -- import row but not by the worker; a pre-#2859 upload row names both.
      insert into chat_channels (id, chapter_id, name, type, description, created_at) values
        ('${CH.LEGACY}', '${A}', 'intramurals', 'PUBLIC', 'Imported from Discord #intramurals', now() - interval '1 day');
      insert into chat_channels (id, chapter_id, name, type, description) values
        ('${CH.LEGACY_NEWER}', '${A}', 'pickup', 'PUBLIC', 'Pickup games');
      insert into discord_import_created_channels (import_id, channel_id) values
        ('${PURGING}', '${CH.EMPTY}'), ('${PURGING}', '${CH.ORPHAN}'), ('${PURGING}', '${CH.LIVE}'),
        ('${PURGING}', '${CH.DELETED_MSG}'), ('${PURGING}', '${CH.OTHER_MSGS}'), ('${PURGING}', '${CH.POINTS}'),
        ('${PURGING}', '${CH.MERGED_INTO}'), ('${PURGING}', '${CH.IN_B}'), ('${RUNNING}', '${CH.RUNNING_CH}'),
        ('${PURGING}', '${CH.SELF_MERGED}'), ('${PURGING}', '${CH.MERGED_BY_PURGED}'), ('${PURGING}', '${CH.MERGED_BY_PURGING}'),
        ('${PURGED}', '${CH.REREAP}'), ('${PURGED}', '${CH.REREAP_PINNED}'), ('${OTHER}', '${CH.OTHERS_CREATED}'),
        ('${OTHER_PURGING}', '${CH.REREAP_PURGING}');
      insert into discord_import_channels
        (import_id, discord_channel_id, discord_channel_name, mapping_action, new_channel_name, target_channel_id) values
        ('${PURGING}', 'd1', 'rush', 'create_new', 'rush', '${CH.EMPTY}'),
        ('${PURGING}', 'd2', 'formal', 'create_new', 'formal', '${CH.THREADED}'),
        ('${PURGING}', 'd2-thread', 'formal-thread', 'create_new', 'formal', '${CH.THREADED}'),
        ('${PURGING}', 'd6', 'announcements', 'use_existing', null, '${CH.EXISTING}'),
        ('${PURGING}', 'd7', 'intramurals', 'create_new', 'intramurals', '${CH.LEGACY}'),
        ('${PURGING}', 'd9', 'pickup', 'create_new', 'pickup', '${CH.LEGACY_NEWER}'),
        ('${PURGING}', 'd8', 'rush', 'create_new', 'rush', '${CH.IN_B}'),
        ('${OTHER}', 'e5', 'social', 'use_existing', null, '${CH.MERGED_INTO}'),
        -- A leftover create_new row of another import on a channel this one
        -- made: it holds nothing there, so it pins nothing.
        ('${OTHER}', 'e1', 'rush', 'create_new', 'rush', '${CH.EMPTY}'),
        ('${RUNNING}', 'f1', 'sports', 'create_new', 'sports', '${CH.RUNNING_CH}'),
        -- #2922: a failed import remapped through the API can merge into a
        -- channel its own first run created.
        ('${PURGING}', 'd10', 'pledges', 'use_existing', null, '${CH.SELF_MERGED}'),
        ('${PURGED}', 'g1', 'alumni', 'use_existing', null, '${CH.MERGED_BY_PURGED}'),
        ('${OTHER_PURGING}', 'h1', 'treasury', 'use_existing', null, '${CH.MERGED_BY_PURGING}'),
        -- Merges into channels other imports created.
        ('${PURGING}', 'd11', 'philanthropy', 'use_existing', null, '${CH.REREAP}'),
        ('${PURGING}', 'd13', 'brotherhood', 'use_existing', null, '${CH.REREAP_PINNED}'),
        ('${RUNNING}', 'f2', 'brotherhood', 'use_existing', null, '${CH.REREAP_PINNED}'),
        ('${PURGING}', 'd12', 'chapter', 'use_existing', null, '${CH.OTHERS_CREATED}'),
        ('${PURGING}', 'd14', 'recruitment', 'use_existing', null, '${CH.REREAP_PURGING}');
      -- What the purge leaves behind: a member's live message, a deleted one,
      -- another import's history, and a chat points adjustment whose card
      -- never posted.
      insert into chat_messages (channel_id, sender_id, content) values
        ('${CH.LIVE}', '${U}', 'posted after the import'),
        ('${CH.DELETED_MSG}', '${U}', '[message deleted]');
      update chat_messages set deleted_at = now() where channel_id = '${CH.DELETED_MSG}';
      insert into chat_messages (channel_id, content, kind, author_name, external_message_id, metadata) values
        ('${CH.OTHER_MSGS}', 'from the other import', 'imported', 'Pinstripe', '905', '{"discord_import_id":"${OTHER}"}');
      insert into point_transactions (chapter_id, user_id, amount, category, channel_id, client_message_id) values
        ('${A}', '${U}', 5, 'MANUAL', '${CH.POINTS}', 'client-2905');
    `);

    const wrongChapter = await q(
      `select * from delete_empty_discord_import_channels('${PURGING}', '${B}')`,
    );
    const notPurging = await q(
      `select * from delete_empty_discord_import_channels('${RUNNING}', '${A}')`,
    );
    check(
      "the wrong chapter id, or an import that isn't purging, deletes nothing",
      wrongChapter.length === 0 &&
        notPurging.length === 0 &&
        (await channelsLeft()).length === Object.keys(CH).length,
      { wrongChapter, notPurging },
    );

    const deleted = (
      await q(
        `select * from delete_empty_discord_import_channels('${PURGING}', '${A}') as id`,
      )
    )
      .map((r) => r.id)
      .sort();
    const left = await channelsLeft();
    check(
      "deletes exactly the created channels left empty, recorded or mapped, once each, and returns them",
      JSON.stringify(deleted) === JSON.stringify(DELETABLE) &&
        DELETABLE.every((id) => !left.includes(id)),
      { deleted, left },
    );
    check(
      "keeps a created channel holding a live message, a deleted one, or another import's messages",
      left.includes(CH.LIVE) &&
        left.includes(CH.DELETED_MSG) &&
        left.includes(CH.OTHER_MSGS),
      { left },
    );
    check(
      "keeps a created channel a points-ledger row points at",
      left.includes(CH.POINTS),
      { left },
    );
    check(
      "keeps a created channel an import that isn't deleted merged into, a finished one included, and a channel it merged into that no deleted import created",
      left.includes(CH.MERGED_INTO) &&
        left.includes(CH.EXISTING) &&
        left.includes(CH.OTHERS_CREATED),
      { left },
    );
    check(
      "a merge by a purging or purged import, this one included, pins nothing (#2922)",
      [CH.SELF_MERGED, CH.MERGED_BY_PURGED, CH.MERGED_BY_PURGING].every((id) =>
        deleted.includes(id),
      ),
      { deleted },
    );
    check(
      "re-reaps a channel a purged, or still purging, import created that this one merged into, unless a live import's merge still pins it (#2922)",
      deleted.includes(CH.REREAP) &&
        deleted.includes(CH.REREAP_PURGING) &&
        left.includes(CH.REREAP_PINNED),
      { deleted, left },
    );
    check(
      "keeps a channel a create_new row names that is older than the import, or lacks the worker's description (an upload mapped before #2859)",
      left.includes(CH.LEGACY) && left.includes(CH.LEGACY_NEWER),
      { left },
    );
    check(
      "keeps another chapter's channel, and a running import's channel",
      left.includes(CH.IN_B) && left.includes(CH.RUNNING_CH),
      { left },
    );
    const targets = await q(
      `select discord_channel_id, target_channel_id from discord_import_channels
        where (import_id = '${PURGING}' and discord_channel_id in ('d1', 'd2', 'd2-thread', 'd10', 'd11'))
           or (import_id = '${PURGED}' and discord_channel_id = 'g1')
           or (import_id = '${OTHER_PURGING}' and discord_channel_id = 'h1')
        order by 1`,
    );
    const records = await q(
      `select count(*)::int as n from discord_import_created_channels where channel_id in (${DELETABLE.map((id) => `'${id}'`).join(", ")})`,
    );
    check(
      "the mapping rows keep their record with the target cleared, and the created-channel records go",
      targets.length === 7 &&
        targets.every((r) => r.target_channel_id === null) &&
        records[0]?.n === 0,
      { targets, records },
    );
    const again = await q(
      `select * from delete_empty_discord_import_channels('${PURGING}', '${A}')`,
    );
    check("a second call deletes nothing more", again.length === 0, { again });

    // Both client roles exist here, so each is checked directly. That catches
    // a revoke from PUBLIC going missing and an explicit grant to either role.
    // It cannot catch a forgotten `revoke ... from anon` or `from
    // authenticated`: hosted grants both through ALTER DEFAULT PRIVILEGES,
    // which is not replayed here (see the can_read_chat_message() EXECUTE
    // assertion). docs/ops/database/promotion-log.md checks `authenticated` for these two
    // functions at promotion, but not `anon` (#3052).
    const guard = await q(`
      select has_function_privilege('authenticated', 'public.delete_empty_discord_import_channels(uuid, uuid)', 'execute') as authed,
             has_function_privilege('authenticated', 'public.discord_import_channel_holds_anything(uuid, uuid)', 'execute') as authed_check,
             has_function_privilege('anon', 'public.delete_empty_discord_import_channels(uuid, uuid)', 'execute') as anon,
             has_function_privilege('anon', 'public.discord_import_channel_holds_anything(uuid, uuid)', 'execute') as anon_check,
             (select relrowsecurity from pg_class where oid = 'public.discord_import_created_channels'::regclass) as rls,
             (select count(*)::int from pg_indexes
               where indexname in ('idx_point_transactions_channel', 'idx_discord_import_channels_target')) as indexes
    `);
    check(
      "neither a signed-in client nor the anon key may call either function, the created-channel table has RLS on, and both indexes exist",
      guard[0]?.authed === false &&
        guard[0]?.authed_check === false &&
        guard[0]?.anon === false &&
        guard[0]?.anon_check === false &&
        guard[0]?.rls === true &&
        guard[0]?.indexes === 2,
      guard[0],
    );
  } catch (e) {
    check(
      "emptied import channels scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      missing += 1;
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`,
      );
    }
  }
}

// ─── Functional: a channel an import merged into can be deleted (#2922) ─────
//
// `discord_import_channels.target_channel_id` is `on delete set null`, but
// `discord_import_channels_target_present` required a target on every
// `use_existing` row, so deleting any channel an import had merged into failed
// the CHECK and rolled back (`DELETE /v1/channels/:id` answered 500). Proved
// against the real schema:
//
//   - an officer's delete of a channel two imports merged into (one finished,
//     one still running) succeeds, and both mapping rows keep their record
//     with the target cleared;
//   - `discord_import_channels_new_name_present` still refuses a `create_new`
//     row with no name, and the old constraint is gone;
//   - the database accepts a `use_existing` row with no target: the mapping
//     routes and `start` refuse one, and the worker stops on one.
//
// Everything runs inside one transaction and is rolled back.
console.log(
  "\n=== Functional: a channel an import merged into can be deleted (#2922) ===",
);
{
  const A = "a2922000-0000-4000-8000-00000000000a";
  const GENERAL = "a2922000-0000-4000-8000-0000000000c1";
  const DONE = "a2922000-0000-4000-8000-0000000000d1";
  const LIVE = "a2922000-0000-4000-8000-0000000000d2";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const q = async (sql) => (await db.query(sql)).rows;
  // Postgres aborts the transaction on an error, so each refusal runs under
  // its own savepoint and is rolled back to it.
  const refused = async (sql) => {
    await db.exec("savepoint p2922;");
    try {
      await db.exec(sql);
      return null;
    } catch (e) {
      return String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p2922;");
    }
  };

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U');
      insert into chat_channels (id, chapter_id, name, type) values ('${GENERAL}', '${A}', 'general', 'PUBLIC');
      insert into discord_imports (id, chapter_id, status, consent_acknowledged_at) values
        ('${DONE}', '${A}', 'completed', now()),
        ('${LIVE}', '${A}', 'running', now());
      insert into discord_import_channels
        (import_id, discord_channel_id, discord_channel_name, mapping_action, target_channel_id) values
        ('${DONE}', 'x1', 'general', 'use_existing', '${GENERAL}'),
        ('${LIVE}', 'y1', 'general', 'use_existing', '${GENERAL}');
    `);

    const deleteError = await refused(
      `delete from chat_channels where id = '${GENERAL}';`,
    );
    check(
      "an officer's delete of a channel two imports merged into succeeds",
      deleteError === null,
      { deleteError },
    );

    await db.exec(`delete from chat_channels where id = '${GENERAL}';`);
    const rows = await q(
      `select import_id, mapping_action, target_channel_id from discord_import_channels
        where import_id in ('${DONE}', '${LIVE}') order by import_id`,
    );
    check(
      "both mapping rows keep their record, still merges, with the target cleared",
      rows.length === 2 &&
        rows.every(
          (r) =>
            r.mapping_action === "use_existing" && r.target_channel_id === null,
        ),
      { rows },
    );

    const unnamed = await refused(`
      insert into discord_import_channels (import_id, discord_channel_id, discord_channel_name, mapping_action)
      values ('${DONE}', 'x2', 'rush', 'create_new');
    `);
    const untargeted = await refused(`
      insert into discord_import_channels (import_id, discord_channel_id, discord_channel_name, mapping_action)
      values ('${DONE}', 'x3', 'rush', 'use_existing');
    `);
    const constraints = await q(`
      select conname from pg_constraint
       where conrelid = 'public.discord_import_channels'::regclass
         and conname in ('discord_import_channels_target_present', 'discord_import_channels_new_name_present')
    `);
    check(
      "a create_new row still needs its name, a use_existing row may have no target, and the old CHECK is gone",
      /discord_import_channels_new_name_present/.test(unnamed ?? "") &&
        untargeted === null &&
        constraints.length === 1 &&
        constraints[0].conname === "discord_import_channels_new_name_present",
      { unnamed, untargeted, constraints },
    );
  } catch (e) {
    check(
      "merged-into channel delete scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      missing += 1;
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`,
      );
    }
  }
}

console.log(
  "\n=== Functional: one 1:1 DM per chapter and member pair (#2788) ===",
);
{
  // The pair index is the whole fix: the API's createDm relies on its 23505 to
  // hand a racing call the DM that won, and every unit suite mocks the
  // repository. So this is the CI-run proof that the index and the CHECK exist
  // and mean what they say (the live-PostgREST race test,
  // apps/api/test/integration/chat-dm-pair.integration-spec.ts, isn't run in CI).
  const A = "a2788000-0000-4000-8000-00000000000a";
  const B = "a2788000-0000-4000-8000-00000000000b";
  const LOW = "a2788000-0000-4000-8000-000000000001";
  const HIGH = "a2788000-0000-4000-8000-000000000002";
  const THIRD = "a2788000-0000-4000-8000-000000000003";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  // Postgres aborts the transaction on an error, so each attempt runs under
  // its own savepoint and is rolled back to it.
  const refused = async (sql) => {
    await db.exec("savepoint p2788;");
    try {
      await db.exec(sql);
      return null;
    } catch (e) {
      return String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p2788;");
    }
  };
  const dm = (chapter, name, members, type = "DM") =>
    `insert into chat_channels (chapter_id, name, type, member_ids)
     values ('${chapter}', '${name}', '${type}', ${members === null ? "null" : `'{${members.join(",")}}'`});`;

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      ${dm(A, `dm-${LOW}-${HIGH}`, [LOW, HIGH])}
    `);

    const reversedRenamed = await refused(
      dm(A, "renamed by an officer", [HIGH, LOW]),
    );
    check(
      "a second DM for the pair is refused, whatever its member order or name",
      /chat_channels_dm_pair_key/.test(reversedRenamed ?? ""),
      { reversedRenamed },
    );

    const otherChapter = await refused(dm(B, `dm-${LOW}-${HIGH}`, [LOW, HIGH]));
    const groupDms = await refused(
      dm(A, "group one", [LOW, HIGH], "GROUP_DM") +
        dm(A, "group two", [LOW, HIGH], "GROUP_DM"),
    );
    check(
      "the same pair may have a DM in another chapter, and group DMs are untouched",
      otherChapter === null && groupDms === null,
      { otherChapter, groupDms },
    );

    const one = await refused(dm(A, "one", [THIRD]));
    const three = await refused(dm(A, "three", [LOW, HIGH, THIRD]));
    const none = await refused(dm(A, "none", null));
    check(
      "a DM without exactly two members is refused",
      [one, three, none].every((e) =>
        /chat_channels_dm_two_members/.test(e ?? ""),
      ),
      { one, three, none },
    );
  } catch (e) {
    check(
      "one-DM-per-pair scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      missing += 1;
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`,
      );
    }
  }
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
