// The guard `npm run eas -- update` runs before eas-cli publishes an OTA update (#3472).
//
// WHY. A bare `eas update` publishes a bundle that is wrong for a store binary in four ways,
// each read from eas-cli 24.8.0's source (`commands/update/index.js`, `project/publish.js`):
//
//   1. It ignores the build `env` in `apps/mobile/eas.json`. The export runs with
//      `{...process.env, ...<EAS variables for --environment>, EXPO_NO_DOTENV: '1'}`, and
//      `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_SENTRY_ENVIRONMENT` live only in eas.json, so the
//      bundle would call `http://localhost:3001` and tag Sentry `development`. Whatever the
//      publisher's shell holds under `EXPO_PUBLIC_*` would be inlined too.
//   2. It sets no `EAS_BUILD_PROFILE`, so `apps/mobile/app.config.js` skips every production
//      fence (API origin, Supabase project and key, app URL, Ask).
//   3. `runtimeVersion` is the `appVersion` policy: an update reaches every binary whose
//      `expo.version` matches. If native code changed since that binary was built without a
//      version bump, the update calls a native module the binary doesn't have and crashes.
//   4. Nothing stops an update from a dirty tree or an unmerged branch reaching members.
//
// WHAT IT DOES. `update` must name `--channel`, which must be the `channel` of exactly one build
// profile in eas.json; `--environment` is that profile's `environment` (added when absent,
// refused when different). The child env drops every inherited `EXPO_PUBLIC_*` and `EAS_BUILD_*`
// variable, adds the profile's eas.json `env`, and sets `FRAPP_EAS_UPDATE_PROFILE`, which
// app.config.js reads as the profile for its public-value fences, plus `FRAPP_EAS_UPDATE_GIT_SHA`
// for `extra.gitSha`. EAS variables still win over both for any name they define, so the fences
// see what the bundle gets. `--branch`, `--auto` and `--skip-bundler` are refused: each would
// publish somewhere other than the named channel, or a bundle this guard never shaped.
//
// For the production channel it also requires a clean tree on a commit already on origin/main,
// and refuses unless every store build recorded for this runtime (`apps/mobile/store/
// shipped-builds.json`) has the same native inputs as HEAD: `app.json`, `app.config.js`, and the
// lockfile version of every installed package that carries native code. That is how far an
// update reaches, and a mismatch means bump `expo.version` and ship a store build instead.
//
// After a successful production publish it uploads the bundle's source maps to Sentry when
// `SENTRY_AUTH_TOKEN` is in the shell. The EAS variable of that name is Secret, and a local
// `eas update` never loads Secret variables, so without it the update's stack traces stay
// minified, and the guard says so.
//
// NOT HERE (#2511): a staging app variant, CI publishing, `update:republish` promotion, staged
// rollout gates, OTA code signing (off for 0.9.x, #2526).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const UPDATE_PROFILE_ENV = "FRAPP_EAS_UPDATE_PROFILE";
export const UPDATE_GIT_SHA_ENV = "FRAPP_EAS_UPDATE_GIT_SHA";
export const EAS_JSON = "apps/mobile/eas.json";
export const APP_JSON = "apps/mobile/app.json";
export const APP_CONFIG = "apps/mobile/app.config.js";
export const SHIPPED_BUILDS = "apps/mobile/store/shipped-builds.json";
export const LOCKFILE = "package-lock.json";
const DIST = "dist";

/** Flags that publish somewhere other than `--channel`, or a bundle the guard didn't shape. */
const REFUSED_FLAGS = {
  "--branch": "names an EAS branch directly; name the channel with --channel instead",
  "--auto": "publishes to a branch named after your git branch, not to a channel",
  "--skip-bundler": "publishes a bundle exported earlier, without this guard's env",
  "--input-dir": "only matters with --skip-bundler, and moves the folder the source-map upload reads",
};

function flagValue(args, name) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === name) return { value: args[i + 1], index: i, width: 2 };
    if (a.startsWith(`${name}=`)) return { value: a.slice(name.length + 1), index: i, width: 1 };
  }
  return undefined;
}

/**
 * What `update`'s arguments ask for. `args` excludes the leading `update`. `help` is true when
 * the run only prints help, which publishes nothing and needs no guard.
 */
