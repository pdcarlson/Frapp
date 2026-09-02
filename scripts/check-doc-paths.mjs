#!/usr/bin/env node

// Citation lint for docs/ and spec/. Runs alongside check-docs-impact.mjs and
// check-docs-structure.mjs, and covers the blind spot in the `Links` gate:
// lychee validates markdown links and heading anchors, but the docs here
// overwhelmingly cite files as inline code — `apps/api/src/main.ts` — which
// lychee never sees. Those citations rot silently when a file moves.
//
// Every finding is a path a reader would follow and land nowhere. The noise
// classes (globs, placeholders, build output, deliberate references to files
// that no longer exist) are handled by the skip heuristics below and by
// scripts/doc-paths-allowlist.json. See docs/internal/ci-cd/DOCS_CI.md.
//
// Pure helpers are exported for scripts/ci/__tests__/check-doc-paths.test.mjs.

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const ALLOWLIST_PATH = "scripts/doc-paths-allowlist.json";

// design-system/reference holds committed design-tool exports whose runtime
// scaffolding is deliberately not committed — the Links gate excludes them as
// link sources for exactly the same reason, so keep the two gates in step.
const EXCLUDED_DIRS = ["spec/ui/design-system/reference/"];

// Extensions worth treating as a repo-path citation. Deliberately narrow: a
// citation only counts if it names a file *kind* this repo actually contains,
// so prose like `npm run lint` or `process.env` never enters the candidate set.
const EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "sql", "md", "yml", "yaml", "sh", "py", "toml", "css",
];

const CITATION_RE = new RegExp(
  "`([^`\\n]+?\\.(?:" + EXTENSIONS.join("|") + "))`",
  "g",
);

/**
 * Scope: the corpus the Links gate walks, plus every AGENTS.md and skill file.
 * Those are the agent-facing contract — a wrong path there misroutes an agent
 * before a human ever reads it — so they are in scope wherever they live.
 */
export function inScope(p) {
  if (EXCLUDED_DIRS.some((d) => p.startsWith(d))) return false;
  if (p.startsWith("docs/") || p.startsWith("spec/")) return p.endsWith(".md");
  if (p.startsWith(".claude/skills/")) return p.endsWith(".md");
  if (path.basename(p) === "AGENTS.md") return true;
  return p === "README.md" || p === "CONTRIBUTING.md";
}

/**
 * Fenced code blocks are worked examples, not citations — a shell transcript or
 * a config sample names files that need not exist.
 */
export function stripFencedBlocks(text) {
  return text.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[ \t]*$/gm, "");
}

/**
 * Tokens that are patterns or prose rather than paths. Each class here was a
 * real false positive in this repo's corpus.
 */
export function isNotAPath(token) {
  // Globs and placeholders: `*.spec.ts`, `spec/behavior/<topic>.md`,
  // `apps/api/.../sentry-scrubbing.ts`.
  if (/[*<>{}|$\s]/.test(token)) return true;
  if (token.includes("...")) return true;
  // Format placeholders spell themselves with repeated characters —
  // `YYYYMMDDHHMMSS_snake_case_name.sql`. This must stay narrow: the repo names
  // real docs in SCREAMING_SNAKE_CASE, so "a run of capitals" would suppress
  // exactly the findings the lint exists to surface.
  if (/(.)\1{3,}/.test(token)) return true;
  // Bare extension fragments used as suffixes in prose: `.d.ts`, `.e2e-spec.ts`.
  if (!token.includes("/") && token.startsWith(".") && !token.startsWith("./")) return true;
  // URLs and package specifiers.
  if (/^(?:https?:|\/\/|@)/.test(token)) return true;
  return false;
}

/**
 * `/.gitleaks.toml` is repo-root-absolute in prose; `./scripts/x.sh` is written
 * the way you would type it at the repo root. Both mean the same file.
 */
