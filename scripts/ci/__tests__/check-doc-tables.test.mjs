import { test } from "node:test";
import assert from "node:assert/strict";

// check-doc-tables.mjs is a general-purpose script under scripts/ (a peer of the
// other check-*.mjs gates); its test lives here so the existing `test:ci-scripts`
// glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the ../../ reach up.
import {
  compareSuites,
  parseCheckArray,
  parseDocSuites,
  parseJobSuites,
} from "../../check-doc-tables.mjs";

// ── parseCheckArray: the required-check source of truth ─────────────────────

const ARRAY_SRC = `
const CI_CHECKS = [
  "packages-build",
  // A comment naming a check that is deliberately absent: "duplicate-detection".
  "lint-and-typecheck",
];

const DOCS_CHECKS = [
  "docs-spec-sync",
  // "doc-paths",
];
`;

test("parses the active entries of an array", () => {
  assert.deepEqual(parseCheckArray(ARRAY_SRC, "CI_CHECKS"), [
    "packages-build",
    "lint-and-typecheck",
  ]);
});

test("a commented-out entry is not required", () => {
  // This is the doc-paths rollout shape: listed but disabled. Counting it would
  // demand docs assert a check that branch protection does not apply.
  assert.deepEqual(parseCheckArray(ARRAY_SRC, "DOCS_CHECKS"), ["docs-spec-sync"]);
});

test("a check named only inside prose in a comment is not picked up", () => {
  assert.equal(parseCheckArray(ARRAY_SRC, "CI_CHECKS").includes("duplicate-detection"), false);
});

test("an absent array is reported rather than treated as empty", () => {
  // Empty would silently pass the whole gate; null makes main() exit 2.
  assert.equal(parseCheckArray(ARRAY_SRC, "NOPE_CHECKS"), null);
});

// ── parseJobSuites: what a ci.yml job actually tests ────────────────────────

const CI_YML = `
jobs:
  lint-and-typecheck:
    steps:
      - name: Lint
        run: npm run lint
      - name: Shared validation package tests
        run: npm run test -w @repo/validation
      - name: Theme package tests
        run: npm run test -w @repo/theme
  web-tests:
    steps:
      - name: Run web unit tests
        run: npm run test -w apps/web
      - name: Run chat-integrations package tests
        run: npm run test -w packages/chat-integrations
  api-tests:
    steps:
      - name: API tests
        run: npm run test -w apps/api
`;

test("collects the workspaces a job tests, and stops at the next job", () => {
  assert.deepEqual(parseJobSuites(CI_YML, "lint-and-typecheck"), [
    "@repo/validation",
    "@repo/theme",
  ]);
  assert.deepEqual(parseJobSuites(CI_YML, "web-tests"), [
    "apps/web",
    "packages/chat-integrations",
  ]);
});

test("a non-test `npm run` step is not mistaken for a suite", () => {
  assert.equal(parseJobSuites(CI_YML, "lint-and-typecheck").includes("lint"), false);
});

test("an unknown job is reported rather than treated as having no suites", () => {
  assert.equal(parseJobSuites(CI_YML, "nope"), null);
});

// ── parseDocSuites: what a doc claims the job tests ─────────────────────────

const DOC = `
| Check | What it validates |
| ----- | ----------------- |
| \`lint-and-typecheck\` | ESLint + TypeScript, landing plus \`@repo/validation\` and \`@repo/theme\` unit tests |
| \`web-tests\` | \`apps/web\` unit tests plus \`packages/hooks\`, \`packages/chat-integrations\` |
`;

test("reads the workspaces a doc row names", () => {
  assert.deepEqual(parseDocSuites(DOC, "lint-and-typecheck"), [
    "@repo/validation",
    "@repo/theme",
  ]);
});

test("a missing row is reported rather than read as an empty list", () => {
  // Empty would report every suite as "missing"; null lets the caller say "no row".
  assert.equal(parseDocSuites(DOC, "api-tests"), null);
});

// ── compareSuites: the drift verdict ────────────────────────────────────────

const docs = (listed) => [{ file: "CONTRIBUTING.md", listed }];

test("agreement produces no findings", () => {
  const findings = compareSuites({
    jobId: "lint-and-typecheck",
    actual: ["@repo/validation", "@repo/theme"],
    docs: docs(["@repo/validation", "@repo/theme"]),
  });
  assert.deepEqual(findings, []);
});

test("a suite the job runs but the doc omits is a finding", () => {
  // The #1153 shape: @repo/theme gained a gate and no table learned about it.
  const findings = compareSuites({
    jobId: "lint-and-typecheck",
    actual: ["@repo/validation", "@repo/theme"],
    docs: docs(["@repo/validation"]),
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "missing");
  assert.match(findings[0].detail, /@repo\/theme/);
});

test("a suite the doc names but the job no longer runs is a finding", () => {
  const findings = compareSuites({
    jobId: "web-tests",
    actual: ["packages/hooks"],
    docs: docs(["packages/hooks", "packages/ui"]),
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "stale");
  assert.match(findings[0].detail, /packages\/ui/);
});

test("ordering is not drift", () => {
  // Docs list these for readability, not to mirror ci.yml's step order.
  const findings = compareSuites({
    jobId: "lint-and-typecheck",
    actual: ["@repo/validation", "@repo/theme"],
    docs: docs(["@repo/theme", "@repo/validation"]),
  });
  assert.deepEqual(findings, []);
});

test("an app workspace is not demanded of the docs", () => {
  // ci.yml runs `-w apps/web` / `-w apps/landing`, which the docs render as prose
  // ("landing plus …"). Only @repo/* and packages/* are compared.
  const findings = compareSuites({
    jobId: "web-tests",
    actual: ["apps/web", "packages/hooks"],
    docs: docs(["packages/hooks"]),
  });
  assert.deepEqual(findings, []);
});

test("a missing row is a finding, not a crash", () => {
  const findings = compareSuites({
    jobId: "web-tests",
    actual: ["packages/hooks"],
    docs: docs(null),
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "no-row");
});
