import { test } from "node:test";
import assert from "node:assert/strict";

// check-doc-tables.mjs is a general-purpose script under scripts/ (a peer of the
// other check-*.mjs gates); its test lives here so the existing `test:ci-scripts`
// glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the ../../ reach up.
import {
  compareRoster,
  compareSuites,
  hasRow,
  parseCheckArray,
  parseDocSuites,
  parseJobSuites,
  tableBlocks,
} from "../../check-doc-tables.mjs";

// ── parseCheckArray ─────────────────────────────────────────────────────────
//
// Every case here is a way the gate could pass while asserting nothing, which is
// worse than failing: a disarmed required-check gate looks identical to a healthy one.

test("parses the active entries of an array", () => {
  const src = `const CI_CHECKS = [\n  "packages-build",\n  "lint-and-typecheck",\n];`;
  assert.deepEqual(parseCheckArray(src, "CI_CHECKS"), ["packages-build", "lint-and-typecheck"]);
});

test("a trailing entry without a comma is still parsed", () => {
  // Valid JS, and scripts/ is neither a workspace nor prettier-formatted, so nothing
  // normalises it. Requiring the comma silently drops the last entry.
  const src = `const CI_CHECKS = [\n  "packages-build",\n  "dependency-cruiser"\n];`;
  assert.deepEqual(parseCheckArray(src, "CI_CHECKS"), ["packages-build", "dependency-cruiser"]);
});

test("a check name that is not lowercase-hyphen is still parsed", () => {
  // GitHub check-run names are free-form. `Links` is already a real gate here, and
  // `codecov/patch` is the shape a coverage service would add.
  const src = `const CI_CHECKS = [\n  "Links",\n  "codecov/patch",\n  "build (20.x)",\n];`;
  assert.deepEqual(parseCheckArray(src, "CI_CHECKS"), ["Links", "codecov/patch", "build (20.x)"]);
});

test("a commented-out entry is not required", () => {
  // The doc-paths rollout shape: listed but disabled. Counting it would demand docs
  // assert a check branch protection does not apply.
  const src = `const DOCS_CHECKS = [\n  "docs-spec-sync",\n  // "doc-paths",\n];`;
  assert.deepEqual(parseCheckArray(src, "DOCS_CHECKS"), ["docs-spec-sync"]);
});

test("an array present but unparseable yields empty, not a silent subset", () => {
  // main() treats a zero-length result as a hard error (exit 2). An empty array is
  // truthy, so a bare null-check would let this pass with everything unasserted.
  const src = `const CI_CHECKS = [\n  'packages-build',\n];`;
  assert.deepEqual(parseCheckArray(src, "CI_CHECKS"), []);
});

test("an absent array is reported rather than treated as empty", () => {
  assert.equal(parseCheckArray(`const CI_CHECKS = [\n  "a",\n];`, "NOPE"), null);
});

// ── parseJobSuites ──────────────────────────────────────────────────────────

const CI_YML = `
jobs:
  lint-and-typecheck:
    steps:
      - name: Lint
        run: npm run lint
      # Removed in #1200: npm run test -w @repo/ghost lived here
      - name: API production build
        run: npm run build -w apps/api
      - name: Shared validation package tests
        run: npm run test -w @repo/validation
      - name: AI eval suite
        run: npm run test:ai-evals -w @repo/evals
      - name: Workspace-flag spelling
        run: npm run test --workspace=@repo/theme
  web-tests:
    steps:
      - name: Run web unit tests
        run: npm run test -w apps/web
`;

test("collects the workspaces a job tests, and stops at the next job", () => {
  assert.deepEqual(parseJobSuites(CI_YML, "web-tests"), ["apps/web"]);
});

test("a comment naming a removed suite is not read as a live one", () => {
  // Both SUITE_JOBS are comment-dense. Reading comments fails every doc for the crime
  // of describing reality.
  assert.equal(parseJobSuites(CI_YML, "lint-and-typecheck").includes("@repo/ghost"), false);
});

test("a non-test npm run with a workspace flag is not a suite", () => {
  // `npm run build -w apps/api` is real, and lives inside lint-and-typecheck. This is
  // the case that discriminates — a bare `npm run lint` has no -w to confuse anything.
  assert.equal(parseJobSuites(CI_YML, "lint-and-typecheck").includes("apps/api"), false);
});

test("hyphenated test scripts and --workspace= are both recognised", () => {
  const suites = parseJobSuites(CI_YML, "lint-and-typecheck");
  assert.ok(suites.includes("@repo/evals"), "test:ai-evals form");
  assert.ok(suites.includes("@repo/theme"), "--workspace= form");
});

test("a job key with trailing whitespace still resolves", () => {
  // A CRLF checkout would otherwise exit 2 with 'job not found'.
  assert.deepEqual(parseJobSuites(CI_YML.replace("  web-tests:", "  web-tests: "), "web-tests"), [
    "apps/web",
  ]);
});

test("an unknown job is reported rather than treated as having no suites", () => {
  assert.equal(parseJobSuites(CI_YML, "nope"), null);
});

