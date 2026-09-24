import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_CONFIG_KEYS,
  appConfigKeysFor,
  formatEnvBaseline,
  infisicalBuildEnv,
  parseEnvBaseline,
  withoutEnvKeys,
} from "../lib/vercel-build-env.mjs";

// Pins `lib/vercel-build-env.mjs` (#2672). The first describe is the one that
// matters over time: once the staging syncs are deleted, a key missing from
// `APP_CONFIG_KEYS` never reaches a staging build, and nothing else would say so.
// The build would go green on the app's fallback (localhost, or the feature off),
// so the table is derived from the apps' own `process.env` reads here instead of
// being trusted.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// ── Reading what an app reads ───────────────────────────────────────────────

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".vercel",
  ".turbo",
  "dist",
  "build",
  "coverage",
  "__tests__",
  "__mocks__",
  "tests",
  "e2e",
]);
// Test and tooling files run under Vitest or Playwright, never in a deployed
// build: `playwright.config.ts` reads `CI` and `PLAYWRIGHT_BASE_URL`.
const SKIP_FILE = /(\.test\.|\.spec\.|\.stories\.|\.d\.ts$|^playwright\.config\.|^vitest\.config\.)/;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...sourceFiles(join(dir, entry.name)));
    } else if (SOURCE_EXT.test(entry.name) && !SKIP_FILE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Lines that are code: JSDoc bodies and whole-line comments dropped. */
function codeLines(text) {
  return text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

/** Workspace package name → directory, for following an app's `@repo/*` deps. */
function workspacePackages() {
  const map = new Map();
  for (const name of readdirSync(join(REPO, "packages"))) {
    const manifest = join(REPO, "packages", name, "package.json");
    try {
      map.set(JSON.parse(readFileSync(manifest, "utf8")).name, join(REPO, "packages", name));
    } catch {
      // Not a package directory.
    }
  }
  return map;
}

const runtimeDeps = (dir) =>
  Object.keys(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies ?? {});

/**
 * The directories whose source an app's bundle can contain: the app, and every
 * workspace package it reaches through runtime `dependencies`, transitively.
 * Direct deps alone are not enough: landing gets `@repo/color` only through
 * `@repo/theme`, and a read there would be checked against web's list and not
 * landing's.
 */
function bundledRoots(appDir) {
  const packages = workspacePackages();
  const roots = [join(REPO, appDir)];
  const seen = new Set();
  for (let i = 0; i < roots.length; i += 1) {
    for (const dep of runtimeDeps(roots[i])) {
      if (!packages.has(dep) || seen.has(dep)) continue;
      seen.add(dep);
      roots.push(packages.get(dep));
    }
  }
  return roots;
}

/**
 * Every `process.env.NAME` an app's deployed code can read: the app's own
 * source plus each workspace package it reaches at runtime, since a package
 * read is compiled into the app that imports it. Returns name → files.
 *
 * Memoized per app: three tests read the same scan.
 */
const scans = new Map();
function envReadsOf(appDir) {
  if (!scans.has(appDir)) scans.set(appDir, scanEnvReads(bundledRoots(appDir)));
  return scans.get(appDir);
}

function scanEnvReads(roots) {
  const reads = new Map();
  const dynamic = [];
  let scanned = 0;
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      scanned += 1;
      const rel = relative(REPO, file);
      for (const line of codeLines(readFileSync(file, "utf8"))) {
        for (const [, name] of line.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
          // `process.env.NEXT_PUBLIC_*` in prose is a prefix, not a read.
          if (name.endsWith("_")) continue;
          if (!reads.has(name)) reads.set(name, new Set());
          reads.get(name).add(rel);
        }
        if (/process\.env(?![.\w])/.test(line)) dynamic.push(`${rel}: ${line.trim()}`);
      }
    }
  }
  return { reads, dynamic, scanned, roots: roots.map((root) => relative(REPO, root)) };
}

/**
 * Names the apps read that no secret store supplies, and why. A name here that
 * later needs a real value belongs in `APP_CONFIG_KEYS` instead.
 */
