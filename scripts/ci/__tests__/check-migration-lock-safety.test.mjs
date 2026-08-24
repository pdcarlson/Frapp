import { test } from "node:test";
import assert from "node:assert/strict";

// check-migration-lock-safety.mjs is a general-purpose script under scripts/
// (a peer of the other check-*.mjs gates); its test lives here so the existing
// `test:ci-scripts` glob runs it — hence the ../../ reach up.
import {
  buildSummary,
  countByRule,
  groupByFile,
  migrationFilesFromDiff,
  severityRank,
} from "../../check-migration-lock-safety.mjs";

// Findings shaped like real Squawk JSON output, taken from the measured run
// over this repo's migrations on 2026-08-24.
const FINDINGS = [
  {
    file: "supabase/migrations/20260531120000_member_custom_field_values.sql",
    line: 16,
    severity: "warning",
    rule_name: "constraint-missing-not-valid",
    message: "By default new constraints require a table scan and block writes.",
    help: "Add NOT VALID, then VALIDATE CONSTRAINT in a later migration.",
  },
  {
    file: "supabase/migrations/20260531120000_member_custom_field_values.sql",
    line: 16,
    severity: "warning",
    rule_name: "disallowed-unique-constraint",
    message: "Adding a `UNIQUE` constraint requires an `ACCESS EXCLUSIVE` lock.",
  },
  {
    file: "supabase/migrations/20260823120000_chat_message_authors.sql",
    line: 31,
    severity: "error",
    rule_name: "ban-drop-not-null",
    message: "Dropping a `NOT NULL` constraint may break existing clients.",
  },
];

// ── migrationFilesFromDiff ──────────────────────────────────────────────────

test("only .sql files under supabase/migrations are linted", () => {
  const result = migrationFilesFromDiff([
    "supabase/migrations/20260824120000_discord_import.sql",
    "supabase/seed/chapter_directory.csv",
    "apps/api/src/main.ts",
    "supabase/migrations/README.md",
    "docs/internal/ops/DB_PROMOTION_RUNBOOK.md",
  ]);

  // The existsSync filter drops the migration too (this fixture path is not on
  // disk), which is the behaviour a deleted migration relies on.
  assert.ok(!result.includes("apps/api/src/main.ts"));
  assert.ok(!result.includes("supabase/migrations/README.md"));
  assert.ok(!result.includes("supabase/seed/chapter_directory.csv"));
});

test("a real migration on disk is selected", () => {
  const result = migrationFilesFromDiff([
    "supabase/migrations/20260824150000_discord_connect_confirm.sql",
    "package.json",
  ]);
  assert.deepEqual(result, [
    "supabase/migrations/20260824150000_discord_connect_confirm.sql",
  ]);
});

test("a migration deleted in the change is not linted", () => {
  // Squawk would fail on a path that no longer exists; the existsSync filter is
  // what keeps a deletion from breaking the job.
  const result = migrationFilesFromDiff([
    "supabase/migrations/29999999999999_deleted_in_this_pr.sql",
  ]);
  assert.deepEqual(result, []);
});

// ── Grouping and counting ───────────────────────────────────────────────────

test("findings group by file", () => {
  const grouped = groupByFile(FINDINGS);
  assert.equal(grouped.size, 2);
  assert.equal(
    grouped.get("supabase/migrations/20260531120000_member_custom_field_values.sql")
      .length,
    2,
  );
});

test("rule counts are ordered by frequency", () => {
  const counts = countByRule([...FINDINGS, FINDINGS[0]]);
  assert.deepEqual(counts[0], ["constraint-missing-not-valid", 2]);
});

test("errors sort ahead of warnings, unknown severities last", () => {
  assert.ok(severityRank("error") < severityRank("warning"));
  assert.ok(severityRank("warning") < severityRank("nonsense"));
  assert.equal(severityRank("ERROR"), severityRank("error"));
});

// ── Summary ─────────────────────────────────────────────────────────────────

test("summary says nothing to lint when no migrations changed", () => {
  const summary = buildSummary({ findings: [], filesChecked: [], strict: false });
  assert.match(summary, /No migrations changed/);
});

test("a clean run lists the files it actually checked", () => {
  const summary = buildSummary({
    findings: [],
    filesChecked: ["supabase/migrations/20260824120000_discord_import.sql"],
    strict: false,
  });
  assert.match(summary, /No lock-safety findings/);
  assert.match(summary, /20260824120000_discord_import\.sql/);
});

test("the advisory summary says plainly that it does not block", () => {
  // The posture has to be legible in the summary itself. A reader who sees
  // findings and cannot tell whether they are blocking will either panic or
  // ignore the check; both are worse than the check not existing.
  const summary = buildSummary({
    findings: FINDINGS,
    filesChecked: ["a.sql", "b.sql"],
    strict: false,
  });
  assert.match(summary, /advisory/);
  assert.match(summary, /does not block the merge/);
});

test("the strict summary says plainly that it DOES block", () => {
  const summary = buildSummary({
    findings: FINDINGS,
    filesChecked: ["a.sql"],
    strict: true,
  });
  assert.match(summary, /BLOCKING/);
  assert.doesNotMatch(summary, /does not block the merge/);
});

test("the summary names every rule, file and message", () => {
  const summary = buildSummary({
    findings: FINDINGS,
    filesChecked: ["a.sql"],
    strict: false,
  });
  assert.match(summary, /constraint-missing-not-valid/);
  assert.match(summary, /disallowed-unique-constraint/);
  assert.match(summary, /ban-drop-not-null/);
  assert.match(summary, /chat_message_authors\.sql/);
  assert.match(summary, /ACCESS EXCLUSIVE/);
  assert.match(summary, /squawkhq\.com\/docs\/rules/);
  assert.match(summary, /\.squawk\.toml/);
});
