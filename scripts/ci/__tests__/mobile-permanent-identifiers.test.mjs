// Locks the names a shipped mobile binary carries for good.
//
// WHY THIS EXISTS. Every install keeps the binary it was built from until its
// owner updates from the store, and nothing reaches it over the air that its
// native config didn't already allow (#2526). The first store upload fixes
// each name below: App Store Connect and Play bind the bundle id and package;
// the OS routes `frapp://` links to whichever app owns the scheme; `.ics`
// files already sitting in members' calendars carry
// `frapp://event-details?id=…`; and every binary asks EAS Update and the Expo
// push service for this EAS project by id. A leftover sweep or a well-meant
// tidy that renames one ships a binary that can't reach what the old ones
// left behind, with nothing failing until a member taps a dead link.
//
// WHERE EACH ONE IS DECIDED. spec/ui/brand-identity.md § 1 (the naming rule
// ADR-25 set) makes the `frapp://` scheme, the iOS bundle id and Android
// package `live.frapp.mobile`, and the frapp.live domains permanent. ADR-25
// adds the Expo slug `frapp` and the Sentry org `frapp-live`.
// spec/environments/README.md § Mobile (EAS) says why the EAS project id is
// permanent. Change the spec first, then this lock.
//
// WHAT IT CHECKS.
// - `apps/mobile/app.json` carries each name above, and `updates.url` points
//   at the pinned EAS project.
// - `apps/mobile/app.config.js`, called the way Expo calls it (its default
//   export with `{ config }`, reading `process.env`), leaves every one of them,
//   and `expo.name`, exactly as app.json has them. It runs once with no EAS
//   profile (`expo start`, `eas update`), then for every `eas.json` build
//   profile on each platform, with that profile's `env` block and the
//   `EAS_BUILD*` values a cloud build sets. Variables that live only in the EAS
//   dashboard never pass through the repo: the lock supplies the ones
//   app.config.js requires (the Supabase URL and key, the Google services
//   file) and can't see a rename keyed on any other.
// - The `.ics` deep link: the calendar export still writes
//   `frapp://event-details?id=…`, and the screen still declares the `id`
//   param that URL carries.
// - Every `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_APP_URL` in `eas.json`, on
//   every profile, is an https frapp.live origin (development may use a
//   loopback http origin).
// - No hosting-platform hostname (Render, Vercel, Cloud Run: ADR-24's current
//   and planned hosts) in the non-spec sources of apps/mobile and of every
//   workspace package it bundles, comments included. The scan is textual: it
//   catches a hostname written out, templated (`${svc}.run.app`) or
//   suffix-concatenated (`svc + ".onrender.com"`), and a platform domain held
//   in a string literal of its own ("onrender.com"). A hostname split further
//   than that (".onrender" + ".com") is beyond a text scan.
//
// WHAT OTHER LOCKS OWN. Not restated here:
// - `expo.name` is `Frapp`: frapp-mobile-copy.test.mjs. This lock checks only
//   that app.config.js doesn't change it.
// - The exact API origin production and preview bake in:
//   eas-production-profile.test.mjs pins it, and `app.config.js` refuses a
//   production build whose `EXPO_PUBLIC_API_URL` differs. This lock's eas.json
//   rule is wider and weaker (any https frapp.live origin), so those two URLs
//   are checked both ways.
// - The rest of app.json's `updates` block: apps/mobile/app.config.spec.ts.
// - `/event-details` resolves to a route file: apps/mobile/lib/routes.spec.ts.
// - The magic-link callback (`frapp:///?`) needs `frapp://**` on both hosted
//   projects' redirect allow lists: staging and production Auth conformance
//   check it daily. From the binary's side it needs only the scheme, pinned
//   below.
//
// THE PROVIDER HOSTNAMES THAT STAY. A binary can't avoid baking some provider
// hosts: `<ref>.supabase.co` (EXPO_PUBLIC_SUPABASE_URL, which `app.config.js`
// fences to frapp-prod), `u.expo.dev` (updates.url), and the Sentry and
// PostHog ingest hosts. So replacing the frapp-prod project strands every
// install until it updates. The way out is the minimum-version gate
// (`GET /v1/client-policy` on api.frapp.live, #2622), which is why the API
// must stay on a name this repo owns.
//
// The assignment lines and the walker are pinned below, because a lock that
// reads its own constants passes when the constant and app.json are renamed
// together, and a walk that quietly skips a directory passes everything in it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile");
const PACKAGES_ROOT = join(REPO_ROOT, "packages");
const requireCjs = createRequire(import.meta.url);

const APP_JSON = "apps/mobile/app.json";
const APP_CONFIG = "apps/mobile/app.config.js";
const EAS_JSON = "apps/mobile/eas.json";
const MOBILE_PACKAGE_JSON = "apps/mobile/package.json";
const EVENT_DETAILS = "apps/mobile/app/(tabs)/event-details.tsx";

