// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  CHANGE_EVENT,
  CHANGE_TOPIC_BUILDERS,
  changeTopic,
  type ChangeTable,
} from "./change-topics";

/**
 * Pins the database → client change-ping contract.
 *
 * The other half is SQL: three trigger functions build these same topics, nine
 * statement-level triggers fire them, and `realtime_messages_scoped_select`
 * authorises them by prefix. Drift between the halves does not fail loudly —
 * the channel still joins and still reports `SUBSCRIBED`, it simply never
 * receives anything, which is indistinguishable from "nothing has changed yet".
 * That silent-success failure mode is exactly what left every
 * `postgres_changes` subscription dead in production for months before #867
 * pinned it down, so it gets a test rather than a comment.
 *
 * It checks what the migrations leave IN EFFECT by applying every
 * `supabase/migrations/*.sql`, in order, to an in-process Postgres (PGlite),
 * then reading the catalogs and driving the objects. `20260816140000_realtime_
 * carrier_repair.sql` first wrote these objects and later migrations re-create
 * several (#2593). An earlier version of this test read that one file's text,
 * and a text reader can't keep up with SQL: guards, CASCADE, routine lists,
 * `format()`, block comments and extra permissive policies each slipped past a
 * regex. Postgres resolves all of them itself.
 *
 * PGlite has no `realtime` schema, so {@link SUBSTRATE} stands up the three
 * pieces the contract touches, each with Supabase's own signature:
 * `realtime.messages` (RLS on), `realtime.topic()` (reads the `realtime.topic`
 * setting, as Supabase's does) and `realtime.send()` (records its arguments
 * here instead of broadcasting).
 *
 * If this fails, change the other half to match; do not edit the expectation.
 * On the SQL side that is always a NEW migration, never an edit to a shipped
 * one: `supabase db push` skips a version a hosted database already applied,
 * so the edit never reaches staging or production. This test replays files,
 * not those databases, so it can't see that happen (#2751).
 */

const MIGRATIONS_DIR = join(__dirname, "../../../../supabase/migrations");

/**
 * What a hosted Supabase database has before the first migration, reduced to
 * what the migrations and these checks need. The `auth.*` stubs mirror
 * `scripts/check-pglite-migrations.mjs`. The `authenticated` role must exist
 * before the migrations run, because most of them grant or create policies
 * only `if exists (select 1 from pg_roles where rolname = 'authenticated')`.
 */
const SUBSTRATE = `
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.role() returns text language sql stable
    as $$ select 'authenticated'::text $$;
  create function auth.jwt() returns jsonb language sql stable
    as $$ select '{}'::jsonb $$;
  create role authenticated nologin;

  create schema realtime;
  create table realtime.messages (
    id bigserial primary key,
    topic text not null,
    extension text not null default 'broadcast',
    event text,
    payload jsonb,
    private boolean not null default true
  );
  alter table realtime.messages enable row level security;
  grant usage on schema realtime to authenticated;
  grant select, insert on realtime.messages to authenticated;
  create function realtime.topic() returns text language sql stable
    as $$ select nullif(current_setting('realtime.topic', true), '') $$;
  create table realtime.sent (payload jsonb, event text, topic text, private boolean);
  create function realtime.send(
    payload jsonb, event text, topic text, private boolean default true
  ) returns void language sql
    as $$ insert into realtime.sent values (payload, event, topic, private) $$;
`;

async function replayMigrations(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto, vector } });
  await db.waitReady;
  await db.exec(SUBSTRATE);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`${file} did not apply: ${String(error)}`);
    }
  }
  return db;
}

/**
 * Runs `body` in a transaction that is always rolled back, so each check and
 * each drift fixture sees the replayed schema and nothing another one did.
 */
async function rolledBack<T>(db: PGlite, body: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    return await body();
  } finally {
    await db.exec("rollback");
  }
}

/**
 * Per table: the column each ping is scoped by, and the function the policy
 * authorises that scope with. The scope id mirrors `change-topics.ts`'s notes.
 */
const SCOPES = {
  notifications: {
    column: "user_id",
    authorise: "realtime_can_read_user_scope",
  },
  events: {
    column: "chapter_id",
    authorise: "realtime_can_read_chapter_scope",
  },
  event_attendance: {
    column: "event_id",
    authorise: "realtime_can_read_event_scope",
  },
} satisfies Record<ChangeTable, { column: string; authorise: string }>;

