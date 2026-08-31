import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GRACE_MINUTES,
  buildGateSummary,
  classifyGateDrift,
  fetchAppliedWithRetry,
  readMigrationsAtRef,
  runDriftGate,
} from "../check-migration-drift-gate.mjs";
import { makeFetchMock } from "./helpers.mjs";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Modeled on the incident this gate exists for: two migrations merged to main
// and never applied to staging, invisible because the only signal was a daily
// issue nobody opened.

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-08-24T12:00:00Z");

const migration = (version, name, landedMs) => ({
  version,
  name,
  file: `${version}_${name}.sql`,
  path: `supabase/migrations/${version}_${name}.sql`,
  landedMs,
});

const MAIN = [
  migration("20260823120000", "chat_message_authors", NOW - 48 * HOUR),
  migration("20260824120000", "discord_import", NOW - 24 * HOUR),
  migration("20260824140000", "discord_bot_connection", NOW - 2 * HOUR),
];

const applied = (list) => list.map((m) => ({ version: m.version, name: m.name }));

const graceMs = DEFAULT_GRACE_MINUTES * 60 * 1000;

// A git double: `ls-tree` lists paths, `log` dates them.
//
// `log` models the one behaviour this gate depends on. Real `git log -1 -- path`
// walks into merged branches and reports the commit that AUTHORED the file;
// adding `--first-parent` restricts the walk to `ref`'s own history and reports
// the commit that LANDED it. So the double keeps two clocks and serves whichever
// the caller's flags ask for. `authored` alone means the two agree, which is
// what a squash merge actually looks like.
function makeGit({ paths, times = {}, landedTimes = {} }) {
  return (args) => {
    if (args[0] === "ls-tree") return `${paths.join("\n")}\n`;
    if (args[0] === "log") {
      const path = args[args.length - 1];
      const firstParent = args.includes("--first-parent");
      const stamp =
        firstParent && landedTimes[path] !== undefined
          ? landedTimes[path]
          : times[path];
      if (stamp === undefined) throw new Error("no commit found");
      return `${stamp}\n`;
    }
    throw new Error(`unexpected git ${args[0]}`);
  };
}

// ── readMigrationsAtRef ─────────────────────────────────────────────────────

test("readMigrationsAtRef parses versioned files and dates them from git", () => {
  const runGit = makeGit({
    paths: [
      "supabase/migrations/20260824120000_discord_import.sql",
      "supabase/migrations/20260823120000_chat_message_authors.sql",
    ],
    times: {
      "supabase/migrations/20260824120000_discord_import.sql": 1787000000,
      "supabase/migrations/20260823120000_chat_message_authors.sql": 1786000000,
    },
  });

  const result = readMigrationsAtRef({ ref: "origin/main", runGit });

  assert.deepEqual(
    result.map((m) => m.version),
    ["20260823120000", "20260824120000"],
    "sorted by version, not by git listing order",
  );
  assert.equal(result[0].landedMs, 1786000000 * 1000);
});

test("readMigrationsAtRef ignores non-migration files in the directory", () => {
  const runGit = makeGit({
    paths: [
      "supabase/migrations/README.md",
      "supabase/migrations/20260824120000_discord_import.sql.bak",
      "supabase/migrations/20260824120000_discord_import.sql",
    ],
    times: { "supabase/migrations/20260824120000_discord_import.sql": 1787000000 },
  });

  const result = readMigrationsAtRef({ ref: "origin/main", runGit });
  assert.equal(result.length, 1);
});

test("readMigrationsAtRef leaves landedMs null when git cannot date the file", () => {
  const runGit = makeGit({
    paths: ["supabase/migrations/20260824120000_discord_import.sql"],
    times: {},
  });

  const [only] = readMigrationsAtRef({ ref: "origin/main", runGit });
  assert.equal(only.landedMs, null);
});

// ── The grace window runs from the merge, not from the authoring ────────────
// Regression cover for the gate turning every open PR red seconds after a
// migration merged. The grace was computed from the feature-branch commit, so
// a PR that sat in review longer than the window got no grace at all — and a
// PR open longer than 30 minutes is the normal case here, which made the
// intended grace unreachable in practice.

const SECOND = 1000;
const MERGE_CASE = "supabase/migrations/20260824115900_late_merge.sql";

test("readMigrationsAtRef dates a migration from its merge, not from the branch commit", () => {
  const runGit = makeGit({
    paths: [MERGE_CASE],
    times: { [MERGE_CASE]: (NOW - 90 * 60 * SECOND) / SECOND },
    landedTimes: { [MERGE_CASE]: (NOW - 60 * SECOND) / SECOND },
  });

  const [only] = readMigrationsAtRef({ ref: "origin/main", runGit });

  assert.equal(
    only.landedMs,
    NOW - 60 * SECOND,
    "landedMs must be the merge commit's time, not the authoring commit's",
  );
});