export const SCHEME = "frapp";
export const SLUG = "frapp";
export const BUNDLE_ID = "live.frapp.mobile";
export const SENTRY_ORG = "frapp-live";
export const EAS_PROJECT_ID = "4ba05e35-7d91-4bb4-9597-be754127de95";

const SENTRY_PLUGIN = "@sentry/react-native/expo";
const WORKSPACE_SCOPE = "@repo/";
const PLATFORMS = ["ios", "android"];

/** ADR-24's hosts for the API and web, today and planned. */
export const HOSTING_PLATFORM_DOMAINS = ["onrender.com", "vercel.app", "run.app"];
/** The eas.json keys that address this repo's own services. */
const OWN_SERVICE_URL_KEYS = ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_APP_URL"];
const OWN_DOMAIN = "frapp.live";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** apps/mobile has well over this many sources; fewer means the walk broke. */
const MIN_MOBILE_SOURCES = 150;
const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", ".turbo", "coverage", "ios", "android", "__tests__"]);
const SOURCE_EXT = /\.(?:json|js|mjs|cjs|ts|tsx)$/;
const TEST_FILE = /\.(?:spec|test)\.[^.]+$/;

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function describe(value) {
  return value === undefined ? "unset" : JSON.stringify(value);
}

function sentryOrganization(expo) {
  const plugins = Array.isArray(expo?.plugins) ? expo.plugins : [];
  const entry = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === SENTRY_PLUGIN);
  return entry?.[1]?.organization;
}

/** Every permanent identifier in one Expo config (app.json's `expo`, or app.config.js's output). */
export function identityProblems(expo) {
  const problems = [];
  if (expo?.slug !== SLUG) {
    problems.push(`expo.slug must be ${SLUG}, not ${describe(expo?.slug)}`);
  }
  if (expo?.scheme !== SCHEME) {
    problems.push(`expo.scheme must be ${SCHEME}, not ${describe(expo?.scheme)}`);
  }
  if (expo?.ios?.bundleIdentifier !== BUNDLE_ID) {
    problems.push(
      `expo.ios.bundleIdentifier must be ${BUNDLE_ID}, not ${describe(expo?.ios?.bundleIdentifier)}`,
    );
  }
  if (expo?.android?.package !== BUNDLE_ID) {
    problems.push(`expo.android.package must be ${BUNDLE_ID}, not ${describe(expo?.android?.package)}`);
  }
  if (expo?.extra?.eas?.projectId !== EAS_PROJECT_ID) {
    problems.push(
      `expo.extra.eas.projectId must be ${EAS_PROJECT_ID}, not ${describe(expo?.extra?.eas?.projectId)}`,
    );
  }
  const updatesUrl = `https://u.expo.dev/${EAS_PROJECT_ID}`;
  if (expo?.updates?.url !== updatesUrl) {
    problems.push(`expo.updates.url must be ${updatesUrl}, not ${describe(expo?.updates?.url)}`);
  }
  const org = sentryOrganization(expo);
  if (org !== SENTRY_ORG) {
    problems.push(`the ${SENTRY_PLUGIN} plugin's organization must be ${SENTRY_ORG}, not ${describe(org)}`);
  }
  return problems;
}

/**
 * app.config.js may add fields (a Google services path, the git SHA), but it
 * must hand back every identifier, and the home-screen name, as app.json has
 * them. The values themselves are identityProblems' and frapp-mobile-copy's.
 */
export function dynamicLayerProblems(staticExpo, resolved) {
  const fields = [
    ["expo.name", (expo) => expo?.name],
    ["expo.slug", (expo) => expo?.slug],
    ["expo.scheme", (expo) => expo?.scheme],
    ["expo.ios.bundleIdentifier", (expo) => expo?.ios?.bundleIdentifier],
    ["expo.android.package", (expo) => expo?.android?.package],
    ["expo.extra.eas.projectId", (expo) => expo?.extra?.eas?.projectId],
    ["expo.updates.url", (expo) => expo?.updates?.url],
    [`the ${SENTRY_PLUGIN} organization`, sentryOrganization],
  ];
  const problems = [];
  for (const [label, read] of fields) {
    if (read(resolved) !== read(staticExpo)) {
      problems.push(
        `app.config.js changes ${label} from ${describe(read(staticExpo))} to ${describe(read(resolved))}`,
      );
    }
  }
  return [...problems, ...identityProblems(resolved)];
}

/**
 * The calendar export writes this URL into every `.ics` file, and the screen
 * reads its `id`. Both halves must hold: a new URL strands the old files, and
 * a renamed param opens them on an empty screen.
 */
