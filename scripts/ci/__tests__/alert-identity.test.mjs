import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT_ASSIGNEE,
  ALERT_LOOKUP_LABEL,
  isDefinedAlert,
  raiseAlert,
  resolveAlert,
} from "../lib/alert-issue.mjs";
import * as checkMigrationDrift from "../check-migration-drift.mjs";
import * as deployAlert from "../deploy-alert.mjs";
import * as prBaseSync from "../pr-base-sync.mjs";
import * as productionAuthConformance from "../production-auth-conformance.mjs";
import * as productionBackupEnv from "../production-backup-env.mjs";
import * as productionBackupFreshness from "../production-backup-freshness.mjs";
import * as productionBackupStorageFreshness from "../production-backup-storage-freshness.mjs";
import * as productionGuardrails from "../production-guardrails.mjs";
import * as productionReleasePin from "../production-release-pin.mjs";
import * as productionUptime from "../production-uptime.mjs";
import * as stagingConformance from "../staging-conformance.mjs";

import { makeFetchMock } from "./helpers.mjs";

// Every watchdog's alert identity, across all of them at once (#2505).
//
// An alert is found again by its exact title within its lookup label. Moving
// that label (`routine-state` → `incident`, ADR-24 decision 2) is only safe if
// every watchdog moves in the same change: one left behind stops finding its
// own open alert, files a duplicate on the next failure, and never closes the
// original on recovery. Each watchdog's own suite tests its flow; this one tests
// that they agree.
//
// Since #1731 every identity is made by the lib's `defineAlert`, and the lib's
// functions take nothing else and accept no lookup label, so a watchdog can't
// look up or file under a label of its own. What this file still checks is
// that each watchdog uses that path: one exported identity, no second shape.

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A source file without its comment lines: prose may name a label, code may not. */
function codeLines(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

// One row per alert. deploy-alert.mjs serves two workflows from one table.
const FLAT = {
  "check-migration-drift": checkMigrationDrift,
  "pr-base-sync": prBaseSync,
  "production-auth-conformance": productionAuthConformance,
  "production-backup-env": productionBackupEnv,
  "production-backup-freshness": productionBackupFreshness,
  "production-backup-storage-freshness": productionBackupStorageFreshness,
  "production-guardrails": productionGuardrails,
  "production-release-pin": productionReleasePin,
  "production-uptime": productionUptime,
  "staging-conformance": stagingConformance,
};
const ALERTS = [
  ...Object.entries(FLAT).map(([script, mod]) => ({ name: script, script, alert: mod.ALERT })),
  ...Object.values(deployAlert.ALERT_CONFIGS).map((config) => ({
    name: `deploy-alert:${config.name}`,
    script: "deploy-alert",
    alert: config.alert,
  })),
];

test("the lookup label and assignee are the ones ADR-24 decision 2 names", () => {
  // AGENTS.md, /next §0.2 and github-pm.md skip issues by this label name, so
  // it cannot move without them.
  assert.equal(ALERT_LOOKUP_LABEL, "incident");
  assert.equal(ALERT_ASSIGNEE, "pdcarlson");
});

test("every script that raises an alert is covered here", () => {
  // A new watchdog that imports the lib but is missing from this file would
  // escape the agreement checks below.
  const raisers = readdirSync(SCRIPTS_DIR)
    .filter((file) => file.endsWith(".mjs"))
    .filter((file) => readFileSync(join(SCRIPTS_DIR, file), "utf8").includes("lib/alert-issue.mjs"))
    .map((file) => file.replace(/\.mjs$/, ""))
    .sort();
  assert.deepEqual(raisers, [...new Set(ALERTS.map((alert) => alert.script))].sort());
});

test("every alert is an identity defineAlert made, filed under the lib's label", () => {
  for (const { name, alert } of ALERTS) {
    assert.ok(isDefinedAlert(alert), `${name} is not a defineAlert identity`);
    assert.equal(alert.labels[0], ALERT_LOOKUP_LABEL, `${name} created labels`);
  }
});

test("no watchdog declares an identity outside defineAlert", () => {
  // The lib refuses a hand-built identity at runtime, but only on the path a
  // test drives. These are the shapes that came before #1731; any of them in
  // code means a second way to say what an alert is has come back.
  const retired = [
    /\bALERT_ISSUE_(TITLE|LABELS|LOOKUP_LABEL)\b/,
    /\blookupLabel\b/,
    /\b(alertTitle|alertLabels|retiredAlertTitles)\b/,
  ];
  for (const script of new Set(ALERTS.map((alert) => alert.script))) {
    const code = codeLines(readFileSync(join(SCRIPTS_DIR, `${script}.mjs`), "utf8"));
    for (const shape of retired) assert.doesNotMatch(code, shape, script);
    assert.ok(/\bdefineAlert\(/.test(code), `${script} declares its alert with defineAlert`);
  }
});

test("no two alerts share an identity", () => {
  // With one shared label, the title alone tells alerts apart. Two watchdogs on
  // one title would comment on, and close, each other's incident.
  const titles = ALERTS.map(({ alert }) => alert.title);
  assert.equal(new Set(titles).size, titles.length);
});

test("no script outside the lib names an alert label itself", () => {
  // The old label as a literal is how a watchdog gets left behind. The ledger
  // and state issues that still carry `routine-state` are written by the
  // routines through the MCP, never by these scripts.
  const offenders = [];
  for (const dir of [SCRIPTS_DIR, join(SCRIPTS_DIR, "lib")]) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".mjs"))) {
      const code = codeLines(readFileSync(join(dir, file), "utf8"));
      if (/["'`]routine-state["'`]/.test(code)) offenders.push(`${file}: routine-state`);
      if (file !== "alert-issue.mjs" && /["'`]incident["'`]/.test(code)) offenders.push(`${file}: incident`);
    }
  }
  assert.deepEqual(offenders, []);
});

/**
 * A GitHub mock that serves `issues` only to a lookup filtered by `label`.
 * The per-script suites answer any lookup, so they can't tell which label a
 * watchdog asked for; this one can.
 */
function labelStrictGitHub({ label, issues }) {
  return makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: (calls) =>
        new URL(calls.at(-1).url).searchParams.get("labels") === label ? issues : [],
    },
    { method: "POST", path: "/comments", body: {} },
    { method: "POST", path: "/issues", body: { number: 999 } },
    { method: "PATCH", path: "/issues/", body: {} },
  ]);
}

