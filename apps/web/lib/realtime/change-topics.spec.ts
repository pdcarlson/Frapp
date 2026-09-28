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
 * The test reads what a fresh replay of `supabase/migrations/` leaves in
 * effect. `20260816140000_realtime_carrier_repair.sql` first wrote these
 * objects and several were re-created since, so it walks the files in apply
 * order and keeps each object's last create or drop (#2593). A form of change
 * it can't model fails the tripwire below rather than slipping past.
 *
 * If this fails, change the other half to match; do not edit the expectation.
 * On the SQL side that is always a NEW migration that drops and re-creates the
 * object (or `create or replace`s a function), never an edit to a shipped one:
 * `supabase db push` skips a version a hosted database already applied, so the
 * edit never reaches staging or production. This test replays files, not those
 * databases, so it can't see that happen — an in-place edit that agrees with
 * `change-topics.ts` passes here while production keeps the old SQL.
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

/**
 * A regex source for an object name as Postgres resolves it here: optionally
 * double-quoted and, in `public`, optionally schema-qualified. About half the
 * migrations write function names bare, and `search_path` resolves them to
 * `public`, so a pattern that required `public.` would miss a live redefinition.
 * `name` is a regex source, so a caller can match a family (`realtime_notify_\w+`).
 */
function sqlName(name: string, schema = "public"): string {
  const qualified = `"?${schema}"?\\s*\\.\\s*`;
  const prefix = schema === "public" ? `(?:${qualified})?` : qualified;
  return `${prefix}"?${name}"?(?![\\w"])`;
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

const OR_REPLACE = `(?:or\\s+replace\\s+)?`;

function pingFunction(table: ChangeTable): ObjectSpec {
  const name = sqlName(`realtime_notify_${table}`);
  return {
    label: `function public.realtime_notify_${table}()`,
    create: `create\\s+${OR_REPLACE}function\\s+${name}\\s*\\(`,
    drop: `drop\\s+function\\s+(?:if\\s+exists\\s+)?${name}`,
    extract: throughDollarQuotedBody,
  };
}

function trigger(name: string): ObjectSpec {
  return {
    label: `trigger ${name}`,
    create: `create\\s+${OR_REPLACE}(?:constraint\\s+)?trigger\\s+"?${name}"?(?![\\w"])`,
    drop: `drop\\s+trigger\\s+(?:if\\s+exists\\s+)?"?${name}"?(?![\\w"])`,
    extract: throughStatementEnd,
  };
}

function policy(name: string, table: string, schema: string): ObjectSpec {
  const target = `"?${name}"?\\s+on\\s+${sqlName(table, schema)}`;
  return {
    label: `policy ${name} on ${schema}.${table}`,
    create: `create\\s+policy\\s+${target}`,
    drop: `drop\\s+policy\\s+(?:if\\s+exists\\s+)?${target}`,
    extract: throughStatementEnd,
  };
}

interface Statement {
  migration: string;
  /** The defining text, or `null` for a drop. */
  text: string | null;
  /** A drop of the same object came earlier in the same migration. */
  droppedFirst: boolean;
}

/** Every create and drop of the object, in apply order. */
function statementsOf(
  migrations: readonly Migration[],
  spec: ObjectSpec,
): Statement[] {
  const out: Statement[] = [];
  for (const { name, sql } of migrations) {
    const found = [
      ...[...sql.matchAll(new RegExp(spec.create, "gi"))].map((m) => ({
        at: m.index,
        text: spec.extract(sql, m.index) as string | null,
      })),
      ...[...sql.matchAll(new RegExp(spec.drop, "gi"))].map((m) => ({
        at: m.index,
        text: null,
      })),
    ].sort((a, b) => a.at - b.at);
    let droppedHere = false;
    for (const { text } of found) {
      out.push({ migration: name, text, droppedFirst: droppedHere });
      if (text === null) droppedHere = true;
    }
  }
  return out;
}

interface Definition {
  migration: string;
  text: string;
}

/**
 * The object's definition as the migrations leave it: the text of its last
 * create, or `null` when a drop came last (or nothing ever created it).
 *
 * Text-level, so SQL assembled at run time (`format('%I', …)`) is invisible to
 * it; none of the objects here is built that way.
 */
function effectiveDefinition(
  migrations: readonly Migration[],
  spec: ObjectSpec,
): Definition | null {
  const last = statementsOf(migrations, spec).at(-1);
  return last?.text == null
    ? null
    : { migration: last.migration, text: last.text };
}

/**
 * The effective definition, which must exist and must have really applied.
 *
 * Text order is not control flow. The carrier migration creates its policies
 * behind `if exists (… pg_policies …) then return`, so a later migration that
 * copied that block would read here as the new definition while every hosted
 * database, which already has the policy, skipped it. So every create after
 * the first must either replace in place (`create or replace`) or come after a
 * drop of the same object in the same migration.
 */
function requireDefinition(
  migrations: readonly Migration[],
  spec: ObjectSpec,
): Definition {
  const statements = statementsOf(migrations, spec);
  const unapplied = statements
    .filter(
      (s, i) =>
        s.text !== null &&
        !s.droppedFirst &&
        !new RegExp(`^create\\s+or\\s+replace\\b`, "i").test(s.text) &&
        statements.slice(0, i).some((earlier) => earlier.text !== null),
    )
    .map((s) => s.migration);
  expect(
    unapplied,
    `${spec.label} is re-created without a drop first, so a database that already has it may skip the create`,
  ).toEqual([]);
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
 * Every trigger that ever executed a ping function, however it was named or
 * qualified, resolved to what is still live: exactly the 3 × insert/update/
 * delete set, each STATEMENT-level.
 *
 * Per-row turns one bulk write (markAutoAbsent inserts a row per member) into
 * N subtransactions, N broadcast frames on one topic, and 2N client
 * invalidations that each cancel the in-flight refetch. Statement level with
 * `select distinct` collapses it to one ping per scope. Collecting every name
 * that ever pointed at a ping function is what catches an extra per-row (or
 * constraint, which is always per-row) trigger added beside the nine.
 */
function checkPingTriggers(migrations: readonly Migration[]) {
  const everCreated = new Set<string>();
  const pointsAtPing = new RegExp(
    `create\\s+${OR_REPLACE}(?:constraint\\s+)?trigger\\s+"?(\\w+)"?[^;]*?execute\\s+(?:function|procedure)\\s+${sqlName("realtime_notify_\\w+")}`,
    "gi",
  );
  for (const { sql } of migrations) {
    for (const m of sql.matchAll(pointsAtPing)) {
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
          `^create\\s+${OR_REPLACE}trigger\\s+\\S+\\s+after\\s+${op}\\s+on\\s+${sqlName(table)}\\s+referencing\\s+${rows}\\s+table\\s+as\\s+changed\\s+for\\s+each\\s+statement\\s+execute\\s+function\\s+${sqlName(`realtime_notify_${table}`)}\\(\\)\\s*$`,
          "i",
        ),
      );
    }
  }
}

