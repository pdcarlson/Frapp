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
// the gate it is meant to preview. Here the copy is simply not made.
//
// Install the binary first: ./scripts/install-lychee.sh

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolved from this file, not the cwd — the same pattern scan-secrets.mjs uses,
// so the check works from a subdirectory instead of reporting a missing workflow.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const WORKFLOW = join(ROOT, ".github/workflows/links.yml");
export const WORKFLOW_LABEL = ".github/workflows/links.yml";
export const LOCAL_BINARY = join(ROOT, ".cache", "lychee", "lychee");
export const INSTALL_SCRIPT = "./scripts/install-lychee.sh";

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

/**
 * The cached binary, else one on PATH, else null.
 *
 * BOTH candidates are vetted by actually running `--version`. Trusting
 * `existsSync` for the cached one meant a file that exists but cannot execute —
 * a mode bit lost in a copy, or an x86_64 binary in a cache directory shared
 * with an arm64 host — was returned, and `execFileSync` below then threw an
 * uncaught EACCES/ENOEXEC. The user got a Node stack trace instead of "lychee is
 * not installed" and the one-line fix. `spawn` is injectable so both branches
 * are reachable from a test without a real lychee on the machine.
 */
export function resolveBinary({ exists = existsSync, spawn = spawnSync } = {}) {
  const runs = (bin) => {
    const probe = spawn(bin, ["--version"], { encoding: "utf8" });
    return !probe.error && probe.status === 0;
  };
  if (exists(LOCAL_BINARY) && runs(LOCAL_BINARY)) return LOCAL_BINARY;
  if (runs("lychee")) return "lychee";
  return null;
}

function main() {
  let yaml;
  try {
    yaml = readFileSync(WORKFLOW, "utf8");
  } catch {
    console.error(`check-links: could not read ${WORKFLOW_LABEL}.`);
    return 2;
  }

  const argString = parseWorkflowArgs(yaml);
  if (!argString) {
    console.error(
      `check-links: could not find the lychee \`args:\` line in ${WORKFLOW_LABEL}. ` +
        `The workflow is the source of truth for these flags — if its shape changed, ` +
        `update parseWorkflowArgs in this file rather than hardcoding a second copy.`,
    );
    return 2;
  }

  const binary = resolveBinary();
  if (!binary) {
    console.error("check-links: lychee is not installed.");
    console.error("");
    console.error(`  ${INSTALL_SCRIPT}`);
    console.error("");
    console.error(
      `Until then, heading anchors are only checked by the \`link-check\` job in ${WORKFLOW_LABEL}.`,
    );
    return 2;
  }

  const args = splitArgs(argString);
  const version = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
  console.log(`Using ${version} (${binary})`);
  console.log(`Flags from ${WORKFLOW_LABEL}: ${argString}`);
  console.log("");

  // lychee resolves `docs` / `spec` against the cwd, so anchor it at the root.
  const run = spawnSync(binary, args, { stdio: "inherit", cwd: ROOT });
  if (run.error) {
    console.error(`check-links: failed to run ${binary} — ${run.error.message}`);
    return 2;
  }
  return run.status ?? 1;
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) process.exit(main());
