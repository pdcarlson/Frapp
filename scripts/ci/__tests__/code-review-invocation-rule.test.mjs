// Executable check on the /code-review invocation rule.
//
// WHY THIS EXISTS. ADR-14 recorded this rule wrong twice: first too restrictive
// ("only a human keystroke can invoke it"), then too permissive ("whenever the
// turn's prompt mentions it in prose"). The second time, the correct regex was
// written down in the runbook two lines above the wrong gloss — extraction was
// right, the sentence summarising it was not, and nobody caught it because
// everyone read the sentence.
//
// A cross-file string-identity check would NOT have caught that: the drift was
// between a regex and the prose beside it, not between copies. So this suite
// executes the runbook's own match/non-match table against the regex the
// runbook itself states.
//
// SCOPE, STATED HONESTLY. This enforces the TABLE, not arbitrary prose. A wrong
// sentence elsewhere in the doc still passes CI. What changes is that the table
// is now a verified artefact rather than another claim: anyone writing a gloss
// has an executable statement of the rule sitting beside it, and a gloss that
// contradicts the table is falsifiable in one command. That raises the cost of
// the original error; it does not make it impossible.
//
// Both the pattern and the cases are PARSED FROM THE DOC, never hardcoded here.
// Hardcoding would just create a fourth copy to drift against.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const RUNBOOK_REL = "docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md";

// Every file that states the literal scan regex. The runbook is canonical; the
// rest must agree with it character for character.
const REGEX_SITES = [
  RUNBOOK_REL,
  "spec/architecture/README.md",
  ".claude/skills/diff-review/SKILL.md",
  ".claude/hooks/pre-push-review-gate.sh",
];

// A backtick-delimited span containing the scan pattern.
const REGEX_SPAN = /`([^`]*\/code-review\(\?=[^`]*)`/;

function readRepoFile(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function extractRegexLiteral(text, where) {
  const m = text.match(REGEX_SPAN);
  assert.ok(m, `no /code-review scan regex found in ${where}`);
  return m[1];
}

// Rows of the runbook's "Written as | Matches? | Why" table. The table lives
// inside a blockquote, so strip the leading "> " before parsing.
//
// A row counts only when its first cell is a code span AND its verdict cell is
// exactly ✅ or ❌. The runbook holds more than one table, and scoping by shape
// rather than by position means an unrelated table gaining a code-span first
// column is ignored here instead of being executed as a bogus rule claim. The
// row-count assertion below is what catches this table going missing.
function parseTable(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const t = line.replace(/^>\s?/, "").trim();
    if (!t.startsWith("|")) continue;
    const cells = t.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (!cells[0].startsWith("`")) continue; // header and separator rows
    if (cells[1] !== "✅" && cells[1] !== "❌") continue; // not a verdict row
    rows.push({ cell: cells[0], verdict: cells[1] });
  }
  return rows;
}

// Unwrap a Markdown code span. The backticked-token row is itself written with
// double backticks, since its content contains a backtick.
function unwrapCodeSpan(cell) {
  const dbl = cell.match(/^``(.*)``$/);
  if (dbl) return dbl[1];
  const sgl = cell.match(/^`(.*)`$/);
  assert.ok(sgl, `table cell is not a code span: ${cell}`);
  return sgl[1];
}

describe("/code-review invocation rule", () => {
  const runbook = readRepoFile(RUNBOOK_REL);
  const literal = extractRegexLiteral(runbook, RUNBOOK_REL);
  const scan = new RegExp(literal);
  const rows = parseTable(runbook);

  test("the runbook states a usable scan regex", () => {
    assert.match(
      literal,
      /code-review/,
      "extracted pattern does not mention the token",
    );
    // Constructing it above would already have thrown; assert it is not a
    // pattern that matches everything, which would make every row below pass.
    assert.equal(
      scan.test("nothing to see here"),
      false,
      "the documented regex matches unrelated text — it cannot be the scan",
    );
  });

  test("the match/non-match table is present and not vacuous", () => {
    assert.ok(
      rows.length >= 6,
      `expected at least 6 table rows, parsed ${rows.length} — did the table move or change shape?`,
    );
    const matches = rows.filter((r) => r.verdict === "✅").length;
    const nonMatches = rows.filter((r) => r.verdict === "❌").length;
    // Both directions must be exercised. A table of only non-matches would pass
    // against a regex that never matches anything, which is the shape of a
    // guard that has quietly stopped guarding.
    assert.ok(matches >= 1, "table asserts no positive case");
    assert.ok(nonMatches >= 1, "table asserts no negative case");
  });

  // The heart of it: every documented claim, executed.
  for (const row of rows) {
    const sample = unwrapCodeSpan(row.cell);
    const shouldMatch = row.verdict === "✅";
    const label = shouldMatch ? "matches" : "does NOT match";
    test(`runbook claims ${JSON.stringify(sample)} ${label}`, () => {
      assert.equal(
        scan.test(sample),
        shouldMatch,
        `The runbook says ${JSON.stringify(sample)} ${label} the scan regex ` +
          `${literal}, but executing it says otherwise. Either the table row or ` +
          `the regex is wrong — fix the doc, do not weaken this test.`,
      );
    });
  }

  test("every file stating the regex states the identical one", () => {
    for (const rel of REGEX_SITES) {
      const found = extractRegexLiteral(readRepoFile(rel), rel);
      assert.equal(
        found,
        literal,
        `${rel} states a different scan regex than ${RUNBOOK_REL}. ` +
          `These must stay identical; the runbook is canonical.`,
      );
    }
  });
});