const builders = {
  buildIssueBody: () => "body",
  buildCommentBody: () => "still failing",
  buildRecoveryBody: () => "recovered",
};

for (const { name, alert } of ALERTS) {
  test(`${name}: an open incident alert is commented, never duplicated, and recovery closes it`, async () => {
    const issues = [{ number: 42, state: "open", title: alert.title }];
    const identity = { token: "t", repo: "o/r", alert };

    const raise = labelStrictGitHub({ label: ALERT_LOOKUP_LABEL, issues });
    const raised = await raiseAlert({ ...identity, fetchImpl: raise.fetchImpl, ...builders });
    assert.deepEqual(raised, { action: "commented", issueNumber: 42 });
    assert.equal(
      raise.calls.some((c) => c.method === "POST" && c.url.endsWith("/issues")),
      false,
      "a second issue was filed",
    );

    const resolve = labelStrictGitHub({ label: ALERT_LOOKUP_LABEL, issues });
    const resolved = await resolveAlert({ ...identity, fetchImpl: resolve.fetchImpl, ...builders });
    assert.deepEqual(resolved, { action: "closed", closed: [42] });
  });
}

test("the old label is no longer read: an alert left only on it is not found", async () => {
  // Negative control for the mock above, and the reason the open alerts are
  // relabelled when this ships: an alert still carrying only `routine-state`
  // is invisible to every watchdog, so the next failure files a fresh issue.
  const [{ alert }] = ALERTS;
  const { fetchImpl, calls } = labelStrictGitHub({
    label: "routine-state",
    issues: [{ number: 42, state: "open", title: alert.title }],
  });
  const raised = await raiseAlert({ token: "t", repo: "o/r", fetchImpl, alert, ...builders });
  assert.equal(raised.action, "created");
  const created = JSON.parse(calls.find((c) => c.method === "POST" && c.url.endsWith("/issues")).body);
  assert.deepEqual(created.assignees, [ALERT_ASSIGNEE]);
});
