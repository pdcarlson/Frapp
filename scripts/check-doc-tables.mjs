#!/usr/bin/env node

// Doc/table drift gate: the required-check rosters and per-job test-suite lists that
// several docs restate by hand must match their in-repo source of truth.
//
// The failure this exists to catch is not hypothetical. `@repo/theme` (#1153) and
// `@repo/formatting` went missing from the `lint-and-typecheck` suite list in ALL THREE
// required-check tables at once, and `packages/chat-integrations` (#1114) from two of the
// `web-tests` lists — because GITHUB_BRANCH_PROTECTION_RUNBOOK.md documents the fanout as
// manual procedure ("if CI job names change, update these files").
//
// Sources of truth:
//   - CI_CHECKS / DOCS_CHECKS / DRIFT_CHECKS in scripts/configure-branch-protection.mjs
//   - job ids and `npm run test -w <workspace>` steps in .github/workflows/ci.yml
//
// See docs/internal/ci-cd/DOCS_CI.md for the contract.

import { readFileSync } from "node:fs";

const SCRIPT_SRC = "scripts/configure-branch-protection.mjs";
const CI_YML = ".github/workflows/ci.yml";

// The docs that restate the roster. Each is checked against the same source.
export const DOC_TABLES = [
  "CONTRIBUTING.md",
  "spec/environments/README.md",
  "docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md",
];

// Jobs whose per-workspace test lists the docs spell out. These are the rows that drifted.
export const SUITE_JOBS = ["lint-and-typecheck", "web-tests"];

/**
 * Active (uncommented) entries of a named array literal in the branch-protection script.
 *
 * The character class is deliberately permissive and the trailing comma optional: a check
 * name is a GitHub check-run name, which may hold spaces, slashes and capitals (`Links`,
 * `codecov/patch`), and a last entry written without a trailing comma is valid JS. Matching
 * only /^\s*"[a-z0-9-]+",/ silently drops both, which disarms the gate rather than failing it.
 * `scripts/` is neither a workspace nor prettier-formatted, so nothing upstream normalises this.
 */
export function parseCheckArray(source, name) {
  const m = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`));
  if (!m) return null;
  return [...m[1].matchAll(/^\s*"([^"\n]+)",?\s*$/gm)].map((x) => x[1]);
}

/**
 * Workspaces tested inside one ci.yml job, in file order.
 *
 * Comment lines are skipped: both SUITE_JOBS are comment-dense, and a comment mentioning a
 * removed suite would otherwise be read as a live one, failing every doc for naming reality.
 */
export function parseJobSuites(ciYml, jobId) {
  const lines = ciYml.split("\n");
  // Tolerate trailing whitespace / CRLF — .gitattributes pins only *.sh to LF.
  const key = (l) => l.replace(/\s+$/, "");
  const start = lines.findIndex((l) => key(l) === `  ${jobId}:`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  [a-zA-Z0-9_-]+:$/.test(key(lines[i]))) { end = i; break; }
  }
  const suites = [];
  for (const line of lines.slice(start, end)) {
    if (/^\s*#/.test(line)) continue;
    // Accepts `test`, `test:unit`, `test:ai-evals` (a hyphen is live at ci.yml's ai-evals
    // suite), and both the `-w` and `--workspace=` spellings.
    const m = line.match(/npm run test(?::[\w:-]+)? (?:-w |--workspace[= ])([@\w./-]+)/);
    if (m) suites.push(m[1]);
  }
  return suites;
}

/** Whether a doc has a table row whose first cell is `` `id` ``. */
export function hasRow(docText, id) {
  return docText.split("\n").some((l) => l.trimStart().startsWith(`| \`${id}\``));
}

/**
 * Backticked workspace-ish tokens named in the doc's rows for `job`.
 *
 * All matching rows are unioned, not just the first — a doc may legitimately split a job
 * across a main and a production table, and reading only the first would leave the second
 * permanently unchecked.
 */
export function parseDocSuites(docText, jobId) {
  const rows = docText
    .split("\n")
    .filter((l) => l.trimStart().startsWith(`| \`${jobId}\``));
  if (rows.length === 0) return null;
  const found = new Set();
  for (const row of rows) {
    for (const m of row.matchAll(/`(@repo\/[a-z0-9-]+|packages\/[a-z0-9-]+|apps\/[a-z0-9-]+)`/g)) {
      found.add(m[1]);
    }
  }
  return [...found];
}

const missing = (a, b) => a.filter((x) => !b.includes(x));
const shared = (s) => s.startsWith("@repo/") || s.startsWith("packages/");

export function compareSuites({ jobId, actual, docs }) {
  const findings = [];
  for (const { file, listed } of docs) {
    if (listed === null) {
      findings.push({ file, id: jobId, detail: `no table row for \`${jobId}\`` });
      continue;
    }
    // `ci.yml` runs `-w apps/landing` and `-w apps/web`, which the docs render as prose
    // ("landing plus …"). Demanding a literal token there would be a false positive.
    const absent = missing(actual.filter(shared), listed);
    const extra = missing(listed.filter(shared), actual);
    if (absent.length) {
      findings.push({ file, id: jobId, detail: `does not list ${absent.join(", ")}` });
    }
    if (extra.length) {
      findings.push({
        file,
        id: jobId,
        detail: `lists ${extra.join(", ")}, which \`${jobId}\` no longer runs`,
      });
    }
  }
  return findings;
}