test("a migration authored outside the grace but merged inside it is graced", () => {
  // The measured shape of the real misfire: authored on a branch 90 minutes
  // ago, merged to main 60 seconds ago, gate runs now. Staging has had one
  // minute to catch up, so this is not drift yet.
  const runGit = makeGit({
    paths: [MERGE_CASE],
    times: { [MERGE_CASE]: (NOW - 90 * 60 * SECOND) / SECOND },
    landedTimes: { [MERGE_CASE]: (NOW - 60 * SECOND) / SECOND },
  });

  const result = classifyGateDrift({
    main: readMigrationsAtRef({ ref: "origin/main", runGit }),
    applied: [],
    nowMs: NOW,
    graceMs,
  });

  assert.equal(result.status, "clean", "an unrelated PR must not go red for this");
  assert.deepEqual(result.overdue, []);
  assert.deepEqual(
    result.withinGrace.map((m) => m.version),
    ["20260824115900"],
  );
});

test("the fix does not blunt the gate: merged long ago is still overdue", () => {
  // The other half of the trade. A migration that genuinely has not reached
  // staging must still fail, and dating it from the merge must not rescue it.
  const runGit = makeGit({
    paths: [MERGE_CASE],
    times: { [MERGE_CASE]: (NOW - 72 * HOUR) / SECOND },
    landedTimes: { [MERGE_CASE]: (NOW - 48 * HOUR) / SECOND },
  });

  const result = classifyGateDrift({
    main: readMigrationsAtRef({ ref: "origin/main", runGit }),
    applied: [],
    nowMs: NOW,
    graceMs,
  });

  assert.equal(result.status, "drift");
  assert.deepEqual(
    result.overdue.map((m) => m.version),
    ["20260824115900"],
  );
});

test("a squash merge dates identically — plain and --first-parent agree", () => {
  // main's current merge style: one linear commit, no side branch to walk
  // into. The double models that as landedTimes being absent.
  const runGit = makeGit({
    paths: [MERGE_CASE],
    times: { [MERGE_CASE]: (NOW - 60 * SECOND) / SECOND },
  });

  const [only] = readMigrationsAtRef({ ref: "origin/main", runGit });
  assert.equal(only.landedMs, NOW - 60 * SECOND);
});

// ── classifyGateDrift ───────────────────────────────────────────────────────

test("clean when staging holds every migration on main", () => {
  const result = classifyGateDrift({
    main: MAIN,
    applied: applied(MAIN),
    nowMs: NOW,
    graceMs,
  });
  assert.equal(result.status, "clean");
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.foreign, []);
});

test("THE INCIDENT: migrations merged to main and never applied are drift", () => {
  const result = classifyGateDrift({
    main: MAIN,
    applied: applied(MAIN.slice(0, 1)),
    nowMs: NOW,
    graceMs,
  });

  assert.equal(result.status, "drift");
  assert.deepEqual(
    result.overdue.map((m) => m.version),
    ["20260824120000", "20260824140000"],
  );
});

test("a migration merged inside the grace window is not yet drift", () => {
  const justMerged = [...MAIN, migration("20260824160000", "brand_new", NOW - 60_000)];

  const result = classifyGateDrift({
    main: justMerged,
    applied: applied(MAIN),
    nowMs: NOW,
    graceMs,
  });

  assert.equal(result.status, "clean", "the apply is still running; do not red every PR");
  assert.deepEqual(
    result.withinGrace.map((m) => m.version),
    ["20260824160000"],
  );
});

test("the grace window expires", () => {
  const stale = [...MAIN, migration("20260824160000", "brand_new", NOW - 2 * HOUR)];

  const result = classifyGateDrift({
    main: stale,
    applied: applied(MAIN),
    nowMs: NOW,
    graceMs,
  });

  assert.equal(result.status, "drift");
  assert.deepEqual(result.overdue.map((m) => m.version), ["20260824160000"]);
});

test("an undatable pending migration is overdue, never silently graced", () => {
  const undatable = [...MAIN, migration("20260824160000", "mystery", null)];

  const result = classifyGateDrift({
    main: undatable,
    applied: applied(MAIN),
    nowMs: NOW,
    graceMs,
  });

  assert.equal(result.status, "drift");
  assert.deepEqual(result.overdue.map((m) => m.name), ["mystery"]);
});

test("a foreign migration on staging is drift and is never graced", () => {
  // The shape still sitting on production (#832): a version applied by hand
  // that exists in no branch. It blocks `db push` outright.
  const result = classifyGateDrift({
    main: MAIN,
    applied: [
      ...applied(MAIN),
      { version: "20260228000000", name: "enable_rls_on_remaining_tables" },
    ],
    nowMs: NOW,
    graceMs,
  });

  assert.equal(result.status, "drift");
  assert.deepEqual(result.foreign.map((m) => m.version), ["20260228000000"]);
});

