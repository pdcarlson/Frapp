#!/usr/bin/env node

// Structure lint for docs/ and spec/. Runs alongside check-docs-impact.mjs.
// Fails a PR that ADDS files at disallowed locations, so agents can't satisfy the
// docs-sync gate by dropping stray files and morphing the layout. See
// docs/internal/DOCUMENTATION_CONVENTIONS.md for the placement map.

import { execSync } from "node:child_process";

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
}

const base = getArg("--base");
const head = getArg("--head");

if (!base || !head) {
  console.error(
    [
      "check-docs-structure: missing required args.",
      "Usage: node scripts/check-docs-structure.mjs --base <sha> --head <sha>",
    ].join("\n"),
  );
  process.exit(2);
}

// Added (and rename-target) paths only — existing files are never flagged.
const added = git(`diff --name-only --diff-filter=AR ${base}...${head}`)
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

// Only README.md may sit at the docs/ root; README.md + engineering.md at the spec/ root.
const allowedDocsRoot = new Set(["docs/README.md"]);
const allowedSpecRoot = new Set(["spec/README.md", "spec/engineering.md"]);

const violations = [];

for (const p of added) {
  if (/^docs\/[^/]+$/.test(p) && !allowedDocsRoot.has(p)) {
    violations.push(`${p} — new file at docs/ root; put it in the right subfolder (see placement map)`);
  }
  if (/^spec\/[^/]+$/.test(p) && !allowedSpecRoot.has(p)) {
    violations.push(`${p} — new file at spec/ root; spec/ is grouped into folders (architecture/, behavior/, product/, ui/, environments/)`);
  }
  if (/^spec\/.*\/chunks\//.test(p)) {
    violations.push(`${p} — 'chunks/' folders are retired; merge canon into the real spec, track delivery in Linear`);
  }
  if (/^docs\/archive\//.test(p)) {
    violations.push(`${p} — docs/archive/ is retired; git history is the archive`);
  }
  if (/^docs\/backlog\//.test(p)) {
    violations.push(`${p} — docs/backlog/ is retired; work tracking lives in Linear (see docs/internal/ci-cd/LINEAR_PM.md)`);
  }
}

if (violations.length > 0) {
  console.error("Docs/spec structure check failed.");
  console.error("");
  console.error("These newly added paths are not allowed by the structure rules:");
  for (const v of violations) console.error(`- ${v}`);
  console.error("");
  console.error("Fix: place the change in its canonical home per docs/internal/DOCUMENTATION_CONVENTIONS.md.");
  process.exit(1);
}

console.log("Docs/spec structure check passed.");