export function parseUpdateArgs(args) {
  const help = args.some((a) => a === "--help" || a === "-h");
  const refused = Object.keys(REFUSED_FLAGS).filter((flag) =>
    args.some((a) => a === flag || a.startsWith(`${flag}=`)),
  );
  const channel = flagValue(args, "--channel");
  const environment = flagValue(args, "--environment");
  return {
    help,
    refused,
    channel: channel?.value,
    environment: environment?.value,
  };
}

/** The one build profile whose `channel` is `channel`, or an error naming the choices. */
export function profileForChannel(easJson, channel) {
  const profiles = Object.entries(easJson?.build ?? {});
  const matches = profiles.filter(([, p]) => p?.channel === channel);
  const known = profiles.map(([, p]) => p?.channel).filter(Boolean);
  if (matches.length === 1) {
    const [name, profile] = matches[0];
    if (!profile.environment) {
      return { error: `${EAS_JSON} build.${name} has no "environment", so no EAS environment matches channel ${channel}.` };
    }
    return { name, profile };
  }
  if (matches.length > 1) {
    return { error: `${matches.length} build profiles in ${EAS_JSON} use channel ${channel}; it must be exactly one.` };
  }
  return { error: `No build profile in ${EAS_JSON} uses channel "${channel}". Channels: ${known.join(", ")}.` };
}

/**
 * The env eas-cli runs with: the caller's, minus every `EXPO_PUBLIC_*` (a stray shell value would
 * be inlined into the bundle) and `EAS_BUILD_*` (an update is not a build), plus the profile's
 * eas.json `env` and the two variables app.config.js reads for an update.
 */
export function updateEnv(baseEnv, { profileName, profile, gitSha }) {
  const stripped = [];
  const env = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (k.startsWith("EXPO_PUBLIC_") || k.startsWith("EAS_BUILD_")) stripped.push(k);
    else env[k] = v;
  }
  Object.assign(env, profile.env ?? {});
  env[UPDATE_PROFILE_ENV] = profileName;
  if (gitSha) env[UPDATE_GIT_SHA_ENV] = gitSha;
  else delete env[UPDATE_GIT_SHA_ENV];
  return { env, stripped };
}

/** True when an installed package directory carries iOS or Android code a binary links. */
export function isNativePackage(dir, { exists = existsSync, readdir = readdirSync } = {}) {
  if (
    exists(path.join(dir, "expo-module.config.json")) ||
    exists(path.join(dir, "android", "build.gradle")) ||
    exists(path.join(dir, "android", "build.gradle.kts"))
  ) {
    return true;
  }
  try {
    return readdir(dir).some((f) => f.endsWith(".podspec"));
  } catch {
    return false;
  }
}

/** `node_modules/a/node_modules/@s/b` → `@s/b`. */
export function packageNameFromLockPath(key) {
  const i = key.lastIndexOf("node_modules/");
  return i === -1 ? undefined : key.slice(i + "node_modules/".length);
}

function versionsByName(lock, names) {
  const out = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    const name = packageNameFromLockPath(key);
    if (!name || !names.has(name) || entry?.link || !entry?.version) continue;
    if (!out.has(name)) out.set(name, new Set());
    out.get(name).add(entry.version);
  }
  return out;
}

const fmt = (set) => (set ? [...set].sort().join(", ") : "none");

/**
 * Native packages whose installed versions differ between two lockfiles. Which packages are
 * native is read from the installed tree (`isNative(lockPath)`), so it describes HEAD; a native
 * package removed since the build is not a difference, because a bundle that no longer imports a
 * module can't crash on it.
 */
export function nativePackageChanges(buildLock, headLock, isNative) {
  const native = new Set();
  for (const key of Object.keys(headLock?.packages ?? {})) {
    const name = packageNameFromLockPath(key);
    if (name && isNative(key)) native.add(name);
  }
  const before = versionsByName(buildLock, native);
  const after = versionsByName(headLock, native);
  const changes = [];
  for (const name of [...native].sort()) {
    const a = before.get(name);
    const b = after.get(name);
    if (fmt(a) !== fmt(b)) changes.push(`${name} ${fmt(a)} -> ${fmt(b)}`);
  }
  return changes;
}

/** Entries of the hidden lockfile npm writes on install that disagree with package-lock.json. */
export function staleInstall(headLock, installedLock) {
  if (!installedLock) return ["node_modules/.package-lock.json is missing"];
  const stale = [];
  for (const [key, entry] of Object.entries(installedLock.packages ?? {})) {
    const want = headLock?.packages?.[key]?.version;
    if (entry?.version && want && entry.version !== want) stale.push(`${key} ${entry.version} (lockfile: ${want})`);
  }
  return stale;
}

