#!/usr/bin/env node

// Doc/table drift gate: the required-check rosters and per-job test-suite lists that
// several docs restate by hand must match their in-repo source of truth.
//
// A roster maintained by hand-copying drifts silently: every copy is a place the list can go
// stale without failing anything, and a doc that describes the fanout as manual procedure
// guarantees it will (#1153, #1114). That is what this gate catches, and why exactly one doc
// restates the roster. Do not add a doc back to DOC_TABLES in order to "document" the roster:
// the fix for a roster that needs documenting is one home, not another policed copy.
//
// Sources of truth:
//   - CI_CHECKS / DOCS_CHECKS / DRIFT_CHECKS in scripts/ci/lib/required-checks.mjs
//   - job ids and `npm run test -w <workspace>` steps in .github/workflows/ci.yml
//
// See docs/internal/ci-cd/DOCS_CI.md for the contract.

import { readFileSync } from "node:fs";

import { DIRECTORIES } from "./ci/lib/docs-structure.mjs";

const SCRIPT_SRC = "scripts/ci/lib/required-checks.mjs";
const CI_YML = ".github/workflows/ci.yml";

// The placement map. Its "Where things go" table is prose restating
// scripts/ci/lib/docs-structure.mjs — the same hand-copied-roster shape this gate
// already polices for the required checks, and the same drift risk.
export const PLACEMENT_DOC = "docs/internal/DOCUMENTATION_CONVENTIONS.md";

// Homes in that table that are deliberately not directories under docs/ or spec/
// (GitHub Issues, or a named file such as `ci-cd/DOCS_CI.md`) need no
// list: they are not `docs/`- or `spec/`-prefixed, so normalizeHome returns null.

// The one doc that restates the roster, checked against the source above.
export const DOC_TABLES = ["docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md"];

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
  // tables keyed on commit types (`test`, `chore`) and environments (`staging`, `prod`),
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

/**
 * A "canonical home" cell into the directory it names, or null.
 *
 * The column is written for readers, not parsers: `spec/behavior/<topic>.md`,
 * `spec/product/`, `spec/architecture/README.md` and `docs/internal/ops/` all
 * appear. Normalising to the DIRECTORY is what makes them comparable — the
 * filename half is illustrative, the folder half is the actual claim.
 */
export function normalizeHome(token) {
  let t = token.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (!t.startsWith("docs/") && !t.startsWith("spec/")) return null;
  const segments = t.split("/");
  const last = segments[segments.length - 1];
  // Drop a filename or a `<placeholder>.md`; keep a bare folder name.
  if (segments.length > 1 && (last.includes(".") || last.includes("<"))) segments.pop();
  const dir = segments.join("/");
  return dir === "docs" || dir === "spec" ? null : dir;
}

/** Every directory the placement-map table points at. */
export function parsePlacementHomes(docText) {
  const homes = new Set();
  for (const block of tableBlocks(docText)) {
    for (const line of block) {
      for (const m of line.matchAll(/`([^`\n]+)`/g)) {
        const dir = normalizeHome(m[1]);
        if (dir) homes.add(dir);
      }
    }
  }
  return homes;
}

/**
 * Both directions between the prose map and the manifest.
 *
 * EXACT match per directory, not prefix coverage. Coverage was the first design
 * and it quietly disarmed the check: a `spec/ui/` row spoke for
 * `spec/ui/landing`, `spec/ui/mobile` and `spec/ui/web-dashboard`, none of which
 * had a row, and the `docs/internal/` row added alongside it made all seven
 * `docs/internal/*` rows non-load-bearing — deleting the `ci-cd` row left the
 * gate green. A map that passes while five of its directories are undocumented
 * is worse than no map, because it reads as verified.
 *
 * So every declared directory owes a row naming it, and every row must name a
 * declared directory. The table is then a complete index of where documentation
 * lives, which is the job of a placement map.
 */
export function comparePlacementMap({ text, directories = DIRECTORIES }) {
  const findings = [];
  const homes = parsePlacementHomes(text);
  const declared = new Set(directories.map((d) => d.dir));

  for (const home of homes) {
    if (declared.has(home)) continue;
    findings.push({
      file: PLACEMENT_DOC,
      id: home,
      detail: `named as a canonical home but not declared in DIRECTORIES (scripts/ci/lib/docs-structure.mjs)`,
    });
  }

  for (const d of directories) {
    if (homes.has(d.dir)) continue;
    findings.push({
      file: PLACEMENT_DOC,
      id: d.dir,
      detail: `is a declared documentation home with no placement-map row — add one naming it exactly, or retire the directory`,
    });
  }

  return findings;
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
  // Production deploys are their own workflow since #1340, and its jobs are
  // legitimate rows for a doc table to describe.
  const deployProdYml = read(".github/workflows/deploy-production.yml");
  if (deployProdYml) for (const m of deployProdYml.matchAll(/^  ([a-zA-Z0-9_-]+):$/gm)) known.add(m[1]);
  // `known.add("branch-policy")` used to sit here. It was removed with the job
  // itself (#1340). Leaving it would have kept stale `branch-policy` rows in the
  // three doc tables passing this gate — the quiet disarm this file's header
  // warns about, where a gate keeps reporting green about a thing that is gone.

  const findings = [];

  for (const file of DOC_TABLES) {
    const text = read(file);
    if (text === null) {
      console.error(`check-doc-tables: could not read ${file} — is DOC_TABLES stale?`);
      return 2;
    }
    findings.push(...compareRoster({ file, text, required, known }));
  }

  const placementText = read(PLACEMENT_DOC);
  if (placementText === null) {
    console.error(`check-doc-tables: could not read ${PLACEMENT_DOC} — is PLACEMENT_DOC stale?`);
    return 2;
  }
  findings.push(...comparePlacementMap({ text: placementText }));

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
      `Sources of truth: ${SCRIPT_SRC} (CI_CHECKS / DOCS_CHECKS / DRIFT_CHECKS), ${CI_YML}, ` +
        `and scripts/ci/lib/docs-structure.mjs (DIRECTORIES, for ${PLACEMENT_DOC}).`,
    );
    console.error("Fix: correct the doc — or, better, delete the copy and link to the source.");
    console.error("Run locally: `npm run check:doc-tables`.");
    return 1;
  }

  console.log(
    `Doc table check passed (${required.length} required checks across ${DOC_TABLES.length} docs; ` +
      `suite lists for ${SUITE_JOBS.join(", ")}; ` +
      `${DIRECTORIES.length} documentation homes against the placement map).`,
  );
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-doc-tables.mjs")) {
  process.exit(main());
}
