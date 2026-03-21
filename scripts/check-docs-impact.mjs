#!/usr/bin/env node

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
      "check-docs-impact: missing required args.",
      "Usage: node scripts/check-docs-impact.mjs --base <sha> --head <sha>",
    ].join("\n"),
  );
  process.exit(2);
}

const changed = git(`diff --name-only ${base}...${head}`)
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

const docsOrSpec = ["apps/docs/", "docs/", "spec/"];

const touchedNonDocsOrSpec = changed.filter(
  (p) => !docsOrSpec.some((prefix) => p.startsWith(prefix)),
);
const touchedDocsOrSpec = changed.filter((p) =>
  docsOrSpec.some((t) => p.startsWith(t)),
);

if (touchedNonDocsOrSpec.length > 0 && touchedDocsOrSpec.length === 0) {
  console.error("Docs/spec sync check failed.");
  console.error("");
  console.error(
    "You changed repository files outside docs/spec, but didn't update `docs/`, `spec/`, or `apps/docs/` in the same PR.",
  );
  console.error("");
  console.error("Changes requiring docs/spec updates:");
  for (const p of touchedNonDocsOrSpec) console.error(`- ${p}`);
  console.error("");
  console.error(
    "Fix: add or update related files under `docs/` (e.g. docs/guides/) and/or `spec/`. Touching `apps/docs/` also satisfies this check, but prefer `docs/` + `spec/` for routine changes.",
  );
  process.exit(1);
}

console.log("Docs/spec sync check passed.");