// ── parseDocSuites ──────────────────────────────────────────────────────────

const DOC = `
| Check | What it validates |
| ----- | ----------------- |
| \`lint-and-typecheck\` | landing plus \`@repo/validation\` and \`@repo/theme\` unit tests |
| \`web-tests\` | \`apps/web\` unit tests plus \`packages/hooks\` |

Production table:

| Check | What it validates |
| ----- | ----------------- |
| \`web-tests\` | also \`packages/chat-core\` |
`;

test("reads the workspaces a doc row names", () => {
  assert.deepEqual(parseDocSuites(DOC, "lint-and-typecheck"), ["@repo/validation", "@repo/theme"]);
});

test("rows for the same job in two tables are unioned", () => {
  // Reading only the first would leave a second table permanently unchecked.
  const listed = parseDocSuites(DOC, "web-tests");
  assert.ok(listed.includes("packages/hooks"));
  assert.ok(listed.includes("packages/chat-core"));
});

test("a missing row is reported rather than read as an empty list", () => {
  // Empty would report every suite as missing; null lets the caller say "no row".
  assert.equal(parseDocSuites(DOC, "api-tests"), null);
});

// ── compareSuites ───────────────────────────────────────────────────────────

const docs = (listed) => [{ file: "CONTRIBUTING.md", listed }];

test("agreement produces no findings", () => {
  assert.deepEqual(
    compareSuites({
      jobId: "lint-and-typecheck",
      actual: ["@repo/validation", "@repo/theme"],
      docs: docs(["@repo/validation", "@repo/theme"]),
    }),
    [],
  );
});

test("a suite the job runs but the doc omits is a finding", () => {
  // The #1153 shape: @repo/theme gained a gate and no table learned about it.
  const f = compareSuites({
    jobId: "lint-and-typecheck",
    actual: ["@repo/validation", "@repo/theme"],
    docs: docs(["@repo/validation"]),
  });
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /does not list @repo\/theme/);
});

test("a suite the doc names but the job no longer runs is a finding", () => {
  const f = compareSuites({
    jobId: "web-tests",
    actual: ["packages/hooks"],
    docs: docs(["packages/hooks", "packages/ui"]),
  });
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /packages\/ui/);
});

test("ordering is not drift", () => {
  assert.deepEqual(
    compareSuites({
      jobId: "lint-and-typecheck",
      actual: ["@repo/a", "@repo/b"],
      docs: docs(["@repo/b", "@repo/a"]),
    }),
    [],
  );
});

test("an app workspace is demanded of neither side", () => {
  // ci.yml runs `-w apps/web`; the docs render it as prose. Asserted in both
  // directions so removing either filter fails a test.
  assert.deepEqual(
    compareSuites({ jobId: "web-tests", actual: ["apps/web", "packages/hooks"], docs: docs(["packages/hooks"]) }),
    [],
    "an app in ci.yml is not demanded of the doc",
  );
  assert.deepEqual(
    compareSuites({ jobId: "web-tests", actual: ["packages/hooks"], docs: docs(["apps/web", "packages/hooks"]) }),
    [],
    "an app named by the doc is not reported as stale",
  );
});

test("a missing row is a finding, not a crash", () => {
  const f = compareSuites({ jobId: "web-tests", actual: ["packages/hooks"], docs: docs(null) });
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /no table row/);
});

// ── hasRow / tableBlocks / compareRoster ────────────────────────────────────

test("hasRow needs a row, not a mention", () => {
  // The whole point: `text.includes` would match a name cited in a neighbouring row's
  // prose, so a deleted row would go unnoticed.
  const doc = "| `changes` | gates `web-responsive-floor` and `web-tests` |";
  assert.equal(hasRow(doc, "changes"), true);
  assert.equal(hasRow(doc, "web-responsive-floor"), false);
});

test("tableBlocks splits on non-table lines", () => {
  assert.equal(tableBlocks("| a |\n| b |\n\ntext\n\n| c |").length, 2);
});

const known = new Set(["packages-build", "duplicate-detection"]);

test("a required check with no row is a finding", () => {
  const f = compareRoster({
    file: "CONTRIBUTING.md",
    text: "| `duplicate-detection` | advisory |",
    required: ["packages-build"],
    known,
  });
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /has no row/);
});

test("a row naming something that is not a check is a finding", () => {
  const f = compareRoster({
    file: "CONTRIBUTING.md",
    text: "| `packages-build` | ok |\n| `ghost-check` | ??? |",
    required: ["packages-build"],
    known,
  });
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /not a job or a required check/);
});

test("a table that is not about checks is left alone", () => {
  // Commit-type and branch tables have identical first cells. Flagging them was a
  // false positive on the real docs.
  const text = "| `packages-build` | ok |\n\n| `feat` | a feature |\n| `chore` | chores |";
  const f = compareRoster({ file: "CONTRIBUTING.md", text, required: ["packages-build"], known });
  assert.deepEqual(f, []);
});
