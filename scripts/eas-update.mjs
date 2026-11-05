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
//   4. Nothing ties the bundle to what production serves: a dirty tree, or main's tip with JS
//      that calls routes the production API (the latest `v*` tag) doesn't serve yet.
//
// WHAT IT DOES. `update` must name `--channel`, which must be the `channel` of exactly one build
// profile in eas.json; `--environment` is that profile's `environment` (added when absent,
// refused when different). The child env drops every inherited `EXPO_PUBLIC_*` and `EAS_BUILD_*`
// variable, adds the profile's eas.json `env`, then that EAS environment's own `EXPO_PUBLIC_*`
// variables, and sets `FRAPP_EAS_UPDATE_PROFILE`, which app.config.js reads as the profile for
// its public-value fences, plus `FRAPP_EAS_UPDATE_GIT_SHA` for `extra.gitSha`.
//
// The EAS variables are pulled first (`eas env:pull`, Plain text and Sensitive only, which is all
// a local run ever gets) because eas-cli evaluates app.config.js several times before it merges
// them in (`DynamicProjectConfigContextField`, `ServerSideEnvironmentVariablesContextField`): with
// the profile set and those values absent, the production Supabase fence would stop every run.
// A name both set must agree (a build takes eas.json's value, an update's export takes EAS's), so
// every evaluation sees what the bundle gets, and the bundle what its binary has. `--branch`,
// `--auto`, `--skip-bundler` and `--input-dir` are refused: each publishes somewhere other than the
// named channel, or a bundle this guard never shaped.
//
// The guard that runs is the checked-out release's own copy, so a production publish is refused
// while the release production serves predates it (v0.8.1 has none).
//
// For the production channel it also requires a clean tree at exactly the commit production
// serves (the latest `v*` tag, `scripts/ci/lib/release-tag.mjs`, the same rule store builds
// follow), and refuses unless every store build recorded for this runtime (`apps/mobile/store/
// shipped-builds.json`) has the same native inputs as HEAD: `app.json`, `app.config.js`, and the
// lockfile version of every installed package that carries native code. That is how far an
// update reaches, and a mismatch means bump `expo.version` and ship a store build instead.
//
// After a successful production publish it uploads the bundle's source maps to Sentry when
// `SENTRY_AUTH_TOKEN` is in the shell. The EAS variable of that name is Secret, and a local
// `eas update` never loads Secret variables, so without it the update's stack traces stay
// minified, and the guard says so.
//
// CI runs this same guard: Deploy production's `mobile_build: auto` publishes through
// `npm run eas -- update` (`.github/workflows/_mobile-update.yml`), after its plan
// (`scripts/ci/plan-mobile-release.mjs`) found the update can reach that platform's store build.
//
// NOT HERE (#2511): a staging app variant, `update:republish` promotion, staged rollout gates,
// OTA code signing (off for 0.9.x, #2526).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistry } from "./check-api-breaking-changes.mjs";
import { latestReleaseTag } from "./ci/lib/release-tag.mjs";
import { REGISTRY_PATH } from "./ci/record-shipped-builds.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const UPDATE_PROFILE_ENV = "FRAPP_EAS_UPDATE_PROFILE";
export const UPDATE_GIT_SHA_ENV = "FRAPP_EAS_UPDATE_GIT_SHA";
export const EAS_JSON = "apps/mobile/eas.json";
export const APP_JSON = "apps/mobile/app.json";
export const APP_CONFIG = "apps/mobile/app.config.js";
export const SHIPPED_BUILDS = REGISTRY_PATH;
export const GUARD_PATH = "scripts/eas-update.mjs";
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
  // `extends` would hand a profile env and a channel this lookup can't see. None uses it; resolving
  // it is #2511's, once there is a profile that needs it.
  const extending = profiles.filter(([, p]) => p?.extends).map(([n]) => n);
  if (extending.length) {
    return { error: `${EAS_JSON} build profiles ${extending.join(", ")} use "extends", which this guard doesn't resolve.` };
  }
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
 * eas.json `env`, then the EAS environment's `EXPO_PUBLIC_*` (`easVars`, which win as they do in
 * eas-cli's export), and the two variables app.config.js reads for an update.
 */
export function updateEnv(baseEnv, { profileName, profile, gitSha, easVars = {} }) {
  const stripped = [];
  const env = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (k.startsWith("EXPO_PUBLIC_") || k.startsWith("EAS_BUILD_")) stripped.push(k);
    else env[k] = v;
  }
  Object.assign(env, profile.env ?? {}, easVars);
  env[UPDATE_PROFILE_ENV] = profileName;
  if (gitSha) env[UPDATE_GIT_SHA_ENV] = gitSha;
  else delete env[UPDATE_GIT_SHA_ENV];
  return { env, stripped };
}

