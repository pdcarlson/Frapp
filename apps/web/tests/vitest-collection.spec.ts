import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readStaticStringArray,
  relativePosix,
  silentlySkippedSuites,
  SUITE_NAME,
  walkFiles,
} from "../../../scripts/ci/lib/vitest-suite-collection.mjs";

/**
 * Pins that every suite-shaped file under `apps/web` is one this workspace's
 * vitest config actually collects, or one its `exclude` deliberately drops.
 *
 * WHY THIS EXISTS. #1711 narrowed `include` to `*.spec.*`. A `*.test.tsx` is
 * not collected, not reported, and not an error. Merging #1748 onto that
 * include dropped four files / seventeen tests with a green suite.
 *
 * OUT OF SCOPE ON PURPOSE. `scripts/ci/__tests__/*.test.mjs` MUST stay
 * `.test` — Node's built-in runner has no `.spec` pattern, and renaming that
 * directory to the repo convention would silently disable every suite in it.
 * This spec only walks `apps/web`. The landing twin is
 * `apps/landing/vitest-collection.spec.ts`.
 *
 * Playwright specs under `tests/visual/` are suite-shaped and excluded by the
 * vitest config; that is intended. The guard reads `include` / `exclude` from
 * `vitest.config.ts` rather than restating those globs.
 */

// `vitest run` in this workspace uses the package directory as cwd.
const webRoot = process.cwd();
const configPath = "apps/web/vitest.config.ts";

describe("vitest collection", () => {
  const configSource = readFileSync(join(webRoot, "vitest.config.ts"), "utf8");
  const include = readStaticStringArray(configSource, "include", configPath);
  const exclude = readStaticStringArray(configSource, "exclude", configPath);

  it("follows the include/exclude literals in vitest.config.ts", () => {
    expect(include.length).toBeGreaterThan(0);
    expect(exclude.length).toBeGreaterThan(0);
  });

  it("names a .test.tsx survivor instead of staying green", () => {
    const skipped = silentlySkippedSuites(
      ["components/chat/composer.spec.tsx", "components/chat/composer.test.tsx"],
      include,
      exclude,
    );
    expect(skipped).toEqual(["components/chat/composer.test.tsx"]);
  });

  it("does not treat Playwright visual specs as silent skips", () => {
    const skipped = silentlySkippedSuites(
      ["tests/visual/pre-auth-floor.spec.ts", "tests/visual/responsive-floor.spec.ts"],
      include,
      exclude,
    );
    expect(skipped).toEqual([]);
  });

  it("every suite-shaped file is collected, or named in exclude", () => {
    const suites = walkFiles(webRoot)
      .map((abs: string) => relativePosix(webRoot, abs))
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
