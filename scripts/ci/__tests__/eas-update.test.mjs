// The OTA publish guard (`npm run eas -- update`, scripts/eas-update.mjs, #3472).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_JSON,
  EAS_JSON,
  LOCKFILE,
  SHIPPED_BUILDS,
  UPDATE_GIT_SHA_ENV,
  UPDATE_PROFILE_ENV,
  nativePackageChanges,
  packageNameFromLockPath,
  parseUpdateArgs,
  prepareUpdate,
  productionChecks,
  profileForChannel,
  staleInstall,
  updateEnv,
  uploadSourceMaps,
} from "../../eas-update.mjs";
import { main } from "../../eas.mjs";

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

/** A git double: `answers` maps a joined command to a result; anything else succeeds empty. */
function fakeGit(answers = {}) {
  const calls = [];
  const git = (args) => {
    const key = args.join(" ");
    calls.push(key);
    for (const [prefix, result] of Object.entries(answers)) {
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
    [SHIPPED_BUILDS]: JSON.stringify({ builds: [{ platform: "android", version: "0.9.1", build: "3", sha: BUILD_SHA }] }),
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
  const opts = { readFile: files(), git: fakeGit().git, production: noProduction, env: {} };
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
  const r = prepareUpdate(["--channel", "preview", "--message", "x"], { readFile: files(), git, production: noProduction, env: {} });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, ["--channel", "preview", "--message", "x", "--environment", "preview"]);
  assert.equal(r.env.EXPO_PUBLIC_API_URL, "https://api-staging.frapp.live");
  assert.equal(r.env[UPDATE_PROFILE_ENV], "preview");
  assert.equal(r.env[UPDATE_GIT_SHA_ENV], SHA);
  assert.equal(r.profileName, "preview");
  assert.ok(r.notes.some((n) => /native-compatibility check is skipped/.test(n)));
});

test("production runs the store-build checks, and any error refuses the publish", () => {
  const opts = { readFile: files(), git: fakeGit().git, env: {} };
  const refused = prepareUpdate(["--channel", "production"], { ...opts, production: () => ({ errors: ["nope"], notes: [] }) });
  assert.deepEqual(refused, { ok: false, errors: ["nope"] });
  const ok = prepareUpdate(["--channel", "production", "--environment", "production"], {
    ...opts,
    production: () => ({ errors: [], notes: ["Reaches x"] }),
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.args, ["--channel", "production", "--environment", "production"], "an explicit match isn't repeated");
  assert.equal(ok.env.EXPO_PUBLIC_API_URL, "https://api.frapp.live");
  assert.ok(ok.notes.includes("Reaches x"));
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
    ...answers,
  });
  return { result: productionChecks({ git, readFile: files(over), isNative: native }), calls };
}

test("a clean tree on main, with native inputs matching every build of the runtime, passes", () => {
  const { result, calls } = checks();
  assert.deepEqual(result.errors, []);
  assert.match(result.notes[0], /Reaches android 0\.9\.1 build 3/);
  assert.ok(calls.includes("fetch --quiet origin main"));
  assert.ok(calls.includes("merge-base --is-ancestor HEAD origin/main"));
});

test("refuses a dirty tree and a HEAD that isn't on origin/main", () => {
  const { result } = checks({
    answers: {
      "status --porcelain": { stdout: " M apps/mobile/app.json\n" },
      "merge-base --is-ancestor": { status: 1 },
    },
  });
  assert.match(result.errors[0], /uncommitted changes/);
  assert.match(result.errors[1], /not on origin\/main/);
});

test("refuses when no store build of the runtime is recorded", () => {
  const { result } = checks({ over: { [APP_JSON]: JSON.stringify({ expo: { version: "0.9.2" } }) } });
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
  const git = (args) => {
    const key = args.join(" ");
    if (key === `fetch --quiet origin ${BUILD_SHA}`) fetched = true;
    if (key.startsWith("cat-file")) return { status: 1, stdout: "", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  const result = productionChecks({ git, readFile: files(), isNative });
  assert.ok(fetched);
  assert.match(result.errors[0], /isn't available locally or from origin/);
});

// ── Source maps ─────────────────────────────────────────────────────────────

test("uploads source maps with org and project from app.json, without the update marker", () => {
  const calls = [];
  const logs = [];
  const readFile = () =>
    JSON.stringify({ expo: { plugins: [["@sentry/react-native/expo", { organization: "frapp-live", project: "frapp-mobile" }]] } });
  uploadSourceMaps({
    env: { SENTRY_AUTH_TOKEN: "t", [UPDATE_PROFILE_ENV]: "production" },
    log: (m) => logs.push(m),
    spawn: (cmd, args, opts) => (calls.push({ args, opts }), { status: 0 }),
    readFile,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.at(-1), "dist");
  assert.equal(calls[0].opts.env.SENTRY_ORG, "frapp-live");
  assert.equal(calls[0].opts.env.SENTRY_PROJECT, "frapp-mobile");
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
