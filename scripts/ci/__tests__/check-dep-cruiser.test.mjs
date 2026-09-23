import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILD_PACKAGES_COMMAND,
  baselineRefusal,
  distTargets,
  missingDistTargets,
  newViolations,
  packageNameOf,
  splitIntroduced,
  staleBaselineEntries,
  toRepoRelative,
  unbuiltPackageViolations,
  violationKey,
} from "../../check-dep-cruiser.mjs";

// ── Path normalisation ──────────────────────────────────────────────────────
//
// depcruise runs with each workspace as cwd (the only way `@/*` resolves, since
// apps/web and apps/mobile each map it to their own root), so every path it
// reports is workspace-relative. Normalising to repo-root-relative is what makes
// ONE baseline possible: `src/index.ts` is otherwise ambiguous across 17
// workspaces.

test("a workspace-relative path becomes repo-root-relative", () => {
  assert.equal(
    toRepoRelative("apps/api", "src/domain/user.entity.ts"),
    "apps/api/src/domain/user.entity.ts",
  );
});

test("a path that leaves the workspace collapses to its canonical spelling", () => {
  // apps/web importing @repo/hooks resolves as ../../packages/hooks/src/x.ts.
  assert.equal(
    toRepoRelative("apps/web", "../../packages/hooks/src/use-user.ts"),
    "packages/hooks/src/use-user.ts",
  );
});

test("the same file reported from two workspaces normalises identically", () => {
  // This is the property that stops one violation being baselined twice.
  const fromWeb = toRepoRelative("apps/web", "../../packages/hooks/src/use-user.ts");
  const fromMobile = toRepoRelative("apps/mobile", "../../packages/hooks/src/use-user.ts");
  const fromHooks = toRepoRelative("packages/hooks", "src/use-user.ts");
  assert.equal(fromWeb, fromMobile);
  assert.equal(fromWeb, fromHooks);
});

test("bare specifiers are left alone, never rewritten into paths", () => {
  // Rewriting these would turn `node:fs` into `apps/api/node:fs`.
  assert.equal(toRepoRelative("apps/api", "react"), "react");
  assert.equal(toRepoRelative("apps/api", "node:fs"), "node:fs");
  assert.equal(toRepoRelative("apps/api", "@nestjs/common"), "@nestjs/common");
  assert.equal(
    toRepoRelative("apps/api", "node_modules/rxjs/index.js"),
    "node_modules/rxjs/index.js",
  );
});

test("a bare specifier WITH a subpath is still a specifier, not a path", () => {
  // The case a "does it contain a slash?" rule gets wrong. `fs/promises`,
  // `stream/web` and friends are core modules dependency-cruiser reports
  // unprefixed, and turning them into apps/api/fs/promises would write a
  // fabricated path straight into a baseline key.
  assert.equal(toRepoRelative("apps/api", "fs/promises"), "fs/promises");
  assert.equal(toRepoRelative("apps/api", "stream/web"), "stream/web");
  assert.equal(toRepoRelative("apps/api", "timers/promises"), "timers/promises");
  assert.equal(toRepoRelative("apps/api", "lodash/debounce"), "lodash/debounce");
});

test("an unresolved alias is passed through rather than turned into a path", () => {
  // `@/…` cannot resolve outside its own app, and there is no file to name.
  assert.equal(toRepoRelative("apps/api", "@/lib/theme"), "@/lib/theme");
  assert.equal(toRepoRelative("apps/api", "@scope/pkg/sub/path.js"), "@scope/pkg/sub/path.js");
});

test("normalisation does not depend on the filesystem", () => {
  // A path that does not exist must still normalise, so the result cannot vary
  // with what happens to be checked out when the gate runs.
  assert.equal(
    toRepoRelative("apps/api", "src/does/not/exist.ts"),
    "apps/api/src/does/not/exist.ts",
  );
});

test("normalisation is stable on an already-normalised path", () => {
  const once = toRepoRelative("apps/web", "../../packages/hooks/src/x.ts");
  assert.equal(toRepoRelative("packages/hooks", "src/x.ts"), once);
});

// ── Baseline identity ───────────────────────────────────────────────────────

test("a violation's identity is rule + edge, and nothing else", () => {
  const a = { rule: "no-circular", from: "a.ts", to: "b.ts" };
  const b = { rule: "no-circular", from: "a.ts", to: "b.ts", severity: "error", workspace: "x" };
  assert.equal(violationKey(a), violationKey(b));
});

