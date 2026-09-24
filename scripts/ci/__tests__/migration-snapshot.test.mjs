import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fetchAppliedMigrations } from "../check-migration-drift.mjs";
import {
  buildSnapshot,
  checkFreshness,
  DEFAULT_MAX_AGE_HOURS,
  loadSnapshot,
  openSnapshot,
  parseSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  snapshotFetch,
} from "../lib/migration-snapshot.mjs";
import { publishSnapshot } from "../publish-migration-snapshot.mjs";
import { makeFetchMock } from "./helpers.mjs";

// The published migration snapshot (#2518): a `main`-only job reads both
// projects' applied-migration history and PR jobs read the file, so no PR job
// holds a credential. These pin the round trip and every fail-closed branch.

const STAGING_REF = "stagingrefaaaaaa";
const PRODUCTION_REF = "productionrefbbb";
const ENVIRONMENTS = {
  staging: { name: "staging", supabaseProjectRef: STAGING_REF },
  production: { name: "production", supabaseProjectRef: PRODUCTION_REF },
};
const NOW = Date.parse("2026-09-23T12:00:00Z");
const STAGING_APPLIED = [
  { version: "00000000000000", name: "initial_schema" },
  { version: "20260915210100", name: "anonymize_user_purge_chat_blocks" },
];
const PRODUCTION_APPLIED = [{ version: "00000000000000", name: "initial_schema" }];

const quiet = { log: () => {}, error: () => {}, writeSummary: () => {}, sleepImpl: async () => {} };

function sample(overrides = {}) {
  return buildSnapshot({
    capturedAt: "2026-09-23T10:00:00.000Z",
    sha: "abc123",
    runUrl: "https://github.com/pdcarlson/Frapp/actions/runs/1",
    environments: [
      { name: "staging", supabaseProjectRef: STAGING_REF, migrations: STAGING_APPLIED },
      { name: "production", supabaseProjectRef: PRODUCTION_REF, migrations: PRODUCTION_APPLIED },
    ],
    ...overrides,
  });
}

function migrationsRoute(ref, migrations, status = 200) {
  return { method: "GET", path: `/v1/projects/${ref}/database/migrations`, status, body: migrations };
}

// ── parse / validate ────────────────────────────────────────────────────────

test("a built snapshot parses back to what was built", () => {
  const snapshot = sample();
  const parsed = parseSnapshot(JSON.stringify(snapshot));
  assert.equal(parsed.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.deepEqual(parsed.environments.production.migrations, PRODUCTION_APPLIED);
  assert.equal(parsed.environments.staging.supabaseProjectRef, STAGING_REF);
});

test("a malformed snapshot is rejected, never read as 'nothing applied'", () => {
  const good = sample();
  const cases = [
    ["not json", "{"],
    ["wrong schema", JSON.stringify({ ...good, schemaVersion: 99 })],
    ["no capture time", JSON.stringify({ ...good, capturedAt: "yesterday-ish" })],
    ["no environments", JSON.stringify({ ...good, environments: {} })],
    [
      "bad ref",
      JSON.stringify({ ...good, environments: { staging: { supabaseProjectRef: "BAD REF", migrations: [] } } }),
    ],
    [
      "no migrations array",
      JSON.stringify({ ...good, environments: { staging: { supabaseProjectRef: STAGING_REF } } }),
    ],
    [
      "versionless row",
      JSON.stringify({
        ...good,
        environments: { staging: { supabaseProjectRef: STAGING_REF, migrations: [{ name: "x" }] } },
      }),
    ],
  ];
  for (const [label, text] of cases) {
    assert.throws(() => parseSnapshot(text), Error, label);
  }
});

// ── freshness ───────────────────────────────────────────────────────────────

test("a snapshot inside the age limit is fresh", () => {
  const verdict = checkFreshness(sample(), { nowMs: NOW });
  assert.equal(verdict.ok, true);
  assert.equal(Math.round(verdict.ageHours), 2);
});

test("a stale snapshot is refused and the message names the publisher", () => {
  const verdict = checkFreshness(sample(), { nowMs: NOW + DEFAULT_MAX_AGE_HOURS * 3_600_000 });
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /migration-snapshot\.yml/);
});

