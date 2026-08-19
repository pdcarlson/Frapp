#!/usr/bin/env node

// Docs/spec sync gate: a PR touching a path outside `docs/` and `spec/` must
// also touch at least one path under one of them. See
// docs/internal/ci-cd/DOCS_CI.md for the full contract and its exemptions.
//
// Pure helpers are exported for scripts/ci/__tests__/check-docs-impact.test.mjs.

import { execSync } from "node:child_process";

const DOCS_OR_SPEC = ["docs/", "spec/"];

// Prefixes that are neither code nor documentation, so a change under them has
// no docs impact to sync. These are *ignored*, never counted as the doc touch —
// a PR that edits code plus one of these still owes a `docs/` or `spec/` edit.
//
// Keep this list short. Every entry weakens a gate that is required under
// `enforce_admins: true`, so a prefix earns a place here only when nothing
// beneath it can change behaviour a doc describes.
//
// `.buildpad/` is a periodically-synced export of the product-planning canvas
// (`blobs/`, `documents/`, `notes/`) that agents read as background. It is
// explicitly not a spec source of truth and holds no code. Without the
// exemption every sync would read to the gate as "N non-doc files changed, no
// docs updated" and fail a required check — the same permanently-unmergeable
// trap the Dependabot exemption in .github/workflows/docs.yml exists to avoid.
export const NON_CODE_PREFIXES = [".buildpad/"];

const hasPrefix = (p, prefixes) => prefixes.some((prefix) => p.startsWith(prefix));

/**
 * Split a PR's changed paths into the three buckets the gate reasons about:
 * the doc/spec edits that can satisfy it, the exempt paths it ignores, and
 * everything else — the changes that oblige a doc/spec edit.
 */
export function classifyChanges(changed) {
  const docsOrSpec = [];
  const exempt = [];
  const requiresDocs = [];

  for (const p of changed) {
    if (hasPrefix(p, DOCS_OR_SPEC)) docsOrSpec.push(p);
    else if (hasPrefix(p, NON_CODE_PREFIXES)) exempt.push(p);
    else requiresDocs.push(p);
  }

  return { docsOrSpec, exempt, requiresDocs };
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
}

function main() {
  const base = getArg("--base");
  const head = getArg("--head");

  if (!base || !head) {
    console.error(
      [
        "check-docs-impact: missing required args.",
        "Usage: node scripts/check-docs-impact.mjs --base <sha> --head <sha>",
      ].join("\n"),
    );
    return 2;
  }

  const changed = git(`diff --name-only ${base}...${head}`)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const { docsOrSpec, exempt, requiresDocs } = classifyChanges(changed);

  if (requiresDocs.length > 0 && docsOrSpec.length === 0) {
    console.error("Docs/spec sync check failed.");
    console.error("");
    console.error(
      "You changed repository files outside `docs/` and `spec/`, but didn't update `docs/` or `spec/` in the same PR.",
    );
    console.error("");
    console.error("Changes requiring docs/spec updates:");
    for (const p of requiresDocs) console.error(`- ${p}`);
    console.error("");
    console.error(
      "Fix: add or update related files under `docs/` (e.g. docs/guides/) and/or `spec/`.",
    );
    return 1;
  }

  if (exempt.length > 0) {
    console.log(
      `Ignored ${exempt.length} path(s) under ${NON_CODE_PREFIXES.join(", ")} — neither code nor documentation.`,
    );
  }
  console.log("Docs/spec sync check passed.");
  return 0;
}

// Only run when invoked directly, so the test can import the helpers.
if (process.argv[1] && process.argv[1].endsWith("check-docs-impact.mjs")) {
  process.exit(main());
}
