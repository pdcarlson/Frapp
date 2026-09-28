import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
 * The test reads what the migrations leave in EFFECT, not any one file. Every
 * object here was first written by `20260816140000_realtime_carrier_repair.sql`
 * and several were re-created since, so it replays `supabase/migrations/` in
 * apply order and keeps each object's last create or drop (#2593).
 *
 * If this fails, change the other half to match; do not edit the expectation.
 * On the SQL side that is always a NEW migration re-creating the object, never
 * an edit to a shipped one: `supabase db push` skips an applied version, and on
 * a fresh reset any later migration overwrites the edit.
 */

const MIGRATIONS_DIR = join(__dirname, "../../../../supabase/migrations");

interface Migration {
  name: string;
  /** Executable SQL only — see {@link stripComments}. */
  sql: string;
}

/**
 * A migration with `--` comments stripped.
 *
 * These files are deliberately comment-heavy, and their prose quotes the very
 * SQL these assertions match — the carrier migration's block explaining why
 * each send needs an exception handler names `perform realtime.send(...)` in
 * passing, and counting against the raw text found four sends where three
 * exist. Assertions about what the database *does* must read executable SQL.
 */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: stripComments(readFileSync(join(MIGRATIONS_DIR, name), "utf8")),
    }));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How one database object is created and dropped in migration text. */
interface ObjectSpec {
  label: string;
  /** Matches where a defining statement starts. Source only; flags are added. */
  create: string;
  /** Matches a statement that removes the object. */
  drop: string;
  /** The defining statement's text, from where `create` matched. */
  extract: (sql: string, start: number) => string;
}

/** A function body runs to the close of its dollar quote (`as $$ … $$`). */
function throughDollarQuotedBody(sql: string, start: number): string {
  const open = /\bas\s+(\$\w*\$)/i.exec(sql.slice(start));
  const tag = open?.[1];
  if (!open || !tag) return sql.slice(start);
  const bodyStart = start + open.index + open[0].length;
  const close = sql.indexOf(tag, bodyStart);
  return close === -1 ? sql.slice(start) : sql.slice(start, close + tag.length);
}

/**
 * Anything else runs to its `;`, or to the dollar quote that closes it when it
 * is dynamic SQL inside `execute $p$ … $p$` — the form policies take here,
 * because they are guarded on roles and schemas that bare Postgres lacks.
 */
