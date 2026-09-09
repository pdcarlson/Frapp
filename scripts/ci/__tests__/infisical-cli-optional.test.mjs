import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * `@infisical/cli` postinstall fetches the binary from GitHub Releases.
 * A 5xx there used to fail `npm ci` and skip every job that
 * `needs: packages-build` (#1938 / #1939). CI injects Infisical via
 * `.github/actions/infisical-secrets`, not this binary, so the package
 * must stay optional.
 */

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const PKG_NAME = "@infisical/cli";

function readJson(relPath) {
  return JSON.parse(readFileSync(join(repoRoot, relPath), "utf8"));
}

test("@infisical/cli is a root optionalDependency, not a hard dep", () => {
  const pkg = readJson("package.json");
  const pin = pkg.optionalDependencies?.[PKG_NAME];
  assert.equal(typeof pin, "string", "package.json optionalDependencies must pin @infisical/cli");
  assert.ok(pin.length > 0, "pin must be a non-empty version");
  assert.equal(
    pkg.dependencies?.[PKG_NAME],
    undefined,
    "must not also live in dependencies — that would make a GitHub Releases 500 fail npm ci",
  );
  assert.equal(
    pkg.devDependencies?.[PKG_NAME],
    undefined,
    "must not also live in devDependencies — npm still fails the install when a hard dep's postinstall exits 1",
  );
});

test("package-lock.json marks @infisical/cli optional so npm ci continues on postinstall 5xx", () => {
  const pkg = readJson("package.json");
  const pin = pkg.optionalDependencies?.[PKG_NAME];
  const lock = readJson("package-lock.json");
  const root = lock.packages?.[""];
  assert.equal(
    root?.optionalDependencies?.[PKG_NAME],
    pin,
    "lockfile root optionalDependencies must match package.json",
  );
  assert.equal(
    root?.devDependencies?.[PKG_NAME],
    undefined,
    "lockfile root must not also list it under devDependencies",
  );
  const entry = lock.packages?.["node_modules/@infisical/cli"];
  assert.equal(entry?.optional, true, "lockfile node_modules/@infisical/cli must be optional: true");
  assert.equal(entry?.hasInstallScript, true, "postinstall is the failure mode this classification exists for");
});