/**
 * The `EXPO_PUBLIC_*` lines of the file `eas env:pull` writes: `NAME=value`, one per line, unquoted
 * (eas-cli 24.8.0 `commands/env/pull.js`). Secret variables arrive commented out and are skipped.
 */
export function parsePulledEnv(text) {
  const vars = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(EXPO_PUBLIC_[A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

/** True when an installed package directory carries iOS or Android code a binary links. */
export function isNativePackage(dir, { exists = existsSync, readdir = readdirSync } = {}) {
  // Any android/, ios/ or apple/ directory counts, not only a module's build.gradle: tooling such
  // as expo-modules-autolinking (a Gradle plugin) or a Swift macros plugin shapes the binary too.
  if (["expo-module.config.json", "android", "ios", "apple"].some((f) => exists(path.join(dir, f)))) {
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

/** `android 0.9.1 build 3 (cca52decb010)`: how every message names a store build. */
export function buildLabel(build) {
  return `${build.platform} ${build.version} build ${build.build} (${build.sha.slice(0, 12)})`;
}

/**
 * For each recorded store build, which native inputs differ between its commit and `head`:
 * `app.json`, `app.config.js`, and the lockfile version of every native package (`isNative` reads
 * the installed tree, so it describes `head`'s install). `headLock` is `head`'s parsed lockfile.
 * A build may carry its own `label` (the PR check compares against its base commit this way).
 * Returns `[{ build, label, changed: string[], error? }]`, one per build, in order. The guard, the
 * deploy's OTA-or-store-build plan (`scripts/ci/plan-mobile-release.mjs`) and the PR check
 * (`scripts/check-mobile-native-version.mjs`) all judge with this one comparison.
 */
export function compareNativeInputs({ builds, git, headLock, isNative, head = "HEAD" }) {
  const results = [];
  for (const build of builds) {
    const label = build.label ?? buildLabel(build);
    if (git(["cat-file", "-e", `${build.sha}^{commit}`]).status !== 0) {
      git(["fetch", "--quiet", "origin", build.sha]);
      if (git(["cat-file", "-e", `${build.sha}^{commit}`]).status !== 0) {
        results.push({ build, label, changed: [], error: `Commit ${build.sha} of ${label} isn't available locally or from origin, so its native inputs can't be compared.` });
        continue;
      }
    }
    const changed = [];
    for (const file of [APP_JSON, APP_CONFIG]) {
      if (git(["diff", "--quiet", build.sha, head, "--", file]).status !== 0) changed.push(file);
    }
    const buildLockText = git(["show", `${build.sha}:${LOCKFILE}`]);
    if (buildLockText.status !== 0) {
      results.push({ build, label, changed: [], error: `Couldn't read ${LOCKFILE} at ${build.sha}: ${buildLockText.stderr.trim()}` });
      continue;
    }
    changed.push(...nativePackageChanges(JSON.parse(buildLockText.stdout), headLock, isNative));
    results.push({ build, label, changed });
  }
  return results;
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
    errors.push("The working tree has uncommitted changes. A production update publishes only the commit production serves.");
  }
  // The bundle calls api.frapp.live, which runs the latest v* tag: JS from anywhere else can call
  // routes production doesn't serve (newer) or roll members back (older).
  const fetch = git(["fetch", "--quiet", "--tags", "origin", "main"]);
  if (fetch.status !== 0) {
    errors.push(`git fetch --tags origin main failed, so the guard can't tell what production serves: ${fetch.stderr.trim()}`);
    return { errors, notes };
  } else {
    const latest = latestReleaseTag({
      git: (a) => {
        const r = git(a);
        if (r.status !== 0) throw new Error(r.stderr.trim() || `git ${a.join(" ")} exited ${r.status}`);
        return r.stdout;
      },
    });
    const tagSha = latest.ok ? git(["rev-parse", `${latest.tag}^{commit}`]) : undefined;
    const headSha = git(["rev-parse", "HEAD"]);
    if (!latest.ok) {
      errors.push(`Can't tell what production serves: ${latest.error}.`);
    } else if (git(["cat-file", "-e", `${latest.tag}:${GUARD_PATH}`]).status !== 0) {
      // The guard runs from the checked-out tree, so a release without it would publish unguarded.
      errors.push(
        `The release production serves, ${latest.tag}, predates this guard, and \`npm run eas -- update\` ` +
          "there is a bare, unsafe `eas update`. No update can be published until Deploy production ships a release that carries it.",
      );
    } else if (tagSha.status !== 0 || headSha.status !== 0 || tagSha.stdout.trim() !== headSha.stdout.trim()) {
      errors.push(
        `HEAD isn't ${latest.tag}, the commit production serves. Publish from it: ` +
          `\`git checkout ${latest.tag} && npm ci\`. To ship newer work, run Deploy production first.`,
      );
    }
  }

  const runtime = JSON.parse(readFile(APP_JSON))?.expo?.version;
  // From main, not HEAD: a tag's own builds are recorded by a PR that merges after the tag.
  let registry;
  try {
    const shown = git(["show", `origin/main:${SHIPPED_BUILDS}`]);
    if (shown.status !== 0) throw new Error(shown.stderr.trim() || "git show failed");
    registry = parseRegistry(shown.stdout);
  } catch (error) {
    errors.push(`${SHIPPED_BUILDS} is malformed: ${error.message}`);
    return { errors, notes };
  }
  const builds = registry.builds.filter((b) => b.version === runtime);
  if (!runtime) {
    errors.push(`${APP_JSON} has no expo.version, so the update has no runtime version.`);
    return { errors, notes };
  }
  if (builds.length === 0) {
    errors.push(
      `No store build of version ${runtime} is recorded in ${SHIPPED_BUILDS}, so this update would reach no ` +
        "store binary. If a build of it shipped, merge the PR that records it first (mobile.md § 6.6); otherwise ship a build, not an update.",
    );
    return { errors, notes };
  }

  let headLock;
  try {
    headLock = JSON.parse(readFile(LOCKFILE));
  } catch (error) {
    errors.push(`Couldn't read ${LOCKFILE}: ${error.message}`);
    return { errors, notes };
  }
  let installed;
  try {
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

  for (const result of compareNativeInputs({ builds, git, headLock, isNative })) {
    if (result.error) errors.push(result.error);
    else if (result.changed.length) {
      errors.push(
        `Native inputs changed since ${result.label}, so this update could crash it:\n` +
          result.changed.map((c) => `      - ${c}`).join("\n") +
          `\n    Bump expo.version in ${APP_JSON} and ship a store build instead (spec/environments/README.md § Mobile (EAS), Native changes).`,
      );
    } else {
      notes.push(`Reaches ${result.label}: same native inputs as HEAD.`);
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
    pullEnv = () => ({ error: "no way to read the EAS environment was given" }),
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
  const pulled = pullEnv(profile.environment);
  if (pulled.error) {
    return { ok: false, errors: [`Couldn't read the ${profile.environment} EAS environment's variables: ${pulled.error}`] };
  }
  // A build takes eas.json's value when both set a name (eas-cli build/evaluateConfigWithEnvVarsAsync)
  // and an update's export takes EAS's, so a difference would make the bundle disagree with its binary.
  const conflicts = Object.entries(profile.env ?? {}).filter(([k, v]) => k in pulled.vars && pulled.vars[k] !== v);
  if (conflicts.length) {
    return {
      ok: false,
      errors: conflicts.map(
        ([k, v]) =>
          `${k} is "${v}" in ${EAS_JSON} build.${profileName}.env but "${pulled.vars[k]}" in the ${profile.environment} ` +
          "EAS environment. A store build uses eas.json's value and an update would use EAS's: delete the EAS variable.",
      ),
    };
  }
  const head = git(["rev-parse", "HEAD"]);
  const { env: outEnv, stripped } = updateEnv(env, {
    profileName,
    profile,
    gitSha: head.status === 0 ? head.stdout.trim() : undefined,
    easVars: pulled.vars,
  });
  if (stripped.length) notes.push(`Dropped from your shell for this run: ${stripped.join(", ")}.`);
  for (const [k, v] of Object.entries(profile.env ?? {})) notes.push(`${k}=${v} (from ${EAS_JSON} build.${profileName}.env)`);
  const fromEas = Object.keys(pulled.vars);
  notes.push(`From the ${profile.environment} EAS environment: ${fromEas.length ? fromEas.join(", ") : "nothing"}.`);
  return { ok: true, args: outArgs, env: outEnv, notes, profileName };
}

/**
 * After a production publish: upload the exported bundle's source maps to Sentry, or say why not.
 * A failed upload doesn't undo the publish, so it only warns.
 */
export function uploadSourceMaps({ env, log, spawn = spawnSync, mobileDir = path.join(ROOT, "apps", "mobile") }) {
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
  // The uploader reads the Sentry org and project from the Expo config. Without the update profile
  // that evaluation runs no profile fences, the same as the by-hand command printed above.
  const uploadEnv = { ...env };
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
