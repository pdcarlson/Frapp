import { strict as assert } from "node:assert";
import test from "node:test";
import {
  matchesGlob,
  readStaticStringArray,
  silentlySkippedSuites,
} from "../lib/vitest-suite-collection.mjs";

test("silentlySkippedSuites names a .test survivor against the web include", () => {
  const include = ["**/*.spec.{ts,tsx}"];
  const exclude = ["**/node_modules/**", "**/dist/**", "tests/visual/**"];
  assert.deepEqual(
    silentlySkippedSuites(
      [
        "components/chat/composer.spec.tsx",
        "components/chat/composer.test.tsx",
        "tests/visual/pre-auth-floor.spec.ts",
      ],
      include,
      exclude,
    ),
    ["components/chat/composer.test.tsx"],
  );
});

test("readStaticStringArray follows the vitest.config literal, not a restated glob", () => {
  const source = `export default defineConfig({
  test: {
    include: ['**/*.spec.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/visual/**']
  },
})`;
  assert.deepEqual(readStaticStringArray(source, "include", "vitest.config.ts"), [
    "**/*.spec.{ts,tsx}",
  ]);
  assert.deepEqual(readStaticStringArray(source, "exclude", "vitest.config.ts"), [
    "**/node_modules/**",
    "**/dist/**",
    "tests/visual/**",
  ]);
});

test("readStaticStringArray fails closed when include is not a static array", () => {
  assert.throws(
    () => readStaticStringArray("export default {}", "include", "vitest.config.ts"),
    /static string array/,
  );
});

test("matchesGlob understands the include brace form", () => {
  assert.equal(matchesGlob("lib/foo.spec.ts", "**/*.spec.{ts,tsx}"), true);
  assert.equal(matchesGlob("lib/foo.spec.tsx", "**/*.spec.{ts,tsx}"), true);
  assert.equal(matchesGlob("lib/foo.test.ts", "**/*.spec.{ts,tsx}"), false);
});
