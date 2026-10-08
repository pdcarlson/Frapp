import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The `api-modules-wiring-only` rules (#3219) have nothing to fire on in the
// real tree, which holds only module files under `apps/api/src/modules/`, so
// `check:dep-cruiser` stays green whether or not they exist. This cruises a
// throwaway tree with the real config, the way `check-dep-cruiser.mjs` does,
// and pins each of the three forms to the file it exists to catch.
//
// It needs the installed dependency-cruiser, so it runs in CI's
// `dependency-cruiser` job (`npm run check:dep-cruiser:rules`), not with the
// dependency-free `scripts/ci/__tests__` suite.

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CONFIG_PATH = path.join(REPO_ROOT, "scripts/dependency-cruiser.cjs");
const DEPCRUISE_BIN = path.join(
  REPO_ROOT,
  "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
);

const FIXTURE = {
  // Wiring: imports a constants file beside it and a service. Allowed itself;
  // the constants file it imports is the -target violation.
  "src/modules/a/a.module.ts":
    "import { X } from './a.consts';\nimport { Y } from './a.module.helpers';\n" +
    "import { S } from '../../application/a.service';\nexport const M = [X, Y, S];\n",
  "src/modules/a/a.consts.ts": "export const X = 1;\n",
  // Named like a module but is not one: the exemption is anchored to the
  // `.module.ts` suffix, so this is a -target violation too.
  "src/modules/a/a.module.helpers.ts": "export const Y = 2;\n",
  // The same lookalike with imports of its own and no importer pins the base
  // rule's anchor; one with no edges at all pins -orphan's.
  "src/modules/b/b.module.helpers.ts":
    "import { S } from '../../application/a.service';\nexport const B = S;\n",
  "src/modules/b/b.module.stray.ts": "export const W = 1;\n",
  // Code under modules/ with imports of its own: the base rule.
  "src/modules/a/a.helper.ts":
    "import { S } from '../../application/a.service';\nexport const H = S;\n",
  // Code under modules/ with no edges at all: -orphan.
  "src/modules/a/z.orphan.ts": "export const Z = 1;\n",
  // A module spec is an orphan by nature and stays exempt.
  "src/modules/a/a.module.spec.ts": "export const SPEC = 1;\n",
  "src/application/a.service.ts": "export const S = 1;\n",
};

function cruiseFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "depcruise-modules-"));
  try {
    for (const [file, body] of Object.entries(FIXTURE)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), body);
    }
    let stdout;
    try {
      stdout = execFileSync(
        process.execPath,
        [
          DEPCRUISE_BIN,
          "src",
          "--config",
          CONFIG_PATH,
          "--output-type",
          "json",
        ],
        {
          cwd: dir,
          encoding: "utf8",
          env: {
            ...process.env,
            DEPCRUISE_WORKSPACE: "apps/api",
            DEPCRUISE_SIBLING_APPS: "",
          },
        },
      );
    } catch (error) {
      // depcruise exits non-zero on violations; the report is still on stdout.
      stdout = error.stdout;
    }
    // No JSON means depcruise failed before reporting (a config that throws on
    // load, a missing binary); say so rather than fail inside JSON.parse.
    if (!stdout || !stdout.trim().startsWith("{")) {
      throw new Error(`depcruise produced no report:\n${stdout ?? ""}`);
    }
    return JSON.parse(stdout)
      .summary.violations.filter((v) =>
        v.rule.name.startsWith("api-modules-wiring-only"),
      )
      .map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`)
      .sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("each api-modules-wiring-only form fires on its file, and only there", () => {
  assert.deepEqual(cruiseFixture(), [
    "api-modules-wiring-only-orphan: src/modules/a/z.orphan.ts -> src/modules/a/z.orphan.ts",
    "api-modules-wiring-only-orphan: src/modules/b/b.module.stray.ts -> src/modules/b/b.module.stray.ts",
    "api-modules-wiring-only-target: src/modules/a/a.module.ts -> src/modules/a/a.consts.ts",
    "api-modules-wiring-only-target: src/modules/a/a.module.ts -> src/modules/a/a.module.helpers.ts",
    "api-modules-wiring-only: src/modules/a/a.helper.ts -> src/application/a.service.ts",
    "api-modules-wiring-only: src/modules/b/b.module.helpers.ts -> src/application/a.service.ts",
  ]);
});
