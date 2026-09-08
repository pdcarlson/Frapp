import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { getEnvironment } from "../lib/environments.mjs";
import {
  assertDbRestoreTarget,
  dbUrlNamesProduction,
  redactDbUrl,
} from "../lib/db-restore-target.mjs";

const production = getEnvironment("production");
const staging = getEnvironment("staging");
const PROD_REF = production.supabaseProjectRef;
const STAGING_REF = staging.supabaseProjectRef;

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const SCRIPT = join(repoRoot, "scripts", "db-restore.sh");

const prodDirect = `postgresql://postgres:secret@db.${PROD_REF}.supabase.co:5432/postgres`;
const prodPooler = `postgresql://postgres.${PROD_REF}:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
const stagingDirect = `postgresql://postgres:secret@db.${STAGING_REF}.supabase.co:5432/postgres`;
const localUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

test("redactDbUrl strips a URI password and leaves the user and host", () => {
  assert.equal(
    redactDbUrl(prodPooler),
    `postgresql://postgres.${PROD_REF}:***@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
  );
  assert.equal(
    redactDbUrl(`host=db.${STAGING_REF}.supabase.co password=untouched-looking user=postgres`),
    `host=db.${STAGING_REF}.supabase.co password=*** user=postgres`,
  );
  assert.equal(
    redactDbUrl(
      `postgresql://aws-0-us-east-1.pooler.supabase.com/postgres?password=secret&user=postgres.${PROD_REF}`,
    ),
    `postgresql://aws-0-us-east-1.pooler.supabase.com/postgres?password=***&user=postgres.${PROD_REF}`,
  );
});

test("a staging URL whose password is the production ref is not a production target", () => {
  const bait = `postgresql://postgres:${PROD_REF}@db.${STAGING_REF}.supabase.co:5432/postgres`;
  assert.equal(dbUrlNamesProduction(bait, PROD_REF), false);
  assert.equal(assertDbRestoreTarget({ dbUrl: bait }).productionTarget, false);
});

test("direct and pooler production URLs are production targets", () => {
  assert.equal(dbUrlNamesProduction(prodDirect, PROD_REF), true);
  assert.equal(dbUrlNamesProduction(prodPooler, PROD_REF), true);
  assert.equal(
    dbUrlNamesProduction(
      `host=db.${PROD_REF}.supabase.co port=5432 dbname=postgres user=postgres password=secret`,
      PROD_REF,
    ),
    true,
  );
});

test("a query-string pooler user is still a production target when password precedes user", () => {
  const query = `postgresql://aws-0-us-east-1.pooler.supabase.com:6543/postgres?password=secret&user=postgres.${PROD_REF}`;
  assert.equal(dbUrlNamesProduction(query, PROD_REF), true);
  assert.throws(
    () => assertDbRestoreTarget({ dbUrl: query }),
    /DB_RESTORE_ALLOW_PRODUCTION=true/,
  );
});

test("an uppercased production host or tunnel user is still refused", () => {
  const upperHost = `postgresql://postgres:secret@db.${PROD_REF.toUpperCase()}.supabase.co:5432/postgres`;
  const upperTunnel = `postgresql://postgres.${PROD_REF.toUpperCase()}:secret@127.0.0.1:5432/postgres`;
  assert.equal(dbUrlNamesProduction(upperHost, PROD_REF), true);
  assert.equal(dbUrlNamesProduction(upperTunnel, PROD_REF), true);
  assert.throws(
    () => assertDbRestoreTarget({ dbUrl: upperHost }),
    /refusing to restore into production/,
  );
  assert.throws(
    () => assertDbRestoreTarget({ dbUrl: upperTunnel }),
    /refusing to restore into production/,
  );
});

test("local and staging URLs are not production targets", () => {
  assert.equal(dbUrlNamesProduction(localUrl, PROD_REF), false);
  assert.equal(dbUrlNamesProduction(stagingDirect, PROD_REF), false);
  assert.equal(assertDbRestoreTarget({ dbUrl: localUrl }).productionTarget, false);
  assert.equal(assertDbRestoreTarget({ dbUrl: stagingDirect }).productionTarget, false);
});

