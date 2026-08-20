import { test } from "node:test";
import assert from "node:assert/strict";

import { isApiRelated } from "../../check-api-contract-drift.mjs";

// `isApiRelated` decides whether the contract check regenerates at all. A false
// negative here is invisible: the check reports green having done nothing, and a
// stale contract merges.

// ── The API tree ────────────────────────────────────────────────────────────

test("API source triggers a regen", () => {
  assert.equal(isApiRelated("apps/api/src/interface/controllers/task.controller.ts"), true);
  assert.equal(isApiRelated("apps/api/src/interface/dtos/task.dto.ts"), true);
  // Non-contract API files too: regenerating is cheap and a clean diff passes,
  // so over-checking beats missing a contract change.
  assert.equal(isApiRelated("apps/api/src/application/services/task.service.ts"), true);
});

test("the artifacts themselves trigger a regen", () => {
  assert.equal(isApiRelated("apps/api/openapi.json"), true);
  assert.equal(isApiRelated("packages/api-sdk/src/types.ts"), true);
});

test("tests and the exporter do not", () => {
  assert.equal(isApiRelated("apps/api/src/application/services/task.service.spec.ts"), false);
  assert.equal(isApiRelated("apps/api/test/task.e2e-spec.ts"), false);
  assert.equal(isApiRelated("apps/api/src/export-openapi.ts"), false);
});

// ── The generators ──────────────────────────────────────────────────────────
//
// openapi.json is emitted by @nestjs/swagger and types.ts by openapi-typescript.
// Bumping either can change the output with NOTHING under apps/api/src touched —
// and a Dependabot bump touches only the manifests, which is exactly the shape
// the filter used to skip.

test("a lockfile change triggers a regen", () => {
  assert.equal(isApiRelated("package-lock.json"), true);
});

test("the API manifest triggers a regen", () => {
  assert.equal(isApiRelated("apps/api/package.json"), true);
});

// ── Shared packages the API imports ─────────────────────────────────────────
//
// A value from one of these can reach a DTO decorator and therefore the emitted
// schema, so it can drift the contract from outside apps/api entirely.

test("shared packages the API consumes trigger a regen", () => {
  assert.equal(isApiRelated("packages/validation/src/index.ts"), true);
  assert.equal(isApiRelated("packages/org-archetypes/src/index.ts"), true);
  assert.equal(isApiRelated("packages/chapter-theme/src/index.ts"), true);
});

test("their tests still do not", () => {
  assert.equal(isApiRelated("packages/validation/src/time-zone.spec.ts"), false);
});

// ── Everything else ─────────────────────────────────────────────────────────

test("unrelated changes do not trigger a regen", () => {
  assert.equal(isApiRelated("apps/web/app/page.tsx"), false);
  assert.equal(isApiRelated("apps/landing/app/page.tsx"), false);
  assert.equal(isApiRelated("docs/guides/testing.md"), false);
  assert.equal(isApiRelated("spec/architecture/README.md"), false);
  assert.equal(isApiRelated(".buildpad/notes/x.md"), false);
  assert.equal(isApiRelated("packages/theme/src/globals.css"), false);
  assert.equal(isApiRelated("packages/hooks/src/use-user.ts"), false);
});

test("the root manifest does not — only the lockfile records resolved versions", () => {
  assert.equal(isApiRelated("package.json"), false);
});