/** One `when realtime.topic() ~* '^<prefix><uuid>$' then <scope call>` arm. */
const POLICY_ARM = new RegExp(
  `\\bwhen\\s+realtime\\.topic\\(\\)\\s*~\\*\\s*'\\^([^'\\[]+)\\[0-9a-f\\]\\{8\\}-\\[0-9a-f\\]\\{4\\}-\\[0-9a-f\\]\\{4\\}-\\[0-9a-f\\]\\{4\\}-\\[0-9a-f\\]\\{12\\}\\$'` +
    `\\s+then\\s+public\\.(\\w+)\\(\\s*substring\\(\\s*realtime\\.topic\\(\\)\\s+from\\s+(\\d+)\\s*\\)::uuid\\s*\\)` +
    `\\s*(?=\\bwhen\\b|\\belse\\s+false\\s+end\\b)`,
  "gi",
);

/**
 * `realtime_messages_scoped_select` authorises each prefix with the right
 * scope function, and nothing else gets through.
 *
 * Postgres takes the first CASE arm that matches, so the whole CASE is read:
 * every arm must be the full-uuid-anchored shape with a bare scope call as its
 * result, and the fallthrough must be `else false`. One arm `then true`, one
 * `or true`, or `else true` would hand every signed-in user another chapter's
 * pings. `substring(realtime.topic() from N)` is 1-indexed, so N is the prefix
 * length + 1: one off and the uuid cast raises on every subscribe, denying the
 * whole family with the same silent, `SUBSCRIBED`-looking failure. The offset
 * rule holds for every arm, not only the three change-ping ones.
 */
