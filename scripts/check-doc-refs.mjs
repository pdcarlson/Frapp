#!/usr/bin/env node

// Doc-reference lint for the files check-doc-paths.mjs cannot see.
//
// `check-doc-paths.mjs` is whole-tree and merge-blocking, but its scope is the
// documentation corpus itself: docs/, spec/, .claude/skills/, any AGENTS.md, and
// the two root guides. Everything else — source, tests, workflows, migrations,
// shell scripts — cites docs constantly and was never checked. That is several
// hundred references; the gate prints the live count on every run, and
// docs/internal/ci-cd/DOCS_CI.md carries the dated figure.
//
// The consequence is not hypothetical: the PREVIOUS restructure (the spec split
// tracked in #432) left dead pointers behind that nothing has caught since.
// `apps/api/README.md` alone pointed at three files that no longer exist, and
// the seed file still named the pre-split behavior spec.
//
// Widening check-doc-paths' scope would not have worked. Its extractor requires
// an inline code span, because that is how prose cites a path; source files cite
// them bare, in comments — the seed file said "defined in <the behavior spec>
// Section 2" with no backticks at all. So this gate uses a bare-path extractor, and
// keeps its own allowlist, while reusing that file's allowlist machinery
// verbatim — including the shared `loadAllowlist`, so both gates fail the same
// way on the same malformed input.
//
// Note this gate scans its own source, so the comments here name no dead path.
//
// See docs/internal/ci-cd/DOCS_CI.md for how this fits the other docs gates.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  findStaleEntries,
  inScope as inDocCorpus,
  loadAllowlist,
  matchAllowlist,
} from "./check-doc-paths.mjs";

export const ALLOWLIST_PATH = "scripts/doc-refs-allowlist.json";

// A bare markdown path under the docs or spec root, anywhere in a line.
//
// The lookbehind rejects a `docs/` or `spec/` that is only a SEGMENT of a longer
// path — `apps/web/docs/guides/testing.md` is not a claim about the repo-root
// corpus, and treating it as one would resolve it against the wrong file. It
// still admits the two ways a root-relative path gets written by hand, `./docs/`
// and `/docs/`, because the character before the slash is `.` or whitespace
// rather than a path segment. No tracked file sits at a nested `docs/` today;
// this keeps the gate honest if one ever does.
export const REFERENCE_RE = /(?<![A-Za-z0-9_-]\/)(?:docs|spec)\/[A-Za-z0-9_./-]*\.md/g;

// Files whose doc references are deliberately not live pointers.
export const EXCLUDED = [
  // A periodically-synced export of the Buildpad canvas, never hand-edited
  // (AGENTS.md § Planning canvas). check-docs-impact.mjs exempts it too.
  ".buildpad/",
  // A gitleaks finding baseline: each entry pins a path AND a commit SHA, so it
  // describes the tree as it was, on purpose.
  ".gitleaks-baseline.json",
  // Both allowlists exist to NAME paths that do not resolve; scanning them would
  // make every excuse its own violation.
  "scripts/doc-paths-allowlist.json",
  "scripts/doc-refs-allowlist.json",
];

// Assertion fixtures are synthetic by construction — a gate's own test must be
// able to name an invented path under spec/ and assert that it is rejected. This is
// the same carve-out check-doc-paths.mjs makes when it strips fenced code blocks
// before extracting: a worked example is not a claim about the tree.
export const EXCLUDED_SEGMENTS = ["__tests__/"];

export function isExcluded(p) {
  if (EXCLUDED.some((e) => p.startsWith(e))) return true;
  return EXCLUDED_SEGMENTS.some((seg) => p.includes(seg));
}

/** The files this gate owns: tracked, and outside the documentation corpus. */
export function inScope(p) {
  if (inDocCorpus(p)) return false;
  return !isExcluded(p);
}

// Characters that end a URL in prose, markdown and source. Splitting on a plain
// space instead — as this first did — excuses a real dead pointer whenever the
// separator happens to be a tab, a comma or a closing quote.
const URL_BOUNDARY = /[\s"'`,()<>[\]]/;

/**
 * A reference inside a URL is not a repo path. `.gitleaks-baseline.json` is
 * excluded wholesale, but permalinks turn up in comments too, and resolving a
 * https://github.com/owner/repo/blob/sha/docs/guides/testing.md permalink
 * against the working tree is meaningless.
 *
 * Walks back to the nearest URL boundary rather than the nearest space, so the
 * suppression is as narrow as the thing it is suppressing.
 */
export function isUrlContext(line, index) {
  let start = index;
  while (start > 0 && !URL_BOUNDARY.test(line[start - 1])) start--;
  return line.slice(start, index).includes("://");
}

export function extractReferences(text) {
  const found = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(REFERENCE_RE)) {
      if (isUrlContext(line, m.index)) continue;
      found.push({ token: m[0], line: i + 1 });
    }
  });
  return found;
}

// A NUL in the first few KB is the classic binary test. It is needed because
// `readFileSync(file, "utf8")` does NOT throw on non-text bytes — it substitutes
// U+FFFD — so the earlier `text === null` check caught filesystem errors only
// and never actually skipped the fonts, images and icons in scope. Harmless in
// practice, but a font whose bytes decoded into a path-shaped run would have
// produced a finding nobody could fix.
function readText(file) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return null;
  }
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString("utf8");
}


function main() {
  const tracked = execSync("git ls-files -z", {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .map((s) => s.trim())
    .filter(Boolean);

  const trackedSet = new Set(tracked);

  const loaded = loadAllowlist(ALLOWLIST_PATH);
  if (!loaded.ok) {
    console.error(loaded.message);
    return 2;
  }
  const allowlist = loaded.allowlist;

  const files = tracked.filter(inScope);
  const findings = [];
  const used = new Set();
  let referenceCount = 0;
  const filesWithRefs = new Set();

  for (const file of files) {
    const text = readText(file);
    if (text === null) continue; // a binary asset, or unreadable
    for (const { token, line } of extractReferences(text)) {
      referenceCount++;
      filesWithRefs.add(file);
      if (trackedSet.has(token)) continue;
      const excusedBy = matchAllowlist(allowlist, token, file);
      if (excusedBy) {
        used.add(excusedBy);
        continue;
      }
      findings.push({ file, line, token });
    }
  }

  const stale = findStaleEntries(allowlist, used);

  if (findings.length === 0 && stale.length === 0) {
    console.log(
      `Doc reference check passed (${referenceCount} references across ${filesWithRefs.size} files ` +
        `outside the docs corpus).`,
    );
    return 0;
  }

  console.error("Doc reference check failed.");
  console.error("");
  if (findings.length) {
    console.error(
      "These files reference docs that do not exist. Nothing else checks them, so they rot silently:",
    );
    const byFile = new Map();
    for (const f of findings) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file).push(f);
    }
    for (const [file, items] of byFile) {
      console.error(`\n  ${file}`);
      for (const f of items) console.error(`    :${f.line}  ${f.token}`);
    }
    console.error("");
    console.error(
      `Fix: point at the current path, or add an entry to ${ALLOWLIST_PATH} with a reason.`,
    );
  }
  if (stale.length) {
    console.error(`\nThese ${ALLOWLIST_PATH} entries no longer match any reference — delete them:`);
    for (const s of stale) console.error(`  - ${s}`);
  }
  console.error("");
  console.error("Run locally: `npm run check:doc-refs`.");
  return 1;
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) process.exit(main());
