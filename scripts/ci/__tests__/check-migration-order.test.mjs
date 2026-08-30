import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildOrderSummary,
  classifyLocalOrder,
  classifyOrder,
  decideOrderOutcome,
  introducedMigrations,
  newestVersion,
  removedMigrations,
  runOrderGate,
  suggestVersion,
} from "../check-migration-order.mjs";
import { makeFetchMock } from "./helpers.mjs";

const m = (version, name) => ({ version, name, file: `${version}_${name}.sql` });

const ENVIRONMENTS = {
  staging: { name: "staging", supabaseProjectRef: "stagingrefaaaaaa", supabaseProjectName: "s" },
  production: { name: "production", supabaseProjectRef: "productionrefbbb", supabaseProjectName: "p" },
};

const quiet = { log: () => {}, error: () => {}, writeSummary: () => {} };

// ── introducedMigrations ────────────────────────────────────────────────────

test("introduced = in head, absent at base", () => {
  const base = [m("20260101000000", "a"), m("20260102000000", "b")];
  const head = [...base, m("20260103000000", "c")];
  assert.deepEqual(
    introducedMigrations({ head, base }).map((x) => x.version),
    ["20260103000000"],
  );
});

test("a migration removed by the change is not an introduction", () => {
  const base = [m("20260101000000", "a"), m("20260102000000", "b")];
  const head = [m("20260101000000", "a")];
  assert.deepEqual(introducedMigrations({ head, base }), []);
});

test("renaming a file to fix its version reads as one introduction", () => {
  // The property that lets a fix turn its own check green. Keyed on version,
  // so the rename is "the bad version left, a good one arrived" — which is
  // what it is. `migration-drift` could never do this: it compared origin/main
  // against staging on every run, so the PR fixing the drift was blocked by
  // the very drift it was fixing.
  const base = [m("20260101000000", "a"), m("20260102000000", "b")];
  const head = [m("20260101000000", "a"), m("20260109000000", "b")];
  const introduced = introducedMigrations({ head, base });
  assert.deepEqual(introduced.map((x) => x.version), ["20260109000000"]);
});

// ── classifyOrder ───────────────────────────────────────────────────────────

test("an ordinary forward migration offends nothing", () => {
  const applied = [m("20260101000000", "a"), m("20260102000000", "b")];
  const { offending, newestApplied } = classifyOrder({
    introduced: [m("20260103000000", "c")],
    applied,
  });
  assert.equal(newestApplied, "20260102000000");
  assert.deepEqual(offending, []);
});

test("a back-dated introduction offends", () => {
  const applied = [m("20260101000000", "a"), m("20260103000000", "c")];
  const { offending } = classifyOrder({ introduced: [m("20260102000000", "b")], applied });
  assert.deepEqual(offending.map((x) => x.version), ["20260102000000"]);
});

test("an introduction already applied here is NOT offending", () => {
  // The hand-applied case. It is not pending, so the CLI never considers
  // inserting it, and failing it would redden a database already in the
  // desired state.
  const applied = [m("20260102000000", "b"), m("20260103000000", "c")];
  const { offending } = classifyOrder({ introduced: [m("20260102000000", "b")], applied });
  assert.deepEqual(offending, []);
});

test("an empty applied list offends nothing HERE — runOrderGate treats it as unreadable", () => {
  // The pure function cannot offend against nothing, which is correct. The
  // judgement that an empty history is a wrong ref rather than a clean database
  // belongs one level up, where the environment is named — see the end-to-end
  // test below.
  const { newestApplied, offending, stranded } = classifyOrder({
    introduced: [m("20260101000000", "a")],
    applied: [],
  });
  assert.equal(newestApplied, null);
  assert.deepEqual(offending, []);
  assert.deepEqual(stranded, []);
  assert.equal(newestVersion([]), null);
});

test("a version equal to the newest applied is not back-dated", () => {
  // `<`, not `<=`. A duplicate version is a different fault, owned by
  // `migration-safety`, and reporting it here would send the author to the
  // wrong remedy.
  const applied = [m("20260103000000", "c")];
  assert.deepEqual(classifyOrder({ introduced: [m("20260103000000", "x")], applied }).offending, []);
});

// ── suggestVersion ──────────────────────────────────────────────────────────

