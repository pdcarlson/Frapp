import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ENVIRONMENTS,
  getEnvironment,
  loadEnvironments,
  parseEnvironments,
} from "../lib/environments.mjs";

const VALID = JSON.stringify({
  environments: {
    staging: { supabaseProjectRef: "aaaaaaaaaaaaaaa", supabaseProjectName: "s" },
    production: { supabaseProjectRef: "bbbbbbbbbbbbbbb", supabaseProjectName: "p" },
  },
});

test("the committed config resolves both environments", () => {
  const all = loadEnvironments();
  assert.deepEqual(Object.keys(all).sort(), [...ENVIRONMENTS].sort());
  for (const name of ENVIRONMENTS) {
    assert.match(all[name].supabaseProjectRef, /^[a-z0-9]{15,20}$/);
  }
  // The distinction the whole fence rests on. If these were ever equal, every
  // assertion in run-migration.mjs would pass while proving nothing.
  assert.notEqual(
    all.staging.supabaseProjectRef,
    all.production.supabaseProjectRef,
  );
});

test("the committed config names production's Infisical slug as `prod`", () => {
  // The name/slug trap check-env-slugs.mjs exists for: Infisical's display name
  // is "Production" and its slug is `prod`. A config that said `production`
  // here would be a fourth copy of the wrong answer.
  assert.equal(loadEnvironments().production.infisicalEnvSlug, "prod");
  assert.equal(loadEnvironments().staging.infisicalEnvSlug, "staging");
});

test("a malformed ref is rejected rather than passed through", () => {
  const bad = JSON.stringify({
    environments: {
      staging: { supabaseProjectRef: "TOO-SHORT" },
      production: { supabaseProjectRef: "bbbbbbbbbbbbbbb" },
    },
  });
  assert.throws(() => parseEnvironments(bad), /supabaseProjectRef must be/);
});

test("a missing environment is fatal, not a silent undefined", () => {
  const partial = JSON.stringify({
    environments: { staging: { supabaseProjectRef: "aaaaaaaaaaaaaaa" } },
  });
  assert.throws(() => parseEnvironments(partial), /does not define the "production"/);
});

test("two environments sharing one ref is fatal", () => {
  // A config where staging and production point at the same project would make
  // the environment fence in run-migration.mjs pass unconditionally — a gate
  // that reads green having asserted nothing.
  const collided = JSON.stringify({
    environments: {
      staging: { supabaseProjectRef: "aaaaaaaaaaaaaaa" },
      production: { supabaseProjectRef: "aaaaaaaaaaaaaaa" },
    },
  });
  assert.throws(() => parseEnvironments(collided), /share a supabaseProjectRef/);
});

test("invalid JSON names the file rather than throwing a bare SyntaxError", () => {
  assert.throws(() => parseEnvironments("{not json", { source: "ci/x.json" }), /ci\/x\.json is not valid JSON/);
});

test("parseEnvironments accepts a well-formed config", () => {
  const parsed = parseEnvironments(VALID);
  assert.equal(parsed.production.supabaseProjectRef, "bbbbbbbbbbbbbbb");
  assert.equal(parsed.production.name, "production");
  assert.equal(parsed.staging.infisicalEnvSlug, null);
  // Defaults OFF: an empty migration history is unreadable unless a project
  // explicitly says otherwise.
  assert.equal(parsed.staging.allowEmptyMigrationHistory, false);
});

test("allowEmptyMigrationHistory is opt-in and must be exactly true", () => {
  const cfg = (value) =>
    JSON.stringify({
      environments: {
        staging: { supabaseProjectRef: "aaaaaaaaaaaaaaa", allowEmptyMigrationHistory: value },
        production: { supabaseProjectRef: "bbbbbbbbbbbbbbb" },
      },
    });
  assert.equal(parseEnvironments(cfg(true)).staging.allowEmptyMigrationHistory, true);
  // Truthy-but-not-true must NOT enable it: this flag disarms a false-green
  // guard, so a stray "false" string or a 1 has to read as off.
  for (const sloppy of ["true", 1, "yes"]) {
    assert.equal(parseEnvironments(cfg(sloppy)).staging.allowEmptyMigrationHistory, false);
  }
  assert.equal(loadEnvironments().production.allowEmptyMigrationHistory, false);
});

test("an unknown environment name throws instead of returning undefined", () => {
  // `prod` is the Infisical SLUG, not an environment name here. Returning
  // undefined for it would let a caller read `.supabaseProjectRef` off nothing.
  assert.throws(() => getEnvironment("prod"), /Unknown environment "prod"/);
});

test("an injected reader is honoured even after the real config is cached", () => {
  // Warm the cache the way every real caller does.
  loadEnvironments();

  // Keying the cache on `path` alone silently ignored this reader and handed
  // back the committed refs. A test pointing the loader at a fixture to
  // exercise run-migration.mjs's mismatch fence would then have compared
  // against production's REAL ref and passed for the wrong reason.
  const injected = loadEnvironments({
    readFile: () =>
      JSON.stringify({
        environments: {
          staging: { supabaseProjectRef: "fixturestagingaa" },
          production: { supabaseProjectRef: "fixtureproductio" },
        },
      }),
  });
  assert.equal(injected.staging.supabaseProjectRef, "fixturestagingaa");
  assert.equal(injected.production.supabaseProjectRef, "fixtureproductio");

  // And the injected read must not poison the cache for real callers.
  assert.equal(loadEnvironments().staging.supabaseProjectRef, "hnoyzpidbmizhbqaiity");
});
