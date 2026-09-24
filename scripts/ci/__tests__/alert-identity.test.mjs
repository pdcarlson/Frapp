import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT_ASSIGNEE,
  ALERT_LOOKUP_LABEL,
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

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  ...Object.entries(FLAT).map(([script, mod]) => ({
    name: script,
    script,
    title: mod.ALERT_ISSUE_TITLE,
    labels: mod.ALERT_ISSUE_LABELS,
    lookupLabel: mod.ALERT_ISSUE_LOOKUP_LABEL,
  })),
  ...Object.values(deployAlert.ALERT_CONFIGS).map((config) => ({
    name: `deploy-alert:${config.name}`,
    script: "deploy-alert",
    title: config.alertTitle,
    labels: config.alertLabels,
    lookupLabel: deployAlert.ALERT_ISSUE_LOOKUP_LABEL,
  })),
];

test("the lookup label and assignee are the ones ADR-24 decision 2 names", () => {
  // AGENTS.md, /next §0.2 and GITHUB_PM.md skip issues by this label name, so
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

test("every watchdog looks its alert up by the lib's label, and files under it", () => {
  for (const alert of ALERTS) {
    assert.equal(alert.lookupLabel, ALERT_LOOKUP_LABEL, `${alert.name} lookup label`);
    assert.ok(alert.labels.includes(ALERT_LOOKUP_LABEL), `${alert.name} created labels`);
  }
});

test("every call site passes the lib-derived label, and nothing else", () => {
  // The exported alias is checked above, but a call site could still pass a
  // literal or a local variable of its own, and the label-strict tests below
  // use the export, so they would never see it. Each script declares the alias
  // once, from the lib, and every `lookupLabel:` it writes is that alias.
  for (const script of new Set(ALERTS.map((alert) => alert.script))) {
    const source = readFileSync(join(SCRIPTS_DIR, `${script}.mjs`), "utf8");
    const declarations = source.match(/\bALERT_ISSUE_LOOKUP_LABEL\s*=[^=].*$/gm) ?? [];
    assert.deepEqual(
      declarations,
      ["ALERT_ISSUE_LOOKUP_LABEL = ALERT_LOOKUP_LABEL;"],
      `${script} declares its lookup label once, from the lib`,
    );
    const passed = [...source.matchAll(/\blookupLabel\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim());
    assert.ok(passed.length > 0, `${script} passes its lookup label`);
    for (const value of passed) {
      assert.equal(value, "ALERT_ISSUE_LOOKUP_LABEL", `${script} passes lookupLabel: ${value}`);
    }
  }
});

test("no two alerts share an identity", () => {
  // With one shared label, the title alone tells alerts apart. Two watchdogs on
  // one title would comment on, and close, each other's incident.
  const titles = ALERTS.map((alert) => alert.title);
  assert.equal(new Set(titles).size, titles.length);
});

test("no script outside the lib names an alert label itself", () => {
  // The old label as a literal is how a watchdog gets left behind. The ledger
  // and state issues that still carry `routine-state` are written by the
  // routines through the MCP, never by these scripts. Comment lines are
  // skipped: prose may name a label in backticks.
  const offenders = [];
  for (const dir of [SCRIPTS_DIR, join(SCRIPTS_DIR, "lib")]) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".mjs"))) {
      const code = readFileSync(join(dir, file), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
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

for (const alert of ALERTS) {
  test(`${alert.name}: an open incident alert is commented, never duplicated, and recovery closes it`, async () => {
    const issues = [{ number: 42, state: "open", title: alert.title }];
    const identity = { token: "t", repo: "o/r", title: alert.title, lookupLabel: alert.lookupLabel };

    const raise = labelStrictGitHub({ label: ALERT_LOOKUP_LABEL, issues });
    const raised = await raiseAlert({
      ...identity,
      fetchImpl: raise.fetchImpl,
      labels: alert.labels,
      ...builders,
    });
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
  const [alert] = ALERTS;
  const { fetchImpl, calls } = labelStrictGitHub({
    label: "routine-state",
    issues: [{ number: 42, state: "open", title: alert.title }],
  });
  const raised = await raiseAlert({
    token: "t",
    repo: "o/r",
    fetchImpl,
    title: alert.title,
    labels: alert.labels,
    lookupLabel: alert.lookupLabel,
    ...builders,
  });
  assert.equal(raised.action, "created");
  const created = JSON.parse(calls.find((c) => c.method === "POST" && c.url.endsWith("/issues")).body);
  assert.deepEqual(created.assignees, [ALERT_ASSIGNEE]);
});
