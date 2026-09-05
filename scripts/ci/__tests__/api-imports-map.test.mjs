import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Pins the condition ORDER in `apps/api`'s Node subpath imports map.
 *
 * Why this needs a gate at all: `default` is always active, so the map resolves
 * to source only because `types` (and `source`) are listed BEFORE it. Move
 * `default` up — or add the `require` key that is the natural thing to reach for
 * when debugging Node resolution — and three things go wrong at once, none of
 * them loudly:
 *
 *   - `tsc --noEmit -p tsconfig.build.json` type-checks the 700-odd `#domain/*`
 *     imports against `apps/api/dist/**` instead of `src/`, so it passes against
 *     whatever the last build emitted rather than the code in the diff.
 *   - dependency-cruiser resolves the same edges into `dist/`, which
 *     `scripts/dependency-cruiser.cjs` excludes as NOT_SOURCE — the domain layer
 *     drops out of the graph entirely, so `api-domain-is-innermost` and its
 *     siblings stop firing while the run still reports the known grandfathered
 *     violations and exits 0.
 *   - `not-to-unresolvable` stays quiet throughout, because the imports really
 *     did resolve. Every signal reads healthy.
 *
 * So the failure mode is a silently hollow required check, which is exactly the
 * kind a cheap assertion is for.
 */

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const manifest = JSON.parse(
  readFileSync(join(repoRoot, "apps", "api", "package.json"), "utf8"),
);

const SOURCE_CONDITIONS = ["types", "source"];

test("every #-subpath resolves to source before it resolves to dist", () => {
  const entries = Object.entries(manifest.imports ?? {});
  assert.ok(entries.length > 0, "apps/api declares no `imports` map");

  for (const [specifier, target] of entries) {
    // A bare string target is the shape someone reaches for when "simplifying"
    // the map, and it is the hazard in its purest form: one target, used by
    // every consumer, with no way to send tsc to source and Node to dist. It is
    // only safe if it points at source.
    if (typeof target === "string") {
      assert.ok(
        !target.includes("dist/"),
        `${specifier}: bare string target "${target}" points into dist/, so tsc and ` +
          "dependency-cruiser would read compiled output. Use a conditions object.",
      );
      continue;
    }

    const conditions = Object.keys(target);

    // A conditions object carrying only `default` has the same effect as the
    // bare string above — every consumer gets one answer — so require that at
    // least one source-resolving condition exists to be ordered ahead of it.
    assert.ok(
      SOURCE_CONDITIONS.some((c) => conditions.includes(c)),
      `${specifier}: declares none of ${SOURCE_CONDITIONS.join("/")}, so every ` +
        `consumer resolves through "${conditions.join("/")}" — source-based tools included.`,
    );

    const defaultAt = conditions.indexOf("default");
    if (defaultAt === -1) continue;

    for (const condition of SOURCE_CONDITIONS) {
      const at = conditions.indexOf(condition);
      if (at === -1) continue;
      assert.ok(
        at < defaultAt,
        `${specifier}: "${condition}" must precede "default" (got ${conditions.join(" -> ")}). ` +
          "With `default` first, tsc and dependency-cruiser both resolve into dist/.",
      );
    }
  }
});

test("no condition ahead of the source ones points into dist", () => {
  for (const [specifier, target] of Object.entries(manifest.imports ?? {})) {
    if (typeof target === "string") continue;

    const conditions = Object.keys(target);
    const firstSource = conditions.findIndex((c) =>
      SOURCE_CONDITIONS.includes(c),
    );
    if (firstSource === -1) continue;

    for (const condition of conditions.slice(0, firstSource)) {
      const value = target[condition];
      assert.ok(
        typeof value !== "string" || !value.includes("dist/"),
        `${specifier}: "${condition}" resolves into dist/ and is matched before ` +
          `"${conditions[firstSource]}", so source-based tools would read compiled output.`,
      );
    }
  }
});

test("#test/* never claims a runtime target it cannot satisfy", () => {
  // `apps/api/test/` is not copied into the image and Node cannot load .ts, so a
  // `default` here would let a src/ file import a fixture, type-check green,
  // build green, and die at first require() in the container. `null` makes Node
  // throw ERR_PACKAGE_IMPORT_NOT_DEFINED at resolve time instead.
  const target = manifest.imports?.["#test/*"];
  if (!target) return;
  assert.notEqual(
    typeof target,
    "string",
    "#test/* must be a conditions object with `default: null`, not a bare string — " +
      "a string target is a runtime promise this alias cannot keep.",
  );
  assert.equal(
    target.default,
    null,
    "#test/* must declare `default: null` — test helpers do not ship.",
  );
});
