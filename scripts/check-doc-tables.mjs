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
import { posix } from "node:path";

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

// The index READMEs, which restate the directory tree a THIRD and FOURTH time.
//
// `DOCUMENTATION_CONVENTIONS.md` names all 23 homes; these two name only the
// immediate children of one directory each, which is why they cannot go through
// comparePlacementMap. They are not a weaker copy, though — each table is
// exactly one scope's children, so the same exact-both-directions rule applies
// once the comparison is made per scope. `scopes` is that scope list.
//
// Why they need a gate at all: `docs/README.md` deep-links into specific files
// (`internal/ops/DEPLOYMENT.md`, `internal/ci-cd/DOCS_CI.md`,
// `internal/environment/ENV_REFERENCE.md`), three of which are in LEGACY_NAMES.
// check-doc-paths and lychee catch a broken LINK, so a rename is never silent —
// but nothing checked that the table still described the real directory SET.
// The stage-3 flatten (#1598) collapses directories, and both tables would have
// had to be corrected by hand with nothing verifying the result (#1619).
// `spec/ui/README.md` and `spec/behavior/README.md` are deliberately absent:
// `spec/ui/design-system/reference` is a GRANDCHILD of `spec/ui`, so they need a
// rule other than "the immediate children of one scope" (#1665).
export const INDEX_DOCS = [
  { file: "docs/README.md", scopes: ["docs", "docs/internal"] },
  { file: "docs/internal/README.md", scopes: ["docs/internal"] },
  { file: "spec/README.md", scopes: ["spec"] },
];

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
 * row standing in the doc, which is the same drift in the other direction.
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
  const t = token.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (!t.startsWith("docs/") && !t.startsWith("spec/")) return null;
  // homeFromSegments is shared with resolveIndexHome so the placement map and
  // the index READMEs cannot disagree about what a token means. It returns null
  // for a bare `docs`/`spec`, which is how a tree root stays out of the map.
  return homeFromSegments(t.split("/"));
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

/**
 * The directory a resolved path segment list claims, or null.
 *
 * Shared by normalizeHome and resolveIndexHome so the placement map and the
 * index READMEs cannot disagree about what a token means. Splitting the rule in
 * two was how `<topic>` handling would have drifted: one copy accepting a
 * spelling the other rejects lets the same path pass one gate and fail the next.
 */
function homeFromSegments(segments) {
  const parts = [...segments];
  // Drop a filename or a `<placeholder>.md`; keep a bare folder name. The folder
  // half is the claim, the file half only illustrates it.
  const last = parts[parts.length - 1];
  if (parts.length > 1 && (last.includes(".") || last.includes("<"))) parts.pop();
  const dir = parts.join("/");
  if (!dir.startsWith("docs/") && !dir.startsWith("spec/")) return null;
  return dir;
}

/**
 * An index README's table path into the directory it names, or null.
 *
 * Deliberately NOT normalizeHome. That function's first act is to reject any
 * token not starting with `docs/` or `spec/`, and a test pins
 * `normalizeHome("ci-cd/DOCS_CI.md") === null` — correct for the placement map,
 * where homes are written repo-root-relative and a bare filename is genuinely
 * not a directory claim. The index READMEs write the same facts RELATIVE to
 * themselves (`internal/ops/` in docs/README.md, bare `ops/` in
 * docs/internal/README.md), so every one of their tokens normalises to null.
 * Pointing PLACEMENT_DOC at them without this would assert nothing about either
 * file while still reporting green — the quiet disarm this file's header warns
 * about, rather than the check the gate advertises.
 *
 * Resolution uses `path.posix`, matching `makeResolver` in check-doc-paths.mjs
 * so the two gates read a relative link in the same doc the same way. A token
 * rooted at `/`, `docs/` or `spec/` is a repo path; anything else resolves
 * against `fromDir`. A token that climbs out of the repo returns null rather
 * than a path with `..` left in it — `..` re-entering the tree
 * (`../../../docs/guides` from `docs/`) must not resolve, or a broken link
 * would count as a satisfied row.
 */
