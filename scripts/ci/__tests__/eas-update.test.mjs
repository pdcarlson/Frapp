// The OTA publish guard (`npm run eas -- update`, scripts/eas-update.mjs, #3472).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  APP_JSON,
  EAS_JSON,
  LOCKFILE,
  SHIPPED_BUILDS,
  UPDATE_GIT_SHA_ENV,
  UPDATE_PROFILE_ENV,
  isNativePackage,
  nativePackageChanges,
  parsePulledEnv,
  packageNameFromLockPath,
  parseUpdateArgs,
  prepareUpdate,
  productionChecks,
  profileForChannel,
  staleInstall,
  updateEnv,
  uploadSourceMaps,
} from "../../eas-update.mjs";
import { main, pullEasEnv } from "../../eas.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const realEasJson = JSON.parse(readFileSync(join(REPO, EAS_JSON), "utf8"));

const EAS = {
  build: {
    development: { channel: "development", environment: "development", env: { EXPO_PUBLIC_API_URL: "http://localhost:3001" } },
    preview: { channel: "preview", environment: "preview", env: { EXPO_PUBLIC_API_URL: "https://api-staging.frapp.live", EXPO_PUBLIC_SENTRY_ENVIRONMENT: "staging" } },
    production: { channel: "production", environment: "production", env: { EXPO_PUBLIC_API_URL: "https://api.frapp.live", EXPO_PUBLIC_SENTRY_ENVIRONMENT: "production" } },
  },
};
const SHA = "a".repeat(40);
const BUILD_SHA = "b".repeat(40);
const REGISTRY = JSON.stringify({
  builds: [{ platform: "android", version: "0.9.1", build: "3", sha: BUILD_SHA, recorded: "2026-11-06" }],
});
const PULLED = { EXPO_PUBLIC_SUPABASE_URL: "https://prod.supabase.co", EXPO_PUBLIC_SENTRY_DSN: "https://x@o0.ingest.sentry.io/0" };
const pullEnv = () => ({ vars: PULLED });

/**
 * A git double: `answers` maps a joined command, or a prefix of one, to a result; the longest
 * matching prefix wins, and anything else succeeds empty.
 */