test("identity is not line-based, so an unrelated edit above an import does not churn it", () => {
  const before = { rule: "no-circular", from: "a.ts", to: "b.ts", line: 3 };
  const after = { rule: "no-circular", from: "a.ts", to: "b.ts", line: 47 };
  assert.equal(violationKey(before), violationKey(after));
});

test("the key separator cannot be forged out of path text", () => {
  // A NUL separator matters: with a naive "-" or ":" join, a file literally
  // named to contain the separator could collide with a different edge.
  const a = { rule: "r", from: "a.ts:b.ts", to: "c.ts" };
  const b = { rule: "r", from: "a.ts", to: "b.ts:c.ts" };
  assert.notEqual(violationKey(a), violationKey(b));
});

// ── The gate's verdict ──────────────────────────────────────────────────────

const BASELINED = { rule: "api-application-not-to-interface", from: "a.ts", to: "b.ts" };
const INTRODUCED = { rule: "no-circular", from: "c.ts", to: "d.ts" };

test("a baselined violation does not fail the gate", () => {
  assert.deepEqual(newViolations([BASELINED], [BASELINED]), []);
});

test("a violation absent from the baseline fails the gate", () => {
  assert.deepEqual(newViolations([BASELINED, INTRODUCED], [BASELINED]), [INTRODUCED]);
});

test("an empty baseline means every violation is new", () => {
  assert.deepEqual(newViolations([INTRODUCED], []), [INTRODUCED]);
});

test("the same edge under a DIFFERENT rule is new, not covered by the baseline", () => {
  const sameEdgeOtherRule = { rule: "no-circular", from: "a.ts", to: "b.ts" };
  assert.deepEqual(newViolations([sameEdgeOtherRule], [BASELINED]), [sameEdgeOtherRule]);
});

test("a clean run passes against a populated baseline", () => {
  assert.deepEqual(newViolations([], [BASELINED]), []);
});

// ── Shrinking the baseline ──────────────────────────────────────────────────

test("a fixed violation is reported as a stale baseline entry", () => {
  assert.deepEqual(staleBaselineEntries([], [BASELINED]), [BASELINED]);
});

test("a still-present violation is not stale", () => {
  assert.deepEqual(staleBaselineEntries([BASELINED], [BASELINED]), []);
});

test("stale entries never fail the gate — fixing a violation must not punish you", () => {
  // The whole point: staleBaselineEntries is informational, and newViolations —
  // the thing that decides the exit code — is unaffected by it.
  assert.deepEqual(newViolations([], [BASELINED]), []);
});

// ── Unbuilt workspace packages (#2516) ──────────────────────────────────────
//
// The API, and the `require`/`types` conditions of each package whose manifest points into
// `dist/`, resolve `@repo/*` through that gitignored `dist/`. So on a checkout where nothing
// built it, those imports are unresolvable, and reporting them as boundary violations "this
// change introduced" told an agent to go and change imports that were never broken.

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** A manifest shaped like the real dist-backed ones (`packages/observability/package.json`). */
const OBSERVABILITY = {
  name: "@repo/observability",
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: {
    ".": { types: "./dist/index.d.ts", require: "./dist/index.js", import: "./src/index.ts", default: "./dist/index.js" },
    "./identified-posthog": {
      types: "./dist/identified-posthog.d.ts",
      require: "./dist/identified-posthog.js",
      import: "./src/identified-posthog.ts",
    },
    "./next": { import: "./next/index.ts" },
  },
};

test("packageNameOf keeps the scope and drops the subpath", () => {
  assert.equal(packageNameOf("@repo/chat-integrations"), "@repo/chat-integrations");
  assert.equal(packageNameOf("@repo/validation/subscription"), "@repo/validation");
  assert.equal(packageNameOf("lodash/fp"), "lodash");
  assert.equal(packageNameOf("react"), "react");
});

test("distTargets lists only the dist/ files a subpath maps to, under every condition", () => {
  assert.deepEqual(distTargets(OBSERVABILITY, "."), ["./dist/index.d.ts", "./dist/index.js"]);
  assert.deepEqual(distTargets(OBSERVABILITY, "./identified-posthog"), [
    "./dist/identified-posthog.d.ts",
    "./dist/identified-posthog.js",
  ]);
  // A source-only subpath has no build output to be missing.
  assert.deepEqual(distTargets(OBSERVABILITY, "./next"), []);
  assert.deepEqual(distTargets(OBSERVABILITY, "./not-exported"), []);
});