function throughStatementEnd(sql: string, start: number): string {
  const rest = sql.slice(start);
  const end = /;|\$\w*\$/.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

function pingFunction(table: ChangeTable): ObjectSpec {
  const name = `public\\.realtime_notify_${table}`;
  return {
    label: `function public.realtime_notify_${table}()`,
    create: `create\\s+(?:or\\s+replace\\s+)?function\\s+${name}\\s*\\(`,
    drop: `drop\\s+function\\s+(?:if\\s+exists\\s+)?${name}\\b`,
    extract: throughDollarQuotedBody,
  };
}

function trigger(name: string): ObjectSpec {
  return {
    label: `trigger ${name}`,
    create: `create\\s+(?:or\\s+replace\\s+)?trigger\\s+${name}\\b`,
    drop: `drop\\s+trigger\\s+(?:if\\s+exists\\s+)?${name}\\b`,
    extract: throughStatementEnd,
  };
}

function policy(name: string, table: string): ObjectSpec {
  const target = `"?${name}"?\\s+on\\s+${escapeRegExp(table)}\\b`;
  return {
    label: `policy ${name} on ${table}`,
    create: `create\\s+policy\\s+${target}`,
    drop: `drop\\s+policy\\s+(?:if\\s+exists\\s+)?${target}`,
    extract: throughStatementEnd,
  };
}

function publicationMember(table: string): ObjectSpec {
  const verb = (v: string) =>
    `alter\\s+publication\\s+supabase_realtime\\s+${v}\\s+table\\s+(?:only\\s+)?public\\.${table}\\b`;
  return {
    label: `supabase_realtime publication member public.${table}`,
    create: verb("add"),
    drop: verb("drop"),
    extract: throughStatementEnd,
  };
}

interface Definition {
  migration: string;
  text: string;
}

/**
 * The object's definition as the migrations leave it: the text of its last
 * create, walking files in apply order and statements in file order, or `null`
 * when a drop came last (or nothing ever created it).
 *
 * Text-level, so SQL assembled at run time (`format('%I', …)`) is invisible to
 * it; none of the objects here is built that way.
 */
function effectiveDefinition(
  migrations: readonly Migration[],
  spec: ObjectSpec,
): Definition | null {
  let current: Definition | null = null;
  for (const { name, sql } of migrations) {
    const statements = [
      ...[...sql.matchAll(new RegExp(spec.create, "gi"))].map((m) => ({
        at: m.index,
        text: spec.extract(sql, m.index) as string | null,
      })),
      ...[...sql.matchAll(new RegExp(spec.drop, "gi"))].map((m) => ({
        at: m.index,
        text: null,
      })),
    ].sort((a, b) => a.at - b.at);
    for (const { text } of statements) {
      current = text === null ? null : { migration: name, text };
    }
  }
  return current;
}

function requireDefinition(
  migrations: readonly Migration[],
  spec: ObjectSpec,
): Definition {
  const definition = effectiveDefinition(migrations, spec);
  expect(
    definition,
    `no migration leaves ${spec.label} in effect`,
  ).not.toBeNull();
  return definition as Definition;
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

/** The prefix the client builds, read from `change-topics.ts` itself. */
const prefixOf = (table: ChangeTable) => changeTopic(table, "");

const SEND_CALL = /perform\s+realtime\.send\((?:[^()]|\([^()]*\))*\)/gi;

/**
 * The ping function scopes by the right column and sends exactly one ping on
 * the client's topic.
 *
 * The triggers are STATEMENT-level over a transition table, so each function
 * loops `select distinct <scope column> from changed` and concatenates the
 * prefix onto that scope. Both halves are asserted — the prefix alone would not
 * catch a function reading the wrong column, which is the mistake that
 * silently sends every ping to the wrong topic.
 *
 * `realtime.send(payload, event, topic, private)` is matched POSITIONALLY,
 * inside the call's own parens: the event must be `change`, the topic the
 * client's prefix, and the fourth argument `true`. A ping sent non-private
 * would bypass `realtime.messages` RLS entirely and reach any client that
 * guessed the topic string, so that is the security-critical argument. (An
 * earlier version counted file-global `/^\s+true\s*$/` lines, which collapsed
 * to 0 on a cosmetic reflow and passed a `true` → `false` flip whenever an
 * unrelated line-final `true` existed elsewhere.)
 */
function checkPingFunction(
  migrations: readonly Migration[],
  table: ChangeTable,
) {
  const { text } = requireDefinition(migrations, pingFunction(table));
  expect(text).toMatch(
    new RegExp(
      `for\\s+v_scope\\s+in\\s+select\\s+distinct\\s+${SCOPES[table].column}\\s+from\\s+changed\\b`,
      "i",
    ),
  );
  const sends = text.match(SEND_CALL) ?? [];
  expect(sends, `realtime.send calls in realtime_notify_${table}`).toHaveLength(
    1,
  );
  expect(sends[0]).toMatch(
    new RegExp(
      `,\\s*'${CHANGE_EVENT}'\\s*,\\s*'${escapeRegExp(prefixOf(table))}'\\s*\\|\\|\\s*v_scope::text\\s*,\\s*true\\s*\\)$`,
      "i",
    ),
  );
}

const TRIGGER_OPS = [
  { suffix: "ins", op: "insert", rows: "new" },
  { suffix: "upd", op: "update", rows: "new" },
  { suffix: "del", op: "delete", rows: "old" },
] as const;

/**
 * Every trigger that ever executed a ping function, resolved to what is still
 * live: exactly the 3 × insert/update/delete set, each STATEMENT-level.
 *
 * Per-row turns one bulk write (markAutoAbsent inserts a row per member) into
 * N subtransactions, N broadcast frames on one topic, and 2N client
 * invalidations that each cancel the in-flight refetch. Statement level with
 * `select distinct` collapses it to one ping per scope. Collecting every name
 * that ever pointed at a ping function is what catches an extra per-row
 * trigger added beside the nine.
 */
function checkPingTriggers(migrations: readonly Migration[]) {
  const everCreated = new Set<string>();
  for (const { sql } of migrations) {
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?trigger\s+(\w+)\b[^;]*?execute\s+(?:function|procedure)\s+public\.realtime_notify_/gi,
    )) {
      everCreated.add((m[1] as string).toLowerCase());
    }
  }
  const live = [...everCreated]
    .filter((name) => effectiveDefinition(migrations, trigger(name)) !== null)
    .sort();
  expect(live).toEqual(
    TABLES.flatMap((table) =>
      TRIGGER_OPS.map(({ suffix }) => `realtime_notify_${table}_${suffix}`),
    ).sort(),
  );

  for (const table of TABLES) {
    for (const { suffix, op, rows } of TRIGGER_OPS) {
      const { text } = requireDefinition(
        migrations,
        trigger(`realtime_notify_${table}_${suffix}`),
      );
      expect(text).toMatch(
        new RegExp(
          `after\\s+${op}\\s+on\\s+public\\.${table}\\s+referencing\\s+${rows}\\s+table\\s+as\\s+changed\\s+for\\s+each\\s+statement\\s+execute\\s+function\\s+public\\.realtime_notify_${table}\\(\\)`,
          "i",
        ),
      );
    }
  }
}

