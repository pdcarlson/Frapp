import { test } from "node:test";
import assert from "node:assert/strict";

// check-env-slugs.mjs is a general-purpose gate under scripts/ (a peer of the other
// check-*.mjs gates); its test lives here so the existing `test:ci-scripts` glob
// (scripts/ci/__tests__/*.test.mjs) runs it — hence the ../../ reach up.
import {
  INFISICAL_ENV_SLUGS,
  canonicalSection,
  infisicalConfigSlugs,
  lineOf,
  unknownSlugsIn,
} from "../../check-env-slugs.mjs";

// Every case here is a way this gate could pass while asserting nothing. That matters more
// than usual: the bug it exists to catch (`--env=local`, an environment that does not
// exist) produced no warning anywhere — it just failed to resolve — so a disarmed gate
// would restore exactly the silence that let it live in `package.json` for months.

// ── the canonical list ──────────────────────────────────────────────────────
//
// Pinned deliberately. If someone "fixes" a failure by widening this list instead of
// fixing the reference, this test is what objects.

test("mirrors the three real Infisical environments", () => {
  assert.deepEqual(INFISICAL_ENV_SLUGS, ["dev", "staging", "prod"]);
});

test("does not contain the slugs that never existed", () => {
  for (const bogus of ["local", "production", "development"]) {
    assert.ok(
      !INFISICAL_ENV_SLUGS.includes(bogus),
      `"${bogus}" is a UI name or a guess, not a slug — it must never be accepted`,
    );
  }
});

// ── unknownSlugsIn ──────────────────────────────────────────────────────────

const ENV_RE = () => /infisical run --env=([A-Za-z0-9_-]+)/g;

test("flags the original package.json bug", () => {
  const found = unknownSlugsIn(
    'npx infisical run --env=local --path=/ -- npm run dev',
    ENV_RE(),
  );
  assert.deepEqual(found, [{ line: 1, found: "local" }]);
});

test("accepts every real slug", () => {
  for (const slug of INFISICAL_ENV_SLUGS) {
    assert.deepEqual(
      unknownSlugsIn(`infisical run --env=${slug} --path=/`, ENV_RE()),
      [],
      `${slug} is real and must pass`,
    );
  }
});

test("finds every occurrence, not just the first", () => {
  // The real regression put the same wrong slug on five consecutive lines. A gate that
  // reports one and stops sends someone to fix a fifth of the problem.
  const text = ["a", "b", "c"]
    .map(() => "infisical run --env=local --path=/")
    .join("\n");
  assert.equal(unknownSlugsIn(text, ENV_RE()).length, 3);
});

test("reports the line number the reader has to open", () => {
  const text = `line one\nline two\ninfisical run --env=nope --path=/`;
  assert.deepEqual(unknownSlugsIn(text, ENV_RE()), [{ line: 3, found: "nope" }]);
});

test("matches the workflow env-slug form in both quote styles", () => {
  const re = /env-slug:\s*["']([A-Za-z0-9_-]+)["']/g;
  assert.deepEqual(unknownSlugsIn(`env-slug: "production"`, re), [
    { line: 1, found: "production" },
  ]);
  assert.deepEqual(unknownSlugsIn(`env-slug: 'prod'`, re), []);
});

test("an empty or slug-free document is not a violation", () => {
  assert.deepEqual(unknownSlugsIn("", ENV_RE()), []);
  assert.deepEqual(unknownSlugsIn("no slugs here at all", ENV_RE()), []);
});

// ── infisicalConfigSlugs ────────────────────────────────────────────────────

test("collects defaultEnvironment and every branch mapping", () => {
  assert.deepEqual(
    infisicalConfigSlugs({
      defaultEnvironment: "dev",
      gitBranchToEnvironmentMapping: { main: "staging", production: "prod" },
    }),
    [
      ["defaultEnvironment", "dev"],
      ["gitBranchToEnvironmentMapping.main", "staging"],
      ["gitBranchToEnvironmentMapping.production", "prod"],
    ],
  );
});

test("surfaces the real .infisical.json bug — branch `production` mapped to slug `production`", () => {
  const claims = infisicalConfigSlugs({
    defaultEnvironment: "local",
    gitBranchToEnvironmentMapping: { main: "staging", production: "production" },
  });
  const bad = claims.filter(([, slug]) => !INFISICAL_ENV_SLUGS.includes(slug));
  assert.deepEqual(bad, [
    ["defaultEnvironment", "local"],
    ["gitBranchToEnvironmentMapping.production", "production"],
  ]);
});

test("tolerates a config missing either key", () => {
  assert.deepEqual(infisicalConfigSlugs({}), []);
  assert.deepEqual(infisicalConfigSlugs(null), []);
  assert.deepEqual(infisicalConfigSlugs({ defaultEnvironment: "dev" }), [
    ["defaultEnvironment", "dev"],
  ]);
});

// ── canonicalSection ────────────────────────────────────────────────────────

test("extracts the environment table and stops at the section rule", () => {
  const doc = [
    "# Env reference",
    "## Infisical Environments",
    "| Development | `dev` |",
    "",
    "---",
    "",
    "## Something Else",
    "| bogus | `local` |",
  ].join("\n");
  const section = canonicalSection(doc);
  assert.match(section, /`dev`/);
  // Must not bleed into later sections, or an unrelated mention would satisfy the check.
  assert.doesNotMatch(section, /`local`/);
});

test("returns null when the section is absent rather than throwing", () => {
  assert.equal(canonicalSection("# no such heading"), null);
  assert.equal(canonicalSection(null), null);
});

// ── lineOf ──────────────────────────────────────────────────────────────────

test("is 1-indexed so output matches an editor", () => {
  assert.equal(lineOf("abc", 0), 1);
  assert.equal(lineOf("a\nb\nc", 4), 3);
});