const TABLES = Object.keys(SCOPES) as ChangeTable[];

/**
 * The ping function sends one private `change` ping per distinct scope, on
 * the client's topic.
 *
 * Driven, not read: a temp table carrying only the scope column gets a
 * statement-level trigger on the effective function, and three rows over two
 * scopes go in. A function that reads another column errors on the missing
 * column (its handler turns that into a warning and no pings); a wrong prefix
 * or event shows in the recorded topic; and `private` must be `true`, because
 * a non-private ping bypasses `realtime.messages` RLS and reaches any client
 * that guessed the topic string.
 */
async function checkPingFunction(db: PGlite, table: ChangeTable) {
  const fn = `public.realtime_notify_${table}()`;
  const exists = await db.query<{ oid: string | null }>(
    `select to_regprocedure($1)::text as oid`,
    [fn],
  );
  expect(exists.rows[0]?.oid, `${fn} exists`).not.toBeNull();

  const [a, b] = [randomUUID(), randomUUID()];
  const column = SCOPES[table].column;
  await db.exec(`
    create temp table ping_probe (${column} uuid);
    create trigger ping_probe after insert on pg_temp.ping_probe
      referencing new table as changed
      for each statement execute function ${fn};
    delete from realtime.sent;
  `);
  await db.query(`insert into ping_probe values ($1), ($1), ($2)`, [a, b]);
  const sent = await db.query<{
    event: string;
    topic: string;
    private: boolean;
  }>(`select event, topic, private from realtime.sent order by topic`);
  expect(sent.rows).toEqual(
    [a, b]
      .map((id) => changeTopic(table, id))
      .sort()
      .map((topic) => ({
        event: CHANGE_EVENT,
        topic,
        private: true,
      })),
  );
}

const TG = { ROW: 1, BEFORE: 2, INSERT: 4, DELETE: 8, UPDATE: 16, INSTEAD: 64 };
const OPS = [
  ["insert", TG.INSERT],
  ["update", TG.UPDATE],
  ["delete", TG.DELETE],
] as const;

/**
 * Every trigger that runs a ping function, in any schema, under any name: for
 * each table exactly one AFTER, STATEMENT-level, enabled trigger per insert,
 * update and delete, reading the transition table the function expects.
 *
 * Per-row turns one bulk write (markAutoAbsent inserts a row per member) into
 * N subtransactions, N broadcast frames on one topic, and 2N client
 * invalidations that each cancel the in-flight refetch. Statement level with
 * `select distinct` collapses it to one ping per scope. A second trigger on the
 * same op would double every ping, and a disabled one silences it.
 */
async function checkPingTriggers(db: PGlite) {
  const { rows } = await db.query<{
    table_schema: string;
    table_name: string;
    fn_schema: string;
    fn_name: string;
    tgtype: number;
    tgenabled: string;
    oldtable: string | null;
    newtable: string | null;
  }>(`
    select tn.nspname as table_schema, c.relname as table_name,
           pn.nspname as fn_schema, p.proname as fn_name,
           t.tgtype, t.tgenabled,
           t.tgoldtable as oldtable, t.tgnewtable as newtable
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace tn on tn.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and p.proname like 'realtime\\_notify\\_%'
  `);
  const found = rows
    .map((r) => {
      const ops = OPS.filter(([, bit]) => r.tgtype & bit).map(([op]) => op);
      const shape = [
        r.tgtype & TG.ROW ? "row" : "statement",
        r.tgtype & (TG.BEFORE | TG.INSTEAD) ? "before" : "after",
        r.tgenabled === "O" || r.tgenabled === "A" ? "enabled" : "disabled",
        r.newtable
          ? `new:${r.newtable}`
          : r.oldtable
            ? `old:${r.oldtable}`
            : "no-table",
      ].join(" ");
      return `${r.table_schema}.${r.table_name} ${ops.join("|")} → ${r.fn_schema}.${r.fn_name} (${shape})`;
    })
    .sort();
  expect(found).toEqual(
    TABLES.flatMap((table) =>
      OPS.map(
        ([op]) =>
          `public.${table} ${op} → public.realtime_notify_${table} (statement after enabled ${op === "delete" ? "old" : "new"}:changed)`,
      ),
    ).sort(),
  );
}

