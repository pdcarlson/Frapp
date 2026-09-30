import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Pins the root `packageManager` field to an exact npm that re-resolves the lockfile
 * without damaging it.
 *
 * WHY THIS IS A GUARD. Dependabot re-resolves `package-lock.json` with
 * `corepack npm@<this pin>`, and nothing in CI runs that npm: `npm ci` uses whatever
 * npm setup-node's Node bundles. So a PR that moves the pin back to a pruning npm (a
 * revert, a conflict resolution, a copied package.json) passes every gate, and the
 * damage lands later, one Dependabot PR at a time. At `npm@11.6.2` Dependabot's
 * lockfile for #2930 dropped `@emnapi/core` and `@emnapi/runtime`, stripped every
 * `libc` field, and failed `npm ci` with `Missing: @emnapi/runtime@1.11.3 from lock
 * file`. `@dependabot recreate` can't repair that while the pin stays put.
 *
 * WHY A FLOOR AND NOT EQUALITY WITH CI'S npm. Equality would turn this required job red
 * for every PR on the day GitHub's Node 24 image bundles a newer npm, which no PR
 * caused. The floor is the lowest npm checked by replaying Dependabot's own commands.
 * Move it up when the pin moves, and don't lower it without that replay.
 *
 * Docs: `docs/ci-cd/agent-infra.md` § Dependabot resolves with the root
 * `packageManager` npm.
 */

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const FLOOR = [11, 19, 0];

function pin() {
  const { packageManager } = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  );
  return packageManager;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

test("packageManager names an exact npm version, the form corepack installs", () => {
  const value = pin();
  assert.match(
    String(value),
    /^npm@\d+\.\d+\.\d+$/,
    `root package.json packageManager is ${JSON.stringify(value)}; Dependabot runs ` +
      "`corepack npm@<pin>`, which needs an exact `npm@x.y.z`.",
  );
});

test("packageManager is not below the npm verified to keep the lockfile intact", () => {
  const value = String(pin());
  const version = value.replace(/^npm@/, "").split(".").map(Number);
  assert.ok(
    compare(version, FLOOR) >= 0,
    `root package.json pins ${value}, below npm@${FLOOR.join(".")}. Dependabot ` +
      "re-resolves with this npm; older npm 11 releases drop @emnapi/* entries or " +
      "libc fields and break `npm ci`. See docs/ci-cd/agent-infra.md § Dependabot " +
      "resolves with the root `packageManager` npm.",
  );
});
