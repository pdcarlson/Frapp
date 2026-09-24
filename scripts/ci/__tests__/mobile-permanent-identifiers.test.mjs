// Locks the names a shipped mobile binary carries for good.
//
// WHY THIS EXISTS. Every install keeps the binary it was built from until its
// owner updates from the store, and nothing reaches it over the air that its
// native config didn't already allow (#2526). ADR-25 made the identifiers
// below permanent and cancelled the frapp → signet identifier rename. The
// first store upload fixes each one: App Store Connect and Play bind the
// bundle id and package; the OS routes `frapp://` links to whichever app owns
// the scheme; `.ics` files already sitting in members' calendars carry
// `frapp://event-details?id=…`; and every binary asks EAS Update and the Expo
// push service for this EAS project by id. A leftover sweep or a well-meant
// tidy that renames one ships a binary that can't reach what the old ones
// left behind, with nothing failing until a member taps a dead link.
//
// WHAT IT CHECKS.
// - `apps/mobile/app.json`: slug and scheme `frapp`, iOS bundle id and
//   Android package `live.frapp.mobile`, the Sentry org `frapp-live`
//   (ADR-25), and the EAS project id that `updates.url` bakes in (#2622).
// - `apps/mobile/app.config.js` run over that config with no EAS profile, as
//   a preview build, and as a production build on each platform: the dynamic
//   layer leaves every one of them alone.
// - The `.ics` deep link: the calendar export still writes
//   `frapp://event-details?id=…`, and the screen still declares the `id`
//   param that URL carries.
// - No hosting-platform hostname (Render, Vercel, Cloud Run: ADR-24's current
//   and planned hosts) anywhere in apps/mobile's non-spec sources, comments
//   included, and every `eas.json` URL for our own services
//   (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_APP_URL`) is an https `frapp.live`
//   origin. The development profile may use a loopback http origin.
//
// WHAT OTHER LOCKS OWN. Not restated here, so each fact has one pin:
// - `expo.name` is `Frapp`: frapp-mobile-copy.test.mjs.
// - The production binary's API origin is `https://api.frapp.live`:
//   eas-production-profile.test.mjs pins `eas.json`, and `app.config.js`
//   refuses a production build whose `EXPO_PUBLIC_API_URL` differs.
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
// Changing any value here is an ADR-level decision, not a lock edit: record
// it in spec/architecture/adr/ first. The assignment lines are pinned below,
// because a lock that reads its own constants passes when the constant and
// app.json are renamed together.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile");
const requireCjs = createRequire(import.meta.url);

const APP_JSON = "apps/mobile/app.json";
const APP_CONFIG = "apps/mobile/app.config.js";
const EAS_JSON = "apps/mobile/eas.json";
const EVENT_DETAILS = "apps/mobile/app/(tabs)/event-details.tsx";

export const SCHEME = "frapp";
export const SLUG = "frapp";
export const BUNDLE_ID = "live.frapp.mobile";
export const SENTRY_ORG = "frapp-live";
export const EAS_PROJECT_ID = "4ba05e35-7d91-4bb4-9597-be754127de95";

const SENTRY_PLUGIN = "@sentry/react-native/expo";

/** ADR-24's hosts for the API and web, today and planned. */
export const HOSTING_PLATFORM_DOMAINS = ["onrender.com", "vercel.app", "run.app"];
/** The eas.json keys that address this repo's own services. */
const OWN_SERVICE_URL_KEYS = ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_APP_URL"];
const OWN_DOMAIN = "frapp.live";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** apps/mobile has well over this many sources; fewer means the walk broke. */
const MIN_WALKED_SOURCES = 100;
const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", "coverage", "ios", "android"]);
const SOURCE_EXT = /\.(?:json|js|ts|tsx)$/;

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
  const org = sentryOrganization(expo);
  if (org !== SENTRY_ORG) {
    problems.push(`the ${SENTRY_PLUGIN} plugin's organization must be ${SENTRY_ORG}, not ${describe(org)}`);
  }
  return problems;
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

