import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Keeps the shared packages' barrels and `exports` maps from becoming merge
 * conflicts again (#4558 item 3).
 *
 * Every new export used to be appended last, to a barrel or to an `exports`
 * map, and the line above it changed too (its comma, or simply its position),
 * so any two PRs that each added one conflicted at the same spot. Now:
 *
 *   - A barrel holds re-exports only, sorted by module path, with each named
 *     list sorted too. A new module goes in its alphabetical place, so two PRs
 *     adding different modules touch different lines.
 *   - A package's `exports` map has one `"./*"` rule, so a new file needs no
 *     entry at all. An explicit entry stays only where it maps somewhere the
 *     wildcard doesn't (`@repo/chat-core/integrations` is a folder).
 *
 * Sort order is `localeCompare` in English: case-insensitive, `type` modifiers
 * ignored, so `type AnalyticsApp` sits beside `ANALYTICS_APPS`.
 */

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const BARRELS = ["packages/hooks/src/index.ts", "packages/validation/src/index.ts"];

const collator = (a, b) => a.localeCompare(b, "en");

/**
 * Splits a barrel into its statements, leaving out comments. Anything that
 * isn't `export … from "…";` is returned as `{ stray }`.
 */
export function barrelStatements(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const statements = [];
  const pattern = /export\s+(type\s+)?(\*|\{([^}]*)\})\s+from\s+"([^"]+)";/g;
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    const between = code.slice(last, match.index).trim();
    if (between) statements.push({ stray: between });
    last = match.index + match[0].length;
    const names =
      match[3] === undefined
        ? null
        : match[3]
            .split(",")
            .map((name) => name.trim().replace(/^type\s+/, ""))
            .filter(Boolean);
    statements.push({ specifier: match[4], names });
  }
  const tail = code.slice(last).trim();
  if (tail) statements.push({ stray: tail });
  return statements;
}

/** Every problem with one barrel's order, as sentences. */
export function barrelProblems(source) {
  const problems = [];
  const statements = barrelStatements(source);
  for (const statement of statements) {
    if (statement.stray !== undefined) {
      problems.push(
        `holds code that isn't a re-export: "${statement.stray.slice(0, 60)}". Move it into its own module and re-export that.`,
      );
    }
  }
  const specifiers = statements
    .filter((statement) => statement.specifier)
    .map((statement) => statement.specifier);
  for (let i = 1; i < specifiers.length; i++) {
    if (collator(specifiers[i - 1], specifiers[i]) > 0) {
      problems.push(`"${specifiers[i]}" comes after "${specifiers[i - 1]}"; sort the re-exports by module path.`);
    }
  }
  for (const statement of statements) {
    if (!statement.names) continue;
    for (let i = 1; i < statement.names.length; i++) {
      if (collator(statement.names[i - 1], statement.names[i]) > 0) {
        problems.push(
          `in the list from "${statement.specifier}", ${statement.names[i]} comes after ${statement.names[i - 1]}; sort the names.`,
        );
      }
    }
  }
  return problems;
}

/**
 * Entries a package's `"./*"` rule already covers, so they only reopen the
 * conflict. Only string entries and condition objects whose every value is
 * the wildcard's value with the name filled in count as covered.
 */
export function redundantExportEntries(exportsMap) {
  if (!exportsMap || typeof exportsMap !== "object") return [];
  const wildcard = exportsMap["./*"];
  if (wildcard === undefined) return [];
  const fill = (value, name) =>
    typeof value === "string"
      ? value.replaceAll("*", name)
      : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, name)]));
  return Object.entries(exportsMap)
    .filter(([key]) => key.startsWith("./") && key !== "./*")
    .filter(([key, value]) => JSON.stringify(fill(wildcard, key.slice(2))) === JSON.stringify(value))
    .map(([key]) => key);
}

for (const barrel of BARRELS) {
  test(`${barrel} holds sorted re-exports only`, () => {
    const problems = barrelProblems(readFileSync(join(repoRoot, barrel), "utf8"));
    assert.deepEqual(problems, [], `${barrel}:\n  ${problems.join("\n  ")}`);
  });
}

test("no package lists an export its wildcard already covers", () => {
  const found = [];
  for (const name of readdirSync(join(repoRoot, "packages"))) {
    const manifestPath = join(repoRoot, "packages", name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const key of redundantExportEntries(manifest.exports)) found.push(`packages/${name}: ${key}`);
  }
  assert.deepEqual(found, [], `delete these entries; "./*" resolves them:\n  ${found.join("\n  ")}`);
});

test("the wildcard packages keep their wildcard", () => {
  for (const name of ["hooks", "chat-core", "validation"]) {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "packages", name, "package.json"), "utf8"));
    assert.ok(manifest.exports?.["./*"], `packages/${name} lost its "./*" export rule`);
  }
});

test("barrelProblems catches what it is for", () => {
  assert.deepEqual(barrelProblems('export * from "./a";\nexport * from "./b";\n'), []);
  assert.equal(barrelProblems('export * from "./b";\nexport * from "./a";\n').length, 1);
  assert.equal(barrelProblems('export { b, a } from "./a";\n').length, 1);
  assert.deepEqual(barrelProblems('export { ANALYTICS_APPS, type AnalyticsApp, b } from "./a";\n'), []);
  assert.equal(barrelProblems('export const x = 1;\nexport * from "./a";\n').length, 1);
  // Comments, including a `from "…"` inside one, are not statements.
  assert.deepEqual(barrelProblems('// from "./z";\n/** x */\nexport * from "./a";\n'), []);
});

test("redundantExportEntries matches strings and condition objects", () => {
  assert.deepEqual(
    redundantExportEntries({ ".": "./src/index.ts", "./*": "./src/*.ts", "./a": "./src/a.ts", "./b": "./src/b/index.ts" }),
    ["./a"],
  );
  assert.deepEqual(
    redundantExportEntries({
      "./*": { import: "./src/*.ts", default: "./dist/*.js" },
      "./a": { import: "./src/a.ts", default: "./dist/a.js" },
    }),
    ["./a"],
  );
  assert.deepEqual(redundantExportEntries({ "./a": "./src/a.ts" }), []);
});
