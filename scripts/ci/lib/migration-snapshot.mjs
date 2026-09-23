// The published migration snapshot: what each deployed Supabase project has
// applied, recorded by a job meant to run from `main` only, so that
// pull-request jobs never hold a credential (#2518).
//
// ── Why this exists ─────────────────────────────────────────────────────────
// `migration-drift-gate.yml` runs on `pull_request`, and for a same-repository
// PR GitHub runs the workflow definition from the PR's own head. So whatever
// credential a PR job can read, any branch can read, by editing the workflow or
// adding a new one. The three migration gates used to inject Infisical `prod`
// for one thing: `GET /v1/projects/{ref}/database/migrations`. The account-level
// Supabase token that answered it also drives production.
//
// Now `publish-migration-snapshot.mjs` makes that read instead, under a GitHub
// environment meant to admit `main` only (the owner's #2583 sets that rule;
// until then a branch dispatch can still run it), and uploads the answer as a
// workflow artifact. The PR jobs download it with `GITHUB_TOKEN` and
// `actions: read`, and serve it back to the unchanged gate logic through
// `snapshotFetch` below, which answers exactly the one URL shape
// `fetchAppliedMigrations` requests.
//
// ── Fails closed ────────────────────────────────────────────────────────────
// A snapshot that is unreadable, stale, from the future or missing an
// environment the caller needs is an error, never "nothing applied". An empty
// or partial answer read as clean is a silent false pass on the one read these
// gates depend on.
//
// Unit tests: scripts/ci/__tests__/migration-snapshot.test.mjs.

import { readFileSync } from "node:fs";

import { getEnvironment, SUPABASE_PROJECT_REF_PATTERN } from "./environments.mjs";

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Artifact and file names shared by the publisher and the download action. */
export const SNAPSHOT_ARTIFACT_NAME = "migration-snapshot";
export const SNAPSHOT_FILE_NAME = "migration-snapshot.json";

/** The workflow that publishes it, named in every "go refresh it" message. */
export const SNAPSHOT_WORKFLOW = ".github/workflows/migration-snapshot.yml";

/**
 * How old a snapshot may be before a consumer refuses it. A backstop, not the
 * main freshness rule.
 *
 * The main rule lives in `.github/actions/download-migration-snapshot`: the
 * snapshot must have been read after the latest completed `Deploy API` or
 * `Deploy production` run on `main`, the only workflows that apply migrations.
 * Each of them triggers a publish. Off `main` the download action waits up to
 * 15 minutes for a lagging one, then fails the gates, naming the publisher. Runs
 * on `main` take the newest snapshot as it is. The drift job's `stale` verdict
 * catches a stuck publisher once a migration outlives its grace window. This
 * limit covers
 * the rest: an apply made outside those workflows, when nothing deploys for a
 * day and the 4-hourly schedule is also failing. Scheduled runs here start hours
 * late (the 06:30 `db-backup.yml` cron started at 11:52Z on 2026-09-23), so 24
 * hours spans a missed day of schedule.
 */
export const DEFAULT_MAX_AGE_HOURS = 24;

/** Clock skew tolerated before a capture time counts as "in the future". */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

const MIGRATIONS_URL = /\/v1\/projects\/([^/]+)\/database\/migrations$/;

/**
 * The file the publisher writes.
 *
 * `environments` is `[{ name, supabaseProjectRef, migrations }]`, where each
 * migration is `{ version, name }` exactly as `fetchAppliedMigrations` returns
 * it. Nothing else is kept: version and name are already public in this repo's
 * `supabase/migrations/`, and the refs are in `.github/environments.json`.
 */
export function buildSnapshot({ capturedAt, sha = null, runUrl = null, environments }) {
  const byName = {};
  for (const env of environments) {
    byName[env.name] = {
      supabaseProjectRef: env.supabaseProjectRef,
      migrations: env.migrations.map((m) => ({ version: m.version, name: m.name ?? "" })),
    };
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt,
    source: { sha, runUrl },
    environments: byName,
  };
}