/**
 * Roster comparison, both directions: every required check needs a row, and every
 * check-shaped row must name a real check. One-directional would leave a removed check's
 * row standing in all three docs, which is the same drift in the other direction.
 */
export function compareRoster({ file, text, required, known }) {
  const findings = [];
  for (const check of required) {
    if (!hasRow(text, check)) {
      findings.push({ file, id: check, detail: `required check \`${check}\` has no row` });
    }
  }
  // The reverse direction is scoped to tables that are *about* checks — a doc also holds
  // tables keyed on commit types (`test`, `chore`) and branches (`main`, `production`),
  // whose first cells look identical. A block earns the check only if it already names a
  // known one, which is what makes "this row names something that is not a check" meaningful.
  for (const block of tableBlocks(text)) {
    const ids = block
      .map((l) => l.trimStart().match(/^\| `([a-z][a-z0-9-]+)`/)?.[1])
      .filter(Boolean);
    if (!ids.some((id) => known.has(id))) continue;
    for (const id of ids) {
      if (!known.has(id)) {
        findings.push({
          file,
          id,
          detail: `names \`${id}\`, which is not a job or a required check`,
        });
      }
    }
  }
  return findings;
}

/** Contiguous runs of markdown table rows. */
export function tableBlocks(text) {
  const blocks = [];
  let current = [];
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("|")) {
      current.push(line);
    } else if (current.length) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function read(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function main() {
  const src = read(SCRIPT_SRC);
  const ciYml = read(CI_YML);
  if (src === null || ciYml === null) {
    console.error(`check-doc-tables: could not read ${src === null ? SCRIPT_SRC : CI_YML}.`);
    return 2;
  }

  const ciChecks = parseCheckArray(src, "CI_CHECKS");
  const docsChecks = parseCheckArray(src, "DOCS_CHECKS");
  const driftChecks = parseCheckArray(src, "DRIFT_CHECKS");
  // An empty array is truthy and would sail past a bare null check, passing the gate with
  // every check unasserted — a silent disarm rather than a failure.
  if (!ciChecks?.length || !docsChecks?.length || !driftChecks?.length) {
    console.error(
      `check-doc-tables: could not parse CI_CHECKS/DOCS_CHECKS/DRIFT_CHECKS from ${SCRIPT_SRC} ` +
        `(got ${ciChecks?.length ?? "none"} / ${docsChecks?.length ?? "none"} / ` +
        `${driftChecks?.length ?? "none"}).`,
    );
    return 2;
  }
  const required = [...ciChecks, ...docsChecks, ...driftChecks];

  // Every ci.yml/docs.yml job is a legitimate thing for a doc to have a row for, whether or
  // not it is required — advisory gates are described in these tables too.
  const known = new Set(required);
  for (const m of ciYml.matchAll(/^  ([a-zA-Z0-9_-]+):$/gm)) known.add(m[1]);
  const docsYml = read(".github/workflows/docs.yml");
  if (docsYml) for (const m of docsYml.matchAll(/^  ([a-zA-Z0-9_-]+):$/gm)) known.add(m[1]);
  const driftYml = read(".github/workflows/migration-drift-gate.yml");
  if (driftYml) for (const m of driftYml.matchAll(/^  ([a-zA-Z0-9_-]+):$/gm)) known.add(m[1]);
  known.add("branch-policy"); // production-only; appended by buildProtectionPayload, not an array.

  const findings = [];

  for (const file of DOC_TABLES) {
    const text = read(file);
    if (text === null) {
      console.error(`check-doc-tables: could not read ${file} — is DOC_TABLES stale?`);
      return 2;
    }
    findings.push(...compareRoster({ file, text, required, known }));
  }

  for (const jobId of SUITE_JOBS) {
    const actual = parseJobSuites(ciYml, jobId);
    if (actual === null) {
      console.error(`check-doc-tables: job \`${jobId}\` not found in ${CI_YML} — is SUITE_JOBS stale?`);
      return 2;
    }
    const docs = DOC_TABLES.map((file) => ({ file, listed: parseDocSuites(read(file), jobId) }));
    findings.push(...compareSuites({ jobId, actual, docs }));
  }

  if (findings.length) {
    console.error("Doc table check failed.");
    console.error("");
    console.error("These docs restate a roster by hand and have drifted from its source:");
    const byFile = new Map();
    for (const f of findings) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file).push(f);
    }
    for (const [file, items] of byFile) {
      console.error(`\n  ${file}`);
      for (const f of items) console.error(`    \`${f.id}\`: ${f.detail}`);
    }
    console.error("");
    console.error(
      `Sources of truth: ${SCRIPT_SRC} (CI_CHECKS / DOCS_CHECKS / DRIFT_CHECKS) and ${CI_YML}.`,
    );
    console.error("Fix: correct the doc — or, better, delete the copy and link to the source.");
    console.error("Run locally: `npm run check:doc-tables`.");
    return 1;
  }

  console.log(
    `Doc table check passed (${required.length} required checks across ${DOC_TABLES.length} docs; ` +
      `suite lists for ${SUITE_JOBS.join(", ")}).`,
  );
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-doc-tables.mjs")) {
  process.exit(main());
}
