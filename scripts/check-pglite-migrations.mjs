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
//   - ENFORCEMENT, black-box — a non-owner `rls_probe` role with `auth.uid()`
//     and `auth.role()` stubbed to a signed-in client reads the tables for
//     real. Positive sets for `chat_messages` / `chat_message_actions`, which
//     carry client-reachable policies; zero-row denial for `members` and
//     `financial_invoices`, which carry none (#423). Posture alone cannot see
//     a policy whose predicate is wrong but whose shape is fine.
//
// Out of reach: Realtime, Presence, and GoTrue with real JWTs — the enforcement
// tier stubs the two `auth.*` functions rather than minting a token, so claims
// beyond `sub` and `role` are not exercised here. That half stays with the
// NestJS Jest tier. See `docs/internal/ci-cd/AGENT_INFRA.md` ("Agent dev
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
// through a non-owner role that is granted `authenticated`. So this file does
// verify enforcement, not only presence — what stays with the NestJS Jest tier
// is a real GoTrue-minted JWT (claims beyond `sub`/`role`), per ADR-11/ADR-12.
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid()  returns uuid language sql as $$ select null::uuid $$;
  create or replace function auth.role() returns text language sql as $$ select 'service_role'::text $$;
  create or replace function auth.jwt()  returns jsonb language sql as $$ select '{}'::jsonb $$;