function fakeGit(answers = {}) {
  const calls = [];
  const ordered = Object.entries(answers).sort(([a], [b]) => b.length - a.length);
  const git = (args) => {
    const key = args.join(" ");
    calls.push(key);
    for (const [prefix, result] of ordered) {
      if (key.startsWith(prefix)) return { status: 0, stdout: "", stderr: "", ...result };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { git, calls };
}

const files = (over = {}) => (p) => {
  const all = {
    [EAS_JSON]: JSON.stringify(EAS),
    [APP_JSON]: JSON.stringify({ expo: { version: "0.9.1" } }),
    [LOCKFILE]: JSON.stringify(lock({ "expo-haptics": "57.0.3", react: "19.2.3" })),
    "node_modules/.package-lock.json": JSON.stringify(lock({ "expo-haptics": "57.0.3", react: "19.2.3" })),
    ...over,
  };
  if (!(p in all)) throw new Error(`unexpected read ${p}`);
  return all[p];
};

function lock(versions) {
  return { packages: Object.fromEntries(Object.entries(versions).map(([n, v]) => [`node_modules/${n}`, { version: v }])) };
}

const NATIVE = new Set(["expo-haptics", "@sentry/react-native"]);
const isNative = (key) => NATIVE.has(packageNameFromLockPath(key));

// ── Arguments ───────────────────────────────────────────────────────────────

test("reads --channel and --environment in both spellings, and spots refused flags", () => {
  assert.deepEqual(parseUpdateArgs(["--channel", "production", "--environment=production", "--message", "x"]), {
    help: false,
    refused: [],
    channel: "production",
    environment: "production",
  });
  assert.equal(parseUpdateArgs(["--channel=preview"]).channel, "preview");
  assert.deepEqual(parseUpdateArgs(["--branch", "main", "--auto", "--skip-bundler", "--input-dir=out"]).refused, [
    "--branch",
    "--auto",
    "--skip-bundler",
    "--input-dir",
  ]);
  assert.equal(parseUpdateArgs(["--help"]).help, true);
});

test("maps a channel to exactly one build profile, and names the choices otherwise", () => {
  assert.equal(profileForChannel(EAS, "production").name, "production");
  assert.match(profileForChannel(EAS, "staging").error, /Channels: development, preview, production/);
  const twice = { build: { a: { channel: "x", environment: "e" }, b: { channel: "x", environment: "e" } } };
  assert.match(profileForChannel(twice, "x").error, /exactly one/);
  assert.match(profileForChannel({ build: { a: { channel: "x" } } }, "x").error, /no "environment"/);
});

test("the real eas.json gives every channel one profile, bound to the environment of the same name", () => {
  for (const channel of ["development", "preview", "production"]) {
    const { name, profile, error } = profileForChannel(realEasJson, channel);
    assert.equal(error, undefined);
    assert.equal(name, channel);
    assert.equal(profile.environment, channel);
  }
  // The two values `eas update` would otherwise miss (#2511).
  assert.equal(realEasJson.build.production.env.EXPO_PUBLIC_API_URL, "https://api.frapp.live");
  assert.equal(realEasJson.build.production.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT, "production");
});

// ── Env ─────────────────────────────────────────────────────────────────────

test("drops inherited EXPO_PUBLIC_* and EAS_BUILD_*, then adds the profile's env and the update markers", () => {
  const { env, stripped } = updateEnv(
    {
      PATH: "/bin",
      EXPO_PUBLIC_API_URL: "http://localhost:3001",
      EXPO_PUBLIC_ASK_ENABLED: "1",
      EAS_BUILD_PROFILE: "preview",
      [UPDATE_GIT_SHA_ENV]: "stale",
    },
    { profileName: "production", profile: EAS.build.production, gitSha: SHA },
  );
  assert.deepEqual(stripped.sort(), ["EAS_BUILD_PROFILE", "EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_ASK_ENABLED"]);
  assert.deepEqual(env, {
    PATH: "/bin",
    EXPO_PUBLIC_API_URL: "https://api.frapp.live",
    EXPO_PUBLIC_SENTRY_ENVIRONMENT: "production",
    [UPDATE_PROFILE_ENV]: "production",
    [UPDATE_GIT_SHA_ENV]: SHA,
  });
  assert.equal(updateEnv({ [UPDATE_GIT_SHA_ENV]: "stale" }, { profileName: "preview", profile: EAS.build.preview }).env[UPDATE_GIT_SHA_ENV], undefined);
});

// ── prepareUpdate ───────────────────────────────────────────────────────────

const noProduction = () => assert.fail("production checks must not run");

test("refuses a run with no channel, a refused flag, or an environment that doesn't match", () => {
  const opts = { readFile: files(), git: fakeGit().git, production: noProduction, env: {}, pullEnv };
  assert.match(prepareUpdate(["--message", "x"], opts).errors[0], /Name the channel/);
  const refused = prepareUpdate(["--channel", "preview", "--branch", "main"], opts);
  assert.equal(refused.ok, false);
  assert.match(refused.errors[0], /--branch is refused/);
  const mismatch = prepareUpdate(["--channel", "preview", "--environment", "production"], opts);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.errors[0], /uses the preview environment/);
  assert.equal(prepareUpdate(["--channel", "staging"], opts).ok, false);
});

test("adds the channel's environment, and skips the store-build checks off production", () => {
  const { git } = fakeGit({ "rev-parse HEAD": { stdout: `${SHA}\n` } });
  const r = prepareUpdate(["--channel", "preview", "--message", "x"], {
    readFile: files(),
    git,
    production: noProduction,
    env: {},
    pullEnv: (environment) => (assert.equal(environment, "preview"), { vars: { EXPO_PUBLIC_SUPABASE_URL: "https://staging.supabase.co" } }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, ["--channel", "preview", "--message", "x", "--environment", "preview"]);
  assert.equal(r.env.EXPO_PUBLIC_API_URL, "https://api-staging.frapp.live");
  assert.equal(r.env[UPDATE_PROFILE_ENV], "preview");
  assert.equal(r.env[UPDATE_GIT_SHA_ENV], SHA);
  assert.equal(r.env.EXPO_PUBLIC_SUPABASE_URL, "https://staging.supabase.co", "the EAS environment's values reach every evaluation");
  assert.equal(r.profileName, "preview");
  assert.ok(r.notes.some((n) => /native-compatibility check is skipped/.test(n)));
});

test("production runs the store-build checks, and any error refuses the publish", () => {
  const opts = { readFile: files(), git: fakeGit().git, env: {}, pullEnv };
  const refused = prepareUpdate(["--channel", "production"], { ...opts, production: () => ({ errors: ["nope"], notes: [] }) });
  assert.deepEqual(refused, { ok: false, errors: ["nope"] });
  const ok = prepareUpdate(["--channel", "production", "--environment", "production"], {
    ...opts,
    production: () => ({ errors: [], notes: ["Reaches x"] }),
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.args, ["--channel", "production", "--environment", "production"], "an explicit match isn't repeated");
  assert.equal(ok.env.EXPO_PUBLIC_API_URL, "https://api.frapp.live");
  assert.equal(ok.env.EXPO_PUBLIC_SENTRY_DSN, PULLED.EXPO_PUBLIC_SENTRY_DSN);
  assert.ok(ok.notes.includes("Reaches x"));
});

test("an EAS environment that can't be read refuses the publish", () => {
  const r = prepareUpdate(["--channel", "preview"], {
    readFile: files(),
    git: fakeGit().git,
    production: noProduction,
    env: {},
    pullEnv: () => ({ error: "not logged in" }),
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /preview EAS environment's variables: not logged in/);
});

test("EAS variables win over eas.json's env, as they do in eas-cli's export", () => {
  const { env } = updateEnv({}, {
    profileName: "production",
    profile: EAS.build.production,
    easVars: { EXPO_PUBLIC_API_URL: "https://elsewhere.example" },
  });
  assert.equal(env.EXPO_PUBLIC_API_URL, "https://elsewhere.example", "so app.config.js's fence sees the value the bundle gets");
});

test("reads only EXPO_PUBLIC_* lines from the file eas env:pull writes", () => {
  const text = [
    "# Environment: production",
    "",
    "EXPO_PUBLIC_SUPABASE_URL=https://x.supabase.co",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_a=b",
    "# SENTRY_AUTH_TOKEN=***** (secret)",
    "GOOGLE_SERVICES_JSON=/p/.eas/.env/GOOGLE_SERVICES_JSON",
  ].join("\n");
  assert.deepEqual(parsePulledEnv(text), {
    EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_a=b",
  });
});

test("refuses an eas.json whose profiles use extends, which the lookup can't resolve", () => {
  const withExtends = { build: { ...EAS.build, beta: { extends: "preview", channel: "beta" } } };
  assert.match(profileForChannel(withExtends, "production").error, /beta use "extends"/);
});

test("--help publishes nothing and passes straight through", () => {
  const r = prepareUpdate(["--help"], { readFile: () => assert.fail("no reads"), git: () => assert.fail("no git") });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, ["--help"]);
});

// ── Native compatibility ────────────────────────────────────────────────────

test("names native packages whose versions moved or appeared, and ignores JS-only and removed ones", () => {
  const build = lock({ "@sentry/react-native": "8.28.0", react: "19.2.2", "expo-old": "1.0.0" });
  const head = lock({ "@sentry/react-native": "8.33.0", react: "19.2.3", "expo-haptics": "57.0.3" });
  assert.deepEqual(nativePackageChanges(build, head, isNative), [
    "@sentry/react-native 8.28.0 -> 8.33.0",
    "expo-haptics none -> 57.0.3",
  ]);
  assert.deepEqual(nativePackageChanges(head, head, isNative), []);
  // A hoisting change that keeps the version is no change.
  const nested = { packages: { "apps/mobile/node_modules/expo-haptics": { version: "57.0.3" } } };
  assert.deepEqual(nativePackageChanges(nested, lock({ "expo-haptics": "57.0.3" }), isNative), []);
  assert.equal(packageNameFromLockPath("node_modules/a/node_modules/@s/b"), "@s/b");
});

test("an install that disagrees with the lockfile can't be trusted for the native check", () => {
  assert.deepEqual(staleInstall(lock({ a: "1" }), lock({ a: "1" })), []);
  assert.match(staleInstall(lock({ a: "2" }), lock({ a: "1" }))[0], /node_modules\/a 1 \(lockfile: 2\)/);
  assert.match(staleInstall(lock({}), undefined)[0], /missing/);
});

function checks({ answers = {}, over = {}, native = isNative } = {}) {
  const { git, calls } = fakeGit({
    [`show ${BUILD_SHA}:${LOCKFILE}`]: { stdout: JSON.stringify(lock({ "expo-haptics": "57.0.3", react: "19.2.2" })) },
    [`show origin/main:${SHIPPED_BUILDS}`]: { stdout: REGISTRY },
    "tag --list v*": { stdout: "v0.9.1\nv0.9.0\n" },
    "rev-parse": { stdout: `${SHA}\n` },
    ...answers,
  });
  return { result: productionChecks({ git, readFile: files(over), isNative: native }), calls };
}

test("a clean tree on main, with native inputs matching every build of the runtime, passes", () => {
  const { result, calls } = checks();
  assert.deepEqual(result.errors, []);
  assert.match(result.notes[0], /Reaches android 0\.9\.1 build 3/);
  assert.ok(calls.includes("fetch --quiet --tags origin main"));
  assert.ok(calls.includes("rev-parse v0.9.1^{commit}"), "compares HEAD with the latest release tag");
});

test("refuses a dirty tree and any HEAD but the commit production serves", () => {
  const { result } = checks({
    answers: {
      "status --porcelain": { stdout: " M apps/mobile/app.json\n" },
      "rev-parse HEAD": { stdout: `${"c".repeat(40)}\n` },
    },
  });
  assert.match(result.errors[0], /uncommitted changes/);
  assert.match(result.errors[1], /HEAD isn't v0\.9\.1, the commit production serves/);
});

test("refuses when the latest v* tag isn't a release, or tags can't be fetched", () => {
  assert.match(checks({ answers: { "tag --list v*": { stdout: "v1.0.0-rc1\nv0.9.1\n" } } }).result.errors[0], /not a vX\.Y\.Z release/);
  const offline = checks({ answers: { "fetch --quiet --tags": { status: 1, stderr: "no network" } } }).result;
  assert.match(offline.errors[0], /can't tell what production serves: no network/);
});

test("reads the store-build records from origin/main and refuses a malformed file", () => {
  const { result } = checks({
    answers: { [`show origin/main:${SHIPPED_BUILDS}`]: { stdout: JSON.stringify({ builds: [{ platform: "android", version: "0.9.1" }] }) } },
  });
  assert.match(result.errors[0], /shipped-builds\.json is malformed/);
});

test("an unreadable lockfile is named as such, not as a stale install", () => {
  const { result } = checks({ over: { [LOCKFILE]: "<<<<<<< HEAD" } });
  assert.match(result.errors[0], /Couldn't read package-lock\.json/);
});

test("a changed app.config.js since the build counts as a native change", () => {
  const { result } = checks({ answers: { [`diff --quiet ${BUILD_SHA} HEAD -- apps/mobile/app.config.js`]: { status: 1 } } });
  assert.match(result.errors[0], /apps\/mobile\/app\.config\.js/);
});

test("isNativePackage spots Expo modules, Android projects and podspecs, and nothing else", () => {
  const root = mkdtempSync(join(tmpdir(), "frapp-native-"));
  try {
    const pkg = (name, files) => {
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      for (const f of files) {
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        writeFileSync(join(dir, f), "");
      }
      return dir;
    };
    assert.equal(isNativePackage(pkg("expo-mod", ["expo-module.config.json"])), true);
    assert.equal(isNativePackage(pkg("rn-android", ["android/build.gradle"])), true);
    assert.equal(isNativePackage(pkg("rn-kts", ["android/build.gradle.kts"])), true);
    assert.equal(isNativePackage(pkg("rn-ios", ["RNThing.podspec"])), true);
    assert.equal(isNativePackage(pkg("macros", ["apple/Macro.swift"])), true, "native tooling counts too");
    assert.equal(isNativePackage(pkg("js-only", ["index.js", "package.json"])), false);
    assert.equal(isNativePackage(join(root, "absent")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The ci-scripts-tests job installs nothing, so this mirrors the real packages' root layouts
// (read from node_modules on 2026-11-05) instead of reading node_modules.
test("isNativePackage recognises the root layouts of the app's real native modules", () => {
  const root = mkdtempSync(join(tmpdir(), "frapp-native-real-"));
  try {
    const layouts = {
      // Only podspecs at its root: no android/, ios/ or expo-module.config.json.
      "react-native": ["React.podspec", "React-Core.podspec", "third-party-podspecs/x.podspec", "index.js"],
      "expo-updates": ["expo-module.config.json", "android/build.gradle", "ios/EXUpdates.podspec"],
      "@sentry/react-native": ["RNSentry.podspec", "expo-module.config.json", "android/build.gradle", "ios/x.m"],
      "expo-haptics": ["expo-module.config.json", "android/build.gradle", "ios/x.swift"],
      "@tanstack/react-query": ["package.json", "build/modern/index.js", "src/index.ts"],
    };
    const native = {};
    for (const [name, files] of Object.entries(layouts)) {
      const dir = join(root, name);
      for (const f of files) {
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        writeFileSync(join(dir, f), "");
      }
      native[name] = isNativePackage(dir);
    }
    assert.deepEqual(native, {
      "react-native": true,
      "expo-updates": true,
      "@sentry/react-native": true,
      "expo-haptics": true,
      "@tanstack/react-query": false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses when no store build of the runtime is recorded", () => {
  const { result } = checks({ over: { [APP_JSON]: JSON.stringify({ expo: { version: "0.9.2" } }) } });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /No store build of version 0\.9\.2/);
});

test("refuses when native inputs changed since a recorded build, and says to bump the version", () => {
  const { result } = checks({
    answers: {
      [`diff --quiet ${BUILD_SHA} HEAD -- apps/mobile/app.json`]: { status: 1 },
      [`show ${BUILD_SHA}:${LOCKFILE}`]: { stdout: JSON.stringify(lock({ react: "19.2.3" })) },
    },
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /apps\/mobile\/app\.json/);
  assert.match(result.errors[0], /expo-haptics none -> 57\.0\.3/);
  assert.match(result.errors[0], /Bump expo\.version/);
});

test("refuses when node_modules doesn't match the lockfile", () => {
  const { result } = checks({ over: { "node_modules/.package-lock.json": JSON.stringify(lock({ "expo-haptics": "57.0.1" })) } });
  assert.match(result.errors[0], /Run `npm ci` first/);
});

test("fetches a build commit it doesn't have, and refuses when it still can't", () => {
  let fetched = false;
  const { git: base } = fakeGit({
    [`show origin/main:${SHIPPED_BUILDS}`]: { stdout: REGISTRY },
    "tag --list v*": { stdout: "v0.9.1\n" },
    "rev-parse": { stdout: `${SHA}\n` },
  });
  const git = (args) => {
    const key = args.join(" ");
    if (key === `fetch --quiet origin ${BUILD_SHA}`) fetched = true;
    if (key.startsWith(`cat-file -e ${BUILD_SHA}`)) return { status: 1, stdout: "", stderr: "" };
    return base(args);
  };
  const result = productionChecks({ git, readFile: files(), isNative });
  assert.ok(fetched);
  assert.match(result.errors[0], /isn't available locally or from origin/);
});

// ── Source maps ─────────────────────────────────────────────────────────────

test("uploads source maps without the update marker, so the uploader's config read runs no fences", () => {
  const calls = [];
  const logs = [];
  uploadSourceMaps({
    env: { SENTRY_AUTH_TOKEN: "t", [UPDATE_PROFILE_ENV]: "production" },
    log: (m) => logs.push(m),
    spawn: (cmd, args, opts) => (calls.push({ args, opts }), { status: 0 }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.at(-1), "dist");
  assert.equal(calls[0].opts.env.SENTRY_AUTH_TOKEN, "t");
  assert.equal(calls[0].opts.env[UPDATE_PROFILE_ENV], undefined, "the uploader must not run the production fences");
});

test("without SENTRY_AUTH_TOKEN it uploads nothing and says how", () => {
  const logs = [];
  uploadSourceMaps({ env: {}, log: (m) => logs.push(m), spawn: () => assert.fail("no upload") });
  assert.match(logs[0], /source maps weren't uploaded/);
});

// ── Wired into `npm run eas` ────────────────────────────────────────────────

const PIN = { version: "24.8.0", before: "2026-10-01" };
const installer = () => "/fake/eas";

test("`npm run eas -- update` refuses before eas runs when the guard says no", () => {
  const spawn = () => assert.fail("eas must not run");
  const status = main(["update", "--channel", "production"], {
    pin: PIN,
    installer,
    spawn,
    cacheRoot: "/nonexistent",
    guardUpdate: () => ({ ok: false, errors: ["nope"] }),
  });
  assert.equal(status, 1);
});

test("a guarded update runs eas with the guard's arguments and env, then uploads source maps for production", () => {
  const calls = [];
  const after = [];
  const env = { [UPDATE_PROFILE_ENV]: "production" };
  const status = main(["update", "--channel", "production"], {
    pin: PIN,
    installer,
    cacheRoot: "/nonexistent",
    spawn: (cmd, args, opts) => (calls.push({ args, opts }), { status: 0 }),
    guardUpdate: () => ({ ok: true, args: ["--channel", "production", "--environment", "production"], env, notes: [], profileName: "production" }),
    afterUpdate: (o) => after.push(o),
  });
  assert.equal(status, 0);
  assert.deepEqual(calls[0].args, ["/fake/eas", "update", "--channel", "production", "--environment", "production"]);
  assert.equal(calls[0].opts.env, env);
  assert.equal(after.length, 1);
});

test("no source-map upload after a failed publish or off production, and other commands skip the guard", () => {
  const after = [];
  const run = (argv, status, profileName) =>
    main(argv, {
      pin: PIN,
      installer,
      cacheRoot: "/nonexistent",
      spawn: () => ({ status }),
      guardUpdate: () => ({ ok: true, args: argv.slice(1), env: {}, notes: [], profileName }),
      afterUpdate: (o) => after.push(o),
    });
  assert.equal(run(["update", "--channel", "production"], 1, "production"), 1);
  run(["update", "--channel", "preview"], 0, "preview");
  assert.equal(after.length, 0);
  let guarded = false;
  main(["update:list"], {
    pin: PIN,
    installer,
    cacheRoot: "/nonexistent",
    spawn: () => ({ status: 0 }),
    guardUpdate: () => ((guarded = true), { ok: false, errors: [] }),
  });
  assert.equal(guarded, false);
});

test("pullEasEnv runs eas env:pull into a temporary file, parses it, and deletes it", () => {
  let seenPath;
  const spawn = (cmd, args, opts) => {
    seenPath = args[args.indexOf("--path") + 1];
    assert.deepEqual(args.slice(0, 4), ["/fake/eas", "env:pull", "--environment", "production"]);
    assert.ok(args.includes("--non-interactive"));
    assert.deepEqual(opts.stdio, ["inherit", 2, 2], "eas's output stays off stdout");
    writeFileSync(seenPath, "# Environment: production\n\nEXPO_PUBLIC_SUPABASE_URL=https://p.supabase.co\n");
    return { status: 0 };
  };
  assert.deepEqual(pullEasEnv("/fake/eas", "production", { spawn }), { vars: { EXPO_PUBLIC_SUPABASE_URL: "https://p.supabase.co" } });
  assert.throws(() => readFileSync(seenPath), /ENOENT/, "the pulled file is deleted");
  assert.match(pullEasEnv("/fake/eas", "production", { spawn: () => ({ status: 1 }) }).error, /exited 1/);
});

test("main hands the guard a way to pull the EAS environment", () => {
  let gotPull;
  main(["update", "--channel", "preview"], {
    pin: PIN,
    installer,
    cacheRoot: "/nonexistent",
    spawn: () => ({ status: 0 }),
    guardUpdate: (args, opts) => ((gotPull = opts.pullEnv), { ok: false, errors: ["stop"] }),
  });
  assert.equal(typeof gotPull, "function");
});

test("refuses while the release production serves predates the guard, without sending you to it", () => {
  const { result } = checks({ answers: { "cat-file -e v0.9.1:scripts/eas-update.mjs": { status: 1 } } });
  assert.match(result.errors[0], /v0\.9\.1, predates this guard/);
  assert.doesNotMatch(result.errors[0], /git checkout/);
});

test("checks every recorded build of the runtime, and only those", () => {
  const OTHER = "c".repeat(40);
  const OLD = "d".repeat(40);
  const registry = JSON.stringify({
    builds: [
      { platform: "android", version: "0.9.0", build: "2", sha: OLD, recorded: "2026-11-03" },
      { platform: "android", version: "0.9.1", build: "3", sha: BUILD_SHA, recorded: "2026-11-06" },
      { platform: "ios", version: "0.9.1", build: "1", sha: OTHER, recorded: "2026-11-07" },
    ],
  });
  const answers = {
    [`show origin/main:${SHIPPED_BUILDS}`]: { stdout: registry },
    [`show ${OLD}:${LOCKFILE}`]: { stdout: JSON.stringify(lock({ react: "19.2.3" })) },
    [`diff --quiet ${OLD}`]: { status: 1 },
    [`show ${OTHER}:${LOCKFILE}`]: { stdout: JSON.stringify(lock({ "expo-haptics": "57.0.3" })) },
  };
  const ok = checks({ answers }).result;
  assert.deepEqual(ok.errors, [], "the 0.9.0 build differs, but an update for 0.9.1 can't reach it");
  assert.equal(ok.notes.length, 2);
  const second = checks({ answers: { ...answers, [`show ${OTHER}:${LOCKFILE}`]: { stdout: JSON.stringify(lock({ "expo-haptics": "57.0.1" })) } } }).result;
  assert.equal(second.errors.length, 1);
  assert.match(second.errors[0], /ios 0\.9\.1 build 1/);
});

test("refuses when eas.json and the EAS environment disagree on a name both set", () => {
  const r = prepareUpdate(["--channel", "production"], {
    readFile: files(),
    git: fakeGit().git,
    env: {},
    production: () => ({ errors: [], notes: [] }),
    pullEnv: () => ({ vars: { EXPO_PUBLIC_SENTRY_ENVIRONMENT: "staging" } }),
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /EXPO_PUBLIC_SENTRY_ENVIRONMENT is "production" in apps\/mobile\/eas\.json .* but "staging"/);
});

test("the names the guard sets are the ones app.config.js reads", () => {
  const requireConfig = createRequire(join(REPO, "apps", "mobile", "app.config.js"));
  const { applyMobileConfig, PRODUCTION_SUPABASE_PUBLIC_ERROR } = requireConfig("./app.config.js");
  const { env } = updateEnv({}, { profileName: "production", profile: realEasJson.build.production, gitSha: SHA });
  // The production fences run: with nothing from EAS, the Supabase presence check stops it.
  assert.throws(() => applyMobileConfig({}, { env, existsSync: () => false }), (e) => e.message === PRODUCTION_SUPABASE_PUBLIC_ERROR);
  const { env: withPreview } = updateEnv({}, { profileName: "preview", profile: realEasJson.build.preview, gitSha: SHA });
  assert.equal(applyMobileConfig({}, { env: withPreview, existsSync: () => false }).extra.gitSha, SHA);
});

test("pullEasEnv pulls with the shell env the guard publishes with, and deletes File variables it wrote", () => {
  const mobileDir = mkdtempSync(join(tmpdir(), "frapp-mobile-"));
  try {
    const fileVar = join(mobileDir, ".eas", ".env", "GOOGLE_SERVICES_JSON");
    mkdirSync(dirname(fileVar), { recursive: true });
    const removed = [];
    const spawn = (cmd, args, opts) => {
      assert.deepEqual(opts.env, { PATH: "/bin" }, "no EXPO_PUBLIC_*, EAS_BUILD_* or update marker");
      writeFileSync(fileVar, "{}");
      writeFileSync(args[args.indexOf("--path") + 1], `GOOGLE_SERVICES_JSON=${fileVar}\nEXPO_PUBLIC_X=1\n`);
      return { status: 0 };
    };
    const r = pullEasEnv("/fake/eas", "production", {
      spawn,
      mobileDir,
      env: { PATH: "/bin", EXPO_PUBLIC_X: "shell", EAS_BUILD_PROFILE: "production", FRAPP_EAS_UPDATE_PROFILE: "production" },
      remove: (p) => (removed.push(p), rmSync(p, { recursive: true, force: true })),
    });
    assert.deepEqual(r, { vars: { EXPO_PUBLIC_X: "1" } });
    assert.ok(removed.includes(fileVar));
  } finally {
    rmSync(mobileDir, { recursive: true, force: true });
  }
});
