#!/usr/bin/env node

// Refuse a deploy, before anything is written, when its config would fail a
// later step of the same job (#3112). `_deploy.yml` runs it right after the
// plan, ahead of the production rehearsal and **Run migrations (dry-run)**, in
// both environments and on production dry runs too.
//
// ── Why here ────────────────────────────────────────────────────────────────
// The job's first write is **Run migrations (apply)**. Three things the run
// depends on used to be checked only after it:
//   * the API's own boot check, `validateEnv`
//     (`apps/api/src/config/env.validation.ts`), which first ran when the new
//     Render instance booted: after the migrations and the Edge Functions;
//   * `SUPABASE_FUNCTIONS_DEPLOY_TOKEN`, read by `deploy-edge-functions.mjs`
//     after the apply;
//   * `API_HEALTHCHECK_URL`, read by the served-commit check after the Render
//     deploy. (Staging's plan already requires it; production has no plan.)
// A bad value then failed with the schema already moved. Before the v0.7.0
// ship the first two were checked by hand (#2558).
//
// ── What it runs ────────────────────────────────────────────────────────────
// The rules are the DEPLOYED commit's, on purpose: its `validateEnv` is what
// will boot. `_deploy.yml` builds the API before any secret is injected, the
// same build the Render image runs, and this loads the compiled module from
// the workspace. Only this harness comes from the trusted copy, so a rollback
// to a commit from before it still has one. A commit with no
// `env.validation.ts` at all skips the boot check with a warning; one that has
// the source but no build fails, because then the check exists and didn't run.
//
// `validateEnv` gets only the names the Infisical injection added (the job's
// environment minus the baseline `record-env-baseline.mjs` wrote just before
// it). That is the store the Render sync copies: same environment, path `/`
// (`docs/internal/environment/SECRETS_MANAGEMENT.md` § 5). So this proves what
// Infisical holds, and nothing about Render: a failed or stale sync, or a row
// set by hand on the service, is invisible from here.
//
// ── In a child process with no store in its environment ─────────────────────
// Loading the module runs third-party code from this commit's `node_modules`
// (`@nestjs/common`, `zod`), which no other step after the injection loads
// with the whole store: `vercel build` gets its app's keys alone
// (`lib/vercel-build-env.mjs`). So the boot check runs in a child whose
// environment is the baseline's names only. The store reaches it on stdin, as
// the config object `validateEnv` is handed at boot, after the module has
// loaded, so code that dumps `process.env` on load finds no secret. That is
// the threat #2824 names; it is not a sandbox against code written to look.
// The child's stdout and stderr are discarded, since anything the module
// prints could quote a value, and its verdict comes back on fd 3.
//
// ── Names, never values ─────────────────────────────────────────────────────
// `validateEnv` names the variable and never echoes a secret. Its refusals are
// plain `Error`s, printed with every injected value replaced by `***` (the
// runner masks them too; this holds without it). Anything else it throws, a
// `TypeError`, a `SyntaxError`, a non-Error, is reported by class alone and its
// text never leaves the child: such text can quote a fragment of a value
// (`JSON.parse` does), which no exact-match mask catches.
//
// Env inputs:
//   CHECK_API_BOOT     — `true` when this run deploys the API, else `false`
//   DEPLOYS_FUNCTIONS  — `true` when this run deploys the Edge Functions
//   VERIFIES_API       — `true` when this run checks the commit the API serves
//   ENV_BASELINE       — the file `record-env-baseline.mjs` wrote
// A flag that is neither `true` nor `false` fails the check, so a typo in the
// workflow can't switch one off.
//
// Unit tests: `scripts/ci/__tests__/check-deploy-config.test.mjs`.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { listFunctions } from "./deploy-edge-functions.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { parseEnvBaseline } from "./lib/vercel-build-env.mjs";

/** The boot check's source, and where the API's build puts it. */
export const BOOT_CHECK_SOURCE = join("apps", "api", "src", "config", "env.validation.ts");
export const BOOT_CHECK_BUILD = join("apps", "api", "dist", "config", "env.validation.js");

const FLAGS = ["CHECK_API_BOOT", "DEPLOYS_FUNCTIONS", "VERIFIES_API"];

/** This step's own inputs. Not part of the store, so neither checked nor redacted. */
export const OWN_INPUTS = Object.freeze([...FLAGS, "ENV_BASELINE", "TRUSTED_CI"]);

/** Shorter values are left alone: masking `1` would garble every version number. */
const MIN_REDACTED_LENGTH = 4;

