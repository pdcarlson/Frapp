import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./harness.mjs";

// ─── Schema landmark assertions ─────────────────────────────────────────────
//
// New landmarks added here when a chunk lands a structural invariant a future
// reviewer needs to confirm without spinning up Docker. Each is named for the
// behavior it pins, not the migration that introduced it — migrations rename
// over time, behaviors don't.

export const LANDMARKS = [
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
    // runtime, in production. That is precisely the class of thing this gate
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
    // The block rule (#2521). The behavioural tier in
    // `tiers/unread-counts-blocked-sender.mjs` proves what it does; this pins that the function still consults the
    // caller's block list at all, so a re-create copied from an older body
    // fails here by name.
    name: "get_channel_unread_counts skips senders the caller blocked (#2521)",
    sql: `select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'get_channel_unread_counts'`,
    ok: (rows) =>
      rows.length === 1 &&
      /not\s+exists\s*\(\s*select\s+1\s+from\s+chat_member_blocks/i.test(rows[0].prosrc ?? "") &&
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
    ok: (rows) =>
      rows.length === 1 && rows[0].display_name === "Frapp System",
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
