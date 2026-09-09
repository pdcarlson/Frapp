import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readStaticStringArray,
  relativePosix,
  silentlySkippedSuites,
  SUITE_NAME,
  walkFiles,
} from "../../scripts/ci/lib/vitest-suite-collection.mjs";

/**
 * Pins that every suite-shaped file under `apps/landing` is one this
 * workspace's vitest config actually collects, or one its `exclude`
 * deliberately drops.
 *
 * Twin of `apps/web/tests/vitest-collection.spec.ts` (#1788). Landing uses the
 * same narrowed `*.spec.*` include, so it has the same silent-skip hazard.
 *
 * OUT OF SCOPE ON PURPOSE. `scripts/ci/__tests__/*.test.mjs` MUST stay
 * `.test` — Node's built-in runner has no `.spec` pattern. This spec only
 * walks `apps/landing`.
 *
 * Reads `include` / `exclude` from `vitest.config.ts` rather than restating
 * those globs.
 */

// `vitest run` in this workspace uses the package directory as cwd.
const landingRoot = process.cwd();
const configPath = "apps/landing/vitest.config.ts";

describe("vitest collection", () => {
  const configSource = readFileSync(join(landingRoot, "vitest.config.ts"), "utf8");
  const include = readStaticStringArray(configSource, "include", configPath);
  const exclude = readStaticStringArray(configSource, "exclude", configPath);

  it("follows the include/exclude literals in vitest.config.ts", () => {
    expect(include.length).toBeGreaterThan(0);
    expect(exclude.length).toBeGreaterThan(0);
  });

  it("names a .test.tsx survivor instead of staying green", () => {
    const skipped = silentlySkippedSuites(
      ["lib/auth-urls.spec.ts", "lib/auth-urls.test.ts"],
      include,
      exclude,
    );
    expect(skipped).toEqual(["lib/auth-urls.test.ts"]);
  });

  it("every suite-shaped file is collected, or named in exclude", () => {
    const suites = walkFiles(landingRoot)
      .map((abs: string) => relativePosix(landingRoot, abs))
      .filter((file: string) => SUITE_NAME.test(file))
      .sort();

    expect(suites.length).toBeGreaterThan(0);

    const skipped = silentlySkippedSuites(suites, include, exclude);
    expect(
      skipped,
      `these files look like suites and \`vitest run\` never collects them: ${skipped.join(", ")}. ` +
        `Rename them to match ${include.join(", ")}, or add a genuine non-suite path to exclude in vitest.config.ts.`,
    ).toEqual([]);
  });
});