/**
 * `realtime_messages_scoped_select` lets a subscriber read a change topic
 * exactly when that topic's scope function says so, called with the id parsed
 * from the topic; every other topic is denied.
 *
 * Driven, not read. The three scope functions are swapped (inside the rolled-
 * back transaction) for stand-ins that log their call and return a chosen
 * answer, and a non-owner member of `authenticated` reads one
 * `realtime.messages` row per topic. So a policy that grants a prefix without
 * asking (`then true`, `or true`, an earlier catch-all arm, `else true`, a
 * second permissive policy), asks the wrong function, or reads the id from the
 * wrong offset (`substring(... from N)` is 1-indexed: the cast then raises on
 * every subscribe) all fail here. What the real scope functions decide is
 * theirs to pin, not this contract's.
 */
async function checkChangePolicy(db: PGlite) {
  const answers = new Map<string, string>();
  for (const { authorise } of Object.values(SCOPES)) {
    const arg = await db.query<{ name: string }>(
      `select (proargnames)[1] as name from pg_proc
       where oid = to_regprocedure('public.' || $1 || '(uuid)')`,
      [authorise],
    );
    expect(arg.rows[0]?.name, `public.${authorise}(uuid) exists`).toBeTruthy();
    answers.set(authorise, arg.rows[0]?.name as string);
  }
  await db.exec(`
    create temp table scope_calls (fn text, id uuid);
    create role rls_probe nologin;
    grant authenticated to rls_probe;
    insert into realtime.messages (topic) values ('any');
    ${[...answers]
      .map(
        ([fn, arg]) => `
    create or replace function public.${fn}(${arg} uuid) returns boolean
      language sql volatile security definer set search_path = pg_catalog, pg_temp
      as $$ insert into pg_temp.scope_calls values ('${fn}', ${arg})
            returning current_setting('test.scope_answer')::boolean $$;`,
      )
      .join("\n")}
  `);

  /** Rows the probe sees under `topic`, or the error the policy raised. */
  const read = async (topic: string, answer: boolean) => {
    await db.exec("savepoint probe; delete from scope_calls");
    try {
      await db.query(`select set_config('realtime.topic', $1, true)`, [topic]);
      await db.query(`select set_config('test.scope_answer', $1, true)`, [
        String(answer),
      ]);
      await db.exec("set local role rls_probe");
      const seen = await db.query<{ n: number }>(
        `select count(*)::int as n from realtime.messages`,
      );
      await db.exec("reset role");
      const calls = await db.query<{ fn: string; id: string }>(
        `select fn, id::text from scope_calls`,
      );
      return { visible: seen.rows[0]?.n, calls: calls.rows };
    } catch (error) {
      return { error: String(error) };
    } finally {
      await db.exec("rollback to savepoint probe; reset role");
    }
  };

  for (const table of TABLES) {
    const id = randomUUID();
    const topic = changeTopic(table, id);
    const call = [{ fn: SCOPES[table].authorise, id }];
    expect(await read(topic, true), `${topic} when its scope allows`).toEqual({
      visible: 1,
      calls: call,
    });
    expect(await read(topic, false), `${topic} when its scope denies`).toEqual({
      visible: 0,
      calls: call,
    });
    const prefix = changeTopic(table, "");
    for (const other of [
      `${prefix}not-a-uuid`,
      `${topic}x`,
      `x${topic}`,
      `${prefix}`,
    ]) {
      expect(await read(other, true), `${other} is not a change topic`).toEqual(
        {
          visible: 0,
          calls: [],
        },
      );
    }
  }
  expect(await read(`unknown:${randomUUID()}`, true)).toEqual({
    visible: 0,
    calls: [],
  });
}

/**
 * Chat is the opposite case: its subscriber consumes `payload.new`, so its two
 * tables need real replication plus a row-level policy, not a ping.
 * `chapter_audit_log` was the sixth dead subscription, and the only one outside
 * the browser: `ChatBridgeWorkerService` subscribes to its INSERTs with the
 * service-role client, which bypasses RLS, so publication membership is the
 * entire fix. Who may read a chat row is `check:pglite-migrations`' enforcement
 * tier's to prove; here it is only that one policy, gated on
 * `can_read_chat_message`, is the whole read path.
 */