/** The argument that makes this file the child, and the fd its verdict goes to. */
const CHILD_FLAG = "--run-boot-check";
const VERDICT_FD = 3;
const CHILD_TIMEOUT_MS = 60_000;

const SELF = fileURLToPath(import.meta.url);

const isBlank = (value) => typeof value !== "string" || value.trim() === "";

/** `env` split by the baseline: what the injection added (less this step's inputs), and what was there before. */
export function splitByBaseline(env, baselineNames) {
  const injected = {};
  const before = {};
  for (const [name, value] of Object.entries(env)) {
    if (baselineNames.has(name)) before[name] = value;
    else if (!OWN_INPUTS.includes(name)) injected[name] = value;
  }
  return { injected, before };
}

/** `text` with every one of `values` (long enough to mean something) replaced by `***`, longest first. */
export function redact(text, values) {
  const secrets = [...new Set(values)]
    .filter((value) => typeof value === "string" && value.length >= MIN_REDACTED_LENGTH)
    .sort((a, b) => b.length - a.length);
  let out = String(text);
  for (const secret of secrets) out = out.replaceAll(secret, "***");
  return out;
}

/**
 * What the child may send back about something thrown: a plain `Error`'s
 * message, or the class alone. See the header.
 */
export function thrownSummary(thrown) {
  if (thrown instanceof Error && thrown.constructor === Error) return { message: thrown.message };
  return { kind: thrown instanceof Error ? thrown.constructor.name || "Error" : typeof thrown };
}

const describe = (summary, secretValues) =>
  summary?.message !== undefined
    ? redact(summary.message, secretValues)
    : `it threw a ${summary?.kind ?? "value"} rather than refusing a variable; the text is withheld because it can quote part of a value`;

/**
 * The child: read the config from stdin, load the module, run `validateEnv`,
 * and write one verdict to fd 3. Every path writes one; only a crash inside
 * the module (a `process.exit`, say) leaves none.
 */
function runChild(modulePath) {
  const verdict = (value) => writeSync(VERDICT_FD, JSON.stringify(value));
  const config = JSON.parse(readFileSync(0, "utf8"));
  let validateEnv;
  try {
    ({ validateEnv } = createRequire(import.meta.url)(modulePath));
  } catch (error) {
    verdict({ status: "load-failed", ...thrownSummary(error) });
    return;
  }
  if (typeof validateEnv !== "function") {
    verdict({ status: "no-export" });
    return;
  }
  try {
    validateEnv(config);
  } catch (error) {
    verdict({ status: "refused", ...thrownSummary(error) });
    return;
  }
  verdict({ status: "ok" });
}

/**
 * Run the deployed commit's `validateEnv` on `config` in the child. Returns
 * `{ status: "ok" | "skipped" | "failed", message }`.
 */
export function runBootCheck({ root, config, childEnv, exists = existsSync, spawn = spawnSync }) {
  if (!exists(join(root, BOOT_CHECK_SOURCE))) {
    return {
      status: "skipped",
      message:
        `This commit has no ${BOOT_CHECK_SOURCE}, so there is no boot check to run (a rollback to a commit ` +
        `from before it). If the check moved, update BOOT_CHECK_SOURCE in scripts/ci/check-deploy-config.mjs.`,
    };
  }
  const secretValues = Object.values(config);
  const result = spawn(process.execPath, [SELF, CHILD_FLAG, join(root, BOOT_CHECK_BUILD)], {
    cwd: root,
    env: childEnv,
    input: JSON.stringify(config),
    stdio: ["pipe", "ignore", "ignore", "pipe"],
    timeout: CHILD_TIMEOUT_MS,
  });
  let verdict;
  try {
    verdict = JSON.parse(String(result.output?.[VERDICT_FD] ?? ""));
  } catch {
    verdict = null;
  }
  const failed = (message) => ({ status: "failed", message });
  switch (verdict?.status) {
    case "ok":
      return {
        status: "ok",
        message: `The API's boot check (validateEnv, from this commit) accepts the ${secretValues.length} names Infisical injected.`,
      };
    case "refused":
      return failed(
        `The API would refuse to boot on this Infisical environment (its validateEnv, from this commit): ` +
          describe(verdict, secretValues),
      );
    case "load-failed":
      return failed(
        `Could not load the API's boot check from ${BOOT_CHECK_BUILD}, which the build step before the injection ` +
          `writes: ${describe(verdict, secretValues)}`,
      );
    case "no-export":
      return failed(`${BOOT_CHECK_BUILD} exports no validateEnv function.`);
    default: {
      const how = result.error?.code === "ETIMEDOUT" ? `did not answer within ${CHILD_TIMEOUT_MS / 1000}s` :
        result.signal ? `was killed by ${result.signal}` : `exited ${result.status} without a verdict`;
      return failed(`The API's boot check ${how}. Its output is withheld, because it can quote a value.`);
    }
  }
}

