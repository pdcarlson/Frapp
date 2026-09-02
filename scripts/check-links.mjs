#!/usr/bin/env node

// Run the SAME link check CI runs, locally.
//
// `.github/workflows/links.yml` is the only thing in the repo that validates
// markdown heading ANCHORS (`--include-fragments`). Until now it ran nowhere
// else, so a change that moved a heading could only be checked by pushing.
//
// The flags are READ OUT OF THE WORKFLOW rather than copied here. A second copy
// of an argument list is exactly the hand-synced-fact problem the rest of this
// PR is about: it would drift, and the local check would quietly stop matching
// the gate it is meant to preview. `check-doc-tables.mjs` polices hand-copied
// rosters for the same reason; here the copy is simply not made.
//
// Install the binary first: ./scripts/install-lychee.sh

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const WORKFLOW = ".github/workflows/links.yml";
export const LOCAL_BINARY = ".tools/lychee";

/**
 * The `args:` value from the lychee-action step.
 *
 * Deliberately narrow: it matches the one `args:` key under a `with:` block and
 * requires the quoted form the workflow uses. A parser that guessed would be
 * worse than one that fails loudly and tells you to look at the workflow.
 */
export function parseWorkflowArgs(yaml) {
  const m = yaml.match(/^\s*args:\s*"([^"]+)"\s*$/m);
  return m ? m[1].trim() : null;
}

/** Split a flag string on whitespace. The workflow's args contain no quoting. */
export function splitArgs(argString) {
  return argString.split(/\s+/).filter(Boolean);
}

export function resolveBinary({ exists = existsSync } = {}) {
  if (exists(LOCAL_BINARY)) return LOCAL_BINARY;
  const probe = spawnSync("lychee", ["--version"], { encoding: "utf8" });
  if (probe.status === 0) return "lychee";
  return null;
}

function main() {
  let yaml;
  try {
    yaml = readFileSync(WORKFLOW, "utf8");
  } catch {
    console.error(`check-links: could not read ${WORKFLOW}.`);
    return 2;
  }

  const argString = parseWorkflowArgs(yaml);
  if (!argString) {
    console.error(
      `check-links: could not find the lychee \`args:\` line in ${WORKFLOW}. ` +
        `The workflow is the source of truth for these flags — if its shape changed, ` +
        `update parseWorkflowArgs in this file rather than hardcoding a second copy.`,
    );
    return 2;
  }

  const binary = resolveBinary();
  if (!binary) {
    console.error("check-links: lychee is not installed.");
    console.error("");
    console.error("  ./scripts/install-lychee.sh");
    console.error("");
    console.error(
      `Until then, heading anchors are only checked by the \`link-check\` job in ${WORKFLOW}.`,
    );
    return 2;
  }

  const args = splitArgs(argString);
  const version = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
  console.log(`Using ${version} (${binary})`);
  console.log(`Flags from ${WORKFLOW}: ${argString}`);
  console.log("");

  const run = spawnSync(binary, args, { stdio: "inherit" });
  if (run.error) {
    console.error(`check-links: failed to run ${binary} — ${run.error.message}`);
    return 2;
  }
  return run.status ?? 1;
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) process.exit(main());
