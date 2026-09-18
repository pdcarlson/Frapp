import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Pins that every `jest` invocation in `apps/api/package.json` launches Node with
 * `--experimental-vm-modules`.
 *
 * WHY THIS IS A GUARD AND NOT A CONVENTION. `apps/api` is CommonJS and depends on
 * ESM-only packages (`@nestjs/schedule` 12 is `"type": "module"` with no CJS build).
 * Jest 30 can `require()` those natively, but only when `vm.SourceTextModule` exists —
 * which needs Node 24.9+ AND this flag. Without the flag `vm.SourceTextModule` is
 * `undefined`, `jest-runtime`'s `supportsSyncEvaluate` gate is false, and the suite dies
 * with `Must use import to load ES Module` on any Node, however new.
 *
 * The failure is per-script, which is what makes it worth a test: drop the prefix from
 * `test:e2e` alone and the unit suite stays green while E2E fails with an error that
 * names ESM and not the flag. Nobody greps package.json for a launch flag.
 *
 * WHY IT LIVES HERE, UNDER `node --test`, RATHER THAN IN A JEST SPEC. A check on Jest's
 * own launch flags must not depend on Jest launching. If the flag is dropped in a way
 * that breaks collection, a Jest-hosted guard goes down with everything else and reports
 * the same confusing ESM error; this one still runs and names the actual cause.
 *
 * TWO LEGAL SPELLINGS. `test:debug` already launches `node` directly
 * (`node --inspect-brk … node_modules/.bin/jest`), so it carries the flag as a bare node
 * flag rather than through `NODE_OPTIONS`. A naive `NODE_OPTIONS` grep reports a false
 * failure on it — accept either form.
 *
 * Docs: `docs/guides/testing.md` § 2a.
 */

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const FLAG = "--experimental-vm-modules";

/** Scripts that run `jest` as the command, rather than merely mentioning the word. */
function jestScripts() {
  const { scripts } = JSON.parse(
    readFileSync(join(repoRoot, "apps", "api", "package.json"), "utf8"),
  );

  return Object.entries(scripts).filter(([, command]) =>
    // `jest` as a bare token or as a path ending in `/jest` — catches both
    // `jest --coverage` and `node … node_modules/.bin/jest --runInBand`, without
    // matching a script that merely has "jest" inside a longer word.
    /(^|[\s/])jest(\s|$)/.test(command),
  );
}

test("every apps/api jest script launches Node with --experimental-vm-modules", () => {
  const scripts = jestScripts();

  // Fail closed: if the detector stops recognising anything, the assertion below
  // would pass vacuously and the guard would be silently dead.
  assert.ok(
    scripts.length > 0,
    "found no jest scripts in apps/api/package.json — the detector is broken, " +
      "not the scripts. Read the notes at the top of this file.",
  );

  const missing = scripts
    .filter(([, command]) => !command.includes(FLAG))
    .map(([name]) => name)
    .sort();

  assert.deepEqual(
    missing,
    [],
    `these apps/api scripts run jest without \`${FLAG}\`: ${missing.join(", ")}. ` +
      `They will fail with "Must use import to load ES Module" on any ESM-only ` +
      `dependency, on any Node version. Add the flag — via \`NODE_OPTIONS=${FLAG}\` ` +
      `for a bare \`jest\`, or as a direct node flag for a script that already ` +
      `launches node itself. See docs/guides/testing.md § 2a.`,
  );
});
