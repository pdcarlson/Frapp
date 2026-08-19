import { test } from "node:test";
import assert from "node:assert/strict";

import {
  newViolations,
  staleBaselineEntries,
  toRepoRelative,
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