`);

// Stand up the `authenticated` role BEFORE applying migrations. ~18 migrations
// wrap policy and grant statements in `if exists (select 1 from pg_roles where
// rolname = 'authenticated')` — the repo's dominant idiom for anything that
// targets a client role, because the role exists on hosted Supabase but not in
// a bare Postgres. Without the role here, every one of those blocks is skipped
// silently, so the harness validates a schema the hosted project does not run.
//
// That was a live false-PASS, not a theoretical one: a permissive
// `create policy ... to authenticated using (true)` written in that idiom left
// this entire script green while handing every signed-in client every row of
// the table. Creating the role is what makes the black-box tiers below see the
// policies they exist to check, and it exercises the `to authenticated` clause
// itself (`v_role_clause`), which previously was never applied here.
await db.exec("create role authenticated nologin;");

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
    // Every sweep in `modules/scheduled-jobs` dedups by inserting here, so a
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
      const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
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
    // `SearchService`. They enumerate columns rather than `select('*')` so the
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
    name: "SearchService select lists cover every column of events + backwork_resources",
    sql: `select table_name, string_agg(column_name, ', ' order by ordinal_position) as cols
            from information_schema.columns
           where table_schema = 'public'
             and table_name in ('events', 'backwork_resources')
             and column_name <> 'search_vector'
           group by table_name`,
    ok: (rows) => {
      const source = readFileSync(
        join(REPO_ROOT, "apps/api/src/application/services/search.service.ts"),
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
          const extra = got.split(",").filter((c) => !want.split(",").includes(c));
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
        : ((String(cfg ?? "").replace(/^\{|\}$/g, "").match(/"(?:[^"\\]|\\.)*"|[^,]+/g) ?? []).map(
            (it) => it.trim().replace(/^"|"$/g, "").replace(/\\"/g, '"'),
          ));
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
    console.log("OK    every public table enables RLS (default-deny invariant)");
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
// `AUTHORIZATION_MODEL.md` §4 heads its table "The policies that do exist (N
// statements)". That number had drifted and was reconciled by hand, which is
// precisely why it drifted again: nothing re-checked it. This checks it against
// the catalog.
//
// The counting convention, written down because ambiguity was the actual defect:
// **N counts individual policy statements — rows in `pg_policies` — not rows in
// the doc's table**, several of which name two policies each.
//
// PGlite legitimately sees fewer than a hosted project, and every one of the
// three absences is role- or schema-gated rather than a defect:
//   - `users.auth_admin_can_read_users` and `members.auth_admin_can_read_members`
//     are created inside `if exists (select 1 from pg_roles where rolname =
//     'supabase_auth_admin')` (20260802120000_active_chapter_jwt_claim.sql:137),
//     and that role does not exist here.
//   - `realtime.messages.realtime_messages_scoped_select` lives in the `realtime`
//     schema, which PGlite does not have at all.
// So: 8 in `public` here; 11 hosted (10 in `public` + 1 in `realtime`). The
// printed hosted figure is derived from this list + those 3, so it cannot
// silently contradict itself the way a second hardcoded literal would.
//
// Asserted as an exact SET rather than a count: a bare count lets a dropped
// policy be masked by an added one, which is the failure mode that matters — a
// silently removed policy widens access without changing the total.
{
  const EXPECTED_PUBLIC_POLICIES = [
    "chapter_audit_log.audit_log_no_delete [DELETE]",
    "chapter_audit_log.audit_log_no_update [UPDATE]",
    "chat_message_actions.chat_message_actions_delete [DELETE]",
    "chat_message_actions.chat_message_actions_insert [INSERT]",
    "chat_message_actions.chat_message_actions_select [SELECT]",
    "chat_messages.chat_messages_select [SELECT]",
    "chat_notification_preferences.chat_notification_preferences_select_own [SELECT]",
    // FOR ALL, so an in-place rewrite here would widen writes as well as reads —
    // which is why the unconditional check below matters most for this one.
    "member_custom_field_values.member_custom_field_values_service_role [ALL]",
  ];
  // `cmd` is part of the identity, not decoration: flipping a policy from SELECT
  // to ALL widens it to writes while the name set is unchanged.
  const res = await db.query(
    `select tablename, policyname, cmd, permissive,
            coalesce(qual, '') as qual,
            coalesce(with_check, '') as with_check
       from pg_policies
      where schemaname = 'public'
      order by tablename, policyname`,
  );
  const got = res.rows.map((r) => `${r.tablename}.${r.policyname} [${r.cmd}]`);
  const added = got.filter((p) => !EXPECTED_PUBLIC_POLICIES.includes(p));
  const removed = EXPECTED_PUBLIC_POLICIES.filter((p) => !got.includes(p));

  // A name-and-cmd set still cannot see a policy REWRITTEN in place, and two of
  // these eight have no other coverage anywhere in the repo
  // (`chat_notification_preferences_select_own`,
  // `member_custom_field_values_service_role`). Dropping and recreating one with
  // `using (true)` under the same name would keep the set identical and hand
  // every row to any authenticated PostgREST client. None of the eight is
  // unconditional today, so assert that directly.
  // BOTH halves, deliberately. `qual` governs reads (and the row a write may
  // target); `with_check` governs what a write may create. A FOR INSERT policy
  // like `chat_message_actions_insert` has a NULL `qual` and carries its entire
  // predicate in `with_check`, so a qual-only check can never fire for it — and
  // on the FOR ALL policy it is `with_check` that gates the write path. Reading
  // only `qual` would leave the write side of both entirely unpinned.
  //
  // This is a tripwire for the obvious rewrite, not a proof: it catches the
  // literal tautologies, and an adversarial `using (id = id)` would still pass.
  // It exists because two of these eight have no other coverage anywhere in the
  // repo (`chat_notification_preferences_select_own`,
  // `member_custom_field_values_service_role`).
  const TAUTOLOGY = /^\s*\(*\s*(true|1\s*=\s*1)\s*\)*\s*$/i;
  const unconditional = res.rows
    .filter(
      (r) =>
        r.permissive === "PERMISSIVE" &&
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
      "MISS  public policy inventory drifted from AUTHORIZATION_MODEL.md §4" +
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
      `OK    public policy inventory matches AUTHORIZATION_MODEL.md §4 (${got.length} here, ${EXPECTED_PUBLIC_POLICIES.length + 3} hosted)`,
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
    console.log("OK    change-ping tables accept writes with no `realtime` schema");

    const warnings = notices.filter((n) => n.severity === "WARNING");
    const pingTables = ["notifications", "events", "event_attendance"];
    // Exact count, not merely "at least one": each table's trigger fires
    // once for this transaction (one INSERT each), so a table reporting
    // zero or more than one WARNING is itself a regression worth catching
    // — e.g. a future migration accidentally double-registering a trigger.
    const counts = Object.fromEntries(
      pingTables.map((t) => [
        t,
        warnings.filter((n) => new RegExp(`ping trigger failed for ${t}\\b`).test(n.message ?? "")).length,
      ]),
    );
    const wrongCount = pingTables.filter((t) => counts[t] !== 1);
    if (wrongCount.length === 0) {
      console.log("OK    each swallowed realtime.send failure raised exactly one observable WARNING");
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
  insert into chat_channels (id, chapter_id, name, type, member_ids, required_permissions) values
    ('${F.chPublic}',        '${F.chapA}', 'public',     'PUBLIC',     null,              null),
    ('${F.chPrivate}',       '${F.chapA}', 'private',    'PRIVATE',    '{${F.userAId}}',  null),
    ('${F.chDM}',            '${F.chapA}', 'dm',         'DM',         '{${F.userAId}}',  null),
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
      -- Mirrors the request context of a signed-in Supabase client. The
      -- authenticated role is created before the migrations apply, so the TO
      -- clause is real here and rls_probe inherits it via the grant above;
      -- the qual is then what decides visibility.
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
      { name: "member sees every action row in channels they can read (all but the empty-gated one)", uid: F.userAAuth,
        visible: [F.msgPublic, F.msgPrivate, F.msgDM, F.msgRoleGated, F.msgGroupDM] },
      { name: "cross-chapter reader sees only their own chapter's row (tenant boundary holds at the table)", uid: F.userBAuth,
        visible: [F.msgPublicB] },
      { name: "chapter member sees only PUBLIC, not PRIVATE/DM/gated (incl. empty-gated)", uid: F.userCAuth,
        visible: [F.msgPublic] },
      { name: "no JWT (null auth.uid()) sees nothing", uid: null, visible: [] },
    ];

    for (const s of BLACKBOX) {
      await db.exec(
        s.uid === null
          ? `create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;`
          : `create or replace function auth.uid() returns uuid language sql as $$ select '${s.uid}'::uuid $$;`,
      );
      await db.exec("set role rls_probe;");
      let seen;
      try {
        const res = await db.query(
          `select message_id::text as id from public.chat_message_actions`,
        );
        seen = res.rows.map((r) => r.id);
      } finally {
        // Never let this replace a pending exception by raising 25P02 on an
        // aborted transaction.
        try {
          await db.exec("reset role;");
        } catch {
          /* keep the original error */
        }
      }
      const want = [...s.visible].sort();
      const got = [...seen].sort();
      const leaked = got.filter((g) => !want.includes(g));
      const absent = want.filter((w) => !got.includes(w));
      if (leaked.length === 0 && absent.length === 0) {
        console.log(`OK    ${s.name}`);
      } else {
        missing += 1;
        console.log(
          `MISS  ${s.name}` +
            (leaked.length ? `\n        ↳ LEAKED: ${leaked.map(label).join(", ")}` : "") +
            (absent.length ? `\n        ↳ wrongly hidden: ${absent.map(label).join(", ")}` : ""),
        );
      }
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
        uid: F.userAAuth,
        visible: [F.msgPublic, F.msgPrivate, F.msgDM, F.msgRoleGated, F.msgGroupDM],
      },
      {
        // The positive control is what makes this assertion mean anything. userB
        // is a real, functioning reader — it sees its OWN chapter's PUBLIC
        // message — and still sees none of chapter A's six. Without that half,
        // "sees zero of chapter A" is equally satisfied by a uuid belonging to
        // nobody, and the tenant boundary is never actually exercised.
        who: "cross-chapter member (sees only their own chapter)",
        uid: F.userBAuth,
        visible: [F.msgPublicB],
      },
      {
        who: "chapter member with no privileges, in no member list",
        uid: F.userCAuth,
        visible: [F.msgPublic],
      },
      {
        // The case the sibling tier never exercises black-box, and the sharpest
        // one: permission and membership are independent axes. '*' grants both
        // ROLE_GATED channels (including the empty-requirement one) and still
        // must not grant PRIVATE / DM / GROUP_DM, which gate on member_ids.
        who: "chapter member holding the '*' wildcard, in no member list",
        uid: F.userDAuth,
        visible: [F.msgPublic, F.msgRoleGated, F.msgRoleGatedOpen],
      },
      { who: "no JWT (null auth.uid())", uid: null, visible: [] },
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
      const name = "the message fixtures are the whole table (set assertions below are table-wide)";
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
      // A mistyped `F.` key yields undefined, which would interpolate the string
      // 'undefined'::uuid and read as a denial — a scenario that silently tests
      // nothing. Fail loudly instead.
      if (s.uid !== null && typeof s.uid !== "string") {
        throw new Error(`MSG_BLACKBOX scenario "${s.who}" has a non-fixture uid`);
      }
      await db.exec(
        s.uid === null
          ? `create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;`
          : `create or replace function auth.uid() returns uuid language sql as $$ select '${s.uid}'::uuid $$;`,
      );
      await db.exec("set role rls_probe;");
      let seen;
      try {
        const res = await db.query(
          `select id::text as id from public.chat_messages
            where id in (${ALL_MSG_IDS.map((m) => `'${m}'`).join(", ")})`,
        );
        seen = res.rows.map((r) => r.id);
      } finally {
        // Never let this replace a pending exception. These run inside the open
        // transaction, so a failed query aborts it and `RESET ROLE` then raises
        // 25P02 — which would surface instead of the real cause and collapse the
        // whole tier into one uninformative ERR.
        try {
          await db.exec("reset role;");
        } catch {
          /* keep the original error */
        }
      }

      const want = [...s.visible].sort();
      const got = [...seen].sort();
      const leaked = got.filter((g) => !want.includes(g));
      const absent = want.filter((w) => !got.includes(w));

      if (leaked.length === 0 && absent.length === 0) {
        console.log(
          `OK    ${s.who} reads exactly ${want.length}/${ALL_MSG_IDS.length} (${want.map(label).join(", ") || "nothing"})`,
        );
      } else {
        missing += 1;
        console.log(
          `MISS  ${s.who} reads the wrong set of chat_messages` +
            (leaked.length ? `\n        ↳ LEAKED: ${leaked.map(label).join(", ")}` : "") +
            (absent.length ? `\n        ↳ wrongly hidden: ${absent.map(label).join(", ")}` : ""),
        );
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
        // See the note on the chat_messages tier: never let this replace a
        // pending exception by raising 25P02 on an aborted transaction.
        try {
          await db.exec("reset role;");
        } catch {
          /* keep the original error */
        }
      }
      if (got === s.expect) {
        console.log(`OK    ${s.name}`);
      } else {
        missing += 1;
        console.log(`MISS  ${s.name}\n        ↳ expected ${s.expect} visible row(s), got ${got}`);
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
    // row it leaks does not exist yet when those run. So re-check the two
    // readers that must see nothing of another tenant, now that it does.
    // Exact sets over the WHOLE table, matching the membership tier — a count
    // can be right for the wrong reason (a policy hiding chapterB/PUBLIC from
    // userB while exposing one imported row keeps the total at 1).
    const POST_ARCHIVE = [
      { who: "no JWT (null auth.uid())", uid: null, visible: [] },
      {
        who: "cross-chapter member",
        uid: F.userBAuth,
        visible: [F.msgPublicB], // their own chapter's PUBLIC message, nothing else
      },
    ];
    const postLabel = (id) => (id === IMPORTED_MSG ? "IMPORTED" : label(id));
    for (const s of POST_ARCHIVE) {
      await db.exec(
        s.uid === null
          ? `create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;`
          : `create or replace function auth.uid() returns uuid language sql as $$ select '${s.uid}'::uuid $$;`,
      );
      await db.exec("set role rls_probe;");
      let seen;
      try {
        const res = await db.query(
          `select id::text as id from public.chat_messages`,
        );
        seen = res.rows.map((r) => r.id);
      } finally {
        try {
          await db.exec("reset role;");
        } catch {
          /* keep the original error */
        }
      }
      const want = [...s.visible].sort();
      const got = [...seen].sort();
      const leaked = got.filter((g) => !want.includes(g));
      const absent = want.filter((w) => !got.includes(w));
      const name = `${s.who} still reads exactly ${want.length} row(s) once an imported archive row exists`;
      if (leaked.length === 0 && absent.length === 0) {
        console.log(`OK    ${name}`);
      } else {
        missing += 1;
        console.log(
          `MISS  ${name}` +
            (leaked.length ? `\n        ↳ LEAKED: ${leaked.map(postLabel).join(", ")}` : "") +
            (absent.length ? `\n        ↳ wrongly hidden: ${absent.map(postLabel).join(", ")}` : ""),
        );
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

    // ─── members / financial_invoices: default-deny enforcement (#423) ───────
    //
    // The two tiers above cover the tables that carry a client-reachable
    // policy. These two carry none, and that is the point rather than a gap:
    //
    //   - `financial_invoices` has no policy anywhere in the tree.
    //   - `members`' only policy, `auth_admin_can_read_members`, is
    //     `to supabase_auth_admin` and is not even created here — it sits
    //     inside an `if exists (... rolname = 'supabase_auth_admin')` guard and
    //     that role does not exist under PGlite. See the policy-inventory note
    //     earlier in this file, which already records the same three absences.
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
    console.log("\n=== members / financial_invoices default-deny (black-box, SET ROLE) ===");
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
      await db.exec("rollback to savepoint deny_seed; release savepoint deny_seed;");
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
      { who: "a chapter-A member reading their own chapter", uid: F.userAAuth },
      { who: "a chapter-B member (cross-tenant)", uid: F.userBAuth },
      { who: "a chapter-A member holding the '*' wildcard", uid: F.userDAuth },
      // A real anon reader: null uid AND auth.role() = 'anon'. Stubbing only
      // the uid would leave this indistinguishable from a signed-in reader,
      // which is how an `auth.role() = 'anon'` policy stays invisible.
      { who: "an anonymous reader (no JWT, auth.role() = 'anon')", uid: null },
    ];

    // Asserted once, before any table: every `reads 0 rows` line below is only
    // meaningful because `rls_probe` is a MEMBER of `authenticated`. Without
    // that membership a `to authenticated` policy simply does not bind the
    // probe, so the read is answered by default-deny and the assertion passes
    // while testing nothing. Today that membership is also load-bearing for the
    // chat visibility sets, which would fail loudly — but this tier must not
    // borrow its validity from another tier's failure.
    {
      const name = "rls_probe is a member of authenticated (so `to authenticated` policies bind it)";
      const res = await db.query(
        `select pg_has_role('rls_probe', 'authenticated', 'member') as ok`,
      );
      if (res.rows[0].ok === true) {
        console.log(`OK    ${name}`);
      } else {
        missing += 1;
        console.log(`MISS  ${name}\n        ↳ every deny assertion below is vacuous for such a policy`);
      }
    }

    for (const table of denySeeded ? DENY_TABLES : []) {
      // Both guards below `continue` on failure rather than falling through.
      // Printing four confident `OK ... reads 0 rows` lines underneath a MISS
      // that just declared them meaningless is worse than printing nothing:
      // `missing` goes up either way, but anyone reading the log — or grepping
      // it for the deny assertions — sees green on a property never tested.
      const privileged = await db.query(
        `select has_table_privilege('rls_probe', 'public.${table}', 'select') as ok`,
      );
      const privName = `rls_probe holds SELECT on ${table} (so a zero-row read means RLS, not a missing grant)`;
      if (privileged.rows[0].ok !== true) {
        missing += 1;
        console.log(`MISS  ${privName}\n        ↳ skipping ${table}: its deny assertions would pass vacuously`);
        continue;
      }
      console.log(`OK    ${privName}`);

      const seeded = await db.query(
        `select count(*)::int as n from public.${table} where chapter_id in ${FIXTURE_CHAPTERS}`,
      );
      const seedName = `${table} holds fixture rows as owner (the deny below has something to deny)`;
      if (seeded.rows[0].n < 1) {
        missing += 1;
        console.log(`MISS  ${seedName}\n        ↳ skipping ${table}: 0 rows, so denying them proves nothing`);
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
      // command. `supabase_auth_admin` is excluded: it is a Supabase-internal
      // role, not a client, and `members` legitimately carries one such policy
      // on hosted projects.
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
            and roles <> '{supabase_auth_admin}'`,
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
        // A mistyped `F.` key yields undefined, which would interpolate
        // 'undefined'::uuid and read as a denial — a scenario that silently
        // tests nothing. Same guard the message tier carries.
        if (s.uid !== null && typeof s.uid !== "string") {
          throw new Error(`DENY_READERS scenario "${s.who}" has a non-fixture uid`);
        }
        // `auth.role()` is varied with the identity, not left at the tier-wide
        // 'authenticated'. Without this the "no JWT" scenario is not an
        // unauthenticated reader at all — it is a signed-in reader who happens
        // to have a null uid, so a policy spelled `using (auth.role() =
        // 'anon')` reads as default-deny here and hands the table to every
        // unauthenticated PostgREST client in production.
        await db.exec(
          s.uid === null
            ? `create or replace function auth.uid()  returns uuid language sql as $$ select null::uuid $$;
               create or replace function auth.role() returns text language sql as $$ select 'anon'::text $$;`
            : `create or replace function auth.uid()  returns uuid language sql as $$ select '${s.uid}'::uuid $$;
               create or replace function auth.role() returns text language sql as $$ select 'authenticated'::text $$;`,
        );
        // Each read gets its own savepoint. A policy that references a table
        // the probe cannot read raises `permission denied` rather than
        // returning rows, and an error inside the open transaction poisons it
        // (25P02) for everything after — which would collapse this whole tier
        // into one uninformative ERR and skip every later scenario. This is not
        // hypothetical: a tenant-scoped policy spelled
        // `chapter_id in (select id from public.chapters)` does exactly that.
        // Rolling back to the savepoint keeps the transaction usable, so each
        // scenario reports its own verdict.
        await db.exec("savepoint deny_probe;");
        await db.exec("set role rls_probe;");
        let seen;
        let failure = null;
        try {
          const res = await db.query(`select count(*)::int as n from public.${table}`);
          seen = res.rows[0].n;
        } catch (e) {
          failure = String(e?.message ?? e).split("\n")[0];
        } finally {
          try {
            await db.exec("reset role;");
          } catch {
            /* the savepoint rollback below is what actually recovers */
          }
          // Guarded like the `reset role` above, and for the same reason: a
          // throw raised in `finally` REPLACES the verdict the try/catch just
          // computed, collapsing this scenario and every one after it into the
          // single opaque outer ERR that the savepoints exist to prevent.
          //
          // `rollback to savepoint` does NOT destroy the savepoint (verified —
          // rolling back to the same name three times succeeds), so the error
          // branch must release it explicitly or every failing scenario leaves
          // another live subtransaction open inside the outer transaction.
          try {
            if (failure === null) {
              await db.exec("release savepoint deny_probe;");
            } else {
              await db.exec("rollback to savepoint deny_probe; release savepoint deny_probe;");
            }
          } catch (e) {
            failure ??= `savepoint cleanup failed: ${String(e?.message ?? e).split("\n")[0]}`;
          }
        }

        const name = `${table}: ${s.who} reads 0 rows`;
        if (failure !== null) {
          missing += 1;
          // Still a failure, not an excuse: the table is supposed to be
          // default-deny, and a policy that errors is a policy that exists.
          console.log(`MISS  ${name}\n        ↳ the read raised instead: ${failure}`);
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