test("a production URL is refused unless the override is set", () => {
  const prev = process.env.DB_RESTORE_ALLOW_PRODUCTION;
  try {
    delete process.env.DB_RESTORE_ALLOW_PRODUCTION;
    assert.throws(
      () => assertDbRestoreTarget({ dbUrl: prodDirect }),
      /DB_RESTORE_ALLOW_PRODUCTION=true/,
    );
    assert.throws(
      () => assertDbRestoreTarget({ dbUrl: prodPooler, allowProduction: false }),
      /--force is not enough/,
    );
    assert.deepEqual(assertDbRestoreTarget({ dbUrl: prodDirect, allowProduction: true }), {
      productionTarget: true,
      projectRef: PROD_REF,
    });
    process.env.DB_RESTORE_ALLOW_PRODUCTION = "true";
    assert.equal(assertDbRestoreTarget({ dbUrl: prodDirect }).productionTarget, true);
  } finally {
    if (prev === undefined) delete process.env.DB_RESTORE_ALLOW_PRODUCTION;
    else process.env.DB_RESTORE_ALLOW_PRODUCTION = prev;
  }
});

test("an empty dbUrl is refused rather than treated as non-production", () => {
  assert.throws(() => assertDbRestoreTarget({ dbUrl: "" }), /--db-url is required/);
  assert.throws(() => assertDbRestoreTarget({}), /--db-url is required/);
});

test("a localhost URL that still names the production user is refused", () => {
  // SSH-tunnel shape: host looks local so --force is not required, but the
  // pooler username still names production. Skipping the fence on LOCAL_TARGET
  // would restore into the tunneled production database.
  const tunneled = `postgresql://postgres.${PROD_REF}:secret@127.0.0.1:5432/postgres`;
  assert.throws(
    () => assertDbRestoreTarget({ dbUrl: tunneled }),
    /refusing to restore into production/,
  );
});

function runRestore(url, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "db-restore-"));
  const childEnv = { ...process.env, ...env };
  if (!Object.hasOwn(env, "DB_RESTORE_ALLOW_PRODUCTION")) {
    delete childEnv.DB_RESTORE_ALLOW_PRODUCTION;
  }
  try {
    return spawnSync("bash", [SCRIPT, "--backup-dir", dir, "--db-url", url, "--force"], {
      encoding: "utf8",
      env: childEnv,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("db-restore.sh refuses a production URL before it looks for psql", () => {
  const prev = process.env.DB_RESTORE_ALLOW_PRODUCTION;
  delete process.env.DB_RESTORE_ALLOW_PRODUCTION;
  try {
    const result = runRestore(prodDirect, { DB_RESTORE_ALLOW_PRODUCTION: "" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DB_RESTORE_ALLOW_PRODUCTION=true/);
    assert.doesNotMatch(result.stderr, /psql not found/);
  } finally {
    if (prev === undefined) delete process.env.DB_RESTORE_ALLOW_PRODUCTION;
    else process.env.DB_RESTORE_ALLOW_PRODUCTION = prev;
  }
});

test("db-restore.sh does not treat a staging URL as production", () => {
  const result = runRestore(stagingDirect, { DB_RESTORE_ALLOW_PRODUCTION: "" });
  assert.doesNotMatch(result.stderr, /refusing to restore into production/);
});

test("db-restore.sh refuses a tunneled production user even without --force", () => {
  // Host is 127.0.0.1 so the --force guard does not fire. The pooler username
  // still names production; the fence must catch it before psql.
  const dir = mkdtempSync(join(tmpdir(), "db-restore-"));
  const tunneled = `postgresql://postgres.${PROD_REF}:secret@127.0.0.1:5432/postgres`;
  try {
    const result = spawnSync(
      "bash",
      [SCRIPT, "--backup-dir", dir, "--db-url", tunneled],
      {
        encoding: "utf8",
        env: { ...process.env, DB_RESTORE_ALLOW_PRODUCTION: "" },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DB_RESTORE_ALLOW_PRODUCTION=true/);
    assert.doesNotMatch(result.stderr, /psql not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