const PUBLISHED_TABLES = [
  "chat_message_actions",
  "chat_messages",
  "chapter_audit_log",
];

async function checkPublication(db: PGlite) {
  const tables = await db.query<{ name: string }>(
    `select schemaname || '.' || tablename as name from pg_publication_tables
     where pubname = 'supabase_realtime'`,
  );
  expect(tables.rows.map((r) => r.name)).toEqual(
    expect.arrayContaining(PUBLISHED_TABLES.map((t) => `public.${t}`)),
  );
  const publishes = await db.query(
    `select pubinsert, pubupdate, pubdelete from pg_publication
     where pubname = 'supabase_realtime'`,
  );
  expect(publishes.rows).toEqual([
    { pubinsert: true, pubupdate: true, pubdelete: true },
  ]);

  const reads = await db.query<{ policyname: string; qual: string }>(
    `select policyname, qual from pg_policies
     where schemaname = 'public' and tablename = 'chat_messages'
       and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'ALL')`,
  );
  expect(reads.rows.map((r) => r.policyname)).toEqual(["chat_messages_select"]);
  expect(reads.rows[0]?.qual).toContain("can_read_chat_message(id)");
  expect(reads.rows[0]?.qual).not.toMatch(/\bOR\b/i);
}

let db: PGlite;