/**
 * Every check, collected rather than stopping at the first, so one run names
 * every problem. Returns `{ problems, warnings, passed }`, each a list of
 * one-line messages that name variables and rules, never values.
 */
export function checkDeployConfig({ env, root, baselineNames, functions, runBoot = runBootCheck }) {
  const problems = [];
  const warnings = [];
  const passed = [];

  const flags = {};
  for (const name of FLAGS) {
    if (env[name] === "true" || env[name] === "false") flags[name] = env[name] === "true";
    else problems.push(`${name} must be true or false (got ${JSON.stringify(env[name] ?? "")}); refusing to guess which checks apply.`);
  }

  if (flags.CHECK_API_BOOT) {
    const { injected, before } = splitByBaseline(env, baselineNames);
    const result = runBoot({ root, config: injected, childEnv: before });
    if (result.status === "failed") problems.push(result.message);
    else if (result.status === "skipped") warnings.push(result.message);
    else passed.push(result.message);
  }

  if (flags.DEPLOYS_FUNCTIONS && functions.length > 0) {
    if (isBlank(env.SUPABASE_FUNCTIONS_DEPLOY_TOKEN)) {
      problems.push(
        `SUPABASE_FUNCTIONS_DEPLOY_TOKEN is not set in this Infisical environment, and this run deploys ` +
          `${functions.join(", ")} after the migrations. It is a Supabase access token scoped to this ` +
          `environment's project with Edge Functions read-write alone; SUPABASE_ACCESS_TOKEN is read-only by ` +
          `design and can't stand in. How to mint it: docs/internal/environment/ENV_REFERENCE.md § CD Secrets.`,
      );
    } else {
      passed.push(`SUPABASE_FUNCTIONS_DEPLOY_TOKEN is set, for ${functions.join(", ")}.`);
    }
  }

  if (flags.VERIFIES_API) {
    if (isBlank(env.API_HEALTHCHECK_URL)) {
      problems.push(
        `API_HEALTHCHECK_URL is not set in this Infisical environment, and this run checks the commit the API ` +
          `serves after the deploy (verify-served-commit.mjs), which fails without it. ` +
          `See docs/internal/environment/ENV_REFERENCE.md § CD Secrets.`,
      );
    } else {
      passed.push("API_HEALTHCHECK_URL is set.");
    }
  }

  return { problems, warnings, passed };
}

/** One `::error::` or `::warning::` line: the runner ends an annotation at a raw newline. */
const annotation = (level, message) =>
  `::${level}::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;

function main() {
  let baselineNames;
  try {
    baselineNames = parseEnvBaseline(readFileSync(process.env.ENV_BASELINE ?? "", "utf8"));
  } catch (error) {
    // The baseline holds names only, so this message carries no value.
    console.error(
      annotation(
        "error",
        `Could not read the env baseline that ENV_BASELINE names (record-env-baseline.mjs writes it just before ` +
          `the injection): ${error.message} Without it the injected names can't be told apart, so nothing was checked.`,
      ),
    );
    return 1;
  }

  const { problems, warnings, passed } = checkDeployConfig({
    env: process.env,
    root: process.cwd(),
    baselineNames,
    functions: listFunctions(),
  });

  console.log("Checked before anything is written (names only, never values):");
  for (const line of passed) console.log(`  ✓ ${line}`);
  for (const line of warnings) console.log(annotation("warning", line));
  for (const line of problems) console.error(annotation("error", line));
  if (problems.length > 0) {
    console.error(
      `${problems.length} problem(s). Nothing has been applied or deployed. Fix the value in Infisical, never on ` +
        `Render or Vercel (AGENTS.md § Credentials and secrets), then re-run.`,
    );
    return 1;
  }
  if (passed.length === 0 && warnings.length === 0) {
    console.log("  Nothing to check: this run deploys no API or function and verifies no API.");
  }
  return 0;
}

if (process.argv[2] === CHILD_FLAG && isInvokedDirectly(import.meta.url)) {
  runChild(process.argv[3]);
} else if (isInvokedDirectly(import.meta.url)) {
  process.exit(main());
}
