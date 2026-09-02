#!/usr/bin/env node

// Doc-reference lint for the files check-doc-paths.mjs cannot see.
//
// `check-doc-paths.mjs` is whole-tree and merge-blocking, but its scope is the
// documentation corpus itself: docs/, spec/, .claude/skills/, any AGENTS.md, and
// the two root guides. Everything else — source, tests, workflows, migrations,
// shell scripts — cites docs constantly and was never checked. At the time this
// gate was written that was 839 references across 436 files.
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
// verbatim so the two behave identically where they overlap.
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
  matchAllowlist,
  validateAllowlist,
} from "./check-doc-paths.mjs";

export const ALLOWLIST_PATH = "scripts/doc-refs-allowlist.json";

// Bare `docs/…​.md` / `spec/…​.md`, anywhere in a line.
export const REFERENCE_RE = /(?:docs|spec)\/[A-Za-z0-9_./-]*\.md/g;

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

/**
 * A reference inside a URL is not a repo path. `.gitleaks-baseline.json` is
 * excluded wholesale, but permalinks turn up in comments too, and resolving a
 * https://github.com/owner/repo/blob/sha/docs/guides/testing.md permalink
 * against the working tree is meaningless.
 */
export function isUrlContext(line, index) {
  const start = line.lastIndexOf(" ", index) + 1;
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

function read(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
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

  const rawAllowlist = read(ALLOWLIST_PATH);
  if (rawAllowlist === null) {
    console.error(`check-doc-refs: could not read ${ALLOWLIST_PATH}.`);
    return 2;
  }
  let allowlist;
  try {
    allowlist = JSON.parse(rawAllowlist);
  } catch (e) {
    console.error(`check-doc-refs: ${ALLOWLIST_PATH} is not valid JSON — ${e.message}`);
    return 2;
  }
  const allowlistErrors = validateAllowlist(allowlist);
  if (allowlistErrors.length) {
    console.error(`${ALLOWLIST_PATH} is invalid:`);
    for (const e of allowlistErrors) console.error(`  - ${e}`);
    return 2;
  }

  const files = tracked.filter(inScope);
  const findings = [];
  const used = new Set();
  let referenceCount = 0;
  const filesWithRefs = new Set();

  for (const file of files) {
    const text = read(file);
    if (text === null) continue; // unreadable as UTF-8 — a binary asset
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
