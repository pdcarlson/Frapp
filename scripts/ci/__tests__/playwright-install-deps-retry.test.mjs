import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_DIR,
  WORKFLOW_DIR,
  actionFiles,
  usesLocalAction,
  workflowFiles,
  workflowSteps,
} from "./helpers/workflow-yaml.mjs";

// Pins how the two required Playwright jobs get Chromium's OS packages, in
// .github/actions/playwright-os-deps. The Ubuntu apt mirrors have failed
// these jobs three ways: Hash Sum mismatches on Google's unused chrome source
// (#2015), a two-hour hang (#3129), and a DNS outage on 2026-11-11 that held
// every PR red. So the action installs cached .debs, asks Playwright's own
// offline check whether anything is still missing, and goes to apt (dropping
// the chrome source, retrying) only when it is. Do not skip apt hash checks
// and do not pin Chrome apt.

const ACTION = join(ACTION_DIR, "playwright-os-deps", "action.yml");
const INSTALL_DEPS = "npx playwright install-deps chromium";
const DRY_RUN = "npx playwright install-deps --dry-run chromium";
const HASH_CHECK_DISABLE =
  /Check-Valid-Until\s*=\s*false|Acquire::https::Verify-Peer\s*=\s*false|--allow-unauthenticated|APT::Get::AllowUnauthenticated/i;
const JOBS = {
  "web-responsive-floor": "npm run test:floor -w apps/web",
  "landing-fold": "npm run test:fold -w apps/landing",
};

function at(text, needle, from = 0) {
  const i = text.indexOf(needle, from);
  assert.notEqual(
    i,
    -1,
    `playwright-os-deps must contain ${JSON.stringify(needle)}`,
  );
  return i;
}

describe("Playwright OS deps install without the apt mirrors when it can", () => {
  const text = readFileSync(ACTION, "utf8");

  it("tries the cached packages and Playwright's offline check before any apt", () => {
    const restore = at(text, "actions/cache/restore@");
    const offline = at(text, "apt-get install -y --no-download", restore);
    const check = at(text, DRY_RUN, offline);
    // The hit path must end at the check, or every run still reaches the mirrors.
    assert.match(
      text,
      /if check="\$\(npx playwright install-deps --dry-run chromium 2>&1\)"; then\n(?:[^\n]*\n){2}\s*exit 0\n\s*fi\n/,
    );
    assert.ok(
      check < at(text, INSTALL_DEPS, check),
      "apt comes only after the check",
    );
    assert.match(
      text,
      /dpkg-query -W[^\n]*\n[^\n]*todo\+=/,
      "only packages the image lacks are installed, so nothing is downgraded",
    );
  });

  it("falls back to apt with the chrome source dropped and three tries", () => {
    const check = at(text, DRY_RUN);
    const apt = at(text, INSTALL_DEPS, check);
    assert.ok(at(text, "google-chrome.list", check) < apt);
    assert.match(text, /for i in 1 2 3;[\s\S]*\bsleep 20\b/);
    assert.match(
      text,
      /if npx playwright install-deps chromium; then\n\s*break\n/,
    );
    assert.doesNotMatch(
      text,
      HASH_CHECK_DISABLE,
      "do not skip apt hash checks or pin Chrome apt",
    );
    assert.doesNotMatch(
      text,
      /install-deps chromium\s*\|\|\s*true/,
      "a failed apt install must fail the job",
    );
  });

  it("caches what apt fetched under the key it restores", () => {
    const apt = at(text, INSTALL_DEPS, at(text, DRY_RUN));
    assert.ok(at(text, 'cp "${fetched[@]}" "$DEBS/"', apt) > apt);
    const save = at(text, "actions/cache/save@");
    assert.match(
      text.slice(save - 120, save),
      /if: steps\.restore\.outputs\.cache-hit != 'true'/,
    );
    const keys = [...text.matchAll(/^\s+key: (.+)$/gm)].map((m) => m[1].trim());
    assert.deepEqual(keys, [
      "${{ steps.key.outputs.key }}",
      "${{ steps.key.outputs.key }}",
    ]);
    assert.match(
      text,
      /key=playwright-os-debs-\$\{ImageOS:-unknown\}-\$\{version\}-\$\{ImageVersion:-unknown\}/,
    );
  });

  it("goes without only fonts when apt is down, and never caches that", () => {
    // Chromium needs every library; a missing font changes no launch. Anything
    // but fonts still fails the job after three tries.
    assert.match(text, /grep -qvE '\^x\?fonts-'/);
    const degrade = at(text, 'if [ "$fonts_only" = true ]; then');
    assert.ok(
      degrade < at(text, 'echo "save=false" >> "$GITHUB_OUTPUT"', degrade),
    );
    assert.ok(degrade < at(text, 'if [ "$i" -eq 3 ]; then', degrade));
    assert.match(
      text,
      /if: steps\.restore\.outputs\.cache-hit != 'true' && steps\.install\.outputs\.save != 'false'/,
    );
  });

  it("is what both Playwright jobs run, bounded, before their suites", () => {
    const steps = workflowSteps(join(WORKFLOW_DIR, "ci.yml"));
    for (const [jobId, suite] of Object.entries(JOBS)) {
      const own = steps.filter((step) => step.jobId === jobId);
      const callsAction = usesLocalAction("playwright-os-deps");
      const deps = own.findIndex((step) =>
        step.body.split("\n").some((line) => callsAction.test(line)),
      );
      const tests = own.findIndex((step) => step.body.includes(suite));
      assert.notEqual(
        deps,
        -1,
        `${jobId} must install OS deps through playwright-os-deps`,
      );
      assert.notEqual(tests, -1, `${jobId} must still run ${suite}`);
      assert.ok(deps < tests, `${jobId} installs OS deps before ${suite}`);
      assert.match(own[deps].body, /^\s+timeout-minutes:\s*\d+\s*$/m);
    }
  });

  it("has no other install-deps consumer", () => {
    const hits = [
      ...workflowFiles()
        .filter((name) =>
          readFileSync(join(WORKFLOW_DIR, name), "utf8").includes(
            "playwright install-deps",
          ),
        )
        .map((name) => `workflows/${name}`),
      ...actionFiles()
        .filter((a) => a.text.includes("playwright install-deps"))
        .map((a) => `actions/${a.name}`),
    ];
    assert.deepEqual(
      hits,
      ["actions/playwright-os-deps"],
      "route it through playwright-os-deps",
    );
  });
});