function hostingPlatformPattern(domains = HOSTING_PLATFORM_DOMAINS) {
  const alternatives = domains.map((domain) => domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?:^|[^a-z0-9.-])((?:[a-z0-9-]+\\.)+(?:${alternatives.join("|")}))\\b`, "gi");
}

/** `files` is `[{ rel, source }]`. */
export function hostingPlatformProblems(files) {
  const problems = [];
  for (const { rel, source } of files) {
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(hostingPlatformPattern())) {
        problems.push(`${rel}:${index + 1}: ${match[1]}`);
      }
    });
  }
  return problems;
}

function isOwnHttpsOrigin(url) {
  return url.protocol === "https:" && (url.hostname === OWN_DOMAIN || url.hostname.endsWith(`.${OWN_DOMAIN}`));
}

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
  const appJson = source.match(/^const APP_JSON = "([^"]+)";?$/m);
  if (!appJson || appJson[1] !== "apps/mobile/app.json") {
    problems.push("must read apps/mobile/app.json");
  }
  const mobileRoot = source.match(/^const MOBILE_ROOT = join\(REPO_ROOT, "([^"]+)"\);?$/m);
  if (!mobileRoot || mobileRoot[1] !== "apps/mobile") {
    problems.push("the hostname walk must start at apps/mobile");
  }
  const domains = source.match(/^export const HOSTING_PLATFORM_DOMAINS = \[([^\]]*)\];?$/m);
  const listed = domains ? [...domains[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
  for (const domain of ["onrender.com", "vercel.app", "run.app"]) {
    if (!listed.includes(domain)) problems.push(`HOSTING_PLATFORM_DOMAINS must keep ${domain}`);
  }
  const floor = source.match(/^const MIN_WALKED_SOURCES = (\d+);?$/m);
  if (!floor || Number(floor[1]) < 100) {
    problems.push("MIN_WALKED_SOURCES must stay at least 100");
  }
  return problems;
}

function walkMobileSources(dir = MOBILE_ROOT) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkMobileSources(path));
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXT.test(entry.name) || /\.spec\./.test(entry.name)) continue;
    out.push({
      rel: relative(REPO_ROOT, path).replaceAll("\\", "/"),
      source: readFileSync(path, "utf8"),
    });
  }
  return out;
}

function liveAppJson() {
  return JSON.parse(readRepo(APP_JSON));
}

function liveEas() {
  return JSON.parse(readRepo(EAS_JSON));
}

function loadAppConfig() {
  const resolved = requireCjs.resolve(join(REPO_ROOT, APP_CONFIG));
  delete requireCjs.cache[resolved];
  return requireCjs(resolved);
}

/** Env sets `app.config.js` accepts, one per kind of build that can ship. */
function buildEnvs(appConfig) {
  const productionEnv = {
    EAS_BUILD_PROFILE: "production",
    EXPO_PUBLIC_API_URL: liveEas().build.production.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_SUPABASE_URL: appConfig.PRODUCTION_SUPABASE_ORIGIN,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_permanentidentifierslock",
  };
  return {
    "no EAS profile": {},
    preview: { EAS_BUILD_PROFILE: "preview" },
    "production iOS": { ...productionEnv, EAS_BUILD_PLATFORM: "ios" },
    "production Android": {
      ...productionEnv,
      EAS_BUILD_PLATFORM: "android",
      GOOGLE_SERVICES_JSON: "/permanent-identifiers-lock/google-services.json",
    },
  };
}

test("app.json carries every permanent identifier", () => {
  assert.deepEqual(identityProblems(liveAppJson().expo), []);
});

test("app.config.js leaves every permanent identifier alone, on every kind of build", () => {
  const appConfig = loadAppConfig();
  for (const [kind, env] of Object.entries(buildEnvs(appConfig))) {
    const config = appConfig.applyMobileConfig(structuredClone(liveAppJson().expo), {
      env,
      existsSync: (path) => path === env.GOOGLE_SERVICES_JSON,
    });
    assert.deepEqual(identityProblems(config), [], kind);
  }
});

test("the calendar export still writes the event-details deep link the screen reads", () => {
  assert.deepEqual(eventDetailsDeepLinkProblems(readRepo(EVENT_DETAILS)), []);
});

test("apps/mobile names no hosting-platform hostname", () => {
  const files = walkMobileSources();
  assert.ok(
    files.length >= MIN_WALKED_SOURCES,
    `walked only ${files.length} apps/mobile sources; expected at least ${MIN_WALKED_SOURCES}`,
  );
  assert.ok(files.some((file) => file.rel === APP_JSON), "the walk must include app.json");
  assert.ok(files.some((file) => file.rel === EAS_JSON), "the walk must include eas.json");
  assert.deepEqual(hostingPlatformProblems(files), []);
});

test("every eas.json URL for our own services is a frapp.live origin", () => {
  assert.deepEqual(easOwnServiceUrlProblems(liveEas()), []);
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

test("a dynamic layer that overrides an identifier fails", () => {
  const appConfig = loadAppConfig();
  const config = appConfig.applyMobileConfig(structuredClone(liveAppJson().expo), { env: {} });
  const overridden = { ...config, ios: { ...config.ios, bundleIdentifier: "live.signet.mobile" } };
  assert.deepEqual(identityProblems(overridden), [
    "expo.ios.bundleIdentifier must be live.frapp.mobile, not \"live.signet.mobile\"",
  ]);
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

test("a hosting-platform hostname in source fails, in code or in a comment", () => {
  assert.deepEqual(
    hostingPlatformProblems([
      { rel: "apps/mobile/lib/a.ts", source: 'const api = "https://frapp-api-prod.onrender.com";' },
      { rel: "apps/mobile/lib/b.ts", source: "// was https://frapp-web.vercel.app/join\nconst ok = 1;" },
      { rel: "apps/mobile/lib/c.ts", source: 'fetch("https://frapp-api-abc123-uc.a.run.app/v1")' },
    ]),
    [
      "apps/mobile/lib/a.ts:1: frapp-api-prod.onrender.com",
      "apps/mobile/lib/b.ts:1: frapp-web.vercel.app",
      "apps/mobile/lib/c.ts:1: frapp-api-abc123-uc.a.run.app",
    ],
  );
});

test("a platform or bare domain name without a hostname passes", () => {
  assert.deepEqual(
    hostingPlatformProblems([
      { rel: "apps/mobile/lib/a.ts", source: "// Render hosts the API; run.app is Cloud Run's domain." },
      { rel: "apps/mobile/lib/b.ts", source: 'const label = "Deployed on vercel.app";' },
    ]),
    [],
  );
});

test("pointing an eas.json profile at a platform hostname fails", () => {
  const eas = liveEas();
  eas.build.preview.env.EXPO_PUBLIC_API_URL = "https://frapp-api-staging.onrender.com";
  eas.build.production.env.EXPO_PUBLIC_APP_URL = "https://frapp-web.vercel.app";
  assert.deepEqual(easOwnServiceUrlProblems(eas), [
    "build.preview.env.EXPO_PUBLIC_API_URL must be an https frapp.live origin, not https://frapp-api-staging.onrender.com",
    "build.production.env.EXPO_PUBLIC_APP_URL must be an https frapp.live origin, not https://frapp-web.vercel.app",
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
    "narrowing the walk",
    'const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile")',
    'const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile/lib")',
    "walk",
  ],
  [
    "dropping a hosting platform from the ban",
    'export const HOSTING_PLATFORM_DOMAINS = ["onrender.com", "vercel.app", "run.app"]',
    'export const HOSTING_PLATFORM_DOMAINS = ["vercel.app", "run.app"]',
    "onrender.com",
  ],
  [
    "lowering the walk floor",
    "const MIN_WALKED_SOURCES = 100",
    "const MIN_WALKED_SOURCES = 0",
    "MIN_WALKED_SOURCES",
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