test("the suggested version is one second past the newest applied", () => {
  assert.equal(suggestVersion("20260829002000"), "20260829002001");
  // Rollovers, since a naive string increment gets these wrong.
  assert.equal(suggestVersion("20261231235959"), "20270101000000");
  assert.equal(suggestVersion("20260228235959"), "20260301000000"); // 2026 is not a leap year
  assert.equal(suggestVersion("20240228235959"), "20240229000000"); // 2024 is
  assert.equal(suggestVersion("not-a-version"), null);
});

// ── decideOrderOutcome ──────────────────────────────────────────────────────

test("no environments checked means nothing was introduced", () => {
  const outcome = decideOrderOutcome({ local: null, results: [] });
  assert.equal(outcome.ok, true);
  assert.match(outcome.message, /introduces no migrations/);
});

test("an unreadable environment fails rather than passing unverified", () => {
  const outcome = decideOrderOutcome({
    local: { floor: "20260101000000", offending: [] },
    introduced: [m("20260901000000", "x")],
    results: [
      { label: "staging", status: "unknown", error: "HTTP 500", newestApplied: null, offending: [], stranded: [] },
      { label: "production", status: "ok", error: null, newestApplied: "20260101000000", offending: [], stranded: [] },
    ],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "environment-unreadable");
  // The availability trade, stated where it is read: this can only ever block a
  // change that introduces migrations.
  assert.match(outcome.message, /only ever blocks a change that adds or removes a migration/);
});

test("one offending environment fails the whole gate and carries the remedy", () => {
  const outcome = decideOrderOutcome({
    local: { floor: "20260828000000", offending: [] },
    introduced: [m("20260829000000", "rollover_promote_new_members")],
    results: [
      {
        label: "staging",
        status: "ok",
        error: null,
        newestApplied: "20260829002000",
        offending: [m("20260829000000", "rollover_promote_new_members")],
        stranded: [],
      },
      { label: "production", status: "ok", error: null, newestApplied: "20260820000000", offending: [], stranded: [] },
    ],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "back-dated-migrations");
  assert.match(outcome.message, /20260829000000_rollover_promote_new_members\.sql/);
  assert.match(outcome.message, /rename each to a version after `20260829002000`/i);
  assert.match(outcome.message, /20260829002001_<same_name>\.sql/);
  // The CLI's own words, so the failure is searchable against the real error.
  assert.match(outcome.message, /inserted before the last migration on remote database/);
  assert.match(outcome.message, /DB_PROMOTION_RUNBOOK\.md/);
});

// ── runOrderGate — end to end, offline ──────────────────────────────────────

const MIGRATIONS_PATH = "/database/migrations";
const appliedRoute = (migrations, status = 200) => [
  { method: "GET", path: MIGRATIONS_PATH, status, body: { migrations } },
];

test("a change introducing nothing passes WITHOUT touching the network", async () => {
  // The property that makes this gate safe to require. `migration-drift` was
  // demoted because it made repo-wide merge availability depend on a
  // third-party API on every PR; this one calls out only for changes that
  // introduce migrations.
  const shared = [m("20260101000000", "a")];
  const { fetchImpl, calls } = makeFetchMock(appliedRoute([]));
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "origin/main",
    environments: ENVIRONMENTS,
    readHead: () => shared,
    readBase: () => shared,
    fetchImpl,
    ...quiet,
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, []);
});

test("#1373 replays: 20260829000000 against a staging holding 20260829002000", async () => {
  // The incident, from a recorded state. `20260829000000_rollover_promote_new_members`
  // merged after `20260829002000` was already applied to staging; `supabase db
  // push` refused, staging's deploy halted, and — because `migration-drift` was
  // required at the time — every open PR in the repo became unmergeable.
  const recorded = JSON.parse(
    readFileSync("scripts/ci/__tests__/fixtures/staging-applied-2026-08-29-incident-1373.json", "utf8"),
  ).migrations;
  const introduced = m("20260829000000", "rollover_promote_new_members");
  const base = recorded.map((r) => m(r.version, r.name));

  let failure = "";
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "origin/main",
    environments: { staging: ENVIRONMENTS.staging },
    readHead: () => [...base, introduced],
    readBase: () => base,
    fetchImpl: makeFetchMock(appliedRoute(recorded)).fetchImpl,
    log: () => {},
    error: (text) => {
      failure += `${text}\n`;
    },
    writeSummary: () => {},
  });

  assert.equal(code, 1);
  assert.match(failure, /20260829000000_rollover_promote_new_members\.sql/);
  assert.match(failure, /rename each to a version after `20260829002000`/i);
});

