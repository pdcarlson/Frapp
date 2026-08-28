import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadEnvFiles, parseEnvFile } from "../../lib/env-file.mjs";

// Coverage for the `.env` reader behind `scripts/configure-branch-protection.mjs`.
//
// The bug it fixes: the script read `process.env.GITHUB_PAT` directly and nothing
// in its import graph loaded a `.env`, so a token sitting in the file failed with
// "Missing GitHub token" and only worked after an `export` in the shell.
//
// The precedence assertions below are the load-bearing half. Both rules are
// inherited — from `ConfigModule.forRoot({ envFilePath: ['.env.local', '.env'] })`
// in `apps/api/src/app.module.ts` and from `loadLocalEnv()` in
// `apps/api/test/integration/stack.ts` — and getting either backwards would let a
// stale checked-in-adjacent file shadow the real credential a hosted VM injects.

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "frapp-env-file-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("parses the shapes a hand-written .env actually contains", () => {
  const parsed = parseEnvFile(
    [
      "# a comment",
      "",
      "GITHUB_PAT=github_pat_plain",
      "  SPACED  =  padded  ",
      'QUOTED="double quoted"',
      "SINGLE='single quoted'",
      "INLINE=value # trailing comment",
      "EMPTY=",
      "URL=https://example.com/path?a=b",
    ].join("\n"),
  );

  assert.equal(parsed.GITHUB_PAT, "github_pat_plain");
  assert.equal(parsed.SPACED, "padded");
  assert.equal(parsed.QUOTED, "double quoted");
  assert.equal(parsed.SINGLE, "single quoted");
  assert.equal(parsed.INLINE, "value");
  assert.equal(parsed.EMPTY, "");
  // Splitting on the FIRST `=` — a URL with a query string is the common way a
  // split-on-every-`=` reader corrupts a value.
  assert.equal(parsed.URL, "https://example.com/path?a=b");
});

test("accepts a leading `export`, as pasted from the runbook", () => {
  // GITHUB_BRANCH_PROTECTION_RUNBOOK.md spells the token out as
  // `export GITHUB_PAT=<token>`, so a `.env` built by pasting from it has one.
  const parsed = parseEnvFile("export GITHUB_PAT=from_export\n");
  assert.equal(parsed.GITHUB_PAT, "from_export");
});

test("keeps a `#` that is part of a quoted value", () => {
  const parsed = parseEnvFile('COLOR="#ff8800"\n');
  assert.equal(parsed.COLOR, "#ff8800");
});

test("skips malformed lines instead of throwing", () => {
  const parsed = parseEnvFile(
    ["not an assignment", "=novalue", "9BAD=x", "has space=x", "GOOD=y"].join(
      "\n",
    ),
  );
  assert.deepEqual(parsed, { GOOD: "y" });
});

test("an already-set variable wins over the file", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, ".env"), "GITHUB_PAT=from_file\n");
    const env = { GITHUB_PAT: "from_environment" };

    loadEnvFiles({ dir, env });

    // The rule that keeps a stale local `.env` from shadowing the credential a
    // hosted agent VM injects directly.
    assert.equal(env.GITHUB_PAT, "from_environment");
  });
});

test(".env.local wins over .env, matching NestJS envFilePath order", () => {
  withTempDir((dir) => {
    writeFileSync(
      join(dir, ".env.local"),
      "GITHUB_PAT=local\nONLY_IN_ENV_LOCAL=a\n",
    );
    writeFileSync(join(dir, ".env"), "GITHUB_PAT=base\nONLY_IN_ENV=b\n");
    const env = {};

    const loaded = loadEnvFiles({ dir, env });

    assert.deepEqual(loaded, [".env.local", ".env"]);
    assert.equal(env.GITHUB_PAT, "local");
    // Later files still contribute keys the earlier one did not set.
    assert.equal(env.ONLY_IN_ENV_LOCAL, "a");
    assert.equal(env.ONLY_IN_ENV, "b");
  });
});

test("missing files are a normal state, not an error", () => {
  withTempDir((dir) => {
    const env = {};
    assert.deepEqual(loadEnvFiles({ dir, env }), []);
    assert.deepEqual(env, {});
  });
});