export function resolveIndexHome(token, fromDir) {
  // Strip a markdown angle-bracket destination, then any fragment or query. A
  // fragment left on kept its own segment and produced a phantom directory
  // AND a spurious "missing row" for the real one — two wrong findings, not none.
  let raw = token.trim().replace(/^<|>$/g, "").split(/[#?]/)[0].replace(/\/+$/, "");
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;

  const rooted = raw.startsWith("/") || raw.startsWith("docs/") || raw.startsWith("spec/");
  // `normalize` keeps a leading `..` as a literal segment, so a link climbing
  // out of the repo (`../../../docs/guides` from `docs/`) resolves to
  // `../../docs/guides` and fails homeFromSegments' `docs/`/`spec/` prefix rule.
  // No separate escape guard: one written here was unreachable, and an
  // unreachable guard reads as protection the next editor may rely on.
  const resolved = posix.normalize(rooted ? raw.replace(/^\//, "") : posix.join(fromDir, raw));

  const dir = homeFromSegments(resolved.split("/").filter((s) => s && s !== "."));
  // A tree root is not a directory entry — root files are governed separately.
  return dir === "docs" || dir === "spec" ? null : dir;
}

/**
 * Every directory an index README's TABLE ROWS name.
 *
 * Table rows only, exactly as parsePlacementHomes does: both files carry prose
 * links to neighbouring trees (`../spec/ui/design-system/`, `../guides/`) that
 * are cross-references, not claims about what this directory holds.
 *
 * BOTH the backticked label and the markdown link target are read. Reading only
 * the target was the first design and it was wrong twice over: the label is the
 * half a reader actually sees, so a row displaying `ops/` while linking to
 * `runbooks/` passed while telling every reader the wrong location; and rows
 * that carry no parenthesised target at all — a titled link `](ops/ "Ops")`, a
 * reference link `][ops]`, or a plain unlinked `` `services/` `` — parsed as
 * nothing, so the gate reported a *missing row* about a row sitting in the
 * table. Reading both means either spelling satisfies the row, and a
 * disagreement between them surfaces as an extra directory rather than silence.
 *
 * Prose tokens in the description column are not a problem here: they resolve
 * outside the doc's scopes and compareIndexDocs only judges scope children.
 * `docs/README.md`'s "tests for `packages/hooks`" is the live example.
 */
export function parseIndexHomes(docText, fromDir) {
  const homes = new Set();
  for (const block of tableBlocks(docText)) {
    for (const line of block) {
      const tokens = [
        ...[...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
        ...[...line.matchAll(/\]\(\s*([^)\s]+)/g)].map((m) => m[1]),
      ];
      for (const token of tokens) {
        const dir = resolveIndexHome(token, fromDir);
        if (dir) homes.add(dir);
      }
    }
  }
  return homes;
}

/** The declared directories sitting immediately inside `scope`. */
export function childrenOf(scope, directories = DIRECTORIES) {
  return directories
    .map((d) => d.dir)
    .filter((dir) => dir.startsWith(`${scope}/`) && !dir.slice(scope.length + 1).includes("/"));
}

/** True when `dir` sits immediately inside any of `scopes`. */
function isChildOfAny(dir, scopes) {
  return scopes.some((scope) => {
    if (!dir.startsWith(`${scope}/`)) return false;
    return !dir.slice(scope.length + 1).includes("/");
  });
}

/**
 * Both directions between an index README's tables and the manifest.
 *
 * EXACT match per scope, for the reason comparePlacementMap spells out at
 * length: coverage-style matching disarms itself the moment one broad row
 * speaks for several directories. #1619 expected this check to have to be
 * weaker than the placement map's — one-directional, "leaving coverage
 * unchecked" — because the three tables sit at different granularities. They
 * do, but not raggedly: each table is precisely one directory's immediate
 * children, so scoping the comparison recovers full strength.
 *
 * The reverse direction judges ONLY paths that are immediate children of a
 * scope. An index legitimately links out of its own scope — to a sibling tree,
 * or to a file sitting in its own root — and the first design rejected every
 * such path with "fix the row, or declare the directory" naming a directory
 * that WAS declared, so neither remedy applied and the only way to green was
 * deleting a correct row. What this check is about is the child SET; a link
 * that is not a child claim is not evidence about it either way.
 */
export function compareIndexDocs({ file, text, scopes, directories = DIRECTORIES }) {
  const findings = [];
  const fromDir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
  const homes = parseIndexHomes(text, fromDir);
  const expected = new Set(scopes.flatMap((scope) => childrenOf(scope, directories)));

  for (const home of homes) {
    if (expected.has(home) || !isChildOfAny(home, scopes)) continue;
    findings.push({
      file,
      id: home,
      detail:
        `is named in a table here but is not declared in DIRECTORIES ` +
        `(scripts/ci/lib/docs-structure.mjs) — fix the row, or declare the directory`,
    });
  }

  for (const dir of expected) {
    if (homes.has(dir)) continue;
    findings.push({
      file,
      id: dir,
      detail: `is a declared documentation home with no row in this index — add one naming it, or retire the directory`,
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

  for (const { file, scopes } of INDEX_DOCS) {
    const text = read(file);
    if (text === null) {
      console.error(`check-doc-tables: could not read ${file} — is INDEX_DOCS stale?`);
      return 2;
    }
    // A scope with no declared children makes `expected` empty, which disarms
    // the missing-row direction entirely while the summary still prints a green
    // count. Same class as the empty-array check below, and reachable two ways:
    // a trailing slash (`"docs/"` matches nothing), and a scope whose children
    // a flatten has collapsed. Fail loudly rather than assert nothing.
    const empty = scopes.filter((scope) => childrenOf(scope).length === 0);
    if (empty.length) {
      console.error(
        `check-doc-tables: ${file} declares scope(s) ${empty.map((s) => `\`${s}\``).join(", ")} ` +
          `with no children in DIRECTORIES — the check would assert nothing. ` +
          `Fix the scope spelling (no trailing slash), or drop the entry from INDEX_DOCS.`,
      );
      return 2;
    }
    findings.push(...compareIndexDocs({ file, text, scopes }));
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
      `${DIRECTORIES.length} documentation homes against the placement map; ` +
      `${INDEX_DOCS.length} index READMEs against their scopes' declared children).`,
  );
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-doc-tables.mjs")) {
  process.exit(main());
}