test("the inverse passes: a normally-dated new migration against today's applied set", async () => {
  // Both environments are in sync at 54 migrations / 20260829002000. A gate
  // that failed the ordinary "add a migration dated now" case would be
  // unusable, and this is the assertion that says so.
  const recorded = JSON.parse(
    readFileSync("scripts/ci/__tests__/fixtures/staging-applied-2026-08-29-incident-1373.json", "utf8"),
  ).migrations;
  const applied = [...recorded, { version: "20260829000000", name: "rollover_promote_new_members" }];
  const base = applied.map((r) => m(r.version, r.name));
  const head = [...base, m("20260901120000", "a_perfectly_normal_migration")];
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "origin/main",
    environments: ENVIRONMENTS,
    readHead: () => head,
    readBase: () => base,
    fetchImpl: makeFetchMock(appliedRoute(applied)).fetchImpl,
    ...quiet,
  });
  assert.equal(code, 0);
});

test("production being behind does not fail an ordinary migration PR", async () => {
  // Production is deployed manually and is routinely many migrations behind.
  // A gate that read "not applied to production" as a fault would fail every
  // migration PR in the repo — the single most likely way this check could be
  // wrong, so it is asserted rather than assumed.
  const base = [m("20260101000000", "a"), m("20260601000000", "b")];
  const head = [...base, m("20260901000000", "new")];
  const productionApplied = [{ version: "20260101000000", name: "a" }]; // months behind
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "origin/main",
    environments: { production: ENVIRONMENTS.production },
    readHead: () => head,
    readBase: () => base,
    fetchImpl: makeFetchMock(appliedRoute(productionApplied)).fetchImpl,
    ...quiet,
  });
  assert.equal(code, 0);
});

test("an unreadable environment fails the gate end to end", async () => {
  const base = [m("20260101000000", "a")];
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "origin/main",
    environments: { staging: ENVIRONMENTS.staging },
    readHead: () => [...base, m("20260901000000", "new")],
    readBase: () => base,
    fetchImpl: makeFetchMock(appliedRoute([], 500)).fetchImpl,
    ...quiet,
  });
  assert.equal(code, 1);
});

// ── Invocation guards ───────────────────────────────────────────────────────

test("a missing base ref is an invocation error, not a pass", async () => {
  const code = await runOrderGate({ accessToken: "t", baseRef: "", ...quiet });
  assert.equal(code, 2);
});

test("an empty base ref listing is a broken checkout, not a huge change", async () => {
  // `git ls-tree` answers a path that does not exist with an empty list and
  // exit 0, so this cannot be caught by checking git's exit code. Left
  // unguarded, every migration in the repo would read as newly introduced.
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "origin/main",
    readHead: () => [m("20260101000000", "a")],
    readBase: () => [],
    ...quiet,
  });
  assert.equal(code, 2);
});

test("an empty head checkout is a broken checkout too", async () => {
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "origin/main",
    readHead: () => [],
    readBase: () => [m("20260101000000", "a")],
    ...quiet,
  });
  assert.equal(code, 2);
});

test("a base ref git cannot read is fatal rather than treated as empty", async () => {
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "refs/nope",
    readHead: () => [m("20260101000000", "a")],
    readBase: () => {
      throw new Error("fatal: not a valid object name");
    },
    ...quiet,
  });
  assert.equal(code, 2);
});

// ── Summary ─────────────────────────────────────────────────────────────────

test("the summary names the introduced files and every environment checked", () => {
  const introduced = [m("20260829000000", "rollover_promote_new_members")];
  const results = [
    { label: "staging", status: "ok", error: null, newestApplied: "20260829002000", offending: introduced, stranded: [] },
    { label: "production", status: "ok", error: null, newestApplied: "20260820000000", offending: [], stranded: [] },
  ];
  const local = { floor: "20260828000000", offending: [] };
  const text = buildOrderSummary({
    introduced,
    local,
    results,
    outcome: decideOrderOutcome({ local, results, introduced }),
    baseRef: "origin/main",
  });
  assert.match(text, /❌ \*\*FAIL\*\*/);
  assert.match(text, /20260829000000_rollover_promote_new_members\.sql/);
  assert.match(text, /`staging`/);
  assert.match(text, /`production`/);
});