beforeAll(async () => {
  db = await replayMigrations();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("change-ping topic contract", () => {
  test("topic strings are exactly what the client expects", () => {
    expect(changeTopic("notifications", "u1")).toBe("notif:u1");
    expect(changeTopic("events", "c1")).toBe("events:c1");
    expect(changeTopic("event_attendance", "e1")).toBe("attendance:e1");
  });

  test("the event name is `change`", () => {
    expect(CHANGE_EVENT).toBe("change");
  });

  test("every table has exactly one builder and no extras creep in", () => {
    expect(Object.keys(CHANGE_TOPIC_BUILDERS).sort()).toEqual([
      "event_attendance",
      "events",
      "notifications",
    ]);
    expect([...TABLES].sort()).toEqual(
      Object.keys(CHANGE_TOPIC_BUILDERS).sort(),
    );
  });

  describe("the migrations, applied, build the same topics", () => {
    test.each(TABLES)(
      "%s: its ping function sends one private `change` ping per scope, on the client's topic",
      (table) => rolledBack(db, () => checkPingFunction(db, table)),
    );

    test("the ping triggers are the nine enabled statement-level ones and no others", () =>
      rolledBack(db, () => checkPingTriggers(db)));

    test("the RLS policy admits each change topic only through its own scope check", () =>
      rolledBack(db, () => checkChangePolicy(db)));

    test("chat and the audit log are published, and chat rows stay RLS-gated", () =>
      rolledBack(db, () => checkPublication(db)));
  });

  /**
   * Each case applies one more migration that breaks one side of the contract
   * and proves a check above fails on it, with an assertion rather than an
   * error, so a fixture that merely broke the SQL can't pass for one.
   */
  describe("a later migration that drifts fails the check", () => {
    const fails = async (fixture: string, check: () => Promise<void>) =>
      rolledBack(db, async () => {
        await db.exec(fixture);
        const error: unknown = await check().then(
          () => null,
          (e: unknown) => e,
        );
        expect(error, "the check passed on drifted SQL").not.toBeNull();
        expect((error as Error).name).toBe("AssertionError");
      });

    /** Replaces text that must be there, so a fixture can't pass vacuously. */
    const swap = (text: string, from: string | RegExp, to: string) => {
      const next = text.replace(from, to);
      expect(next, `fixture edit ${String(from)} matched nothing`).not.toBe(
        text,
      );
      return next;
    };
    const eventsFn = async () =>
      (
        await db.query<{ def: string }>(
          `select pg_get_functiondef('public.realtime_notify_events()'::regprocedure) as def`,
        )
      ).rows[0]?.def as string;
    const changePolicyQual = async () =>
      (
        await db.query<{ qual: string }>(
          `select qual from pg_policies where schemaname = 'realtime'
           and policyname = 'realtime_messages_scoped_select'`,
        )
      ).rows[0]?.qual as string;
    const recreatePolicy = (qual: string) => `
      drop policy "realtime_messages_scoped_select" on realtime.messages;
      create policy "realtime_messages_scoped_select" on realtime.messages
        for select to authenticated using (${qual});`;

    test.each([
      [
        "scopes by another column",
        "select distinct chapter_id",
        "select distinct user_id",
      ],
      ["renames the topic prefix", "'events:'", "'event:'"],
      ["sends the ping non-private", /,\s*true(\s*\))/, ", false$1"],
    ] as const)("a ping function that %s", async (_case, from, to) => {
      const fixture = swap(await eventsFn(), from, to);
      await fails(fixture, () => checkPingFunction(db, "events"));
    });

    test.each([
      [
        "drops a ping function with CASCADE, in a routine list",
        "drop routine if exists public.realtime_notify_events(), public.realtime_notify_notifications() cascade;",
      ],
      [
        "adds a per-row trigger with an unqualified target",
        `create trigger events_row_ping after insert on public.events
           for each row execute function realtime_notify_events();`,
      ],
      [
        "adds a quoted-name constraint trigger",
        `create constraint trigger "events_row_ping" after insert on public.events
           for each row execute function public.realtime_notify_events();`,
      ],
      [
        "disables every trigger on a table among other actions",
        "alter table public.events add column zz_probe int, disable trigger all;",
      ],
      [
        "re-creates the triggers per-row in a format() loop",
        `do $$ declare t text; begin
           foreach t in array array['notifications', 'events', 'event_attendance'] loop
             execute format('drop trigger if exists %I on public.%I', 'realtime_notify_' || t || '_ins', t);
             execute format('create trigger %I after insert on public.%I for each row execute function public.%I()',
                            'realtime_notify_' || t || '_ins', t, 'realtime_notify_' || t);
           end loop;
         end $$;`,
      ],
    ])("a migration that %s", (_case, fixture) =>
      fails(fixture, () => checkPingTriggers(db)),
    );

    test.each([
      ["reads the id from the wrong offset", "FROM 12)", "FROM 11)"],
      [
        "asks another table's scope function",
        "THEN realtime_can_read_user_scope(",
        "THEN realtime_can_read_chapter_scope(",
      ],
      [
        "widens an arm with `or true`",
        /(THEN realtime_can_read_chapter_scope\(\(SUBSTRING\(realtime\.topic\(\) FROM 8\)\)::uuid\))/,
        "$1 OR true",
      ],
      [
        "lets every topic through on the fallthrough",
        /ELSE false/,
        "ELSE true",
      ],
      [
        "puts a catch-all arm first",
        /CASE\s+WHEN/,
        "CASE WHEN (realtime.topic() ~* '^events:') THEN true WHEN",
      ],
    ])("a change-ping policy that %s", async (_case, from, to) => {
      const fixture = recreatePolicy(swap(await changePolicyQual(), from, to));
      await fails(fixture, () => checkChangePolicy(db));
    });

    test.each([
      [
        "adds a second permissive read policy",
        `create policy "realtime_debug" on realtime.messages
           for select to authenticated using (realtime.topic() like 'events:%');`,
      ],
      [
        "drops the change-ping policy",
        `drop policy "realtime_messages_scoped_select" on realtime.messages;`,
      ],
    ])("a migration that %s", (_case, fixture) =>
      fails(fixture, () => checkChangePolicy(db)),
    );

    test.each([
      [
        "drops a table from a list, in dynamic SQL",
        `do $$ begin
           execute 'alter publication supabase_realtime drop table public.chat_message_actions, public.chapter_audit_log';
         end $$;`,
      ],
      [
        "replaces the whole list",
        "alter publication supabase_realtime set table public.chat_messages;",
      ],
      [
        "stops publishing deletes",
        "alter publication supabase_realtime set (publish = 'insert, update');",
      ],
      [
        "adds a second permissive chat read policy",
        `create policy "chat_open" on public.chat_messages
           for select to authenticated using (true);`,
      ],
    ])("a migration that %s", (_case, fixture) =>
      fails(fixture, () => checkPublication(db)),
    );
  });
});
