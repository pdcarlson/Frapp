import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Pins the cutover half of stage 4's composite-action extraction (#1382).
//
// The `.turbo` cache key from ADR-15 lever (A) used to be written out verbatim in
// all eight of its call sites in `ci.yml` -- one producer (`actions/cache`) and
// seven consumers (`actions/cache/restore`). That duplication is uniquely nasty
// because its failure is silent: edit the key in the producer and forget one
// consumer, and that job stops hitting the cache and rebuilds every package from
// cold on every run. A cache miss is not an error, so CI stays green and the only
// symptom is a slow job nobody attributes to a typo weeks earlier.
//
// The extraction is only worth anything if the copies stay gone. Per AGENTS.md
// § Tech debt protocol, a shared helper living beside surviving local copies is a
// net loss -- so this test fails if a hand-written block comes back, rather than
// waiting for someone to notice the minutes.
//
// Parsed by hand rather than with a YAML library on purpose, matching
// `workflow-concurrency.test.mjs`: every test in this directory imports `node:`
// modules only, and `yaml` is present here as a transitive override rather than a
// declared dependency.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOWS = join(REPO, ".github", "workflows");
const ACTION = join(REPO, ".github", "actions", "turbo-packages-build", "action.yml");

const USES = "uses: ./.github/actions/turbo-packages-build";

/** Every `*.yml` under `.github/workflows`, as `{ name, text }`. */
function workflows() {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((name) => ({ name, text: readFileSync(join(WORKFLOWS, name), "utf8") }));
}

/** Lines of one `  <jobId>:` block in a workflow, up to the next job. */
function jobBlock(text, jobId) {
  const lines = text.split("\n");
  const key = (l) => l.replace(/\s+$/, "");
  const start = lines.findIndex((l) => key(l) === `  ${jobId}:`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-zA-Z0-9_-]+:$/.test(key(lines[i]))) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("turbo-packages-build composite action", () => {
  it("exists and is a composite action", () => {
    assert.ok(existsSync(ACTION), `${ACTION} is missing`);
    const text = readFileSync(ACTION, "utf8");
    assert.match(text, /using:\s*composite/, "action must declare `using: composite`");
  });

  it("is the only place the turbo cache key is written", () => {
    const offenders = workflows()
      .filter((w) => w.text.includes("turbo-pkgbuild"))
      .map((w) => w.name);
    assert.deepEqual(
      offenders,
      [],
      "the `turbo-pkgbuild-` cache key belongs only in " +
        ".github/actions/turbo-packages-build/action.yml -- a workflow spelling it " +
        "out again can drift onto a different key and silently rebuild from cold",
    );
  });

  it("is the only place packages/* is built", () => {
    const offenders = workflows()
      .filter((w) => w.text.includes("turbo run build --filter='./packages/*'"))
      .map((w) => w.name);
    assert.deepEqual(
      offenders,
      [],
      "build `packages/*` through ./.github/actions/turbo-packages-build, not a hand-written step",
    );
  });

  it("has exactly one producer, and it is packages-build", () => {
    const ci = readFileSync(join(WORKFLOWS, "ci.yml"), "utf8");
    const savers = ci.split("\n").filter((l) => /^\s*save:\s*"true"\s*$/.test(l));
    assert.equal(
      savers.length,
      1,
      "exactly one job may pass `save: \"true\"` -- a second writer races the first " +
        "for the same cache key",
    );
    const producer = jobBlock(ci, "packages-build");
    assert.ok(producer, "ci.yml must still define a `packages-build` job");
    assert.match(producer, /save:\s*"true"/, "packages-build is the job that writes the cache");
  });

  it("is used by every job that needs prebuilt packages", () => {
    const ci = readFileSync(join(WORKFLOWS, "ci.yml"), "utf8");
    // packages-build produces; the rest consume. `web-responsive-floor` is the
    // one ADR-15's own text still omits -- it is listed here so the count cannot
    // drift again unnoticed.
    const expected = [
      "packages-build",
      "lint-and-typecheck",
      "api-tests",
      "web-tests",
      "api-contract-check",
      "dependency-cruiser",
      "mobile-validate",
      "web-responsive-floor",
    ];
    for (const jobId of expected) {
      const block = jobBlock(ci, jobId);
      assert.ok(block, `ci.yml must still define a \`${jobId}\` job`);
      assert.ok(block.includes(USES), `${jobId} must build packages through the shared action`);
    }
    const total = ci.split("\n").filter((l) => l.trim() === USES).length;
    assert.equal(total, expected.length, "unexpected extra or missing call site in ci.yml");
  });

  it("stays out of the two jobs that exist to catch a cold build", () => {
    const ci = readFileSync(join(WORKFLOWS, "ci.yml"), "utf8");
    // Both jobs carry an in-file comment saying adding a build/cache step
    // silently disarms them: `clean-checkout-typecheck` reproduces a bare
    // install on a cold machine, and `web-production-build` builds under a
    // production prune. Prebuilt `dist/` on disk hides the failure each exists
    // to surface, and the shared action is now the easiest way to add one.
    for (const jobId of ["clean-checkout-typecheck", "web-production-build"]) {
      const block = jobBlock(ci, jobId);
      assert.ok(block, `ci.yml must still define a \`${jobId}\` job`);
      assert.ok(
        !block.includes(USES),
        `${jobId} must NOT use the shared build action -- it exists to fail when ` +
          "shared packages cannot build from a cold tree",
      );
    }
  });
});