const NOT_FROM_THE_STORE = new Map([
  ["VERCEL_ENV", "a Vercel system variable; `vercel pull` writes it into the pulled env"],
  ["VERCEL_GIT_COMMIT_SHA", "injected from DEPLOY_SHA by `vercelCliEnv`"],
  ["NEXT_PUBLIC_SENTRY_ENVIRONMENT", "derived in next.config.js `env`; ENV_REFERENCE says never set it"],
  ["NEXT_PUBLIC_SENTRY_RELEASE", "derived in next.config.js `env`; ENV_REFERENCE says never set it"],
  ["SUPABASE_AUTH_BYPASS", "a CI-only Playwright flag, ignored under NODE_ENV=production"],
  ["NODE_ENV", "set by Next itself"],
]);

/**
 * Non-public keys a build may receive, each read only at build time by
 * `next.config.js`. The lib header's runtime claim (a deployment's runtime env
 * needs nothing from Infisical) rests on this list staying build-only.
 */
const BUILD_ONLY_KEYS = new Set(["SENTRY_AUTH_TOKEN"]);

describe("APP_CONFIG_KEYS matches what each app reads", () => {
  for (const [label, entry] of Object.entries(APP_CONFIG_KEYS)) {
    it(`${label} (${entry.appDir}): reads no fewer and no more than the table`, () => {
      const { reads, scanned } = envReadsOf(entry.appDir);

      // The negative control: an empty scan would make both lists below empty
      // and this assertion vacuous.
      assert.ok(scanned > 10, `scanned only ${scanned} files under ${entry.appDir}`);
      assert.ok(reads.size >= 5, `found only ${reads.size} env reads under ${entry.appDir}`);

      const fromStore = [...reads.keys()].filter((name) => !NOT_FROM_THE_STORE.has(name)).sort();
      const table = [...appConfigKeysFor(label)].sort();

      const unlisted = fromStore.filter((name) => !table.includes(name));
      assert.deepEqual(
        unlisted,
        [],
        `${label} reads ${unlisted.join(", ")} (${unlisted
          .map((n) => [...reads.get(n)].join(" "))
          .join("; ")}) but APP_CONFIG_KEYS does not list it. A staging build would never ` +
          `receive it. Add it (required or optional), or to NOT_FROM_THE_STORE here with the reason.`,
      );
      const stale = table.filter((name) => !fromStore.includes(name));
      assert.deepEqual(
        stale,
        [],
        `APP_CONFIG_KEYS lists ${stale.join(", ")} for ${label}, which nothing in it reads. ` +
          `Remove it, so the build is handed only what the app uses.`,
      );
    });

    it(`${label}: scans every workspace package its bundle can contain`, () => {
      // Pinned with the one transitive case that exists today, so a return to
      // direct-deps-only fails here rather than by missing a future read.
      const { roots } = envReadsOf(entry.appDir);
      assert.ok(roots.includes("packages/theme"), `${label} should reach packages/theme`);
      assert.ok(roots.includes("packages/color"), `${label} reaches packages/color through @repo/theme`);
    });

    it(`${label}: reads env by name only, so every read is visible to this guard`, () => {
      // `process.env[name]` or a destructure is invisible here, and Next does
      // not inline a dynamic `NEXT_PUBLIC_*` read either, so it would be
      // undefined in the browser anyway.
      assert.deepEqual(envReadsOf(entry.appDir).dynamic, []);
    });

    it(`${label}: every non-public key it receives is read only by next.config.js`, () => {
      const { reads } = envReadsOf(entry.appDir);
      for (const key of appConfigKeysFor(label)) {
        if (key.startsWith("NEXT_PUBLIC_")) continue;
        assert.ok(
          BUILD_ONLY_KEYS.has(key),
          `${key} is a non-public key in ${label}'s build env. Either it is build-only (add it to ` +
            `BUILD_ONLY_KEYS after checking) or the app now needs it at request time, which the ` +
            `staging path does not supply.`,
        );
        const readers = [...(reads.get(key) ?? [])];
        assert.ok(
          readers.length > 0 && readers.every((file) => file.endsWith("next.config.js")),
          `${key} is read by ${readers.join(", ")}, not only next.config.js; a request-time read ` +
            `would get nothing from the staging deployment's runtime env.`,
        );
      }
    });
  }
});