export function eventDetailsDeepLinkProblems(source) {
  const problems = [];
  if (!/deepLinkUrl:\s*`frapp:\/\/event-details\?id=\$\{/.test(source)) {
    problems.push(`${EVENT_DETAILS} must export deepLinkUrl \`frapp://event-details?id=\${…}\``);
  }
  if (!/useLocalSearchParams<\{[^}]*\bid\?\s*:/.test(source)) {
    problems.push(`${EVENT_DETAILS} must declare the id param in useLocalSearchParams<{ id?: … }>`);
  }
  return problems;
}

/**
 * Two shapes. A platform domain with a dot in front of it is a hostname under
 * the platform, whether its labels are written out, templated or concatenated
 * on. A platform domain that is a whole string literal ("onrender.com") is a
 * hostname about to be assembled. The bare domain in prose ("Cloud Run's
 * run.app domain", "Deployed on vercel.app") is neither, and passes.
 */
function hostingPlatformPatterns(domains = HOSTING_PLATFORM_DOMAINS) {
  const alternatives = domains.map((domain) => domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return [
    new RegExp(`([a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${alternatives}))\\b`, "gi"),
    new RegExp(`(["'\`]\\.?(?:${alternatives})["'\`])`, "gi"),
  ];
}

/** `files` is `[{ rel, source }]`. */
export function hostingPlatformProblems(files) {
  const patterns = hostingPlatformPatterns();
  const problems = [];
  for (const { rel, source } of files) {
    source.split("\n").forEach((line, index) => {
      for (const pattern of patterns) {
        for (const match of line.matchAll(pattern)) {
          problems.push(`${rel}:${index + 1}: ${match[1]}`);
        }
      }
    });
  }
  return problems;
}

function isOwnHttpsOrigin(url) {
  return url.protocol === "https:" && (url.hostname === OWN_DOMAIN || url.hostname.endsWith(`.${OWN_DOMAIN}`));
}

/** Every own-service URL in every eas.json profile is ours: https on frapp.live, or loopback on development. */
export function easOwnServiceUrlProblems(eas) {
  const problems = [];
  for (const [profile, config] of Object.entries(eas?.build ?? {})) {
    const env = config?.env;
    if (env == null || typeof env !== "object") continue;
    for (const key of OWN_SERVICE_URL_KEYS) {
      if (!(key in env)) continue;
      const value = env[key];
      let url;
      try {
        url = new URL(String(value));
      } catch {
        problems.push(`build.${profile}.env.${key} is not a URL: ${describe(value)}`);
        continue;
      }
      if (isOwnHttpsOrigin(url)) continue;
      if (profile === "development" && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) {
        continue;
      }
      problems.push(`build.${profile}.env.${key} must be an https ${OWN_DOMAIN} origin, not ${value}`);
    }
  }
  return problems;
}

/** Every `packages/<dir>` bundled into the binary: apps/mobile's workspace dependencies, transitively. */
export function bundledPackageDirs(mobilePackageJson, workspacePackages) {
  const byName = new Map(workspacePackages.map((pkg) => [pkg.name, pkg]));
  const seen = new Set();
  const out = [];
  const queue = Object.keys(mobilePackageJson.dependencies ?? {}).filter((name) =>
    name.startsWith(WORKSPACE_SCOPE),
  );
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const pkg = byName.get(name);
    if (!pkg) {
      out.push({ name, dir: null });
      continue;
    }
    out.push({ name, dir: pkg.dir });
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (dep.startsWith(WORKSPACE_SCOPE)) queue.push(dep);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The environment each kind of build evaluates app.config.js with: no EAS
 * profile, then every eas.json profile on each platform. A cloud build puts
 * the profile's `env` block and its `EAS_BUILD*` values (the set
 * @sentry/react-native's EAS hooks read) in `process.env`. `dashboard` adds
 * what only the EAS dashboard holds.
 */
export function easBuildEnvs(eas, dashboard = () => ({})) {
  const out = [{ kind: "no EAS profile", env: {} }];
  for (const [profile, config] of Object.entries(eas?.build ?? {})) {
    for (const platform of PLATFORMS) {
      out.push({
        kind: `${profile} ${platform}`,
        env: {
          EAS_BUILD: "true",
          EAS_BUILD_ID: "00000000-0000-0000-0000-000000000001",
          EAS_BUILD_PROFILE: profile,
          EAS_BUILD_PLATFORM: platform,
          EAS_BUILD_PROJECT_ID: EAS_PROJECT_ID,
          EAS_BUILD_GIT_COMMIT_HASH: "0".repeat(40),
          EAS_BUILD_USERNAME: "permanent-identifiers-lock",
          EAS_BUILD_WORKINGDIR: "/build",
          ...(config?.env ?? {}),
          ...dashboard(profile, platform),
        },
      });
    }
  }
  return out;
}

export function lockSelfProblems(source) {
  const problems = [];
  const pins = [
    ["SCHEME", "frapp"],
    ["SLUG", "frapp"],
    ["BUNDLE_ID", "live.frapp.mobile"],
    ["SENTRY_ORG", "frapp-live"],
    ["EAS_PROJECT_ID", "4ba05e35-7d91-4bb4-9597-be754127de95"],
  ];
  for (const [name, value] of pins) {
    const match = source.match(new RegExp(`^export const ${name} = "([^"]+)";?$`, "m"));
    if (!match || match[1] !== value) problems.push(`${name} must stay ${value}`);
  }
  const lines = [
    ['const APP_JSON = "apps/mobile/app.json";', "must read apps/mobile/app.json"],
    ['const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile");', "the hostname walk must start at apps/mobile"],
    ['const PACKAGES_ROOT = join(REPO_ROOT, "packages");', "bundled packages must resolve under packages/"],
    [
      'const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", ".turbo", "coverage", "ios", "android", "__tests__"]);',
      "SKIP_DIRS must stay the build-output, generated-native and test directories only",
    ],
    ["const SOURCE_EXT = /\\.(?:json|js|mjs|cjs|ts|tsx)$/;", "SOURCE_EXT must keep every source extension"],
    ["const TEST_FILE = /\\.(?:spec|test)\\.[^.]+$/;", "TEST_FILE must skip only spec and test files"],
    [
      "if (!SKIP_DIRS.has(entry.name)) out.push(...walkSources(path));",
      "walkSources must skip only SKIP_DIRS",
    ],
    [
      "if (!entry.isFile() || !SOURCE_EXT.test(entry.name) || TEST_FILE.test(entry.name)) continue;",
      "walkSources must skip only non-sources and test files",
    ],
  ];
  const trimmed = new Set(source.split("\n").map((line) => line.trim()));
  for (const [line, problem] of lines) {
    if (!trimmed.has(line)) problems.push(problem);
  }
  const domains = source.match(/^export const HOSTING_PLATFORM_DOMAINS = \[([^\]]*)\];?$/m);
  const listed = domains ? [...domains[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
  for (const domain of ["onrender.com", "vercel.app", "run.app"]) {
    if (!listed.includes(domain)) problems.push(`HOSTING_PLATFORM_DOMAINS must keep ${domain}`);
  }
  const floor = source.match(/^const MIN_MOBILE_SOURCES = (\d+);?$/m);
  if (!floor || Number(floor[1]) < 150) {
    problems.push("MIN_MOBILE_SOURCES must stay at least 150");
  }
  return problems;
}

function walkSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkSources(path));
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXT.test(entry.name) || TEST_FILE.test(entry.name)) continue;
    out.push({
      rel: relative(REPO_ROOT, path).replaceAll("\\", "/"),
      source: readFileSync(path, "utf8"),
    });
  }
  return out;
}

