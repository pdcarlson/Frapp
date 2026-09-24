// What a CI-built Vercel bundle compiles against, when the app config comes
// from Infisical rather than from the Vercel project (#834, #2672).
//
// ── Why staging stopped reading Vercel's Preview env ───────────────────────
// Staging's app config used to reach Vercel through two Infisical→Vercel syncs
// (`vercel-web-staging`, `vercel-landing-staging`). Those have failed since
// ADR-21 unlinked both projects from Git: Infisical scopes a Preview write by
// git branch, and a Git-less project has no branch to resolve. They also pushed
// the WHOLE staging store, backend credentials included, into two frontend
// projects. The owner chose #834's option (b) on 2026-09-24: the staging deploy
// job injects Infisical `staging` itself and hands each build exactly the keys
// its app reads. Reconnecting Git (option c) stays off the table, and an
// unfiltered Preview target (option a) was declined because it keeps fanning the
// backend store into the frontends.
//
// The syncs had also stopped mattering to the build before anyone noticed:
// `vercel pull --environment=preview` with no `--git-branch` requests
// `/v3/env/pull/<project>/preview` with no branch (CLI 59.11.7 source), and run
// 36053129347's log shows it returning only unscoped rows (`frapp-web`:
// `NEXT_PUBLIC_API_URL` and the two `NEXT_PUBLIC_SUPABASE_*` keys; `frapp-landing`:
// `NEXT_PUBLIC_APP_URL`), none of the sync's `Preview · main` rows.
//
// ── The three rules, and why each is needed ────────────────────────────────
// 1. The app keys go into `vercel build`'s environment. The CLI loads the
//    pulled `.vercel/.env.<env>.local` with a bundled dotenv@4.0.0 whose whole
//    merge is `process.env[key] = process.env[key] || parsed[key]`, so a
//    non-empty value already in the environment wins over the file.
// 2. The same keys are deleted from the pulled file. The `||` above means an
//    EMPTY injected value loses to the file, and a key Infisical does not hold
//    at all would be filled from it. Either way a Vercel row would feed the
//    bundle while the log said Infisical did.
// 3. Nothing else Infisical injected reaches a Vercel CLI process. The injection
//    exports the whole store to the job, so the child environment is built from
//    the names the job had BEFORE the injection (the baseline, recorded by
//    `record-env-baseline.mjs`) plus the project's own keys, never from the
//    ambient environment wholesale.
//
// Runtime is not a fourth rule, and that was checked, not assumed. Next inlines
// `NEXT_PUBLIC_*` at build into client, Node server and proxy code alike
// (`next/dist/build/define-env.js` spreads them unconditionally), and neither app
// reads a non-public key at request time: `SENTRY_AUTH_TOKEN` is read only by
// `next.config.js`. So a deployment's runtime env needs nothing from Infisical,
// and deleting the stale `Preview · main` rows removes nothing an app reads.
//
// Semantics: the pure functions below. Unit tests, including the guard that
// keeps `APP_CONFIG_KEYS` equal to what the apps read:
// `scripts/ci/__tests__/vercel-build-env.test.mjs`.

/**
 * The keys each Vercel project's app reads from the secret store, by project
 * label (the label `deploy-vercel.mjs` gives each project).
 *
 * `required` fails the deploy before anything is built when missing: each has
 * a fallback that would ship a bundle pointed at `localhost` or at nothing
 * (`ENV_REFERENCE.md` marks them ✅). `optional` keys may be absent; the app
 * has a working default or turns the feature off.
 *
 * Not listed, deliberately: the Vercel system variables (`VERCEL_ENV`,
 * `VERCEL_GIT_COMMIT_SHA`), the two derived Sentry names `next.config.js`
 * writes itself, and the CI-only `SUPABASE_AUTH_BYPASS`. The test that derives
 * this table from the apps' source names each exclusion and why.
 */