function defaultGit(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? r.error?.message ?? "" };
}

/**
 * The production checks. Returns `{ errors, notes }`; any error refuses the publish.
 * `git`, `readFile` and `isNative` are injectable for the tests.
 */
export function productionChecks({
  git = defaultGit,
  readFile = (p) => readFileSync(path.join(ROOT, p), "utf8"),
  isNative = (lockPath) => isNativePackage(path.join(ROOT, lockPath)),
} = {}) {
  const errors = [];
  const notes = [];
  const status = git(["status", "--porcelain"]);
  if (status.status !== 0) return { errors: [`git status failed: ${status.stderr.trim()}`], notes };
  if (status.stdout.trim()) {
    errors.push("The working tree has uncommitted changes. A production update publishes only a commit on main.");
  }
  const fetch = git(["fetch", "--quiet", "origin", "main"]);
  if (fetch.status !== 0) {
    errors.push(`git fetch origin main failed, so the guard can't tell whether HEAD is on main: ${fetch.stderr.trim()}`);
  } else if (git(["merge-base", "--is-ancestor", "HEAD", "origin/main"]).status !== 0) {
    errors.push("HEAD is not on origin/main. Publish only merged work: `git switch main && git pull`, then run it again.");
  }

  const runtime = JSON.parse(readFile(APP_JSON))?.expo?.version;
  const builds = (JSON.parse(readFile(SHIPPED_BUILDS))?.builds ?? []).filter((b) => b.version === runtime);
  if (!runtime) {
    errors.push(`${APP_JSON} has no expo.version, so the update has no runtime version.`);
    return { errors, notes };
  }
  if (builds.length === 0) {
    errors.push(
      `No store build of version ${runtime} is recorded in ${SHIPPED_BUILDS}, so this update would reach no ` +
        "store binary. If a build of it shipped, record it first (mobile.md § 6.6); otherwise ship a build, not an update.",
    );
    return { errors, notes };
  }

  let headLock;
  let installed;
  try {
    headLock = JSON.parse(readFile(LOCKFILE));
    installed = JSON.parse(readFile("node_modules/.package-lock.json"));
  } catch {
    installed = undefined;
  }
  const stale = staleInstall(headLock, installed);
  if (stale.length) {
    errors.push(
      `node_modules doesn't match ${LOCKFILE}, so the native check can't trust it. Run \`npm ci\` first. ` +
        `First mismatch: ${stale[0]}.`,
    );
    return { errors, notes };
  }

  for (const build of builds) {
    const label = `${build.platform} ${build.version} build ${build.build} (${build.sha.slice(0, 12)})`;
    if (git(["cat-file", "-e", `${build.sha}^{commit}`]).status !== 0) {
      git(["fetch", "--quiet", "origin", build.sha]);
      if (git(["cat-file", "-e", `${build.sha}^{commit}`]).status !== 0) {
        errors.push(`Commit ${build.sha} of ${label} isn't available locally or from origin, so its native inputs can't be compared.`);
        continue;
      }
    }
    const changed = [];
    for (const file of [APP_JSON, APP_CONFIG]) {
      if (git(["diff", "--quiet", build.sha, "HEAD", "--", file]).status !== 0) changed.push(file);
    }
    const buildLockText = git(["show", `${build.sha}:${LOCKFILE}`]);
    if (buildLockText.status !== 0) {
      errors.push(`Couldn't read ${LOCKFILE} at ${build.sha}: ${buildLockText.stderr.trim()}`);
      continue;
    }
    changed.push(...nativePackageChanges(JSON.parse(buildLockText.stdout), headLock, isNative));
    if (changed.length) {
      errors.push(
        `Native inputs changed since ${label}, so this update could crash it:\n` +
          changed.map((c) => `      - ${c}`).join("\n") +
          `\n    Bump expo.version in ${APP_JSON} and ship a store build instead (spec/environments/README.md § Mobile (EAS), Native changes).`,
      );
    } else {
      notes.push(`Reaches ${label}: same native inputs as HEAD.`);
    }
  }
  return { errors, notes, runtime };
}

/**
 * Check an `update` run and shape what eas-cli gets. `args` excludes `update`. Returns
 * `{ ok: false, errors }`, or `{ ok: true, args, env, notes, profileName }`.
 */
