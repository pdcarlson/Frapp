import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { installsDependencies, USES_NODE_SETUP, workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";
import { CI_CHECKS } from "../lib/required-checks.mjs";

// Pins the mobile Metro bundle step in `mobile-validate` (#2388).
//
// The step exists because nothing else in CI hands the mobile module graph to
// Metro: #2347 shipped a spec under `apps/mobile/app/` that only EAS's "Bundle
// JavaScript" phase could see, and EAS reported it as "Unknown error". So this
// file locks two things. The step must be able to fail the required job: a
// `continue-on-error`, an `if:`, or a swallowed exit makes it advisory. And it
// must run before anything builds `packages/*/dist`. The EAS worker installs
// from the lockfile and never builds the packages, and for a package whose
// `exports` send `require`/`default`/`main` to dist/ (validation, formatting,
// color, org-archetypes, observability's root), a built tree resolves what the
// worker can't: a local `require("@repo/validation")` exports with dist/
// present and fails to resolve without it (checked by hand for #2388).

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
// The only steps allowed before the bundle: none of them can build dist/.
// An allowlist, because a denylist of build commands misses the next one
// (`npm run build -w packages/validation`, a downloaded artifact, ...).
const ALLOWED_BEFORE = [
  /^\s*-?\s*uses:\s*["']?actions\/checkout@/m,
  // Node and `npm ci` (#1541): installs, builds nothing.
  new RegExp(USES_NODE_SETUP.source, "m"),
  // Reads package.json, package-lock.json and dependabot.yml; builds nothing.
  /^\s*-?\s*run:\s*npm\s+run\s+check:expo-sdk-line\s*$/m,
];

/** The step's text without its `name:` line, so a name can't stand in for the command. */
const withoutName = (step) => step.body.replace(/^\s*-?\s*name:.*$/m, "");

const steps = workflowSteps(CI_YML).filter((step) => step.jobId === JOB);

describe(`${JOB}: the mobile bundle step (#2388)`, () => {
  const exportIndexes = steps
    .map((step, index) => (EXPORT_RE.test(withoutName(step)) ? index : -1))
    .filter((index) => index !== -1);

  it("finds the job's steps (a reader that sees none passes every check below)", () => {
    assert.ok(steps.length >= 5, `expected ${JOB} steps in ci.yml, found ${steps.length}`);
  });

  it("has exactly one step that runs `expo export`", () => {
    assert.equal(exportIndexes.length, 1, `expected one step in ${JOB} whose command is \`expo export\``);
  });

  const bundle = steps[exportIndexes[0]] ?? { body: "", env: new Map(), if: null };
  const command = withoutName(bundle);

  it("bundles iOS in apps/mobile", () => {
    assert.match(command, /--platform[=\s]+["']?(ios|all)\b/);
    assert.match(command, /working-directory:\s*["']?apps\/mobile["']?\s*$/m);
  });

  it("can fail the required job", () => {
    assert.equal(bundle.if, null, "the step runs on every event");
    assert.doesNotMatch(command, /continue-on-error/);
    // An exit the shell swallows is a step that can't go red.
    assert.doesNotMatch(command, /\|\||set\s+\+e|;\s*(true|exit\s+0)\b/);
    const job = workflowJobs(CI_YML).find((j) => j.jobId === JOB);
    assert.ok(job, `${JOB} job not found`);
    assert.equal(job.if, null, `${JOB} runs on every event`);
    assert.doesNotMatch(String(job.keys.get("continue-on-error") ?? ""), /true/);
    assert.ok(CI_CHECKS.includes(JOB), `${JOB} is a required check`);
  });

  it("runs before anything that could build packages/*/dist", () => {
    assert.ok(exportIndexes.length === 1);
    for (const step of steps.slice(0, exportIndexes[0])) {
      assert.ok(
        ALLOWED_BEFORE.some((re) => re.test(withoutName(step))),
        `"${step.name}" runs before \`expo export\`; only checkout, node-setup and the read-only SDK-line check may, ` +
          "because the EAS worker never builds the shared packages",
      );
    }
    assert.ok(
      steps.slice(0, exportIndexes[0]).some(installsDependencies),
      "`expo export` must run after `npm ci`",
    );
  });

  it("is a production bundle with no EAS profile", () => {
    // `arg` parses `--dev` as a Boolean, so `--dev=false` and `--dev false`
    // both turn dev ON. Production is export's default; any `--dev` is wrong.
    assert.doesNotMatch(command, /--dev\b|--no-minify\b|--no-bytecode\b/);
    // A profile arms app.config.js's store fences, which need real secrets.
    assert.equal(bundle.env.has("EAS_BUILD_PROFILE"), false);
  });

  it("writes its output outside the workspace", () => {
    // Keeps the checkout as `npm ci` left it, so nothing later can upload,
    // cache or commit a stray bundle.
    assert.match(command, /--output-dir[=\s]+["']?\$\{?RUNNER_TEMP\}?\//);
  });
});
