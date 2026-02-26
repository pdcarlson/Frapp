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

const triggers = [
  "apps/api/",
  "packages/",
  "supabase/",
  "apps/web/",
  "apps/mobile/",
  "apps/landing/",
];

const docsOrSpec = ["apps/docs/", "spec/"];

const touchedTrigger = changed.filter((p) =>
  triggers.some((t) => p.startsWith(t)),
);
const touchedDocsOrSpec = changed.filter((p) =>
  docsOrSpec.some((t) => p.startsWith(t)),
);

if (touchedTrigger.length > 0 && touchedDocsOrSpec.length === 0) {
  console.error("Docs/spec sync check failed.");
  console.error("");
  console.error(
    "You changed product code, but didn't update `apps/docs/` or `spec/` in the same PR.",
  );
  console.error("");
  console.error("Triggering changes:");
  for (const p of touchedTrigger) console.error(`- ${p}`);
  console.error("");
  console.error(
    "Fix: update the relevant guide(s) in `apps/docs/` and/or the specs in `spec/`.",
  );
  process.exit(1);
}

console.log("Docs/spec sync check passed.");