export const APP_CONFIG_KEYS = Object.freeze({
  "frapp-web": Object.freeze({
    appDir: "apps/web",
    required: Object.freeze([
      "NEXT_PUBLIC_API_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]),
    optional: Object.freeze([
      "NEXT_PUBLIC_LANDING_URL",
      "NEXT_PUBLIC_POSTHOG_HOST",
      "NEXT_PUBLIC_POSTHOG_KEY",
      "NEXT_PUBLIC_SENTRY_DSN",
      "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "SENTRY_AUTH_TOKEN",
    ]),
  }),
  "frapp-landing": Object.freeze({
    appDir: "apps/landing",
    required: Object.freeze(["NEXT_PUBLIC_APP_URL"]),
    optional: Object.freeze([
      "NEXT_PUBLIC_LANDING_SENTRY_DSN",
      "NEXT_PUBLIC_POSTHOG_HOST",
      "NEXT_PUBLIC_POSTHOG_KEY",
      "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
      "SENTRY_AUTH_TOKEN",
    ]),
  }),
});

/** Every key `label`'s app reads from the store, required first. */
export function appConfigKeysFor(label) {
  const entry = APP_CONFIG_KEYS[label];
  if (!entry) {
    // An unknown label is a programming error, not "reads nothing": the
    // fail-open reading would build that project with no app config at all.
    throw new Error(
      `No app config keys recorded for Vercel project '${label}'. Add it to APP_CONFIG_KEYS ` +
        `rather than building it with an unknown environment.`,
    );
  }
  return [...entry.required, ...entry.optional];
}

/** What `record-env-baseline.mjs` writes: the sorted names, one JSON array. */
export function formatEnvBaseline(env) {
  return `${JSON.stringify(Object.keys(env).sort())}\n`;
}

/**
 * Read a baseline back, refusing one that cannot be a real job environment.
 *
 * `PATH` is the sanity anchor: every runner step has it, so a baseline without
 * it is truncated or written by something else, and trusting it would strip the
 * build's environment down to nothing.
 */
export function parseEnvBaseline(text) {
  let names;
  try {
    names = JSON.parse(text);
  } catch (error) {
    throw new Error(`The env baseline is not JSON (${error.message}).`);
  }
  if (!Array.isArray(names) || !names.every((n) => typeof n === "string")) {
    throw new Error("The env baseline must be a JSON array of variable names.");
  }
  if (!names.includes("PATH")) {
    throw new Error(
      "The env baseline has no PATH, so it is not a snapshot of a job environment. " +
        "Refusing to build from it.",
    );
  }
  return new Set(names);
}

/**
 * The environments ONE project's CLI steps run with, when its app config comes
 * from an Infisical injection earlier in the job.
 *
 * - `baseEnv`: the ambient environment restricted to the baseline's names, for
 *   every CLI step. The injection's other keys never reach a CLI process.
 * - `appEnv`: the project's app keys that hold a value, for `vercel build`
 *   only. An empty value counts as absent, as it does for `requireEnv`.
 * - `appKeys`: every key the app reads, set or not. These are deleted from the
 *   pulled env file, so Vercel cannot supply one.
 *
 * Throws, naming keys and never values, when a required key is missing or when
 * the baseline already holds an app key. The second means the baseline was
 * recorded after the injection (so it would pass the whole store through) or
 * that an app key is set outside Infisical. Both are wrong for a build whose
 * config is supposed to come from Infisical alone.
 */
export function infisicalBuildEnv({ label, env, baselineNames }) {
  const appKeys = appConfigKeysFor(label);
  const { required } = APP_CONFIG_KEYS[label];

  const leaked = appKeys.filter((key) => baselineNames.has(key));
  if (leaked.length > 0) {
    throw new Error(
      `[${label}] The env baseline already holds ${leaked.join(", ")}. Either it was recorded ` +
        `after the Infisical injection, which would hand the whole store to the build, or the ` +
        `job sets app config outside Infisical. Record the baseline before the injection and ` +
        `let Infisical be the only source.`,
    );
  }

  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `[${label}] The Infisical injection supplied no value for ${missing.join(", ")}. The app ` +
        `falls back to localhost or to nothing without ${missing.length === 1 ? "it" : "them"}, ` +
        `so nothing was built. Add the key to Infisical (ENV_REFERENCE.md lists its value).`,
    );
  }

  const baseEnv = {};
  for (const name of baselineNames) {
    if (name in env) baseEnv[name] = env[name];
  }
  const appEnv = {};
  for (const key of appKeys) {
    if (env[key]) appEnv[key] = env[key];
  }
  return { baseEnv, appEnv, appKeys };
}

// The same line shape dotenv@4.0.0 in the CLI accepts, so a line this reads as
// a key is exactly a line `vercel build` would load. The CLI writes one
// `KEY="value"` per line with newlines escaped, so line-wise removal is exact.
const DOTENV_KEY_RE = /^\s*([\w.-]+)\s*=/;

/**
 * Remove `keys` from the text of a pulled `.vercel/.env.<env>.local`.
 *
 * Everything else is kept as written, the Vercel system variables included
 * (`VERCEL_ENV` is what `next.config.js` derives the Sentry environment from).
 * Returns the names removed, for the log. Never the values.
 */
export function withoutEnvKeys(text, keys) {
  const drop = new Set(keys);
  const removed = [];
  const kept = text.split("\n").filter((line) => {
    const key = line.match(DOTENV_KEY_RE)?.[1];
    if (key && drop.has(key)) {
      removed.push(key);
      return false;
    }
    return true;
  });
  return { text: kept.join("\n"), removed };
}