test("a PR's own unmerged migration cannot fail the gate", () => {
  // The gate compares main to staging. A migration that exists only on the PR
  // branch is absent from `main`, so it is neither pending nor foreign.
  const result = classifyGateDrift({
    main: MAIN,
    applied: applied(MAIN),
    nowMs: NOW,
    graceMs,
  });
  assert.equal(result.status, "clean");
});

// ── fetchAppliedWithRetry ───────────────────────────────────────────────────

test("a transient API failure is absorbed by retry", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts < 3) return { ok: false, status: 503, text: async () => "" };
    return { ok: true, status: 200, text: async () => JSON.stringify(applied(MAIN)) };
  };

  const result = await fetchAppliedWithRetry({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl,
    sleepImpl: async () => {},
    log: () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(attempts, 3);
});

test("a sustained outage exhausts retries and stays not-ok", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "" });

  const result = await fetchAppliedWithRetry({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl,
    sleepImpl: async () => {},
    log: () => {},
  });

  assert.equal(result.ok, false);
});

// ── runDriftGate ────────────────────────────────────────────────────────────

function gateArgs(overrides = {}) {
  const runGit = makeGit({
    paths: MAIN.map((m) => m.path),
    times: Object.fromEntries(MAIN.map((m) => [m.path, m.landedMs / 1000])),
  });
  return {
    accessToken: "t",
    projectRef: "examplestagingref01",
    mainRef: "origin/main",
    nowMs: NOW,
    runGit,
    sleepImpl: async () => {},
    log: () => {},
    error: () => {},
    onSummary: () => {},
    ...overrides,
  };
}

test("exit 0 when staging matches main", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/database/migrations", body: applied(MAIN) },
  ]);
  assert.equal(await runDriftGate(gateArgs({ fetchImpl })), 0);
});

test("exit 1 when main has unapplied migrations", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/database/migrations", body: applied(MAIN.slice(0, 1)) },
  ]);
  assert.equal(await runDriftGate(gateArgs({ fetchImpl })), 1);
});

test("zero migrations at the ref is a checkout error, not 51 foreign migrations", async () => {
  // `git ls-tree` answers a path that does not exist with an empty list and
  // exit 0. Without the guard, every migration on staging would be classified
  // foreign and the operator would be told `db push` is blocked by hand-applied
  // rows — a wrong and expensive thing to be told.
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/database/migrations", body: applied(MAIN) },
  ]);

  const summaries = [];
  const code = await runDriftGate(
    gateArgs({
      fetchImpl,
      runGit: makeGit({ paths: [], times: {} }),
      onSummary: (s) => summaries.push(s),
    }),
  );

  assert.equal(code, 1);
  assert.match(summaries[0], /checkout problem, not a database problem/);
  // The point is that it does not ANNOUNCE drift it never observed. (The text
  // may still use the word "foreign" while explaining what it is not doing.)
  assert.doesNotMatch(
    summaries[0],
    /\*\*Drift detected/,
    "must not announce drift it did not observe",
  );
  assert.doesNotMatch(
    summaries[0],
    /migration\(s\) on staging that do not exist/,
    "must not list staging's migrations as foreign",
  );
});

test("an unreadable staging is a FAILURE, never a silent pass", async () => {
  // The whole point. "Could not verify" spelled green is what let the incident
  // run for as long as it did.
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/database/migrations", status: 500, body: {} },
  ]);
  assert.equal(await runDriftGate(gateArgs({ fetchImpl })), 1);
});

test("the summary names the missing migrations and how to fix them", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/database/migrations", body: applied(MAIN.slice(0, 1)) },
  ]);

  const summaries = [];
  await runDriftGate(gateArgs({ fetchImpl, onSummary: (s) => summaries.push(s) }));

  assert.equal(summaries.length, 1);
  assert.match(summaries[0], /discord_import/);
  assert.match(summaries[0], /discord_bot_connection/);
  assert.match(summaries[0], /DB_PROMOTION_RUNBOOK\.md/);
});

test("the summary explains a foreign migration blocks db push", () => {
  const result = classifyGateDrift({
    main: MAIN,
    applied: [...applied(MAIN), { version: "20260228000000", name: "hand_applied" }],
    nowMs: NOW,
    graceMs,
  });

  const summary = buildGateSummary({
    result,
    graceMinutes: DEFAULT_GRACE_MINUTES,
    projectRef: "examplestagingref01",
    mainRef: "origin/main",
  });

  assert.match(summary, /blocks `supabase db push`/);
  assert.match(summary, /20260228000000/);
});