function checkChangePolicy(migrations: readonly Migration[]) {
  const { text } = requireDefinition(
    migrations,
    policy("realtime_messages_scoped_select", "messages", "realtime"),
  );
  expect(text).toMatch(
    /\bfor\s+select\s+to\s+authenticated\s+using\s*\(\s*case\s+when\b/i,
  );
  expect(text).toMatch(/\belse\s+false\s+end\s*\)\s*$/i);

  const arms = [...text.matchAll(POLICY_ARM)].map((m) => ({
    prefix: (m[1] as string).toLowerCase(),
    authorise: m[2] as string,
    from: Number(m[3]),
  }));
  expect(
    arms.length,
    "every `when` arm must be the anchored-prefix → scope-call shape",
  ).toBe(text.match(/\bwhen\b/gi)?.length ?? 0);
  expect(new Set(arms.map((a) => a.prefix)).size).toBe(arms.length);
  for (const arm of arms) {
    expect(arm.from, `substring offset for '^${arm.prefix}'`).toBe(
      arm.prefix.length + 1,
    );
  }
  for (const table of TABLES) {
    expect(arms).toContainEqual({
      prefix: prefixOf(table),
      authorise: SCOPES[table].authorise,
      from: prefixOf(table).length + 1,
    });
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

/**
 * `supabase_realtime`'s table list as the migrations leave it: `add`, `drop`
 * and `set` replayed in order, each over its whole comma-separated list.
 */
function publishedTables(migrations: readonly Migration[]): Set<string> {
  const members = new Set<string>();
  const statement =
    /alter\s+publication\s+"?supabase_realtime"?\s+(add|drop|set)\s+table\s+([^;$]*)/gi;
  for (const { sql } of migrations) {
    for (const m of sql.matchAll(statement)) {
      const verb = (m[1] as string).toLowerCase();
      let list = m[2] as string;
      // Column lists and row filters (`t (a, b) where (…)`) carry commas too.
      while (/\([^()]*\)/.test(list)) list = list.replace(/\([^()]*\)/g, "");
      const tables = list
        .replace(/\bwhere\b/gi, "")
        .split(",")
        .map((t) =>
          t
            .trim()
            .replace(/^only\s+/i, "")
            .replace(/\s*\*$/, "")
            .replace(/"/g, "")
            .replace(/^public\s*\.\s*/i, "")
            .toLowerCase(),
        )
        .filter(Boolean);
      if (verb === "set") members.clear();
      for (const t of tables) {
        if (verb === "drop") members.delete(t);
        else members.add(t);
      }
    }
  }
  return members;
}

function checkPublication(migrations: readonly Migration[]) {
  const published = publishedTables(migrations);
  for (const table of PUBLISHED_TABLES) {
    expect(published, `supabase_realtime publishes ${table}`).toContain(table);
  }
  const { text } = requireDefinition(
    migrations,
    policy("chat_messages_select", "chat_messages", "public"),
  );
  expect(text).toContain("public.can_read_chat_message(id)");
  expect(text, "chat_messages_select must not widen with `or`").not.toMatch(
    /\bor\b/i,
  );
}

/**
 * Changes this replay can't model, so they fail rather than pass unseen. Each
 * alters a contract object in place: the create text the check reads stays
 * the same while what the database runs changes. Change the object by
 * dropping and re-creating it instead. (`alter policy` is also refused repo-wide by
 * `apps/api/.../chat-read-surface-ledger.spec.ts`; this spec says so itself
 * so it stands alone.)
 */
const UNMODELLED_CHANGES: [string, RegExp][] = [
  [
    "alter policy on a contract policy",
    /\balter\s+policy\s+"?(?:realtime_messages_scoped_select|chat_messages_select)\b/i,
  ],
  [
    "alter function on a ping function",
    new RegExp(
      `\\balter\\s+function\\s+${sqlName("realtime_notify_\\w+")}`,
      "i",
    ),
  ],
  [
    "alter trigger on a ping trigger",
    /\balter\s+trigger\s+"?realtime_notify_/i,
  ],
  [
    "enable/disable of a ping trigger",
    /\b(?:enable|disable)\s+(?:replica\s+|always\s+)?trigger\s+"?realtime_notify_/i,
  ],
  [
    "disable trigger all/user on a ping table",
    new RegExp(
      `\\balter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${sqlName("(?:notifications|events|event_attendance)")}\\s+disable\\s+trigger\\s+(?:all|user)\\b`,
      "i",
    ),
  ],
  [
    "dropping or renaming the publication",
    /\b(?:drop\s+publication\s+(?:if\s+exists\s+)?"?supabase_realtime\b|alter\s+publication\s+"?supabase_realtime"?\s+rename\b)/i,
  ],
  [
    "a publication change other than add/drop/set table",
    /\balter\s+publication\s+"?supabase_realtime"?\s+(?!(?:add|drop|set)\s+table\s)(?!rename\b)/i,
  ],
];

function unmodelledChanges(migrations: readonly Migration[]): string[] {
  return migrations.flatMap(({ name, sql }) =>
    UNMODELLED_CHANGES.filter(([, pattern]) => pattern.test(sql)).map(
      ([what]) => `${name}: ${what}`,
    ),
  );
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

    test("the RLS policy authorises each prefix with its own scope check, and nothing else", () =>
      checkChangePolicy(MIGRATIONS));

    test("chat and the audit log are published, and chat rows stay RLS-gated", () =>
      checkPublication(MIGRATIONS));

    test("no migration changes a contract object in a form this replay can't model", () =>
      expect(unmodelledChanges(MIGRATIONS)).toEqual([]));
  });

  /**
   * Each case appends a later migration that breaks one side of the contract
   * and proves the check above catches it — the proof that it reads the newest
   * definition, in whatever form it is written, rather than the file that
   * first wrote it.
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
      current(
        policy("realtime_messages_scoped_select", "messages", "realtime"),
      );
    const recreatePolicy = (text: string) =>
      withLater(
        `drop policy if exists "realtime_messages_scoped_select" on realtime.messages;
         ${text};`,
      );

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

    test.each([
      ["unqualified", "realtime_notify_events"],
      ["quoted", `"public"."realtime_notify_events"`],
    ])("a drifted ping function written %s", (_case, spelling) => {
      // The prefix flip alone would fail the check; it fails here only if the
      // replay actually saw the differently spelled redefinition.
      const respelled = swap(
        eventsFn(),
        /public\.realtime_notify_events/i,
        spelling,
      );
      const drifted = withLater(`${swap(respelled, "'events:'", "'event:'")};`);
      expect(() => checkPingFunction(drifted, "events")).toThrow();
    });

    test("a dropped ping function, written unqualified", () => {
      const drifted = withLater(
        "drop function if exists realtime_notify_events();",
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
      [
        "adds one with an unqualified target",
        `create trigger events_row_ping after insert on public.events
           for each row execute function realtime_notify_events();`,
      ],
      [
        "adds one with a quoted name",
        `create trigger "events_row_ping" after insert on public.events
           for each row execute function public.realtime_notify_events();`,
      ],
      [
        "adds a constraint trigger",
        `create constraint trigger events_row_ping after insert on public.events
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
      [
        "lets every topic through on the fallthrough",
        /else\s+false/i,
        "else true",
      ],
      [
        "widens an arm with `or true`",
        "from 8)::uuid)",
        "from 8)::uuid) or true",
      ],
      [
        "puts an unscoped arm first",
        /case\s+when/i,
        "case when realtime.topic() ~* '^events:' then true when",
      ],
    ])("a change-ping policy that %s", (_case, from, to) => {
      const drifted = recreatePolicy(swap(changePolicy(), from, to));
      expect(() => checkChangePolicy(drifted)).toThrow();
    });

    test("a dropped change-ping policy", () => {
      const drifted = withLater(
        `drop policy if exists "realtime_messages_scoped_select" on realtime.messages;`,
      );
      expect(() => checkChangePolicy(drifted)).toThrow();
    });

    test("a guarded re-create that a database with the policy would skip", () => {
      // The carrier migration's own idiom. Were it copied with a changed
      // prefix, the replay would read the new text while staging and
      // production, which have the policy, returned before the create.
      const drifted = withLater(
        `do $$ begin
           if exists (select 1 from pg_policies where policyname = 'realtime_messages_scoped_select') then
             return;
           end if;
           execute $p$ ${changePolicy()} $p$;
         end $$;`,
      );
      expect(() => checkChangePolicy(drifted)).toThrow(
        /re-created without a drop/,
      );
    });

    test.each([
      [
        "drops a table named after another in the list",
        "alter publication supabase_realtime drop table public.notifications, public.chapter_audit_log;",
      ],
      [
        "replaces the whole list",
        "alter publication supabase_realtime set table public.chat_messages;",
      ],
      [
        "drops a quoted table",
        `alter publication supabase_realtime drop table "public"."chapter_audit_log";`,
      ],
    ])("a publication change that %s", (_case, sql) => {
      expect(() => checkPublication(withLater(sql))).toThrow();
    });

    test.each([
      `alter policy "realtime_messages_scoped_select" on realtime.messages using (false);`,
      "alter function realtime_notify_events() rename to realtime_notify_old;",
      "alter table public.events disable trigger realtime_notify_events_ins;",
      "alter table public.events disable trigger all;",
      "alter publication supabase_realtime set (publish = 'insert');",
      "drop publication if exists supabase_realtime;",
    ])("an in-place change the replay can't model: %s", (sql) => {
      expect(unmodelledChanges(withLater(sql))).toEqual([
        expect.stringContaining(FIXTURE),
      ]);
    });

    test("an edit to the carrier migration, overridden since, changes nothing the check reads", () => {
      // The trap the old comment set: "fix the migration to match". Later
      // migrations re-create every ping function, so this edit reaches no
      // database, and it doesn't reach the check either. (An edit to the NEWEST
      // definer would reach the check but still no hosted database: see the
      // header.)
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