// ── Clause 1: the local floor ───────────────────────────────────────────────
// No database, so it holds on forks, during a Supabase outage, and — the point
// — regardless of WHEN an environment happens to apply anything.

test("an introduced migration sorting before one already on base fails locally", () => {
  const surviving = [m("20260101000000", "a"), m("20260103000000", "c")];
  const { floor, offending } = classifyLocalOrder({
    introduced: [m("20260102000000", "b")],
    surviving,
  });
  assert.equal(floor, "20260103000000");
  assert.deepEqual(offending.map((x) => x.version), ["20260102000000"]);
});

test("the floor is the SURVIVING set, so renaming the bad base file turns the check green", () => {
  // A PR whose whole purpose is moving a far-future typo out of the way must be
  // able to pass. Were the floor computed over `base`, the version it is
  // removing would keep blocking it forever.
  const base = [m("20260101000000", "a"), m("20991231000000", "typo")];
  const head = [m("20260101000000", "a"), m("20260102000000", "typo")];
  const headVersions = new Set(head.map((x) => x.version));
  const surviving = base.filter((x) => headVersions.has(x.version));
  const introduced = introducedMigrations({ head, base });
  assert.deepEqual(removedMigrations({ head, base }).map((x) => x.version), ["20991231000000"]);
  assert.deepEqual(classifyLocalOrder({ introduced, surviving }).offending, []);
});

test("THE RACE: two PRs in flight, caught with no database consulted", async () => {
  // 10:00 PR-A (…120000) and PR-B (…090000) are both green against staging.
  // 10:02 A merges; B rebases. 10:03 B's gate re-runs — staging has NOT applied
  // A yet, so the applied-floor rule still passes B. 10:06 staging applies A.
  // 10:20 B merges and `db push` refuses. GitHub never expires a passed check,
  // so only a rule that reads B's BASE closes this.
  const base = [m("20260101000000", "old"), m("20260901120000", "pr_a")];
  const head = [...base, m("20260901090000", "pr_b")];
  const stagingStillBehind = [{ version: "20260101000000", name: "old" }];
  let failure = "";
  const { fetchImpl, calls } = makeFetchMock(appliedRoute(stagingStillBehind));
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "origin/main",
    environments: ENVIRONMENTS,
    readHead: () => head,
    readBase: () => base,
    fetchImpl,
    log: () => {},
    error: (text) => {
      failure += `${text}\n`;
    },
    writeSummary: () => {},
  });
  assert.equal(code, 1);
  assert.match(failure, /20260901090000_pr_b\.sql/);
  assert.match(failure, /already on the base branch/);
  // And it cost nothing: the verdict needed no database at all.
  assert.deepEqual(calls, []);
});

// ── Clause 3: stranding ─────────────────────────────────────────────────────

