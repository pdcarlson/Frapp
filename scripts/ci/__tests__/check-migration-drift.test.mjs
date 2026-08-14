import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ALERT_ISSUE_LABELS,
  ALERT_ISSUE_TITLE,
  classifyDrift,
  describeTarget,
  fetchAppliedMigrations,
  overallStatus,
  parseMigrationFilename,
  parseTargets,
  readLocalMigrations,
  runMigrationDriftCheck,
  versionToEpochMs,
} from "../check-migration-drift.mjs";
import { makeFetchMock, quiet } from "./helpers.mjs";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Modeled on the two real drift modes measured on 2026-08-10 (staging, since
// remediated) and 2026-08-14 (production, still live — see #832):
//
//   BEHIND  — schema_migrations held 2 rows against 39 repo files.
//   FOREIGN — the history carried 20260228000000_enable_rls_on_remaining_tables,
//             a version that has never existed in this repository.

const INITIAL = { version: "00000000000000", name: "initial_schema" };
const FOREIGN_FEB = {
  version: "20260228000000",
  name: "enable_rls_on_remaining_tables",
};

/** A repo-side migration list of `count` entries, all authored 2026-08-09. */
function localFixture(count) {
  const migrations = [INITIAL];
  for (let i = 1; i < count; i += 1) {
    const version = `202608090${String(i).padStart(5, "0")}`;
    migrations.push({ version, name: `migration_${i}`, file: `${version}_migration_${i}.sql` });
  }
  return migrations;
}

// 2026-08-14T04:00:00Z — comfortably more than 24h after the 2026-08-09 fixtures.
const NOW = Date.UTC(2026, 7, 14, 4, 0, 0);
const GRACE_MS = 24 * 60 * 60 * 1000;

function githubRoutes({ issues = [], createStatus = 201 } = {}) {
  return [
    { method: "GET", path: "issues?state=all", body: issues },
    { method: "POST", path: "/comments", body: {} },
    { method: "POST", path: "/issues", status: createStatus, body: { number: 901 } },
    { method: "PATCH", path: "/issues/", body: {} },
  ];
}

function supabaseRoute(ref, migrations, status = 200) {
  return { method: "GET", path: `/projects/${ref}/database/migrations`, status, body: migrations };
}

// ── parseMigrationFilename / readLocalMigrations ────────────────────────────

test("parseMigrationFilename accepts versioned .sql files and rejects everything else", () => {
  assert.deepEqual(
    parseMigrationFilename("20260809120000_chapter_document_folders.sql"),
    {
      version: "20260809120000",
      name: "chapter_document_folders",
      file: "20260809120000_chapter_document_folders.sql",
    },
  );

  // The initial schema is 14 zeros — a real version that is not a real date.
  assert.equal(parseMigrationFilename("00000000000000_initial_schema.sql").version, "00000000000000");

  for (const rejected of [
    "README.md",
    "20260809120000_thing.sql.bak",
    "no_version_prefix.sql",
    "2026080912_short_version.sql",
    "20260809120000.sql", // version but no name
  ]) {
    assert.equal(parseMigrationFilename(rejected), null, `should reject ${rejected}`);
  }
});

test("readLocalMigrations filters non-migrations and sorts by version", () => {
  const dir = mkdtempSync(join(tmpdir(), "drift-test-"));
  try {
    writeFileSync(join(dir, "20260809120000_later.sql"), "");
    writeFileSync(join(dir, "00000000000000_initial_schema.sql"), "");
    writeFileSync(join(dir, "20250226120000_earlier.sql"), "");
    writeFileSync(join(dir, "README.md"), "");
    mkdirSync(join(dir, "subdir"));

    const local = readLocalMigrations(dir);
    assert.deepEqual(
      local.map((m) => m.version),
      ["00000000000000", "20250226120000", "20260809120000"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readLocalMigrations returns [] for a missing directory rather than throwing", () => {
  assert.deepEqual(readLocalMigrations(join(tmpdir(), "definitely-not-a-real-dir-9f2a1c0")), []);
});

// ── versionToEpochMs ────────────────────────────────────────────────────────

test("versionToEpochMs maps the initial schema to 0 so it is never graced", () => {
  assert.equal(versionToEpochMs("00000000000000"), 0);
});

test("versionToEpochMs parses a real version as UTC", () => {
  assert.equal(versionToEpochMs("20260809120000"), Date.UTC(2026, 7, 9, 12, 0, 0));
});

test("versionToEpochMs returns null for malformed versions", () => {
  for (const bad of [
    "2026080912000", // 13 digits
    "202608091200000", // 15 digits
    "2026ab09120000", // non-numeric
    "20261309120000", // month 13
    "20260800120000", // day 0
    "20260809250000", // hour 25
    "20260809126000", // minute 60
    "20260809120060", // second 60
  ]) {
    assert.equal(versionToEpochMs(bad), null, `should reject ${bad}`);
  }
});

// ── parseTargets ────────────────────────────────────────────────────────────

test("parseTargets reads label=ref pairs and tolerates whitespace", () => {
  assert.deepEqual(parseTargets(" staging=abc123 , production=def456 "), [
    { label: "staging", ref: "abc123" },
    { label: "production", ref: "def456" },
  ]);
});

test("parseTargets drops malformed entries instead of failing the whole run", () => {
  // A typo in one target must not stop the other target being checked.
  assert.deepEqual(parseTargets("staging=abc,garbage,=noref,nolabel=,production=def"), [
    { label: "staging", ref: "abc" },
    { label: "production", ref: "def" },
  ]);
  assert.deepEqual(parseTargets(""), []);
  assert.deepEqual(parseTargets(undefined), []);
});

// ── fetchAppliedMigrations ──────────────────────────────────────────────────

test("fetchAppliedMigrations accepts a bare array response", async () => {
  const { fetchImpl, calls } = makeFetchMock([supabaseRoute("ref1", [FOREIGN_FEB, INITIAL])]);
  const result = await fetchAppliedMigrations({
    accessToken: "tok",
    projectRef: "ref1",
    fetchImpl,
  });

  assert.equal(result.ok, true);
  // Sorted by version regardless of response order.
  assert.deepEqual(
    result.migrations.map((m) => m.version),
    ["00000000000000", "20260228000000"],
  );
  assert.match(calls[0].url, /api\.supabase\.com\/v1\/projects\/ref1\/database\/migrations$/);
});

test("fetchAppliedMigrations accepts a { migrations: [...] } wrapper", async () => {
  const { fetchImpl } = makeFetchMock([
    supabaseRoute("ref1", { migrations: [INITIAL] }),
  ]);
  const result = await fetchAppliedMigrations({
    accessToken: "tok",
    projectRef: "ref1",
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.migrations.length, 1);
});

test("fetchAppliedMigrations reports an unrecognised shape as an error, never as zero migrations", async () => {
  // This is the important one: reading an unexpected wrapper as "no migrations
  // applied" would look identical to catastrophic drift and would open a
  // maximally alarming alert on a purely cosmetic upstream change.
  const { fetchImpl } = makeFetchMock([supabaseRoute("ref1", { data: [INITIAL] })]);
  const result = await fetchAppliedMigrations({
    accessToken: "tok",
    projectRef: "ref1",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.migrations.length, 0);
  assert.match(result.error, /no migration list/);
});

test("fetchAppliedMigrations surfaces HTTP failures", async () => {
  const { fetchImpl } = makeFetchMock([supabaseRoute("ref1", { message: "nope" }, 401)]);
  const result = await fetchAppliedMigrations({
    accessToken: "bad",
    projectRef: "ref1",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 401/);
});

test("fetchAppliedMigrations survives a network rejection", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNRESET");
  };
  const result = await fetchAppliedMigrations({
    accessToken: "tok",
    projectRef: "ref1",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNRESET/);
});

// ── classifyDrift ───────────────────────────────────────────────────────────

test("classifyDrift reports clean when the repo and database agree", () => {
  const local = localFixture(5);
  const result = classifyDrift({ local, remote: local, nowMs: NOW, graceMs: GRACE_MS });

  assert.equal(result.status, "clean");
  assert.equal(result.matched.length, 5);
  assert.equal(result.pending.length, 0);
  assert.equal(result.foreign.length, 0);
});

test("classifyDrift reproduces the live production shape: 37 pending + 1 foreign", () => {
  // frapp-prod on 2026-08-14: schema_migrations held exactly two rows, one of
  // which has never existed in this repository.
  const local = localFixture(38);
  const remote = [INITIAL, FOREIGN_FEB];
  const result = classifyDrift({ local, remote, nowMs: NOW, graceMs: GRACE_MS });

  assert.equal(result.status, "drift");
  assert.equal(result.matched.length, 1);
  assert.equal(result.overdue.length, 37);
  assert.equal(result.withinGrace.length, 0);
  assert.deepEqual(
    result.foreign.map((m) => m.version),
    ["20260228000000"],
  );
});

test("classifyDrift graces a freshly merged migration", () => {
  const local = [
    INITIAL,
    { version: "20260814030000", name: "brand_new", file: "20260814030000_brand_new.sql" },
  ];
  const result = classifyDrift({ local, remote: [INITIAL], nowMs: NOW, graceMs: GRACE_MS });

  // Authored one hour ago — legitimately not applied yet.
  assert.equal(result.status, "clean");
  assert.equal(result.withinGrace.length, 1);
  assert.equal(result.overdue.length, 0);
});

test("classifyDrift stops gracing a migration once the window elapses", () => {
  const local = [
    INITIAL,
    { version: "20260812030000", name: "two_days_old", file: "20260812030000_two_days_old.sql" },
  ];
  const result = classifyDrift({ local, remote: [INITIAL], nowMs: NOW, graceMs: GRACE_MS });

  assert.equal(result.status, "drift");
  assert.equal(result.overdue.length, 1);
});

test("classifyDrift never graces a foreign row, even a brand-new one", () => {
  // A version the repo has never contained is wrong the moment it appears, and
  // it blocks `db push` outright — the grace window must not apply to it.
  const local = [INITIAL];
  const remote = [
    INITIAL,
    { version: "20260814033000", name: "hand_applied_just_now" },
  ];
  const result = classifyDrift({ local, remote, nowMs: NOW, graceMs: GRACE_MS });

  assert.equal(result.status, "drift");
  assert.equal(result.foreign.length, 1);
});

test("classifyDrift treats an unparseable pending version as overdue, not graced", () => {
  const local = [{ version: "not-a-version", name: "weird", file: "weird.sql" }];
  const result = classifyDrift({ local, remote: [], nowMs: NOW, graceMs: GRACE_MS });

  assert.equal(result.status, "drift");
  assert.equal(result.overdue.length, 1);
});

// ── overallStatus ───────────────────────────────────────────────────────────

test("overallStatus ranks drift over unknown over clean", () => {
  assert.equal(overallStatus([{ status: "clean" }, { status: "clean" }]), "clean");
  assert.equal(overallStatus([{ status: "clean" }, { status: "unknown" }]), "unknown");
  assert.equal(overallStatus([{ status: "unknown" }, { status: "drift" }]), "drift");
});

// ── describeTarget ──────────────────────────────────────────────────────────

test("describeTarget distinguishes in-sync, graced, drifting and unreadable", () => {
  assert.equal(
    describeTarget({ status: "clean", withinGrace: [], overdue: [], foreign: [] }),
    "in sync",
  );
  assert.match(
    describeTarget({ status: "clean", withinGrace: [1], overdue: [], foreign: [] }),
    /1 pending within grace/,
  );
  assert.match(
    describeTarget({ status: "drift", withinGrace: [], overdue: [1, 2], foreign: [3] }),
    /DRIFTING — 2 pending, 1 foreign/,
  );
  assert.match(
    describeTarget({ status: "unknown", error: "HTTP 401" }),
    /could not be read — HTTP 401/,
  );
});

// ── runMigrationDriftCheck ──────────────────────────────────────────────────

const baseRun = {
  token: "gh-token",
  repo: "pdcarlson/Frapp",
  accessToken: "sb-token",
  nowMs: NOW,
  graceHours: 24,
  runUrl: "https://github.com/pdcarlson/Frapp/actions/runs/1",
  writeSummary: () => {},
  logger: quiet,
};

test("a clean run exits 0 and closes an open alert issue", async () => {
  const local = localFixture(3);
  const { fetchImpl, calls } = makeFetchMock([
    supabaseRoute("stg", local),
    ...githubRoutes({ issues: [{ number: 42, state: "open", title: ALERT_ISSUE_TITLE }] }),
  ]);

  const result = await runMigrationDriftCheck({
    ...baseRun,
    targets: [{ label: "staging", ref: "stg" }],
    local,
    fetchImpl,
  });

  assert.equal(result.status, "clean");
  assert.equal(result.exitCode, 0);
  assert.equal(result.alert.action, "closed");
  assert.deepEqual(result.alert.closed, [42]);

  const closing = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(JSON.parse(closing.body), { state: "closed", state_reason: "completed" });
});

test("a clean run with no open alert touches nothing", async () => {
  const local = localFixture(3);
  const { fetchImpl, calls } = makeFetchMock([
    supabaseRoute("stg", local),
    ...githubRoutes({ issues: [] }),
  ]);

  const result = await runMigrationDriftCheck({
    ...baseRun,
    targets: [{ label: "staging", ref: "stg" }],
    local,
    fetchImpl,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.alert.action, "none");
  assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});

test("drift creates the alert issue when none exists, and exits 1", async () => {
  const local = localFixture(38);
  const { fetchImpl, calls } = makeFetchMock([
    supabaseRoute("prod", [INITIAL, FOREIGN_FEB]),
    ...githubRoutes({ issues: [] }),
  ]);

  const result = await runMigrationDriftCheck({
    ...baseRun,
    targets: [{ label: "production", ref: "prod" }],
    local,
    fetchImpl,
  });

  assert.equal(result.status, "drift");
  assert.equal(result.exitCode, 1);
  assert.equal(result.alert.action, "created");

  const created = JSON.parse(calls.find((c) => c.method === "POST").body);
  assert.equal(created.title, ALERT_ISSUE_TITLE);
  assert.deepEqual(created.labels, ALERT_ISSUE_LABELS);
  // The body must name both drift modes and warn off the destructive repair.
  assert.match(created.body, /Foreign \(1\)/);
  assert.match(created.body, /Pending \(37\)/);
  assert.match(created.body, /do not run it blind/i);
});

test("drift comments on an already-open alert rather than filing a second one", async () => {
  const local = localFixture(38);
  const { fetchImpl, calls } = makeFetchMock([
    supabaseRoute("prod", [INITIAL, FOREIGN_FEB]),
    ...githubRoutes({ issues: [{ number: 42, state: "open", title: ALERT_ISSUE_TITLE }] }),
  ]);

  const result = await runMigrationDriftCheck({
    ...baseRun,
    targets: [{ label: "production", ref: "prod" }],
    local,
    fetchImpl,
  });

  assert.equal(result.alert.action, "commented");
  assert.equal(result.alert.issueNumber, 42);
  // Never a fresh issue per failure — alert spam is how alerting gets muted.
  assert.equal(calls.some((c) => c.method === "POST" && c.url.endsWith("/issues")), false);
  assert.equal(calls.some((c) => c.method === "PATCH"), false);
});

test("drift reopens a closed alert", async () => {
  const local = localFixture(38);
  const { fetchImpl, calls } = makeFetchMock([
    supabaseRoute("prod", [INITIAL, FOREIGN_FEB]),
    ...githubRoutes({ issues: [{ number: 42, state: "closed", title: ALERT_ISSUE_TITLE }] }),
  ]);

  const result = await runMigrationDriftCheck({
    ...baseRun,
    targets: [{ label: "production", ref: "prod" }],
    local,
    fetchImpl,
  });

  assert.equal(result.alert.action, "reopened");
  const reopen = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(JSON.parse(reopen.body), { state: "open" });
});

test("an unreadable target neither raises nor closes an alert, and exits 1", async () => {
  // The regression this guards: a Management API blip must not close a live
  // drift alert (silencing a real outage), and must not open one either
  // (nothing was observed to be drifting).
  const local = localFixture(3);
  const { fetchImpl, calls } = makeFetchMock([
    supabaseRoute("stg", { message: "unauthorized" }, 401),
    ...githubRoutes({ issues: [{ number: 42, state: "open", title: ALERT_ISSUE_TITLE }] }),
  ]);

  const result = await runMigrationDriftCheck({
    ...baseRun,
    targets: [{ label: "staging", ref: "stg" }],
    local,
    fetchImpl,
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.exitCode, 1);
  assert.equal(result.alert.action, "none");
  assert.equal(calls.some((c) => c.method !== "GET"), false);
});

test("one unreadable target does not mask drift on another", async () => {
  const local = localFixture(38);
  const { fetchImpl } = makeFetchMock([
    supabaseRoute("stg", { message: "boom" }, 500),
    supabaseRoute("prod", [INITIAL, FOREIGN_FEB]),
    ...githubRoutes({ issues: [] }),
  ]);

  const result = await runMigrationDriftCheck({
    ...baseRun,
    targets: [
      { label: "staging", ref: "stg" },
      { label: "production", ref: "prod" },
    ],
    local,
    fetchImpl,
  });

  assert.equal(result.status, "drift");
  assert.equal(result.exitCode, 1);
  assert.equal(result.alert.action, "created");
  assert.equal(result.results[0].status, "unknown");
  assert.equal(result.results[1].status, "drift");
});

test("every target is checked, and each appears in the run summary", async () => {
  const local = localFixture(3);
  let summary = "";
  const { fetchImpl } = makeFetchMock([
    supabaseRoute("stg", local),
    supabaseRoute("prod", [INITIAL]),
    ...githubRoutes({ issues: [] }),
  ]);

  const result = await runMigrationDriftCheck({
    ...baseRun,
    targets: [
      { label: "staging", ref: "stg" },
      { label: "production", ref: "prod" },
    ],
    local,
    fetchImpl,
    writeSummary: (text) => {
      summary = text;
    },
  });

  assert.equal(result.results.length, 2);
  assert.match(summary, /DRIFT DETECTED/);
  assert.match(summary, /\| `staging` \| 3 \| 3 \| in sync \|/);
  assert.match(summary, /`production`/);
});

test("a failed issue-create is reported without throwing", async () => {
  const local = localFixture(38);
  const { fetchImpl } = makeFetchMock([
    supabaseRoute("prod", [INITIAL, FOREIGN_FEB]),
    ...githubRoutes({ issues: [], createStatus: 403 }),
  ]);

  const result = await runMigrationDriftCheck({
    ...baseRun,
    targets: [{ label: "production", ref: "prod" }],
    local,
    fetchImpl,
  });

  assert.equal(result.alert.action, "failed");
  // Drift is still the verdict — a write failure must not turn the run green.
  assert.equal(result.exitCode, 1);
});