/**
 * `realtime_messages_scoped_select` authorises each prefix, with the right
 * scope function, reading the id from right after the prefix.
 *
 * `substring(realtime.topic() from N)` is 1-indexed, so N is the prefix length
 * + 1. One off and the uuid cast raises on every subscribe, which denies the
 * whole family — the same silent, `SUBSCRIBED`-looking failure.
 */
function checkChangePolicy(migrations: readonly Migration[]) {
  const { text } = requireDefinition(
    migrations,
    policy("realtime_messages_scoped_select", "realtime.messages"),
  );
  for (const table of TABLES) {
    const prefix = prefixOf(table);
    expect(text).toMatch(
      new RegExp(
        `'\\^${escapeRegExp(prefix)}\\[0-9a-f\\][^']*'\\s+then\\s+public\\.${SCOPES[table].authorise}\\(\\s*substring\\(\\s*realtime\\.topic\\(\\)\\s+from\\s+${prefix.length + 1}\\s*\\)::uuid\\s*\\)`,
        "i",
      ),
    );
  }
}

/**
 * Chat is the opposite case: its subscriber consumes `payload.new`, so its two
 * tables need real replication plus a row-level policy, not a ping.
 * `chapter_audit_log` was the sixth dead subscription, and the only one outside
 * the browser: `ChatBridgeWorkerService` subscribes to its INSERTs with the
 * service-role client, which bypasses RLS, so publication membership is the
 * entire fix.
 */
const PUBLISHED_TABLES = [
  "chat_messages",
  "chat_message_actions",
  "chapter_audit_log",
];

function checkPublication(migrations: readonly Migration[]) {
  for (const table of PUBLISHED_TABLES) {
    requireDefinition(migrations, publicationMember(table));
  }
  const { text } = requireDefinition(
    migrations,
    policy("chat_messages_select", "public.chat_messages"),
  );
  expect(text).toContain("public.can_read_chat_message(id)");
}

