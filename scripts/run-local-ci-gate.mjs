#!/usr/bin/env node

import { execSync } from "node:child_process";

const DEFAULT_BASE_REF = "origin/main";
const BASE_REF_FLAG = "--base-ref";

function getArgValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex === -1) {
    return undefined;
  }

  return process.argv[flagIndex + 1];
}

function runCommand(command, label) {
  console.log(`\n==> ${label}`);
  console.log(`$ ${command}`);
  execSync(command, { stdio: "inherit" });
}

function getMergeBase(baseRef) {
  return execSync(`git merge-base ${baseRef} HEAD`, { encoding: "utf8" }).trim();
}

function resolveDocsSyncBase(baseRef) {
  try {
    runCommand(`git fetch origin ${baseRef.replace("origin/", "")}`, "Fetch base branch");
  } catch {
    console.warn(
      `Warning: unable to fetch ${baseRef}. Continuing with local refs for merge-base resolution.`,
    );
  }

  try {
    return getMergeBase(baseRef);
  } catch {
    const fallbackRef = baseRef.replace("origin/", "");
    return getMergeBase(fallbackRef);
  }
}

function runDocsSyncCheck(baseRef) {
  const baseSha = resolveDocsSyncBase(baseRef);
  const headSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

  runCommand(
    `node scripts/check-docs-impact.mjs --base "${baseSha}" --head "${headSha}"`,
    "Run docs/spec sync check",
  );
}

function runLocalGate() {
  const baseRef =
    getArgValue(BASE_REF_FLAG) ?? process.env.CI_GATE_BASE_REF ?? DEFAULT_BASE_REF;

  console.log("Running local CI gate...");
  console.log(`Base ref: ${baseRef}`);
  runDocsSyncCheck(baseRef);

  const gateChecks = [
    ["npm run lint", "Run monorepo lint"],
    ["npm run check-types", "Run monorepo type-check"],
    ["npm run test -w apps/api", "Run API unit tests"],
    ["npm run check:api-contract", "Run API contract freshness check"],
    ["npm run check:migration-safety", "Run migration safety check"],
    ["npm run build -w docs", "Build docs app"],
    ["npm run lint -w docs", "Lint docs app"],
  ];

  for (const [command, label] of gateChecks) {
    runCommand(command, label);
  }

  console.log("\n✅ Local CI gate passed.");
}

try {
  runLocalGate();
} catch (error) {
  console.error("\n❌ Local CI gate failed.");
  if (error instanceof Error && error.message) {
    console.error(error.message);
  }
  process.exit(1);
}