test("removing a migration an environment has applied is fatal", () => {
  // The missing half of "a rename fixes ordering". If the migration has already
  // been applied somewhere, the rename leaves a schema_migrations row no file
  // explains — a foreign row — and `db push` refuses to that environment from
  // then on. The remedy the gate prints elsewhere would brick the environment.
  const applied = [m("20260101000000", "a"), m("20260829000000", "rollover")];
  const { stranded } = classifyOrder({
    introduced: [m("20260829002001", "rollover")],
    removed: [m("20260829000000", "rollover")],
    applied,
  });
  assert.deepEqual(stranded.map((x) => x.version), ["20260829000000"]);

  const outcome = decideOrderOutcome({
    local: { floor: "20260101000000", offending: [] },
    introduced: [m("20260829002001", "rollover")],
    removed: [m("20260829000000", "rollover")],
    results: [{ label: "staging", status: "ok", error: null, newestApplied: "20260829000000", offending: [], stranded }],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "stranded-migrations");
  assert.match(outcome.message, /FOREIGN row/);
  assert.match(outcome.message, /forward migration instead/);
});

test("removing a migration nothing has applied is fine", () => {
  const applied = [m("20260101000000", "a")];
  const { stranded } = classifyOrder({
    introduced: [],
    removed: [m("20260829000000", "never_applied")],
    applied,
  });
  assert.deepEqual(stranded, []);
});

// ── Clause 4: an empty history is unreadable, not clean ─────────────────────

test("an empty applied list is treated as unreadable, not as a clean database", async () => {
  // Both real projects permanently hold `00000000000000_initial_schema`, so an
  // empty answer is a wrong ref, a token scoped elsewhere that answers 200 with
  // nothing, or a reset project. Read as "cannot be offended" it is a silent
  // false pass on the one read this gate depends on.
  const base = [m("20260101000000", "a")];
  let failure = "";
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "origin/main",
    environments: { staging: ENVIRONMENTS.staging },
    readHead: () => [...base, m("20260901000000", "new")],
    readBase: () => base,
    fetchImpl: makeFetchMock(appliedRoute([])).fetchImpl,
    log: () => {},
    error: (text) => {
      failure += `${text}\n`;
    },
    writeSummary: () => {},
  });
  assert.equal(code, 1);
  assert.match(failure, /EMPTY migration history/);
  assert.match(failure, /allowEmptyMigrationHistory/);
});

test("a genuinely new project can opt out of the empty-history rule", async () => {
  const base = [m("20260101000000", "a")];
  const code = await runOrderGate({
    accessToken: "t",
    baseRef: "origin/main",
    environments: {
      staging: { ...ENVIRONMENTS.staging, allowEmptyMigrationHistory: true },
    },
    readHead: () => [...base, m("20260901000000", "new")],
    readBase: () => base,
    fetchImpl: makeFetchMock(appliedRoute([])).fetchImpl,
    ...quiet,
  });
  assert.equal(code, 0);
});

// ── Clause 5: remote versions of the wrong shape ────────────────────────────

test("an applied version that is not a 14-digit stamp is excluded from the floor", () => {
  // `localeCompare` against arbitrary remote text answers confidently and
  // wrongly — a version of "9" beats every date in this repo's history.
  const applied = [m("20260101000000", "a"), { version: "9", name: "nonsense" }];
  const { newestApplied, badVersions, offending } = classifyOrder({
    introduced: [m("20260102000000", "b")],
    applied,
  });
  assert.equal(newestApplied, "20260101000000");
  assert.deepEqual(badVersions.map((x) => x.version), ["9"]);
  assert.deepEqual(offending, []);
});

// ── Clause 6, and the fork path ─────────────────────────────────────────────

test("introducing migrations while checking NO environment is a failure", () => {
  // A verdict of "fine" reached having consulted nothing is the false green
  // every gate in this repo is written to avoid.
  const outcome = decideOrderOutcome({
    local: { floor: "20260101000000", offending: [] },
    introduced: [m("20260901000000", "x")],
    results: [],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "no-environment-checked");
});

test("local-only mode passes on the base-branch rule alone, and says so", async () => {
  // A fork PR gets no secrets. Reporting Success having skipped the whole job
  // is what a job-level fork guard does; running the rule that needs nothing
  // and naming what was not checked is strictly more than that.
  const base = [m("20260101000000", "a")];
  let summary = "";
  const { fetchImpl, calls } = makeFetchMock(appliedRoute([]));
  const code = await runOrderGate({
    accessToken: undefined,
    baseRef: "origin/main",
    localOnly: true,
    environments: ENVIRONMENTS,
    readHead: () => [...base, m("20260901000000", "new")],
    readBase: () => base,
    fetchImpl,
    log: () => {},
    error: () => {},
    writeSummary: (text) => {
      summary = text;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, [], "local-only must make no network calls");
  assert.match(summary, /not.*checked/is);
});

test("local-only mode still fails the base-branch rule", async () => {
  const base = [m("20260101000000", "a"), m("20260901120000", "later")];
  const code = await runOrderGate({
    accessToken: undefined,
    baseRef: "origin/main",
    localOnly: true,
    environments: ENVIRONMENTS,
    readHead: () => [...base, m("20260901090000", "earlier")],
    readBase: () => base,
    fetchImpl: makeFetchMock(appliedRoute([])).fetchImpl,
    ...quiet,
  });
  assert.equal(code, 1);
});