test("distTargets reads exports sugar and single-* patterns", () => {
  assert.deepEqual(distTargets({ exports: "./dist/index.js" }, "."), ["./dist/index.js"]);
  assert.deepEqual(distTargets({ exports: { require: "./dist/index.cjs", import: "./src/index.ts" } }, "."), [
    "./dist/index.cjs",
  ]);
  const patterned = { exports: { "./*": { types: "./dist/*.d.ts", import: "./src/*.ts" } } };
  assert.deepEqual(distTargets(patterned, "./renderers"), ["./dist/renderers.d.ts"]);
});

test("distTargets agrees with the real manifests it runs against", () => {
  const read = (pkg) => JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", pkg, "package.json"), "utf8"));
  assert.ok(distTargets(read("validation"), ".").includes("./dist/index.js"));
  assert.ok(distTargets(read("observability"), "./identified-posthog").includes("./dist/identified-posthog.js"));
  // A source-only package can never be "unbuilt".
  assert.deepEqual(distTargets(read("chat-core"), "."), []);
});

test("a dist/ that exists but lacks the imported export still counts as unbuilt", (t) => {
  // The review's case: a dist/ from a build before `./identified-posthog` existed, or a build
  // that died halfway. The directory is there; the file the import needs is not.
  const dir = mkdtempSync(path.join(tmpdir(), "dep-cruiser-dist-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "dist"));
  writeFileSync(path.join(dir, "dist", "index.js"), "");
  writeFileSync(path.join(dir, "dist", "index.d.ts"), "");
  const manifests = new Map([["@repo/observability", { dir, manifest: OBSERVABILITY }]]);

  assert.deepEqual(missingDistTargets("@repo/observability", manifests, existsSync), []);
  assert.deepEqual(missingDistTargets("@repo/observability/identified-posthog", manifests, existsSync), [
    "./dist/identified-posthog.d.ts",
    "./dist/identified-posthog.js",
  ]);
  // Not a workspace package: nothing to build, so nothing is missing.
  assert.deepEqual(missingDistTargets("left-pad", manifests, existsSync), []);

  rmSync(path.join(dir, "dist"), { recursive: true });
  assert.equal(missingDistTargets("@repo/observability", manifests, existsSync).length, 2);
});

test("only unresolvable imports of an UNBUILT @repo export are set apart", () => {
  const unbuilt = new Set(["@repo/chat-integrations", "@repo/chat-integrations/renderers"]);
  const violations = [
    { rule: "not-to-unresolvable", from: "apps/web/a.tsx", to: "@repo/chat-integrations" },
    { rule: "not-to-unresolvable", from: "apps/web/b.tsx", to: "@repo/chat-integrations/renderers" },
    // Built export: an unresolvable import of it is a real problem and must stay reported.
    { rule: "not-to-unresolvable", from: "apps/web/c.tsx", to: "@repo/validation" },
    // Not a workspace package at all.
    { rule: "not-to-unresolvable", from: "apps/web/d.tsx", to: "left-pad" },
    // Another rule on the same target is a real boundary finding, whatever the build state.
    { rule: "no-cross-app", from: "apps/web/e.tsx", to: "@repo/chat-integrations" },
  ];
  const isUnbuilt = (specifier) => unbuilt.has(specifier);
  assert.deepEqual(
    unbuiltPackageViolations(violations, isUnbuilt).map((v) => v.from),
    ["apps/web/a.tsx", "apps/web/b.tsx"],
  );

  const { unbuilt: explained, genuine } = splitIntroduced(violations, isUnbuilt);
  assert.deepEqual(explained.map((v) => v.from), ["apps/web/a.tsx", "apps/web/b.tsx"]);
  assert.deepEqual(genuine.map((v) => v.from), ["apps/web/c.tsx", "apps/web/d.tsx", "apps/web/e.tsx"]);
});

test("--update-baseline refuses an unbuilt checkout and names the quoted build command", () => {
  const violations = [
    { rule: "not-to-unresolvable", from: "apps/api/src/a.ts", to: "@repo/validation" },
    { rule: "no-cross-app", from: "apps/web/b.tsx", to: "apps/mobile/c.tsx" },
  ];
  const refusal = baselineRefusal(violations, (specifier) => specifier === "@repo/validation");
  assert.match(refusal, /refusing to record the baseline — 1 violation\(s\)/);
  assert.ok(refusal.includes(BUILD_PACKAGES_COMMAND));
  // Quoted, so zsh's NOMATCH does not abort a pasted copy on the unmatched glob.
  assert.equal(BUILD_PACKAGES_COMMAND, "npx turbo run build --filter='./packages/*'");
  // A built checkout records normally, genuine violations and all.
  assert.equal(baselineRefusal(violations, () => false), null);
});