test("a capture time in the future is refused; small clock skew is not", () => {
  const future = sample({ capturedAt: "2026-09-23T13:00:00.000Z" });
  assert.equal(checkFreshness(future, { nowMs: NOW }).ok, false);
  const skewed = sample({ capturedAt: "2026-09-23T12:02:00.000Z" });
  assert.equal(checkFreshness(skewed, { nowMs: NOW }).ok, true);
});

// ── the fetch stand-in ──────────────────────────────────────────────────────

test("the stand-in answers fetchAppliedMigrations exactly as the live API would", async () => {
  const fetchImpl = snapshotFetch(sample());
  const staging = await fetchAppliedMigrations({ accessToken: "snapshot", projectRef: STAGING_REF, fetchImpl });
  assert.equal(staging.ok, true);
  assert.deepEqual(staging.migrations, STAGING_APPLIED);
});

test("an unrecorded ref is a named failure, not an empty history", async () => {
  const fetchImpl = snapshotFetch(sample());
  const result = await fetchAppliedMigrations({
    accessToken: "snapshot",
    projectRef: "someotherrefcccc",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /no entry for project someotherrefcccc/);
});

test("the stand-in refuses any URL but migration history", async () => {
  const fetchImpl = snapshotFetch(sample());
  await assert.rejects(() => fetchImpl(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`));
});

// ── loadSnapshot ────────────────────────────────────────────────────────────

test("loadSnapshot refuses a snapshot missing a ref the caller needs", () => {
  const text = JSON.stringify(
    buildSnapshot({
      capturedAt: "2026-09-23T10:00:00.000Z",
      environments: [{ name: "staging", supabaseProjectRef: STAGING_REF, migrations: STAGING_APPLIED }],
    }),
  );
  assert.throws(
    () => loadSnapshot("x.json", { nowMs: NOW, requireRefs: [PRODUCTION_REF], readFile: () => text }),
    new RegExp(`no entry for ${PRODUCTION_REF}`),
  );
});

test("loadSnapshot names an unreadable file", () => {
  assert.throws(
    () =>
      loadSnapshot("/nope/migration-snapshot.json", {
        nowMs: NOW,
        readFile: () => {
          throw new Error("ENOENT");
        },
      }),
    /Could not read the migration snapshot at \/nope\/migration-snapshot\.json: ENOENT/,
  );
});

// ── publishSnapshot ─────────────────────────────────────────────────────────

test("the publisher reads both projects and writes a snapshot consumers can load", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    migrationsRoute(STAGING_REF, STAGING_APPLIED),
    migrationsRoute(PRODUCTION_REF, PRODUCTION_APPLIED),
  ]);
  const written = {};
  const code = await publishSnapshot({
    accessToken: "t",
    outPath: "/tmp/out/migration-snapshot.json",
    environments: ENVIRONMENTS,
    fetchImpl,
    nowMs: NOW,
    sha: "abc123",
    runUrl: "https://example.test/run/1",
    writeFile: (path, text) => {
      written[path] = text;
    },
    ...quiet,
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.method === "GET"), "the publisher is read-only");

  const text = written["/tmp/out/migration-snapshot.json"];
  const { fetchImpl: served } = loadSnapshot("x", {
    nowMs: NOW,
    requireRefs: [STAGING_REF, PRODUCTION_REF],
    readFile: () => text,
  });
  const production = await fetchAppliedMigrations({ accessToken: "snapshot", projectRef: PRODUCTION_REF, fetchImpl: served });
  assert.deepEqual(production.migrations, PRODUCTION_APPLIED);
  assert.equal(JSON.parse(text).source.sha, "abc123");
});

test("the publisher writes nothing when either project cannot be read", async () => {
  // Consumers then keep using the last good snapshot until a deploy outdates it
  // or it ages out. Writing a partial one would hand them an environment with
  // no entry at best.
  const { fetchImpl } = makeFetchMock([
    migrationsRoute(STAGING_REF, STAGING_APPLIED),
    migrationsRoute(PRODUCTION_REF, { message: "boom" }, 500),
  ]);
  let wrote = false;
  const code = await publishSnapshot({
    accessToken: "t",
    outPath: "/tmp/out/x.json",
    environments: ENVIRONMENTS,
    fetchImpl,
    nowMs: NOW,
    writeFile: () => {
      wrote = true;
    },
    ...quiet,
  });
  assert.equal(code, 1);
  assert.equal(wrote, false);
});

test("the publisher refuses an empty history unless the environment allows one", async () => {
  // Both real projects permanently hold 00000000000000_initial_schema, so an
  // empty answer is a wrong ref or a token scoped elsewhere. Published, it
  // would read downstream as "nothing is applied", which is clean.
  const run = async (environments) => {
    let wrote = false;
    const { fetchImpl } = makeFetchMock([
      migrationsRoute(STAGING_REF, STAGING_APPLIED),
      migrationsRoute(PRODUCTION_REF, []),
    ]);
    const code = await publishSnapshot({
      accessToken: "t",
      outPath: "/tmp/out/x.json",
      environments,
      fetchImpl,
      nowMs: NOW,
      writeFile: () => {
        wrote = true;
      },
      ...quiet,
    });
    return { code, wrote };
  };
  assert.deepEqual(await run(ENVIRONMENTS), { code: 1, wrote: false });
  assert.deepEqual(
    await run({ ...ENVIRONMENTS, production: { ...ENVIRONMENTS.production, allowEmptyMigrationHistory: true } }),
    { code: 0, wrote: true },
  );
});

test("the publisher's invocation guards", async () => {
  assert.equal(await publishSnapshot({ accessToken: "t", outPath: "", ...quiet }), 2);
  assert.equal(await publishSnapshot({ accessToken: "", outPath: "/tmp/x.json", ...quiet }), 2);
});

// A token that, like each Infisical environment's since #2583, answers only for
// its own project: anything else is the Management API's 403.
function scopedFetch(tokenByRef) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const ref = url.match(/\/v1\/projects\/([^/]+)\/database\/migrations$/)?.[1];
    const token = String(init.headers?.Authorization ?? "").replace(/^Bearer /, "");
    seen.push({ ref, token });
    const allowed = ref && tokenByRef[ref] === token;
    const body = ref === STAGING_REF ? STAGING_APPLIED : PRODUCTION_APPLIED;
    return {
      ok: allowed,
      status: allowed ? 200 : 403,
      text: async () => JSON.stringify(allowed ? body : { message: "Forbidden" }),
    };
  };
  return { fetchImpl, seen };
}

test("each project is read with its own token, since neither can read the other (#2583)", async () => {
  const tokens = { staging: "staging-token", production: "production-token" };
  const { fetchImpl, seen } = scopedFetch({ [STAGING_REF]: tokens.staging, [PRODUCTION_REF]: tokens.production });
  const code = await publishSnapshot({
    tokenFor: (name) => tokens[name],
    outPath: "/tmp/out/x.json",
    environments: ENVIRONMENTS,
    fetchImpl,
    nowMs: NOW,
    writeFile: () => {},
    ...quiet,
  });
  assert.equal(code, 0);
  assert.deepEqual(
    seen.map(({ ref, token }) => [ref, token]),
    [
      [STAGING_REF, tokens.staging],
      [PRODUCTION_REF, tokens.production],
    ],
  );
});

test("production's token alone cannot publish: staging answers 403 and nothing is written", async () => {
  // The failure run 36022850155 hit on 2026-09-24, before the workflow kept
  // each environment's token.
  const { fetchImpl } = scopedFetch({ [STAGING_REF]: "staging-token", [PRODUCTION_REF]: "production-token" });
  let wrote = false;
  const code = await publishSnapshot({
    accessToken: "production-token",
    outPath: "/tmp/out/x.json",
    environments: ENVIRONMENTS,
    fetchImpl,
    nowMs: NOW,
    writeFile: () => {
      wrote = true;
    },
    ...quiet,
  });
  assert.equal(code, 1);
  assert.equal(wrote, false);
});

test("a project with no token is an invocation error that names its variable", async () => {
  const errors = [];
  let fetched = false;
  const code = await publishSnapshot({
    tokenFor: (name) => (name === "production" ? "production-token" : ""),
    outPath: "/tmp/out/x.json",
    environments: ENVIRONMENTS,
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
    ...quiet,
    error: (line) => errors.push(line),
  });
  assert.equal(code, 2);
  assert.equal(fetched, false, "nothing is read until every project has a token");
  assert.ok(errors.some((line) => line.includes("SUPABASE_ACCESS_TOKEN_STAGING")), errors.join("\n"));
});

// ── openSnapshot ────────────────────────────────────────────────────────────

test("openSnapshot resolves refs by environment name and reports the capture time", () => {
  const text = JSON.stringify(sample());
  const opened = openSnapshot("x.json", ["staging", "production"], {
    nowMs: NOW,
    environments: ENVIRONMENTS,
    readFile: () => text,
  });
  assert.deepEqual(opened.refs, { staging: STAGING_REF, production: PRODUCTION_REF });
  assert.equal(opened.capturedMs, Date.parse("2026-09-23T10:00:00.000Z"));
  assert.match(opened.description, /captured 2026-09-23T10:00:00.000Z \(2\.0h old\)/);
});

test("openSnapshot refuses an environment name it cannot resolve", () => {
  assert.throws(
    () => openSnapshot("x.json", ["preview"], { nowMs: NOW, environments: ENVIRONMENTS, readFile: () => "{}" }),
    /No "preview" environment/,
  );
});

// ── Who waits on a stale snapshot ───────────────────────────────────────────

test("only the required gates off main wait on a stale snapshot", () => {
  // The download action's `on-stale: wait` polls for a post-deploy publish and
  // fails when its budget runs out. On a push to main that failure would be a
  // red REQUIRED check on a main commit, one validate-deploy-sha.mjs refuses
  // to deploy and nothing re-runs. The wait would also hold main's
  // non-cancellable concurrency group open. So push and dispatch runs, and the
  // report-only drift job, must `use` the snapshot as it is.
  const workflow = readFileSync(
    new URL("../../../.github/workflows/migration-drift-gate.yml", import.meta.url),
    "utf8",
  );
  const settings = [...workflow.matchAll(/uses: \.\/\.github\/actions\/download-migration-snapshot\n\s+with:\n\s+on-stale: (.+)\n/g)].map(
    (m) => m[1].trim(),
  );
  // Keyed on the ref, not the event: a dispatch on a PR's branch reports check
  // runs on the PR's head too, so it must wait like the pull_request run.
  assert.deepEqual(settings, [
    "use",
    "${{ github.ref != 'refs/heads/main' && 'wait' || 'use' }}",
    "${{ github.ref != 'refs/heads/main' && 'wait' || 'use' }}",
  ]);
  const calls = workflow.match(/uses: \.\/\.github\/actions\/download-migration-snapshot/g) ?? [];
  assert.equal(calls.length, settings.length, "every call site sets on-stale explicitly");
});

// ── The workflows that inject two Infisical environments ────────────────────

test("each two-environment workflow clears staging's values before the prod injection", () => {
  // Infisical/secrets-action exports only the keys an environment returns, so
  // a key missing from `prod` would otherwise keep staging's value and pass
  // the prod capture's empty-check as production's (a staging token recorded
  // as production's, or the drift check reading staging twice).
  const cases = [
    [".github/workflows/migration-snapshot.yml", ["SUPABASE_ACCESS_TOKEN"]],
    [".github/workflows/check-migration-drift.yml", ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]],
  ];
  for (const [path, names] of cases) {
    const text = readFileSync(path, "utf8");
    const staging = text.indexOf('env-slug: "staging"');
    const prod = text.indexOf('env-slug: "prod"');
    assert.ok(staging !== -1 && prod > staging, `${path}: staging is injected before prod`);
    const between = text.slice(staging, prod);
    for (const name of names) {
      assert.ok(
        between.includes(`echo "${name}_STAGING=$${name}" >> "$GITHUB_ENV"`) ||
          between.includes(`echo "STAGING_PROJECT_REF=$${name}" >> "$GITHUB_ENV"`),
        `${path}: ${name} is kept under a staging name`,
      );
      assert.ok(
        between.includes(`echo "${name}=" >> "$GITHUB_ENV"`),
        `${path}: ${name} is cleared before the prod injection`,
      );
    }
  }
});