/** Parse and validate a snapshot. Throws with the reason on anything malformed. */
export function parseSnapshot(text, { source = "migration snapshot" } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error.message}`);
  }
  if (parsed?.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `${source} has schemaVersion ${JSON.stringify(parsed?.schemaVersion)}; this checkout ` +
        `reads version ${SNAPSHOT_SCHEMA_VERSION}.`,
    );
  }
  if (typeof parsed.capturedAt !== "string" || !Number.isFinite(Date.parse(parsed.capturedAt))) {
    throw new Error(`${source} has no valid capturedAt timestamp.`);
  }
  const environments = parsed.environments;
  if (!environments || typeof environments !== "object" || Object.keys(environments).length === 0) {
    throw new Error(`${source} records no environments.`);
  }
  for (const [name, entry] of Object.entries(environments)) {
    const ref = entry?.supabaseProjectRef;
    if (typeof ref !== "string" || !SUPABASE_PROJECT_REF_PATTERN.test(ref)) {
      throw new Error(`${source}: "${name}" has an invalid supabaseProjectRef (${JSON.stringify(ref)}).`);
    }
    if (!Array.isArray(entry.migrations)) {
      throw new Error(`${source}: "${name}" has no migrations array.`);
    }
    for (const m of entry.migrations) {
      if (typeof m?.version !== "string") {
        throw new Error(`${source}: "${name}" lists a migration without a string version.`);
      }
    }
  }
  return parsed;
}

/** `{ ok, ageHours, error }`. A capture time in the future is as untrustworthy as an old one. */
export function checkFreshness(snapshot, { nowMs = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS } = {}) {
  const capturedMs = Date.parse(snapshot.capturedAt);
  const ageMs = nowMs - capturedMs;
  const ageHours = ageMs / 3_600_000;
  if (ageMs < -FUTURE_SKEW_MS) {
    return {
      ok: false,
      ageHours,
      error: `the migration snapshot claims a capture time in the future (${snapshot.capturedAt})`,
    };
  }
  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      ageHours,
      error:
        `the migration snapshot is ${ageHours.toFixed(1)}h old (captured ${snapshot.capturedAt}), ` +
        `past the ${maxAgeHours}h limit. The publisher (${SNAPSHOT_WORKFLOW}) has not succeeded ` +
        `since then: read its latest run, fix it, then re-run it (Actions → Migration snapshot → ` +
        `Run workflow, on main)`,
    };
  }
  return { ok: true, ageHours, error: null };
}

/**
 * A `fetch` stand-in that answers the Management API's migration-history URL
 * from the snapshot, keyed by project ref.
 *
 * An unknown ref THROWS rather than answering 404: `fetchAppliedMigrations`
 * turns a throw into `request failed: <message>`, which names the real cause,
 * where a 404 would read as "Supabase Management API returned HTTP 404". Callers
 * check the refs they need up front (`loadSnapshot`'s `requireRefs`), so this
 * path is defence in depth.
 */
export function snapshotFetch(snapshot) {
  const byRef = new Map(
    Object.entries(snapshot.environments).map(([name, e]) => [e.supabaseProjectRef, { name, ...e }]),
  );
  return async (url) => {
    const match = String(url).match(MIGRATIONS_URL);
    if (!match) {
      throw new Error(`the migration snapshot answers only migration-history reads, not ${url}`);
    }
    const entry = byRef.get(match[1]);
    if (!entry) {
      throw new Error(
        `the migration snapshot has no entry for project ${match[1]} ` +
          `(it records: ${[...byRef.keys()].join(", ")})`,
      );
    }
    const body = JSON.stringify(entry.migrations);
    return { ok: true, status: 200, text: async () => body };
  };
}

/**
 * Read, validate and freshness-check a snapshot file, and return the fetch
 * stand-in for it. Throws one message naming the problem and the fix.
 *
 * `requireRefs` lists the project refs the caller will ask about. A snapshot
 * missing one fails here rather than as a mid-run fetch error, which is what
 * happens for one publish cycle after a ref changes in environments.json.
 */
export function loadSnapshot(
  path,
  { nowMs = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS, requireRefs = [], readFile = readFileSync } = {},
) {
  let text;
  try {
    text = readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Could not read the migration snapshot at ${path}: ${error.message}`);
  }
  const snapshot = parseSnapshot(text, { source: path });
  const freshness = checkFreshness(snapshot, { nowMs, maxAgeHours });
  if (!freshness.ok) throw new Error(freshness.error);

  const recorded = new Set(Object.values(snapshot.environments).map((e) => e.supabaseProjectRef));
  const missing = requireRefs.filter((ref) => !recorded.has(ref));
  if (missing.length > 0) {
    throw new Error(
      `the migration snapshot has no entry for ${missing.join(", ")} (it records ` +
        `${[...recorded].join(", ")}). If .github/environments.json changed a project ref, the ` +
        `next publish picks it up: re-run ${SNAPSHOT_WORKFLOW} on main`,
    );
  }
  return { snapshot, fetchImpl: snapshotFetch(snapshot), ageHours: freshness.ageHours };
}

/**
 * `loadSnapshot` for the named environments of `.github/environments.json`,
 * which is what every gate wants: their refs, the snapshot's fetch stand-in, a
 * log line, and `capturedMs`, the moment the state was read. The snapshot
 * cannot know about anything after `capturedMs`, so the drift gate keeps a
 * migration that landed after it in grace. Its grace clock itself still runs
 * from now: measured from `capturedMs`, a failed apply captured within 30
 * minutes of its merge would never turn red.
 */
export function openSnapshot(path, names, { nowMs = Date.now(), environments, readFile } = {}) {
  const refs = {};
  for (const name of names) {
    const env = environments ? environments[name] : getEnvironment(name);
    if (!env) throw new Error(`No "${name}" environment to look up in the migration snapshot.`);
    refs[name] = env.supabaseProjectRef;
  }
  const loaded = loadSnapshot(path, {
    nowMs,
    requireRefs: Object.values(refs),
    ...(readFile ? { readFile } : {}),
  });
  return {
    ...loaded,
    refs,
    capturedMs: Date.parse(loaded.snapshot.capturedAt),
    description: describeSnapshot(loaded.snapshot, loaded.ageHours),
  };
}

/** One line for logs: where the data came from and how old it is. */
export function describeSnapshot(snapshot, ageHours) {
  const source = snapshot.source?.runUrl ? ` by ${snapshot.source.runUrl}` : "";
  return `migration snapshot captured ${snapshot.capturedAt} (${ageHours.toFixed(1)}h old)${source}`;
}
