#!/usr/bin/env node

// Doc/table drift gate: the required-check rosters and per-job test-suite lists that
// several docs restate by hand must match their in-repo source of truth.
//
// The failure this exists to catch is not hypothetical. `@repo/theme` (#1153) and
// `@repo/formatting` went missing from the `lint-and-typecheck` suite list in ALL THREE
// required-check tables at once, and `packages/chat-integrations` (#1114) from two of the
// `web-tests` lists — because GITHUB_BRANCH_PROTECTION_RUNBOOK.md documents the fanout as
// manual procedure ("if CI job names change, update these four files").
//
// Sources of truth:
//   - CI_CHECKS / DOCS_CHECKS in scripts/configure-branch-protection.mjs
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

/** Active (uncommented) entries of a named array literal in the branch-protection script. */
export function parseCheckArray(source, name) {
  const m = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`));
  if (!m) return null;
  return [...m[1].matchAll(/^\s*"([a-z0-9-]+)",/gm)].map((x) => x[1]);
}

/** Workspaces tested inside one ci.yml job, in file order. */
export function parseJobSuites(ciYml, jobId) {
  const lines = ciYml.split("\n");
  const start = lines.findIndex((l) => l === `  ${jobId}:`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  [a-zA-Z0-9_-]+:$/.test(lines[i])) { end = i; break; }
  }
  const suites = [];
  for (const line of lines.slice(start, end)) {
    const m = line.match(/npm run test(?::[a-z]+)? -w (\S+)/);
    if (m) suites.push(m[1]);
  }
  return suites;
}

/** Backticked workspace-ish tokens named in the doc's row for `job`. */
export function parseDocSuites(docText, jobId) {
  const row = docText
    .split("\n")
    .find((l) => l.trimStart().startsWith(`| \`${jobId}\``));
  if (!row) return null;
  return [...row.matchAll(/`(@repo\/[a-z0-9-]+|packages\/[a-z0-9-]+|apps\/[a-z0-9-]+)`/g)].map(
    (x) => x[1],
  );
}

const missing = (a, b) => a.filter((x) => !b.includes(x));

export function compareSuites({ jobId, actual, docs }) {
  const findings = [];
  for (const { file, listed } of docs) {
    if (listed === null) {
      findings.push({ file, jobId, kind: "no-row", detail: `no table row for \`${jobId}\`` });
      continue;
    }
    // `landing` is written as `apps/landing` in ci.yml but as prose in the docs; compare on
    // the workspace tokens the docs actually cite, which is where the drift showed up.
    const wanted = actual.filter((s) => s.startsWith("@repo/") || s.startsWith("packages/"));
    const absent = missing(wanted, listed);
    const extra = missing(listed.filter((s) => s.startsWith("@repo/") || s.startsWith("packages/")), actual);
    if (absent.length) findings.push({ file, jobId, kind: "missing", detail: `does not list ${absent.join(", ")}` });
    if (extra.length) findings.push({ file, jobId, kind: "stale", detail: `lists ${extra.join(", ")}, which \`${jobId}\` no longer runs` });
  }
  return findings;
}

function main() {
  const src = readFileSync(SCRIPT_SRC, "utf8");
  const ciYml = readFileSync(CI_YML, "utf8");

  const ciChecks = parseCheckArray(src, "CI_CHECKS");
  const docsChecks = parseCheckArray(src, "DOCS_CHECKS");
  if (!ciChecks || !docsChecks) {
    console.error(`check-doc-tables: could not parse CI_CHECKS/DOCS_CHECKS from ${SCRIPT_SRC}.`);
    return 2;
  }
  const required = [...ciChecks, ...docsChecks];

  const findings = [];

  // 1. Every required check must appear in every doc roster.
  for (const file of DOC_TABLES) {
    const text = readFileSync(file, "utf8");
    for (const check of required) {
      if (!text.includes(`\`${check}\``)) {
        findings.push({ file, jobId: check, kind: "unlisted", detail: `required check \`${check}\` is absent` });
      }
    }
  }

  // 2. Per-job suite lists must match ci.yml.
  for (const jobId of SUITE_JOBS) {
    const actual = parseJobSuites(ciYml, jobId);
    if (actual === null) {
      console.error(`check-doc-tables: job \`${jobId}\` not found in ${CI_YML}.`);
      return 2;
    }
    const docs = DOC_TABLES.map((file) => ({
      file,
      listed: parseDocSuites(readFileSync(file, "utf8"), jobId),
    }));
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
    for (const [file, fs_] of byFile) {
      console.error(`\n  ${file}`);
      for (const f of fs_) console.error(`    \`${f.jobId}\`: ${f.detail}`);
    }
    console.error("");
    console.error(`Sources of truth: ${SCRIPT_SRC} (CI_CHECKS / DOCS_CHECKS) and ${CI_YML}.`);
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
