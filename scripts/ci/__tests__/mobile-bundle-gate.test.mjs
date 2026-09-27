import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { workflowSteps } from "./helpers/workflow-yaml.mjs";

// Pins the mobile Metro bundle step in `mobile-validate` (#2388).
//
// The step exists because nothing else in CI hands the mobile module graph to
// Metro: #2347 shipped a spec under `apps/mobile/app/` that only EAS's "Bundle
// JavaScript" phase could see, and EAS reported it as "Unknown error". Where
// the step sits matters too. The EAS worker installs from the lockfile and
// never runs turbo, so it resolves `@repo/*` with no `packages/*/dist`
// present. Anything Metro resolves through a package's `require`/`default`/
// `main` entry lands in dist/, so below "Build shared packages" a
// `require("@repo/validation")` bundles green that EAS fails to resolve
// (checked by hand for #2388). Nothing else would notice the step moving, so
// the ordering is what this file locks.

const CI_YML = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "ci.yml",
);

const JOB = "mobile-validate";
const EXPORT_RE = /\bexpo\s+export\b/;
// The composite action, or a hand-written `turbo (run )build` of the packages.
const PACKAGE_BUILD_RE =
  /\.\/\.github\/actions\/turbo-packages-build|\bturbo\s+(run\s+)?build\b/;

const steps = workflowSteps(CI_YML).filter((step) => step.jobId === JOB);

describe(`${JOB}: the mobile bundle step (#2388)`, () => {
  const exportIndexes = steps
    .map((step, index) => (EXPORT_RE.test(step.body) ? index : -1))
    .filter((index) => index !== -1);

  it("finds the job's steps (a reader that sees none passes every check below)", () => {
    assert.ok(steps.length >= 5, `expected ${JOB} steps in ci.yml, found ${steps.length}`);
  });

  it("has exactly one `expo export` step", () => {
    assert.equal(exportIndexes.length, 1, `expected one \`expo export\` step in ${JOB}`);
  });

  const bundle = steps[exportIndexes[0]] ?? { body: "", env: new Map() };

  it("bundles iOS in apps/mobile", () => {
    assert.match(bundle.body, /--platform[=\s]+["']?(ios|all)\b/);
    assert.match(bundle.body, /working-directory:\s*["']?apps\/mobile["']?\s*$/m);
  });

  it("runs after `npm ci` and before any shared-package build", () => {
    const install = steps.findIndex((step) => /\bnpm\s+ci\b/.test(step.body));
    const build = steps.findIndex((step) => PACKAGE_BUILD_RE.test(step.body));
    assert.notEqual(install, -1, `${JOB} has no \`npm ci\` step`);
    assert.notEqual(build, -1, `${JOB} has no shared-package build step`);
    assert.ok(install < exportIndexes[0], "`expo export` must run after `npm ci`");
    assert.ok(
      exportIndexes[0] < build,
      "`expo export` must run before the shared packages are built: the EAS worker never builds them",
    );
  });

  it("is a production bundle with no EAS profile", () => {
    // `--dev` asks for a development bundle; production is export's default.
    assert.doesNotMatch(bundle.body, /--dev\b(?![=\s]+false\b)/);
    // A profile arms app.config.js's store fences, which need real secrets.
    assert.equal(bundle.env.has("EAS_BUILD_PROFILE"), false);
  });

  it("writes its output outside the workspace", () => {
    // Inside apps/mobile, `dist/` would be linted and walked by later steps.
    assert.match(bundle.body, /--output-dir[=\s]+["']?\$\{?RUNNER_TEMP\}?\//);
  });
});