describe("APP_CONFIG_KEYS shape", () => {
  it("lists each key once per project, required ones included in the set", () => {
    for (const [label, entry] of Object.entries(APP_CONFIG_KEYS)) {
      const keys = appConfigKeysFor(label);
      assert.equal(new Set(keys).size, keys.length, `${label} lists a key twice`);
      assert.ok(entry.required.length > 0, `${label} has no required key, so nothing fails closed`);
    }
  });

  it("never asks the store for a name it must not hold", () => {
    for (const label of Object.keys(APP_CONFIG_KEYS)) {
      for (const key of appConfigKeysFor(label)) {
        assert.ok(!NOT_FROM_THE_STORE.has(key), `${label} lists ${key}: ${NOT_FROM_THE_STORE.get(key)}`);
        assert.ok(!key.startsWith("VERCEL_"), `${label} lists ${key}, which Vercel's namespace owns`);
      }
    }
  });

  it("refuses an unknown project rather than building it with no config", () => {
    assert.throws(() => appConfigKeysFor("frapp-docs"), /No app config keys recorded/);
  });
});

// ── The baseline ────────────────────────────────────────────────────────────

describe("env baseline", () => {
  it("round-trips names, sorted, and carries no values", () => {
    const text = formatEnvBaseline({ PATH: "/usr/bin", HOME: "/h", SECRET: "v4lue" });
    assert.equal(text, '["HOME","PATH","SECRET"]\n');
    assert.deepEqual([...parseEnvBaseline(text)], ["HOME", "PATH", "SECRET"]);
  });

  it("refuses text that is not a JSON array of names", () => {
    assert.throws(() => parseEnvBaseline("PATH\nHOME\n"), /not JSON/);
    assert.throws(() => parseEnvBaseline('{"PATH":1}'), /JSON array/);
    assert.throws(() => parseEnvBaseline('["PATH", 3]'), /JSON array/);
  });

  it("refuses a baseline with no PATH, which no job step has", () => {
    // Trusting it would strip every CLI process down to nothing.
    assert.throws(() => parseEnvBaseline('["HOME"]'), /no PATH/);
  });

  it("record-env-baseline.mjs writes names only, readable by parseEnvBaseline", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-baseline-"));
    try {
      const file = join(dir, "names.json");
      const result = spawnSync(process.execPath, [join(REPO, "scripts/ci/record-env-baseline.mjs")], {
        env: { PATH: process.env.PATH, VERCEL_BUILD_ENV_BASELINE: file, SOME_SECRET: "do-not-record-me" },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      const text = readFileSync(file, "utf8");
      assert.ok(!text.includes("do-not-record-me"), "a value reached the baseline");
      assert.ok(!result.stdout.includes("do-not-record-me"), "a value reached the log");
      const names = parseEnvBaseline(text);
      assert.ok(names.has("SOME_SECRET") && names.has("VERCEL_BUILD_ENV_BASELINE"));
      assert.ok(statSync(file).size < 4096);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("record-env-baseline.mjs fails without somewhere to write", () => {
    const result = spawnSync(process.execPath, [join(REPO, "scripts/ci/record-env-baseline.mjs")], {
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /VERCEL_BUILD_ENV_BASELINE/);
  });
});

// ── One project's build env ─────────────────────────────────────────────────

describe("infisicalBuildEnv", () => {
  const baselineNames = new Set(["PATH", "HOME", "CI", "VERCEL_TEAM_ID"]);
  // The job env after the Infisical injection: the runner's names, the whole
  // staging store, and the deploy step's own variables.
  const env = {
    PATH: "/usr/bin",
    HOME: "/home/runner",
    CI: "true",
    VERCEL_TEAM_ID: "team_x",
    VERCEL_API_KEY: "step-level",
    NEXT_PUBLIC_API_URL: "https://api-staging.example",
    NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_APP_URL: "https://app.staging.example",
    NEXT_PUBLIC_POSTHOG_KEY: "",
    SENTRY_AUTH_TOKEN: "sntrys_x",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    STRIPE_SECRET_KEY: "sk_test_x",
    RENDER_DEPLOY_HOOK_URL: "https://hook",
  };

  it("hands the build only its app's keys, and every step only the baseline", () => {
    const web = infisicalBuildEnv({ label: "frapp-web", env, baselineNames });
    assert.deepEqual(web.baseEnv, { PATH: "/usr/bin", HOME: "/home/runner", CI: "true", VERCEL_TEAM_ID: "team_x" });
    assert.deepEqual(Object.keys(web.appEnv).sort(), [
      "NEXT_PUBLIC_API_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SENTRY_AUTH_TOKEN",
    ]);
    assert.deepEqual(web.appKeys, appConfigKeysFor("frapp-web"));

    const landing = infisicalBuildEnv({ label: "frapp-landing", env, baselineNames });
    assert.deepEqual(Object.keys(landing.appEnv).sort(), ["NEXT_PUBLIC_APP_URL", "SENTRY_AUTH_TOKEN"]);
  });

  it("carries no backend secret and no step-level credential anywhere", () => {
    for (const label of Object.keys(APP_CONFIG_KEYS)) {
      const { baseEnv, appEnv } = infisicalBuildEnv({ label, env, baselineNames });
      const everything = JSON.stringify({ baseEnv, appEnv });
      for (const value of ["service-role", "sk_test_x", "https://hook", "step-level"]) {
        assert.ok(!everything.includes(value), `${label}'s build env carries ${value}`);
      }
    }
  });

  it("treats an empty value as absent, so the key is simply unset for the build", () => {
    // Infisical exports an empty secret as an empty variable. Passing "" would
    // inline "" where the app expects undefined, and dotenv@4 in the CLI lets
    // a pulled row replace an empty value anyway.
    const web = infisicalBuildEnv({ label: "frapp-web", env, baselineNames });
    assert.ok(!("NEXT_PUBLIC_POSTHOG_KEY" in web.appEnv));
    assert.ok(web.appKeys.includes("NEXT_PUBLIC_POSTHOG_KEY"), "still removed from the pulled env");
  });

  it("fails, naming keys and never values, when a required key has no value", () => {
    const withoutApi = { ...env, NEXT_PUBLIC_API_URL: "" };
    assert.throws(
      () => infisicalBuildEnv({ label: "frapp-web", env: withoutApi, baselineNames }),
      (error) => {
        assert.match(error.message, /\[frapp-web\].*no value for NEXT_PUBLIC_API_URL\b/);
        assert.ok(!error.message.includes("ref.supabase.co"));
        return true;
      },
    );
  });

  it("refuses a baseline that already holds an app key", () => {
    // Recorded after the injection, it would hold the whole store and pass it
    // all to every CLI process.
    const late = new Set([...baselineNames, "NEXT_PUBLIC_APP_URL", "STRIPE_SECRET_KEY"]);
    assert.throws(
      () => infisicalBuildEnv({ label: "frapp-landing", env, baselineNames: late }),
      /baseline already holds NEXT_PUBLIC_APP_URL.*recorded after the Infisical injection/s,
    );
  });

  it("refuses an unknown project", () => {
    assert.throws(() => infisicalBuildEnv({ label: "frapp-docs", env, baselineNames }), /No app config keys/);
  });
});

describe("withoutEnvKeys", () => {
  it("removes exactly the named keys and reports them in file order", () => {
    const text = [
      "# Created by Vercel CLI",
      'NEXT_PUBLIC_APP_URL="https://stale"',
      'NEXT_PUBLIC_APP_URL_OLD="other key"',
      "  SENTRY_AUTH_TOKEN = spaced",
      'VERCEL_ENV="preview"',
      "",
    ].join("\n");
    const { text: kept, removed } = withoutEnvKeys(text, ["SENTRY_AUTH_TOKEN", "NEXT_PUBLIC_APP_URL"]);
    assert.deepEqual(removed, ["NEXT_PUBLIC_APP_URL", "SENTRY_AUTH_TOKEN"]);
    assert.equal(
      kept,
      ["# Created by Vercel CLI", 'NEXT_PUBLIC_APP_URL_OLD="other key"', 'VERCEL_ENV="preview"', ""].join("\n"),
    );
  });

  it("returns the text unchanged when none of the keys is present", () => {
    const text = 'VERCEL_ENV="preview"\n';
    assert.deepEqual(withoutEnvKeys(text, ["NEXT_PUBLIC_API_URL"]), { text, removed: [] });
  });
});
