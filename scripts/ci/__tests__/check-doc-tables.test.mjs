import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// check-doc-tables.mjs is a general-purpose script under scripts/ (a peer of the
// other check-*.mjs gates); its test lives here so the existing `test:ci-scripts`
// glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the ../../ reach up.
import {
  INDEX_DOCS,
  childrenOf,
  compareIndexDocs,
  comparePlacementMap,
  compareRoster,
  compareSuites,
  hasRow,
  normalizeHome,
  parseCheckArray,
  parseDocSuites,
  parseIndexHomes,
  parseJobSuites,
  parsePlacementHomes,
  resolveIndexHome,
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

// ── The placement map ───────────────────────────────────────────────────────
//
// Same failure shape as the roster tables: prose restating a machine source by
// hand. `docs/hooks/` and `docs/performance/` existed on disk for months with no
// row, because nothing compared the two.

const DIRS = [
  { dir: "docs/guides", purpose: "guides", index: true },
  { dir: "spec/ui", purpose: "ui", index: true },
  { dir: "spec/ui/mobile", purpose: "mobile ui", index: true },
];

test("normalizeHome reduces a home cell to the directory it claims", () => {
  assert.equal(normalizeHome("spec/behavior/<topic>.md"), "spec/behavior");
  assert.equal(normalizeHome("spec/architecture/README.md"), "spec/architecture");
  assert.equal(normalizeHome("docs/internal/ops/"), "docs/internal/ops");
  assert.equal(normalizeHome("spec/product/"), "spec/product");
  assert.equal(normalizeHome("docs/hooks"), "docs/hooks");
});

test("normalizeHome ignores homes that are not docs/spec directories", () => {
  // The map legitimately names non-directory homes — today just the GitHub
  // Issues row. The rest are synthetic: normalizeHome must reject anything
  // that is not a docs/ or spec/ directory, whether or not the map uses it.
  for (const t of ["GitHub Issues", "ci-cd/DOCS_CI.md"]) {
    assert.equal(normalizeHome(t), null, t);
  }
  // A tree root is not a directory entry — root files are governed separately.
  assert.equal(normalizeHome("spec/engineering.md"), null);
  assert.equal(normalizeHome("docs/README.md"), null);
});

test("parsePlacementHomes reads only table rows", () => {
  const text = [
    "Prose mentioning `spec/nowhere/thing.md` outside a table.",
    "",
    "| Kind | Home |",
    "| --- | --- |",
    "| UI | `spec/ui/` |",
    "| Guides | `docs/guides/` |",
  ].join("\n");
  const homes = parsePlacementHomes(text);
  assert.equal(homes.has("spec/ui"), true);
  assert.equal(homes.has("docs/guides"), true);
  assert.equal(homes.has("spec/nowhere"), false);
});

test("a declared directory no row reaches is drift", () => {
  const text = "| Kind | Home |\n| --- | --- |\n| Guides | `docs/guides/` |";
  const f = comparePlacementMap({ text, directories: DIRS });
  const ids = f.map((x) => x.id);
  assert.deepEqual(ids.sort(), ["spec/ui", "spec/ui/mobile"]);
});

test("a parent row does NOT cover its children — this disarmed the check", () => {
  // The original design let `spec/ui/` speak for `spec/ui/mobile`, so five
  // declared directories had no row and the gate stayed green; adding a
  // `docs/internal/` row likewise made all seven `docs/internal/*` rows
  // non-load-bearing. Deleting a row has to fail, or the map is not checked.
  const text = "| Kind | Home |\n| --- | --- |\n| Guides | `docs/guides/` |\n| UI | `spec/ui/` |";
  const f = comparePlacementMap({ text, directories: DIRS });
  assert.deepEqual(
    f.map((x) => x.id),
    ["spec/ui/mobile"],
  );
});

test("every declared directory with its own row passes", () => {
  const text = [
    "| Kind | Home |",
    "| --- | --- |",
    "| Guides | `docs/guides/` |",
    "| UI | `spec/ui/` |",
    "| Mobile UI | `spec/ui/mobile/` |",
  ].join("\n");
  assert.deepEqual(comparePlacementMap({ text, directories: DIRS }), []);
});

test("a row naming an undeclared home is drift in the other direction", () => {
  const text = [
    "| Kind | Home |",
    "| --- | --- |",
    "| Guides | `docs/guides/` |",
    "| UI | `spec/ui/` |",
    "| Mobile UI | `spec/ui/mobile/` |",
    "| Gone | `docs/retired/` |",
  ].join("\n");
  const f = comparePlacementMap({ text, directories: DIRS });
  assert.equal(f.length, 1);
  assert.equal(f[0].id, "docs/retired");
  assert.match(f[0].detail, /not declared in DIRECTORIES/);
});

test("a sibling prefix does not count as coverage", () => {
  // `spec/ui-legacy` must not be covered by a `spec/ui` row.
  const text = "| Kind | Home |\n| --- | --- |\n| UI | `spec/ui/` |";
  const f = comparePlacementMap({
    text,
    directories: [
      { dir: "spec/ui", purpose: "x", index: false },
      { dir: "spec/ui-legacy", purpose: "x", index: false },
    ],
  });
  assert.equal(f.length, 1);
  assert.equal(f[0].id, "spec/ui-legacy");
});

// ── The index READMEs ───────────────────────────────────────────────────────
//
// A third and fourth restatement of the same fact, and until #1619 neither was
// checked. They differ from the placement map in one way that drives the whole
// design: their paths are written RELATIVE to the doc, so normalizeHome rejects
// every one of them. A check built on normalizeHome would read all three files
// and assert nothing while reporting green.

const INDEX_DIRS = [
  { dir: "docs/guides", purpose: "guides", index: true },
  { dir: "docs/internal", purpose: "internal", index: true },
  { dir: "docs/internal/ops", purpose: "ops", index: false },
  { dir: "docs/internal/ci-cd", purpose: "ci", index: false },
  { dir: "spec/ui", purpose: "ui", index: true },
];

const internalIndex = (text) =>
  compareIndexDocs({
    file: "docs/internal/README.md",
    text,
    scopes: ["docs/internal"],
    directories: INDEX_DIRS,
  });

test("resolveIndexHome resolves relative targets against the doc's own directory", () => {
  assert.equal(resolveIndexHome("ops/", "docs/internal"), "docs/internal/ops");
  assert.equal(resolveIndexHome("internal/ops/DEPLOYMENT.md", "docs"), "docs/internal/ops");
  assert.equal(resolveIndexHome("guides/README.md", "docs"), "docs/guides");
  assert.equal(resolveIndexHome("../spec/ui/", "docs"), "spec/ui");
  // Rooted spellings — at a tree, or at the repo root with a leading slash.
  assert.equal(resolveIndexHome("docs/internal/ops/", "docs"), "docs/internal/ops");
  assert.equal(resolveIndexHome("/docs/internal/ops/DEPLOYMENT.md", "docs"), "docs/internal/ops");
});

test("resolveIndexHome strips fragments, queries and angle-bracket destinations", () => {
  // A fragment kept its own segment, so the gate emitted a phantom directory
  // AND a spurious "missing row" for the real one — two wrong findings, not none.
  assert.equal(resolveIndexHome("ops/#runbooks", "docs/internal"), "docs/internal/ops");
  assert.equal(resolveIndexHome("ops/?v=2", "docs/internal"), "docs/internal/ops");
  assert.equal(resolveIndexHome("<ops/>", "docs/internal"), "docs/internal/ops");
});

test("resolveIndexHome resolves what normalizeHome must reject", () => {
  // The exact tokens the index READMEs carry. normalizeHome returns null for
  // every one — correct for the placement map, where homes are repo-root
  // relative — so reusing it here would have produced a gate that passes
  // because it parsed nothing. Both halves are asserted by value, not by
  // notEqual(null), so a regression to an unresolved or un-popped path fails.
  const tokens = [
    ["ops/", "docs/internal", "docs/internal/ops"],
    ["internal/ci-cd/DOCS_CI.md", "docs", "docs/internal/ci-cd"],
    ["guides/README.md", "docs", "docs/guides"],
  ];
  for (const [token, fromDir, expected] of tokens) {
    assert.equal(normalizeHome(token), null, `normalizeHome(${token})`);
    assert.equal(resolveIndexHome(token, fromDir), expected, `resolveIndexHome(${token})`);
  }
});

test("resolveIndexHome ignores anything that is not a docs/spec directory", () => {
  // `packages/hooks` is real prose in docs/README.md's Hooks row.
  assert.equal(resolveIndexHome("../packages/hooks", "docs"), null);
  assert.equal(resolveIndexHome("../AGENTS.md", "docs"), null);
  assert.equal(resolveIndexHome("https://example.com", "docs"), null);
  assert.equal(resolveIndexHome("#anchor", "docs"), null);
  // A tree root is not a directory entry.
  assert.equal(resolveIndexHome("../spec/README.md", "docs"), null);
});

test("a link that climbs out of the repo and back in does not resolve", () => {
  // The case that matters: a token that escapes the repo root and re-enters a
  // tree by name. If it resolved, a broken link would count as a satisfied row
  // and green the missing-row half of the check. `path.posix.normalize` keeps
  // the leading `..`, so the `docs/`/`spec/` prefix rule rejects it — this
  // pins that behaviour, not a particular implementation of it.
  assert.equal(resolveIndexHome("../../../docs/guides", "docs"), null);
  assert.equal(resolveIndexHome("../../spec/ui", "docs"), null);
  assert.equal(resolveIndexHome("../../../etc", "docs"), null);
});

test("childrenOf returns immediate children only, and no sibling prefixes", () => {
  assert.deepEqual(childrenOf("docs", INDEX_DIRS), ["docs/guides", "docs/internal"]);
  assert.deepEqual(childrenOf("docs/internal", INDEX_DIRS), [
    "docs/internal/ops",
    "docs/internal/ci-cd",
  ]);
  // `docs/internal` is not its own child.
  assert.equal(childrenOf("docs/internal", INDEX_DIRS).includes("docs/internal"), false);
  assert.deepEqual(
    childrenOf("spec/ui", [
      { dir: "spec/ui", purpose: "x", index: false },
      { dir: "spec/ui-legacy", purpose: "x", index: false },
    ]),
    [],
  );
  // A trailing slash matches nothing — main() rejects such a scope rather than
  // letting it empty `expected` and silently disarm the check.
  assert.deepEqual(childrenOf("docs/", INDEX_DIRS), []);
});

test("parseIndexHomes reads both the backticked label and the link target", () => {
  // Reading only the target was wrong twice: the label is the half a reader
  // sees, and rows with no parenthesised target parsed as nothing.
  assert.deepEqual([...parseIndexHomes("| x | [`ops/`](ops/) |", "docs/internal")], [
    "docs/internal/ops",
  ]);
  // Disagreement between the two surfaces as an extra directory, not silence.
  assert.deepEqual(
    [...parseIndexHomes("| x | [`ops/`](runbooks/) |", "docs/internal")].sort(),
    ["docs/internal/ops", "docs/internal/runbooks"],
  );
});

test("a row whose target markdown cannot be parsed is still read via its label", () => {
  // Titled, reference-style and unlinked rows all produced "no row in this
  // index" about a row sitting in the table.
  for (const cell of ["[`ops/`](ops/ \"Ops runbooks\")", "[`ops/`][opsref]", "`ops/`"]) {
    assert.deepEqual(
      [...parseIndexHomes(`| Ops | ${cell} | notes |`, "docs/internal")],
      ["docs/internal/ops"],
      cell,
    );
  }
});

test("parseIndexHomes reads only table rows", () => {
  const text = [
    "Prose linking [`../spec/ui/`](../spec/ui/README.md) outside a table.",
    "",
    "| Area | Path |",
    "| ---- | ---- |",
    "| Ops | [`ops/`](ops/) |",
  ].join("\n");
  assert.deepEqual([...parseIndexHomes(text, "docs/internal")], ["docs/internal/ops"]);
});

test("an index whose rows are exactly its scopes' declared children passes", () => {
  const text = [
    "| Area | Path |",
    "| ---- | ---- |",
    "| Guides | [`guides/`](guides/README.md) |",
    "| Internal | [`internal/`](internal/README.md) |",
    "",
    "| Topic | Path |",
    "| ----- | ---- |",
    "| Ops | [`internal/ops/`](internal/ops/DEPLOYMENT.md) |",
    "| CI | [`internal/ci-cd/`](internal/ci-cd/DOCS_CI.md) |",
  ].join("\n");
  assert.deepEqual(
    compareIndexDocs({
      file: "docs/README.md",
      text,
      scopes: ["docs", "docs/internal"],
      directories: INDEX_DIRS,
    }),
    [],
  );
});

test("a declared child with no row in the index is drift", () => {
  // What the stage-3 flatten (#1598) would otherwise have done in reverse:
  // change the directory set, leave the table describing the old one.
  const f = internalIndex("| Area | Folder |\n| ---- | ------ |\n| Ops | [`ops/`](ops/) |");
  assert.equal(f.length, 1);
  assert.equal(f[0].id, "docs/internal/ci-cd");
  assert.match(f[0].detail, /no row in this index/);
});

test("a row naming an undeclared CHILD of a scope is drift the other way", () => {
  const text = [
    "| Area | Folder |",
    "| ---- | ------ |",
    "| Ops | [`ops/`](ops/) |",
    "| CI | [`ci-cd/`](ci-cd/) |",
    "| Gone | [`retired/`](retired/) |",
  ].join("\n");
  const f = internalIndex(text);
  assert.equal(f.length, 1);
  assert.equal(f[0].id, "docs/internal/retired");
  assert.match(f[0].detail, /not declared in DIRECTORIES/);
});

test("a label and target naming different children both count, so drift shows", () => {
  // The row displays `ops/` but links to `runbooks/`. Reading only the target
  // let the table tell every reader the wrong location while the gate passed.
  const text = [
    "| Area | Folder |",
    "| ---- | ------ |",
    "| Ops | [`ops/`](runbooks/) |",
    "| CI | [`ci-cd/`](ci-cd/) |",
  ].join("\n");
  assert.deepEqual(
    internalIndex(text).map((x) => x.id),
    ["docs/internal/runbooks"],
  );
});

test("a table path that is not a child of any scope is not judged at all", () => {
  // An index legitimately links out of its own scope. The first design rejected
  // every such path with "fix the row, or declare the directory" naming a
  // directory that WAS declared — no remedy applied, and the only way to green
  // was deleting a correct row. Each cell below is an ordinary edit.
  const rows = [
    ["a sibling tree", "| UI | [`spec/ui/`](../../spec/ui/README.md) |"],
    ["a file in the scope's own root", "| Conventions | [`CONV.md`](CONV.md) |"],
    ["an image", "| Brand | ![mark](../../spec/ui/assets/mark.svg) |"],
    ["a deeper path", "| Hooks | tests for `../../packages/hooks` |"],
  ];
  for (const [label, row] of rows) {
    const text = [
      "| Area | Folder |",
      "| ---- | ------ |",
      "| Ops | [`ops/`](ops/) |",
      "| CI | [`ci-cd/`](ci-cd/) |",
      row,
    ].join("\n");
    assert.deepEqual(internalIndex(text), [], label);
  }
});

test("every INDEX_DOCS entry holds against the real repo, and asserts something", () => {
  // The only test that exercises the real config against the real files, which
  // is what main() does. Without it a wiring break — a dropped findings.push, a
  // stale INDEX_DOCS path, a scope whose children a rename collapsed — leaves
  // every other test green while the gate checks nothing and still prints a
  // count. Reading the files here is the point, not an integration shortcut.
  for (const { file, scopes } of INDEX_DOCS) {
    const text = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    assert.deepEqual(compareIndexDocs({ file, text, scopes }), [], file);
    for (const scope of scopes) {
      assert.ok(
        childrenOf(scope).length > 0,
        `${file}: scope ${scope} has no declared children, so the check asserts nothing`,
      );
    }
    // Non-vacuity: the entry must actually claim directories, not parse to nothing.
    const fromDir = file.slice(0, file.lastIndexOf("/"));
    assert.ok(parseIndexHomes(text, fromDir).size > 0, `${file}: parsed no homes`);
  }
});