/** Workspace packages under `root`. A directory with no package.json (a branch's leftover dist/) isn't one. */
export function workspacePackages(root = PACKAGES_ROOT) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "package.json")))
    .map((entry) => {
      const dir = join(root, entry.name);
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return { name: pkg.name, dir, dependencies: pkg.dependencies };
    });
}

function liveAppJson() {
  return JSON.parse(readRepo(APP_JSON));
}

function liveEas() {
  return JSON.parse(readRepo(EAS_JSON));
}

/** Runs `fn` with only `env`'s build variables in `process.env`, then restores it. */
function withBuildEnv(env, fn) {
  const easEnvKeys = new Set(Object.values(liveEas().build ?? {}).flatMap((config) => Object.keys(config?.env ?? {})));
  const isBuildVar = (key) =>
    /^(?:EAS_|EXPO_PUBLIC_)/.test(key) || key === "GOOGLE_SERVICES_JSON" || easEnvKeys.has(key) || key in env;
  const saved = Object.fromEntries(
    Object.keys(process.env)
      .filter(isBuildVar)
      .map((key) => [key, process.env[key]]),
  );
  for (const key of Object.keys(saved)) delete process.env[key];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) if (isBuildVar(key)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

/** Calls a config function the way Expo does: its default export, with `{ config }`, reading `process.env`. */
export function resolveExpoConfig(configFunction, staticExpo, env) {
  return withBuildEnv(env, () => configFunction({ config: structuredClone(staticExpo) }));
}

function loadAppConfig() {
  const resolved = requireCjs.resolve(join(REPO_ROOT, APP_CONFIG));
  delete requireCjs.cache[resolved];
  return requireCjs(resolved);
}

test("app.json carries every permanent identifier", () => {
  assert.deepEqual(identityProblems(liveAppJson().expo), []);
});

test("app.config.js, as Expo calls it, leaves every permanent identifier alone on every build", () => {
  const appConfig = loadAppConfig();
  const staticExpo = liveAppJson().expo;
  // An Android build refuses on production unless Firebase's client config exists on disk.
  const scratch = mkdtempSync(join(tmpdir(), "permanent-identifiers-"));
  const googleServicesFile = join(scratch, "google-services.json");
  writeFileSync(googleServicesFile, "{}\n");
  const dashboard = (profile, platform) => ({
    ...(profile === "production"
      ? {
          EXPO_PUBLIC_SUPABASE_URL: appConfig.PRODUCTION_SUPABASE_ORIGIN,
          EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_permanentidentifierslock",
        }
      : {}),
    ...(platform === "android" ? { GOOGLE_SERVICES_JSON: googleServicesFile } : {}),
  });
  try {
    const builds = easBuildEnvs(liveEas(), dashboard);
    assert.ok(builds.length >= 7, `expected no-profile plus 3 profiles × 2 platforms, got ${builds.length}`);
    for (const { kind, env } of builds) {
      const resolved = resolveExpoConfig(appConfig, staticExpo, env);
      assert.deepEqual(dynamicLayerProblems(staticExpo, resolved), [], kind);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the calendar export still writes the event-details deep link the screen reads", () => {
  assert.deepEqual(eventDetailsDeepLinkProblems(readRepo(EVENT_DETAILS)), []);
});

test("every eas.json URL for our own services is a frapp.live origin", () => {
  assert.deepEqual(easOwnServiceUrlProblems(liveEas()), []);
});

test("apps/mobile and every package it bundles name no hosting-platform hostname", () => {
  const mobile = walkSources(MOBILE_ROOT);
  assert.ok(
    mobile.length >= MIN_MOBILE_SOURCES,
    `walked only ${mobile.length} apps/mobile sources; expected at least ${MIN_MOBILE_SOURCES}`,
  );
  for (const rel of [APP_JSON, EAS_JSON, APP_CONFIG]) {
    assert.ok(mobile.some((file) => file.rel === rel), `the walk must include ${rel}`);
  }
  for (const top of ["app", "components", "lib"]) {
    assert.ok(
      mobile.some((file) => file.rel.startsWith(`apps/mobile/${top}/`)),
      `the walk must include apps/mobile/${top}/`,
    );
  }
  const bundled = bundledPackageDirs(JSON.parse(readRepo(MOBILE_PACKAGE_JSON)), workspacePackages());
  assert.ok(bundled.length > 0, `${MOBILE_PACKAGE_JSON} lists no ${WORKSPACE_SCOPE} dependency`);
  const files = [...mobile];
  for (const { name, dir } of bundled) {
    assert.ok(dir, `${name} is a ${MOBILE_PACKAGE_JSON} dependency with no packages/ directory`);
    const root = relative(REPO_ROOT, dir).replaceAll("\\", "/");
    const sources = walkSources(dir);
    assert.ok(
      sources.some((file) => file.rel.slice(root.length + 1).includes("/")),
      `walked no sources below ${root}/ (${name}); its top-level config files alone don't count`,
    );
    files.push(...sources);
  }
  assert.deepEqual(hostingPlatformProblems(files), []);
});

test("the lock pins its own identifiers, reader and walk", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
});

// Mutations: each must fail, or the lock above proves nothing.

for (const [label, mutate, expected] of [
  ["renaming the scheme", (expo) => (expo.scheme = "signet"), "expo.scheme"],
  ["adding a second scheme", (expo) => (expo.scheme = ["frapp", "signet"]), "expo.scheme"],
  ["renaming the slug", (expo) => (expo.slug = "signet"), "expo.slug"],
  [
    "changing the iOS bundle id",
    (expo) => (expo.ios.bundleIdentifier = "live.signet.mobile"),
    "bundleIdentifier",
  ],
  ["changing the Android package", (expo) => (expo.android.package = "live.signet.mobile"), "package"],
  [
    "re-running eas init onto a new project",
    (expo) => (expo.extra.eas.projectId = "00000000-0000-0000-0000-000000000000"),
    "projectId",
  ],
  [
    "pointing updates.url at another project",
    (expo) => (expo.updates.url = "https://u.expo.dev/00000000-0000-0000-0000-000000000000"),
    "updates.url",
  ],
  [
    "moving the Sentry plugin to another org",
    (expo) => {
      const entry = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === SENTRY_PLUGIN);
      entry[1].organization = "signet";
    },
    "organization",
  ],
  [
    "dropping the Sentry plugin",
    (expo) => {
      expo.plugins = expo.plugins.filter((plugin) => !(Array.isArray(plugin) && plugin[0] === SENTRY_PLUGIN));
    },
    "organization",
  ],
]) {
  test(`${label} fails`, () => {
    const expo = structuredClone(liveAppJson().expo);
    mutate(expo);
    const problems = identityProblems(expo);
    assert.ok(
      problems.some((problem) => problem.includes(expected)),
      problems.join("; ") || "no problems",
    );
  });
}

// A config function standing in for an edited app.config.js, run through the
// same harness as the real one, against one of the build environments it sees.
const renameOn = (predicate, field) => ({ config }) =>
  predicate(process.env) ? { ...config, ...field(config) } : config;

for (const [label, override, expected, envFrom] of [
  [
    "renames the scheme and bundle id",
    renameOn(() => true, (config) => ({ scheme: "signet", ios: { ...config.ios, bundleIdentifier: "live.signet.mobile" } })),
    ["expo.scheme", "expo.ios.bundleIdentifier"],
    "no EAS profile",
  ],
  ["renames the app", renameOn(() => true, () => ({ name: "Chapter" })), ["expo.name"], "no EAS profile"],
  [
    "repoints updates.url",
    renameOn(() => true, (config) => ({ updates: { ...config.updates, url: "https://u.expo.dev/other" } })),
    ["expo.updates.url"],
    "no EAS profile",
  ],
  [
    "renames only on a production build",
    renameOn((env) => env.EAS_BUILD_PROFILE === "production", () => ({ slug: "signet" })),
    ["expo.slug"],
    "production ios",
  ],
  [
    "renames only on an EAS build",
    renameOn((env) => env.EAS_BUILD === "true", () => ({ slug: "signet" })),
    ["expo.slug"],
    "preview android",
  ],
  [
    "renames on a value from the profile's eas.json env",
    renameOn((env) => env.EXPO_PUBLIC_SENTRY_ENVIRONMENT === "production", () => ({ slug: "signet" })),
    ["expo.slug"],
    "production android",
  ],
  [
    "renames only on the development profile",
    renameOn((env) => env.EAS_BUILD_PROFILE === "development", () => ({ slug: "signet" })),
    ["expo.slug"],
    "development ios",
  ],
  [
    "renames only on preview for iOS",
    renameOn((env) => env.EAS_BUILD_PROFILE === "preview" && env.EAS_BUILD_PLATFORM === "ios", () => ({
      slug: "signet",
    })),
    ["expo.slug"],
    "preview ios",
  ],
]) {
  test(`a config function that ${label} fails the dynamic-layer check`, () => {
    const staticExpo = liveAppJson().expo;
    const build = easBuildEnvs(liveEas()).find((candidate) => candidate.kind === envFrom);
    assert.ok(build, `no ${envFrom} build in easBuildEnvs`);
    const problems = dynamicLayerProblems(staticExpo, resolveExpoConfig(override, staticExpo, build.env));
    for (const field of expected) {
      assert.ok(
        problems.some((problem) => problem.includes(`changes ${field} `)),
        `${field}: ${problems.join("; ") || "no problems"}`,
      );
    }
  });
}

test("the simulated builds carry each profile's eas.json env and the EAS build values", () => {
  const eas = {
    build: {
      production: { env: { APP_VARIANT: "store", EXPO_PUBLIC_API_URL: "https://api.frapp.live" } },
      preview: {},
    },
  };
  const builds = easBuildEnvs(eas, (profile) => (profile === "production" ? { DASHBOARD_ONLY: "1" } : {}));
  assert.deepEqual(
    builds.map((build) => build.kind),
    ["no EAS profile", "production ios", "production android", "preview ios", "preview android"],
  );
  const production = builds.find((build) => build.kind === "production android").env;
  assert.equal(production.APP_VARIANT, "store");
  assert.equal(production.EAS_BUILD, "true");
  assert.equal(production.EAS_BUILD_PLATFORM, "android");
  assert.equal(production.DASHBOARD_ONLY, "1");
  assert.deepEqual(builds[0].env, {});
});

test("resolveExpoConfig clears ambient build variables and restores process.env", () => {
  const before = { EAS_BUILD: process.env.EAS_BUILD, EXPO_PUBLIC_X: process.env.EXPO_PUBLIC_X };
  process.env.EAS_BUILD = "true";
  process.env.EXPO_PUBLIC_X = "ambient";
  try {
    const seen = resolveExpoConfig(
      ({ config }) => ({ ...config, seen: [process.env.EAS_BUILD, process.env.EXPO_PUBLIC_X] }),
      liveAppJson().expo,
      {},
    ).seen;
    assert.deepEqual(seen, [undefined, undefined]);
    assert.equal(process.env.EAS_BUILD, "true");
    assert.equal(process.env.EXPO_PUBLIC_X, "ambient");
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

for (const [label, find, replace, expected] of [
  [
    "changing the deep link's route",
    "`frapp://event-details?id=${",
    "`frapp://events?id=${",
    "deepLinkUrl",
  ],
  [
    "renaming the deep link's param",
    "`frapp://event-details?id=${",
    "`frapp://event-details?eventId=${",
    "deepLinkUrl",
  ],
  ["renaming the screen's param", "useLocalSearchParams<{ id?:", "useLocalSearchParams<{ eventId?:", "id param"],
]) {
  test(`${label} fails`, () => {
    const source = readRepo(EVENT_DETAILS);
    assert.ok(source.includes(find), `fixture drift: ${EVENT_DETAILS} no longer contains ${find}`);
    const problems = eventDetailsDeepLinkProblems(source.replace(find, replace));
    assert.ok(
      problems.some((problem) => problem.includes(expected)),
      problems.join("; ") || "no problems",
    );
  });
}

test("a hosting-platform hostname fails when written out, templated, concatenated or held as a domain", () => {
  assert.deepEqual(
    hostingPlatformProblems([
      { rel: "apps/mobile/lib/a.ts", source: 'const api = "https://frapp-api-prod.onrender.com";' },
      { rel: "apps/mobile/lib/b.ts", source: "// was https://frapp-web.vercel.app/join\nconst ok = 1;" },
      { rel: "apps/mobile/lib/c.ts", source: 'fetch("https://frapp-api-abc123-uc.a.run.app/v1")' },
      { rel: "apps/mobile/lib/d.ts", source: "const u = `https://${svc}.onrender.com`;" },
      { rel: "apps/mobile/lib/e.ts", source: 'const u = "frapp-api" + ".onrender.com";' },
      { rel: "packages/observability/src/f.ts", source: 'const u = svc + ".run.app";' },
      { rel: "packages/observability/src/g.ts", source: 'const RENDER_DOMAIN = "onrender.com";' },
      { rel: "packages/observability/src/h.ts", source: "const u = [name, 'vercel.app'].join('.');" },
    ]),
    [
      "apps/mobile/lib/a.ts:1: frapp-api-prod.onrender.com",
      "apps/mobile/lib/b.ts:1: frapp-web.vercel.app",
      "apps/mobile/lib/c.ts:1: frapp-api-abc123-uc.a.run.app",
      "apps/mobile/lib/d.ts:1: .onrender.com",
      "apps/mobile/lib/e.ts:1: .onrender.com",
      'apps/mobile/lib/e.ts:1: ".onrender.com"',
      "packages/observability/src/f.ts:1: .run.app",
      'packages/observability/src/f.ts:1: ".run.app"',
      'packages/observability/src/g.ts:1: "onrender.com"',
      "packages/observability/src/h.ts:1: 'vercel.app'",
    ],
  );
});

test("a platform or bare domain name without a hostname passes", () => {
  assert.deepEqual(
    hostingPlatformProblems([
      { rel: "apps/mobile/lib/a.ts", source: "// Render hosts the API; run.app is Cloud Run's domain." },
      { rel: "apps/mobile/lib/b.ts", source: 'const label = "Deployed on vercel.app";' },
      { rel: "apps/mobile/lib/c.ts", source: 'const other = "https://api.frapp.live/run.application";' },
    ]),
    [],
  );
});

test("pointing an eas.json profile at a platform or unowned host fails", () => {
  const eas = liveEas();
  eas.build.preview.env.EXPO_PUBLIC_API_URL = "https://frapp-api-staging.onrender.com";
  eas.build.preview.env.EXPO_PUBLIC_APP_URL = "https://frapp-staging.netlify.app";
  eas.build.development.env.EXPO_PUBLIC_APP_URL = "https://api.example.com";
  assert.deepEqual(easOwnServiceUrlProblems(eas), [
    "build.development.env.EXPO_PUBLIC_APP_URL must be an https frapp.live origin, not https://api.example.com",
    "build.preview.env.EXPO_PUBLIC_API_URL must be an https frapp.live origin, not https://frapp-api-staging.onrender.com",
    "build.preview.env.EXPO_PUBLIC_APP_URL must be an https frapp.live origin, not https://frapp-staging.netlify.app",
  ]);
});

test("a look-alike or plain-http frapp.live host fails; loopback passes only on development", () => {
  const eas = liveEas();
  eas.build.preview.env.EXPO_PUBLIC_API_URL = "https://api.frapp.live.example.com";
  eas.build.production.env.EXPO_PUBLIC_APP_URL = "http://app.frapp.live";
  eas.build.development.env.EXPO_PUBLIC_APP_URL = "http://127.0.0.1:3000";
  assert.deepEqual(easOwnServiceUrlProblems(eas), [
    "build.preview.env.EXPO_PUBLIC_API_URL must be an https frapp.live origin, not https://api.frapp.live.example.com",
    "build.production.env.EXPO_PUBLIC_APP_URL must be an https frapp.live origin, not http://app.frapp.live",
  ]);
  eas.build.preview.env.EXPO_PUBLIC_API_URL = "http://localhost:3001";
  assert.deepEqual(
    easOwnServiceUrlProblems(eas).filter((problem) => problem.startsWith("build.preview")),
    ["build.preview.env.EXPO_PUBLIC_API_URL must be an https frapp.live origin, not http://localhost:3001"],
  );
});

test("bundled packages follow workspace dependencies transitively, and ignore dev-only ones", () => {
  const packages = [
    { name: "@repo/theme", dir: "/p/theme", dependencies: { "@repo/color": "*" } },
    { name: "@repo/color", dir: "/p/color", dependencies: {} },
    { name: "@repo/eslint-config", dir: "/p/eslint-config", dependencies: {} },
    { name: "@repo/landing-only", dir: "/p/landing-only", dependencies: {} },
  ];
  assert.deepEqual(
    bundledPackageDirs(
      { dependencies: { "@repo/theme": "*", react: "19.2.3" }, devDependencies: { "@repo/eslint-config": "*" } },
      packages,
    ),
    [
      { name: "@repo/color", dir: "/p/color" },
      { name: "@repo/theme", dir: "/p/theme" },
    ],
  );
  assert.deepEqual(bundledPackageDirs({ dependencies: { "@repo/gone": "*" } }, packages), [
    { name: "@repo/gone", dir: null },
  ]);
});

test("a packages/ directory with no package.json is skipped, not read", () => {
  const root = mkdtempSync(join(tmpdir(), "permanent-identifiers-packages-"));
  try {
    mkdirSync(join(root, "real"));
    writeFileSync(join(root, "real", "package.json"), JSON.stringify({ name: "@repo/real" }));
    mkdirSync(join(root, "leftover", "dist"), { recursive: true });
    assert.deepEqual(
      workspacePackages(root).map((pkg) => pkg.name),
      ["@repo/real"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [label, find, replace, expected] of [
  ["rewriting SCHEME with app.json", 'export const SCHEME = "frapp"', 'export const SCHEME = "signet"', "SCHEME"],
  [
    "rewriting BUNDLE_ID with app.json",
    'export const BUNDLE_ID = "live.frapp.mobile"',
    'export const BUNDLE_ID = "live.signet.mobile"',
    "BUNDLE_ID",
  ],
  [
    "rewriting EAS_PROJECT_ID after an eas init",
    'export const EAS_PROJECT_ID = "4ba05e35-7d91-4bb4-9597-be754127de95"',
    'export const EAS_PROJECT_ID = "00000000-0000-0000-0000-000000000000"',
    "EAS_PROJECT_ID",
  ],
  [
    "pointing the reader at another app.json",
    'const APP_JSON = "apps/mobile/app.json"',
    'const APP_JSON = "apps/landing/app.json"',
    "apps/mobile/app.json",
  ],
  [
    "narrowing the walk's root",
    'const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile")',
    'const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile/lib")',
    "start at apps/mobile",
  ],
  [
    "skipping a source directory in SKIP_DIRS",
    '"ios", "android", "__tests__"]);',
    '"ios", "android", "__tests__", "components"]);',
    "SKIP_DIRS",
  ],
  [
    "skipping a source directory inside walkSources",
    "      if (!SKIP_DIRS.has(entry.name)) out.push(...walkSources(path));",
    '      if (!SKIP_DIRS.has(entry.name) && entry.name !== "chat") out.push(...walkSources(path));',
    "walkSources must skip only SKIP_DIRS",
  ],
  [
    "skipping a file kind inside walkSources",
    "    if (!entry.isFile() || !SOURCE_EXT.test(entry.name) || TEST_FILE.test(entry.name)) continue;",
    '    if (!entry.isFile() || !SOURCE_EXT.test(entry.name) || TEST_FILE.test(entry.name) || entry.name.endsWith(".tsx")) continue;',
    "walkSources must skip only non-sources",
  ],
  ["dropping an extension", "(?:json|js|mjs|cjs|ts|tsx)$/;", "(?:json|js|mjs|cjs|ts)$/;", "SOURCE_EXT"],
  [
    "dropping a hosting platform from the ban",
    'export const HOSTING_PLATFORM_DOMAINS = ["onrender.com", "vercel.app", "run.app"]',
    'export const HOSTING_PLATFORM_DOMAINS = ["vercel.app", "run.app"]',
    "onrender.com",
  ],
  [
    "lowering the walk floor",
    "const MIN_MOBILE_SOURCES = 150",
    "const MIN_MOBILE_SOURCES = 0",
    "MIN_MOBILE_SOURCES",
  ],
]) {
  test(`${label} fails the lock's self-check`, () => {
    const source = readFileSync(LOCK, "utf8");
    assert.ok(source.includes(find), `fixture drift: the lock no longer contains ${find}`);
    const problems = lockSelfProblems(source.replace(find, replace));
    assert.ok(
      problems.some((problem) => problem.includes(expected)),
      problems.join("; ") || "no problems",
    );
  });
}