export function prepareUpdate(
  args,
  {
    env = process.env,
    readFile = (p) => readFileSync(path.join(ROOT, p), "utf8"),
    git = defaultGit,
    production = productionChecks,
  } = {},
) {
  const parsed = parseUpdateArgs(args);
  if (parsed.help) return { ok: true, args, env, notes: [], profileName: undefined };
  const errors = parsed.refused.map((f) => `${f} is refused here: it ${REFUSED_FLAGS[f]}.`);
  if (!parsed.channel) {
    errors.push("Name the channel: `npm run eas -- update --channel production --message \"...\"`.");
    return { ok: false, errors };
  }
  const match = profileForChannel(JSON.parse(readFile(EAS_JSON)), parsed.channel);
  if (match.error) return { ok: false, errors: [...errors, match.error] };
  const { name: profileName, profile } = match;
  let outArgs = args;
  if (parsed.environment === undefined) {
    outArgs = [...args, "--environment", profile.environment];
  } else if (parsed.environment !== profile.environment) {
    errors.push(
      `--environment ${parsed.environment} doesn't match channel ${parsed.channel}, whose build profile ` +
        `(${profileName}) uses the ${profile.environment} environment. Leave --environment off.`,
    );
  }
  const notes = [];
  if (profileName === "production") {
    const checks = production({ git, readFile });
    errors.push(...checks.errors);
    notes.push(...checks.notes);
  } else {
    notes.push(
      `Channel ${parsed.channel} has no store-build record, so the native-compatibility check is skipped. ` +
        "An update reaches every installed build of this version on that channel.",
    );
  }
  if (errors.length) return { ok: false, errors };
  const head = git(["rev-parse", "HEAD"]);
  const { env: outEnv, stripped } = updateEnv(env, {
    profileName,
    profile,
    gitSha: head.status === 0 ? head.stdout.trim() : undefined,
  });
  if (stripped.length) notes.push(`Dropped from your shell for this run: ${stripped.join(", ")}.`);
  for (const [k, v] of Object.entries(profile.env ?? {})) notes.push(`${k}=${v} (from ${EAS_JSON} build.${profileName}.env)`);
  return { ok: true, args: outArgs, env: outEnv, notes, profileName };
}

/**
 * After a production publish: upload the exported bundle's source maps to Sentry, or say why not.
 * A failed upload doesn't undo the publish, so it only warns.
 */
export function uploadSourceMaps({
  env,
  log,
  spawn = spawnSync,
  readFile = (p) => readFileSync(path.join(ROOT, p), "utf8"),
  mobileDir = path.join(ROOT, "apps", "mobile"),
}) {
  const cmd = "npx sentry-expo-upload-sourcemaps dist";
  if (!env.SENTRY_AUTH_TOKEN) {
    log(
      "WARNING: the update is live, but its source maps weren't uploaded to Sentry, so its stack traces stay minified. " +
        `SENTRY_AUTH_TOKEN isn't in your shell (EAS keeps it Secret, which never reaches a local run). ` +
        `To upload: set it for this shell, then in apps/mobile run \`${cmd}\` (mobile.md § 6.7).`,
    );
    return;
  }
  log("Uploading the update's source maps to Sentry...");
  // Org and project from app.json's Sentry plugin entry, passed as env so the uploader doesn't
  // evaluate app.config.js itself: that evaluation would run the production fences without the
  // EAS variables eas-cli loaded, and stop.
  const plugin = (JSON.parse(readFile(APP_JSON))?.expo?.plugins ?? []).find(
    (p) => Array.isArray(p) && p[0] === "@sentry/react-native/expo",
  )?.[1];
  const uploadEnv = {
    ...env,
    SENTRY_ORG: env.SENTRY_ORG || plugin?.organization,
    SENTRY_PROJECT: env.SENTRY_PROJECT || plugin?.project,
    SENTRY_URL: env.SENTRY_URL || plugin?.url || "https://sentry.io/",
  };
  delete uploadEnv[UPDATE_PROFILE_ENV];
  const result = spawn(process.execPath, [path.join(ROOT, "node_modules", "@sentry", "react-native", "scripts", "expo-upload-sourcemaps.js"), DIST], {
    cwd: mobileDir,
    stdio: "inherit",
    env: uploadEnv,
  });
  if (result.status !== 0) {
    log(`WARNING: the update is live, but the source-map upload failed. Run \`${cmd}\` in apps/mobile again.`);
  }
}