export function normalizeCitation(token) {
  return token.replace(/^\/+/, "").replace(/^\.\//, "");
}

/** Every distinct backticked path-shaped token in a markdown document. */
export function extractCitations(text) {
  const out = [];
  const seen = new Set();
  for (const m of stripFencedBlocks(text).matchAll(CITATION_RE)) {
    const token = m[1];
    if (isNotAPath(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Resolve citations the three ways a reader would actually chase one.
 * `trackedPaths` is the repo's tracked file list.
 */
export function makeResolver(trackedPaths) {
  const trackedSet = new Set(trackedPaths);
  const byBasename = new Map();
  for (const t of trackedPaths) {
    const base = path.posix.basename(t);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(t);
  }

  function resolves(token, sourceFile) {
    const t = normalizeCitation(token);
    // 1. Against repo root.
    if (trackedSet.has(t)) return true;
    // 2. Against the citing file's own directory.
    const rel = path.posix.normalize(
      path.posix.join(path.posix.dirname(sourceFile), t),
    );
    if (!rel.startsWith("..") && trackedSet.has(rel)) return true;
    // 3. Trailing-segment match — `main.ts` legitimately names apps/api/src/main.ts.
    for (const cand of byBasename.get(path.posix.basename(t)) ?? []) {
      if (cand === t || cand.endsWith("/" + t)) return true;
    }
    return false;
  }

  // A broken citation is far more useful with the fix attached. When exactly one
  // tracked file shares the basename, that is almost always where it moved.
  function suggestMove(token) {
    const matches = byBasename.get(path.posix.basename(normalizeCitation(token))) ?? [];
    return matches.length === 1 ? matches[0] : null;
  }

  return { resolves, suggestMove };
}

/**
 * Reasons are load-bearing: an allowlist without them becomes a dumping ground,
 * so a missing reason is a hard error rather than a warning.
 */
export function validateAllowlist(raw) {
  const errors = [];
  // The three arrays differ by one key, so pasting an entry into the wrong one
  // is the easy mistake. Checking only `reason` let that through: a `prefixes`
  // entry parked in `paths` validated clean and then threw an uncaught
  // TypeError out of normalizeCitation — a stack trace from a required gate,
  // indistinguishable in CI from a real citation failure. The shape key is as
  // load-bearing as the reason.
  const required = { prefixes: "prefix", paths: "path", perFile: "path" };
  for (const key of ["prefixes", "paths", "perFile"]) {
    (raw[key] ?? []).forEach((entry, i) => {
      if (!entry.reason || !String(entry.reason).trim()) {
        errors.push(`${key}[${i}] is missing a non-empty "reason"`);
      }
      const shape = required[key];
      if (!entry[shape] || !String(entry[shape]).trim()) {
        errors.push(`${key}[${i}] is missing a non-empty "${shape}"`);
      }
      if (key === "perFile" && !entry.file) {
        errors.push(`perFile[${i}] is missing "file"`);
      }
    });
  }
  return errors;
}

/** Which allowlist entry (if any) excuses this citation. Returns its id. */
export function matchAllowlist(allowlist, token, sourceFile) {
  const t = normalizeCitation(token);
  const idx = (k) => allowlist[k] ?? [];
  for (const [i, e] of idx("prefixes").entries()) {
    if (t.startsWith(e.prefix)) return `prefixes[${i}]`;
  }
  for (const [i, e] of idx("paths").entries()) {
    if (t === normalizeCitation(e.path)) return `paths[${i}]`;
  }
  // perFile is scoped on purpose: a dead path that is deliberate in one doc is
  // usually a genuine bug in another.
  for (const [i, e] of idx("perFile").entries()) {
    if (e.file === sourceFile && normalizeCitation(e.path) === t) return `perFile[${i}]`;
  }
  return null;
}

/**
 * Read and validate an allowlist file. Shared with check-doc-refs.mjs so the two
 * gates fail the same way on the same malformed input.
 *
 * Returns `{ ok: true, allowlist }` or `{ ok: false, message }`. A MISSING file
 * is not an error — it simply means nothing is excused, which is fail-safe: the
 * gate reports more, never less. Malformed JSON IS an error, and used not to be:
 * this ran as a bare `JSON.parse`, so a stray comma threw an uncaught
 * SyntaxError and exited 1 with a stack trace — indistinguishable, in CI, from a
 * genuine citation failure in a required check.
 */
export function loadAllowlist(path, deps = {}) {
  const exists = deps.exists ?? existsSync;
  const read = deps.read ?? readFileSync;
  const empty = { prefixes: [], paths: [], perFile: [] };
  if (!exists(path)) return { ok: true, allowlist: empty };

  let parsed;
  try {
    parsed = JSON.parse(read(path, "utf8"));
  } catch (e) {
    return { ok: false, message: `${path} is not valid JSON — ${e.message}` };
  }
  const errors = validateAllowlist(parsed);
  if (errors.length > 0) {
    return { ok: false, message: `${path} is invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}` };
  }
  return { ok: true, allowlist: parsed };
}

/**
 * Entries that excused nothing this run. The doc was fixed and the excuse
 * outlived it — leaving it behind lets a future breakage slip through.
 */
export function findStaleEntries(allowlist, used) {
  const stale = [];
  for (const key of ["prefixes", "paths", "perFile"]) {
    (allowlist[key] ?? []).forEach((e, i) => {
      const id = `${key}[${i}]`;
      if (!used.has(id)) {
        stale.push(`${id} — ${e.prefix ?? e.path}${e.file ? ` (in ${e.file})` : ""}`);
      }
    });
  }
  return stale;
}

// ---------------------------------------------------------------------------

function main() {
  const tracked = execSync("git ls-files -z", {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);

  const docs = tracked.filter(inScope);
  const { resolves, suggestMove } = makeResolver(tracked);

  const loaded = loadAllowlist(ALLOWLIST_PATH);
  if (!loaded.ok) {
    console.error(loaded.message);
    process.exit(2);
  }
  const allowlist = loaded.allowlist;

  const findings = [];
  const used = new Set();
  let citationCount = 0;

  for (const file of docs) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (const token of extractCitations(text)) {
      citationCount++;
      if (resolves(token, file)) continue;
      const allow = matchAllowlist(allowlist, token, file);
      if (allow) {
        used.add(allow);
        continue;
      }
      const line = lines.findIndex((l) => l.includes("`" + token + "`"));
      findings.push({ file, token, line: line + 1, suggestion: suggestMove(token) });
    }
  }

  const stale = findStaleEntries(allowlist, used);

  if (findings.length === 0 && stale.length === 0) {
    console.log(
      `Doc path citation check passed (${citationCount} citations across ${docs.length} files).`,
    );
    return 0;
  }

  if (findings.length > 0) {
    console.error("Doc path citation check failed.");
    console.error("");
    console.error(
      "These docs cite repo paths that do not exist. A reader following them lands nowhere:",
    );
    console.error("");
    let current = null;
    findings.sort((a, b) => a.file.localeCompare(b.file) || a.token.localeCompare(b.token));
    for (const f of findings) {
      if (f.file !== current) {
        console.error(`  ${f.file}`);
        current = f.file;
      }
      const hint = f.suggestion ? `  → did it move to \`${f.suggestion}\`?` : "";
      console.error(`    :${f.line}  \`${f.token}\`${hint}`);
    }
    console.error("");
    console.error(
      "Fix: correct the path, or — if the doc deliberately names a file that no longer",
    );
    console.error(
      `exists (a rename note, a removals table) — add it with a reason to ${ALLOWLIST_PATH}.`,
    );
  }

  if (stale.length > 0) {
    if (findings.length > 0) console.error("");
    console.error(`These ${ALLOWLIST_PATH} entries no longer match any citation — delete them:`);
    for (const s of stale) console.error(`  - ${s}`);
  }

  return 1;
}

// Only run when invoked directly, so the test can import the helpers.
if (process.argv[1] && process.argv[1].endsWith("check-doc-paths.mjs")) {
  process.exit(main());
}