const MIGRATIONS = loadMigrations();

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

  describe("the migrations, as applied, build the same topics", () => {
    test.each(TABLES)(
      "%s: its ping function scopes by the right column and sends the client's topic, privately",
      (table) => checkPingFunction(MIGRATIONS, table),
    );

    test("the ping triggers are the nine statement-level ones and no others", () =>
      checkPingTriggers(MIGRATIONS));

    test("the RLS policy authorises each prefix with its own scope check", () =>
      checkChangePolicy(MIGRATIONS));

    test("chat and the audit log are published, and chat rows stay RLS-gated", () =>
      checkPublication(MIGRATIONS));
  });

  /**
   * Each case appends a later migration that breaks one side of the contract
   * and proves the check above catches it — the proof that it reads what the
   * database runs rather than the file that first wrote it.
   */
  describe("a later migration that drifts fails the check", () => {
    const FIXTURE = "99999999999999_drift_fixture.sql";
    const withLater = (sql: string): Migration[] => [
      ...MIGRATIONS,
      { name: FIXTURE, sql: stripComments(sql) },
    ];
    /** Replaces text that must be there, so a fixture can't pass vacuously. */
    const swap = (text: string, from: string | RegExp, to: string) => {
      const next = text.replace(from, to);
      expect(next, `fixture edit ${String(from)} matched nothing`).not.toBe(
        text,
      );
      return next;
    };
    const current = (spec: ObjectSpec) =>
      requireDefinition(MIGRATIONS, spec).text;
    const eventsFn = () => current(pingFunction("events"));
    const changePolicy = () =>
      current(policy("realtime_messages_scoped_select", "realtime.messages"));

    test.each([
      [
        "scopes by another column",
        "select distinct chapter_id",
        "select distinct user_id",
      ],
      ["renames the topic prefix", "'events:'", "'event:'"],
      ["sends the ping non-private", /true(\s*\)\s*;)/, "false$1"],
      [
        "sends a second ping",
        "perform realtime.send(",
        "perform realtime.send(null, 'change', 'x', true); perform realtime.send(",
      ],
    ] as const)("a ping function that %s", (_case, from, to) => {
      const drifted = withLater(`${swap(eventsFn(), from, to)};`);
      expect(() => checkPingFunction(drifted, "events")).toThrow();
    });

    test("a dropped ping function", () => {
      const drifted = withLater(
        "drop function if exists public.realtime_notify_events();",
      );
      expect(() => checkPingFunction(drifted, "events")).toThrow();
    });

    test.each([
      [
        "drops one of the nine",
        "drop trigger if exists realtime_notify_events_upd on public.events;",
      ],
      [
        "re-creates one per-row",
        `drop trigger if exists realtime_notify_events_ins on public.events;
         create trigger realtime_notify_events_ins after insert on public.events
           for each row execute function public.realtime_notify_events();`,
      ],
      [
        "adds a per-row trigger beside the nine",
        `create trigger realtime_notify_events_row after insert on public.events
           for each row execute function public.realtime_notify_events();`,
      ],
    ])("a migration that %s", (_case, sql) => {
      expect(() => checkPingTriggers(withLater(sql))).toThrow();
    });

    test.each([
      ["renames a prefix", "'^attendance:", "'^attend:"],
      ["reads the id from the wrong offset", "from 12)", "from 11)"],
      [
        "authorises a prefix with another table's scope",
        "public.realtime_can_read_user_scope",
        "public.realtime_can_read_chapter_scope",
      ],
    ])("a change-ping policy that %s", (_case, from, to) => {
      const drifted = withLater(
        `drop policy if exists "realtime_messages_scoped_select" on realtime.messages;
         ${swap(changePolicy(), from, to)};`,
      );
      expect(() => checkChangePolicy(drifted)).toThrow();
    });

    test("a dropped change-ping policy", () => {
      const drifted = withLater(
        `drop policy if exists "realtime_messages_scoped_select" on realtime.messages;`,
      );
      expect(() => checkChangePolicy(drifted)).toThrow();
    });

    test("a table dropped from the publication", () => {
      const drifted = withLater(
        "alter publication supabase_realtime drop table public.chapter_audit_log;",
      );
      expect(() => checkPublication(drifted)).toThrow();
    });

    test("editing the shipped carrier migration changes nothing the check reads", () => {
      // The trap the old comment set: "fix the migration to match". A later
      // migration re-creates every ping function, so this edit never reaches
      // the database — and must not satisfy (or fail) the check either.
      const edited = MIGRATIONS.map((m) =>
        m.name === "20260816140000_realtime_carrier_repair.sql"
          ? { ...m, sql: swap(m.sql, "'events:'", "'event:'") }
          : m,
      );
      expect(() => checkPingFunction(edited, "events")).not.toThrow();
      expect(
        requireDefinition(edited, pingFunction("events")).migration,
      ).not.toBe("20260816140000_realtime_carrier_repair.sql");
    });
  });
});
