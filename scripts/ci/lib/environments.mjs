// Environment identity, read from `.github/environments.json`.
//
// Before this existed, "which Supabase project is production?" was answered by
// whatever `SUPABASE_PROJECT_REF` happened to hold in the job's environment —
// which is to say, by an Infisical folder and a workflow's `env-slug:` line,
// neither of which the repo could check. `run-migration.mjs` took an `--env`
// argument, validated it, printed it, and then ignored it entirely: `--env
// staging` and `--env production` were the same program, and a misconfigured
// ref would have applied to the wrong database under the right label.
//
// So the ref belongs somewhere the repo can assert against. A project ref is
// not a secret — it is already published in DB_ROLLBACK_PLAYBOOK.md,
// CLOUD_SANDBOX.md and the live-verification skill, and on its own it grants
// nothing without `SUPABASE_ACCESS_TOKEN`. Naming it here costs no secrecy and
// buys the fence in `run-migration.mjs`.
//
// Resolution is from THIS FILE's location, not `process.cwd()`, so a script
// invoked from a subdirectory reads the same config as one invoked from the
// repo root.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = fileURLToPath(new URL("../../../.github/environments.json", import.meta.url));

/** Environment names this repo deploys. Order is deliberate: staging first. */
export const ENVIRONMENTS = ["staging", "production"];

/**
 * The same shape the Supabase Management API and the CLI both accept. Matching
 * `run-migration.mjs`'s historical pattern exactly, so tightening the fence
 * cannot start rejecting a ref that used to be accepted.
 */
export const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{15,20}$/;

/**
 * Parse and validate the config.
 *
 * Fails LOUDLY rather than falling back to a built-in default. A default would
 * make a missing or truncated config file read as "staging is whatever the
 * environment says", which is precisely the unverifiable state this module was
 * added to remove — and it would do so silently, on the one code path that
 * writes to a production database.
 */
export function parseEnvironments(text, { source = CONFIG_PATH } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error.message}`);
  }

  const environments = parsed?.environments;
  if (!environments || typeof environments !== "object") {
    throw new Error(`${source} has no "environments" object.`);
  }

  const resolved = {};
  for (const name of ENVIRONMENTS) {
    const entry = environments[name];
    if (!entry) throw new Error(`${source} does not define the "${name}" environment.`);

    const ref = entry.supabaseProjectRef;
    if (typeof ref !== "string" || !SUPABASE_PROJECT_REF_PATTERN.test(ref)) {
      throw new Error(
        `${source}: "${name}".supabaseProjectRef must be 15-20 lowercase alphanumeric ` +
          `characters (got ${JSON.stringify(ref)}).`,
      );
    }
    resolved[name] = {
      name,
      supabaseProjectRef: ref,
      supabaseProjectName: entry.supabaseProjectName ?? name,
      infisicalEnvSlug: entry.infisicalEnvSlug ?? null,
      // Opt-out for `check-migration-order.mjs`, which otherwise reads an empty
      // migration history as "unreadable" rather than "clean" — both real
      // projects permanently hold `00000000000000_initial_schema`, so empty is
      // a wrong ref or a mis-scoped token, not a fresh database. A genuinely new
      // project sets this until its first migration lands.
      allowEmptyMigrationHistory: entry.allowEmptyMigrationHistory === true,
    };
  }

  // Two environments pointing at one database would make the fence in
  // `run-migration.mjs` assert nothing while looking like it asserted
  // something — the worst of the available failures, since it reads green.
  const refs = new Set(ENVIRONMENTS.map((n) => resolved[n].supabaseProjectRef));
  if (refs.size !== ENVIRONMENTS.length) {
    throw new Error(
      `${source}: two environments share a supabaseProjectRef. Each environment must name a ` +
        `distinct project, or the environment fence asserts nothing.`,
    );
  }

  return resolved;
}

let cached = null;

/**
 * Every environment, keyed by name. Cached — the file cannot change mid-run.
 *
 * The cache is used ONLY for the no-argument call. Keying it on `path` alone
 * meant an injected `readFile` was silently ignored once anything in the
 * process had read the real config: the guard passed, the fixture reader was
 * never called, and the caller got the committed refs back. A test pointing the
 * loader at a fixture to exercise `run-migration.mjs`'s mismatch fence would
 * then have asserted against production's real ref and passed for the wrong
 * reason — a green assertion about a config nothing under test supplied, on the
 * one code path that writes to a production database.
 */
export function loadEnvironments(options = {}) {
  const { path = CONFIG_PATH, readFile = readFileSync } = options;
  const cacheable = path === CONFIG_PATH && readFile === readFileSync;
  if (cached && cacheable) return cached;
  let text;
  try {
    text = readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
  const parsed = parseEnvironments(text, { source: path });
  if (cacheable) cached = parsed;
  return parsed;
}

/** One environment by name. Throws on an unknown name rather than returning undefined. */
export function getEnvironment(name, options = {}) {
  const all = loadEnvironments(options);
  const found = all[name];
  if (!found) {
    throw new Error(
      `Unknown environment "${name}". Known: ${Object.keys(all).join(", ")}.`,
    );
  }
  return found;
}
