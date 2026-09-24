// Dynamic layer over app.json. Expo loads app.json first and hands it to this
// function as `config`; everything static stays in app.json (which is what
// `expo-doctor`'s schema check and #1801 validate). This file exists for the
// fields that cannot be static: Firebase's Android client config path, and
// the EAS production fences on public env that is inlined into the store
// binary. `extra.gitSha` is the EAS git SHA (`EAS_BUILD_GIT_COMMIT_HASH`)
// for Sentry metadata — it is never the Sentry `release` name.
//
// Push on Android goes through FCM, and `expo-notifications` reads FCM's
// client config from `android.googleServicesFile` at prebuild. Without it a
// production Android build compiles and runs, but `getExpoPushTokenAsync()`
// throws ("Default FirebaseApp is not initialized") — `use-push-runtime.ts`
// catches that, so the member sees no error and simply never receives a push.
// A static `googleServicesFile` in app.json would make `expo prebuild` fail
// wherever the file is absent — CI, every laptop without the Firebase console
// export — so the field is set only when a file is actually there:
//
//   1. `GOOGLE_SERVICES_JSON` — the path EAS materialises a **file**
//      environment variable at (expo.dev → project → Environment variables →
//      type "File", scoped to the `production` and `preview` environments the
//      build profiles in eas.json bind to). Preferred: nothing is committed.
//   2. `./google-services.json` next to this file — for a local build. The
//      file carries a Google API key (`AIza…`) that gitleaks' default
//      `gcp-api-key` rule flags, so committing it needs an entry in
//      `.gitleaks.toml`; the file-variable path avoids the question.
//
// An EAS **production Android** build (`EAS_BUILD_PROFILE=production` and
// `EAS_BUILD_PLATFORM` not `ios`) refuses to evaluate this config when neither
// path exists. That is the store-binary fence: a production APK cannot ship
// with silent-dead push. CI (`npx expo prebuild`) and `expo start` do not set
// `EAS_BUILD_PROFILE`, so they still omit the field. iOS production builds
// skip the Google-services fence — APNs does not use this file. Preview and
// development omit the field when the file is absent, so an internal tester
// APK can still compile before the Firebase project exists (#1826).
//
// Every EAS **production** build (iOS and Android) also refuses when
// `EXPO_PUBLIC_API_URL` is not the origin in `eas.json` →
// `build.production.env`, when `EXPO_PUBLIC_SUPABASE_URL` /
// `EXPO_PUBLIC_SUPABASE_ANON_KEY` are empty, or when the Supabase URL is
// not the `frapp-prod` origin from `.github/environments.json`. Presence
// alone used to accept a staging project URL. Those values are inlined
// into the store binary; a missing or staging value is a first-user dead
// sign-in, not a dashboard that can be fixed later. A set
// `EXPO_PUBLIC_APP_URL` must be `https://app.frapp.live`; unset still
// falls back at runtime.
//
// Every EAS **production** build also refuses a Supabase key that is not a
// publishable key (`sb_publishable_…`, #2526), or that carries whitespace
// around it. Supabase keeps the legacy JWT `anon` key working only "until the
// end of 2026", and a store binary outlives that: every install keeps the key
// it was built with until its owner updates from the store, so a legacy key
// would go dead in the field. Expo inlines the value verbatim and
// `lib/supabase.ts` doesn't trim it, so a pasted trailing newline would ship
// too. The variable keeps its `ANON_KEY` name because EAS and every doc already
// use it; renaming it is a separate change.
//
// And the config refuses a **secret** key on every profile, and whenever it is
// evaluated, not only for production: a `sb_secret_…` key, or a JWT whose role
// isn't `anon` (`service_role` bypasses RLS), and anything in an
// `EXPO_PUBLIC_*` variable is inlined into the bundle. A preview build is still
// an installable binary anyone can unpack.
//
// Every EAS build, whatever its profile, also allows only a client key once the
// Supabase key is set: the publishable key or an anon JWT, with no whitespace
// around it. Its binary goes to testers or the store, and a value pasted from
// the wrong field (the legacy JWT secret, an access token) has no shape the
// secret check could refuse. Unset still builds (nothing is inlined), and a run
// with no EAS profile keeps only the secret check, so local placeholders work.
//
// Every EAS **production** build also refuses when `EXPO_PUBLIC_ASK_ENABLED`
// switches Ask on (#2259). Ask answers from a synthetic corpus
// (`lib/ask/corpus.ts`), and the App Store listing and review notes describe
// a binary with no Ask surface. The parse is `lib/ask/flag.ts`'s exactly:
// `"1"` or `"true"` after trimming is on, anything else is off, so a value
// the app would read as off is not refused either. This is the half of
// "production has no Ask" that `eas.json` cannot show, because an
// `eas env:set --environment production` reaches the bundle with no repo
// change; with this fence such a value fails the build instead of shipping.
//
// The FCM V1 *service account* key (what Expo's push service uses to send) is
// a separate upload under EAS credentials → Android → FCM V1; it never touches
// this repo. iOS needs neither: EAS generates the APNs key on the first
// `eas build -p ios` against the Apple account.
//
// Source of truth for the credential inventory:
// docs/internal/environment/ENV_REFERENCE.md § apps/mobile (Expo — EAS).
const fs = require("node:fs");
const path = require("node:path");
const easJson = require("./eas.json");

const PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR = [
  "EAS production Android builds require Firebase client config.",
  "Set GOOGLE_SERVICES_JSON as an EAS environment variable of type File",
  "(scoped to the production environment this profile binds to), or place",
  "apps/mobile/google-services.json.",
  "Without it the APK compiles, getExpoPushTokenAsync throws, and members never receive push.",
  "See docs/internal/environment/ENV_REFERENCE.md § apps/mobile (Expo — EAS) and GitHub issue #1826.",
].join(" ");

function resolveGoogleServicesFile({
  env = process.env,
  existsSync = fs.existsSync,
  localPath = path.join(__dirname, "google-services.json"),
} = {}) {
  const fromEnv = env.GOOGLE_SERVICES_JSON;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync(localPath)) return "./google-services.json";
  return undefined;
}

function assertProductionAndroidGoogleServices({
  easBuildProfile,
  easBuildPlatform,
  googleServicesFile,
} = {}) {
  if (easBuildProfile !== "production") return;
  if (easBuildPlatform === "ios") return;
  if (googleServicesFile) return;
  throw new Error(PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR);
}

function normalizePublicOrigin(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

const PRODUCTION_API_ORIGIN = normalizePublicOrigin(
  easJson.build.production.env.EXPO_PUBLIC_API_URL,
);

if (!PRODUCTION_API_ORIGIN) {
  throw new Error(
    "apps/mobile/eas.json build.production.env.EXPO_PUBLIC_API_URL is missing.",
  );
}

const PRODUCTION_API_URL_ERROR = [
  `EAS production builds require EXPO_PUBLIC_API_URL=${PRODUCTION_API_ORIGIN}`,
  "(the origin in apps/mobile/eas.json → build.production.env, trailing slash ignored).",
  "A store binary pointed at staging, localhost, or an empty value signs",
  "members into the wrong API. Do not override it in the EAS dashboard.",
  "See docs/internal/environment/ENV_REFERENCE.md § apps/mobile (Expo — EAS).",
].join(" ");

const PRODUCTION_SUPABASE_PUBLIC_ERROR = [
  "EAS production builds require EXPO_PUBLIC_SUPABASE_URL and",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY (EAS dashboard per environment; there is",
  "no Infisical→EAS sync). Without them getSupabaseClient() returns null and",
  "the store binary shows sign-in as unavailable. See",
  "docs/internal/environment/ENV_REFERENCE.md § apps/mobile (Expo — EAS).",
].join(" ");

// Same file `scripts/ci/lib/environments.mjs` reads. A project ref is not a
// secret. Do not add a third copy of the ref in this file.
const environmentsJson = require(
  path.join(__dirname, "../../.github/environments.json"),
);

function productionSupabaseOriginFromEnvironments(
  config = environmentsJson,
) {
  const ref = config?.environments?.production?.supabaseProjectRef;
  if (typeof ref !== "string" || !/^[a-z0-9]{15,20}$/.test(ref)) {
    throw new Error(
      "apps/mobile/app.config.js: .github/environments.json production.supabaseProjectRef must be 15-20 lowercase alphanumeric characters.",
    );
  }
  return `https://${ref}.supabase.co`;
}

const PRODUCTION_SUPABASE_ORIGIN = productionSupabaseOriginFromEnvironments();

const PRODUCTION_SUPABASE_URL_ERROR = [
  `EAS production builds require EXPO_PUBLIC_SUPABASE_URL=${PRODUCTION_SUPABASE_ORIGIN}`,
  "(the frapp-prod origin from .github/environments.json).",
  "A store binary pointed at staging, localhost, or another project signs",
  "members into the wrong database. Do not override it in the EAS dashboard.",
  "See docs/internal/environment/ENV_REFERENCE.md § apps/mobile (Expo — EAS).",
].join(" ");

// Same origin @repo/validation exports as PRODUCTION_APP_ORIGIN. This file
// is CommonJS evaluated by Expo before that package's dist is a given, so
// the string is duplicated here and the validation spec pins the constant.
const PRODUCTION_APP_ORIGIN = "https://app.frapp.live";

const PRODUCTION_APP_URL_ERROR = [
  `EAS production builds require EXPO_PUBLIC_APP_URL unset or ${PRODUCTION_APP_ORIGIN}`,
  "(trailing slash ignored) when the variable is set.",
  "A store binary that inlines https://app.staging.frapp.live shares first-officer",
  "invite links into staging. Unset still falls back to the production origin at runtime.",
  "See docs/internal/environment/ENV_REFERENCE.md § apps/mobile (Expo — EAS).",
].join(" ");

function assertProductionApiUrl({ easBuildProfile, apiUrl } = {}) {
  if (easBuildProfile !== "production") return;
  if (normalizePublicOrigin(apiUrl) === PRODUCTION_API_ORIGIN) return;
  throw new Error(PRODUCTION_API_URL_ERROR);
}

function supabasePublicOrigin(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    if (parsed.protocol !== "https:") return "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "";
    if (pathname !== "") return "";
    return `https://${parsed.hostname}`;
  } catch {
    return "";
  }
}

function assertProductionSupabasePublic({
  easBuildProfile,
  supabaseUrl,
  supabaseAnonKey,
} = {}) {
  if (easBuildProfile !== "production") return;
  if (
    !String(supabaseUrl || "").trim() ||
    !String(supabaseAnonKey || "").trim()
  ) {
    throw new Error(PRODUCTION_SUPABASE_PUBLIC_ERROR);
  }
  if (supabasePublicOrigin(supabaseUrl) !== PRODUCTION_SUPABASE_ORIGIN) {
    throw new Error(PRODUCTION_SUPABASE_URL_ERROR);
  }
}

const SUPABASE_PUBLISHABLE_KEY_PREFIX = "sb_publishable_";

const PRODUCTION_SUPABASE_KEY_ERROR = [
  "EAS production builds require EXPO_PUBLIC_SUPABASE_ANON_KEY to be the",
  `frapp-prod publishable key (${SUPABASE_PUBLISHABLE_KEY_PREFIX}…), not the legacy`,
  "JWT anon key, and with no whitespace around it. Supabase supports legacy keys only until the",
  "end of 2026, and a store binary keeps its key until it is updated from the",
  "store. Copy it from Supabase → frapp-prod → Project Settings → API Keys and",
  "set it on the EAS production environment (eas env:list --environment production).",
  "See docs/internal/environment/ENV_REFERENCE.md § apps/mobile (Expo — EAS).",
].join(" ");

function assertProductionSupabasePublishableKey({
  easBuildProfile,
  supabaseAnonKey,
} = {}) {
  if (easBuildProfile !== "production") return;
  const raw = String(supabaseAnonKey || "");
  // Untrimmed on purpose: the binary gets exactly this string.
  if (raw === raw.trim() && raw.startsWith(SUPABASE_PUBLISHABLE_KEY_PREFIX)) {
    return;
  }
  throw new Error(PRODUCTION_SUPABASE_KEY_ERROR);
}

const PUBLIC_SUPABASE_SECRET_KEY_ERROR = [
  "EXPO_PUBLIC_SUPABASE_ANON_KEY holds a credential a client must not carry: a",
  "Supabase secret key (sb_secret_…) or a JWT whose role isn't anon (service_role,",
  "or a user's access token). Every EXPO_PUBLIC_* value is inlined into the app",
  "bundle, so any build would hand it to whoever unpacks the binary. Use the",
  "project's publishable key instead, and rotate the credential if a build",
  "already carried it.",
  "See docs/internal/environment/ENV_REFERENCE.md § apps/mobile (Expo — EAS).",
].join(" ");

/** The claims of a JWT-shaped key, or undefined for anything else. */
function jwtClaims(key) {
  const parts = key.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims && typeof claims === "object" ? claims : undefined;
  } catch {
    return undefined;
  }
}

// Refuses the shapes that are known credentials, on every evaluation: a secret
// key, or a JWT whose role isn't `anon` (service_role, or a user's
// `authenticated` access token). It is a denylist, so placeholder values keep
// working locally; an EAS build also has to pass assertEasSupabaseClientKey,
// the allowlist. This is the only key check on the one path with no EAS
// profile whose bundle leaves the machine, the export `eas update` publishes,
// so it looks for `sb_secret_` anywhere: a pasted key can arrive wrapped in
// quotes or behind a zero-width space, which trim() leaves.
function assertNoSupabaseSecretKey({ supabaseAnonKey } = {}) {
  const key = String(supabaseAnonKey || "").trim();
  const claims = jwtClaims(key);
  if (key.includes("sb_secret_") || (claims && claims.role !== "anon")) {
    throw new Error(PUBLIC_SUPABASE_SECRET_KEY_ERROR);
  }
}

const EAS_SUPABASE_CLIENT_KEY_ERROR = [
  "EAS builds require a set EXPO_PUBLIC_SUPABASE_ANON_KEY to be a key a client",
  "may carry, with no whitespace around it: the project's publishable key",
  "(sb_publishable_…) or its legacy anon JWT. An EAS build inlines the value",
  "verbatim into a binary that goes to testers or the store, and a value",
  "pasted from the wrong field (the legacy JWT secret, an access token) has no",
  "shape to refuse, so only those two are allowed. Rotate the value if a build",
  "already carried it.",
  "See docs/internal/environment/ENV_REFERENCE.md § apps/mobile (Expo — EAS).",
].join(" ");

// Allows only a client key on every EAS profile, since each one produces a
// binary that leaves this machine. Unset is allowed: nothing is inlined.
// Production goes further (assertProductionSupabasePublishableKey), and runs
// first so its error names the publishable key. The web fence
// (apps/web/lib/assert-production-public-env.js) accepts the same two kinds of
// key, but only when VERCEL_ENV is production, and it also pins an anon JWT to
// the frapp-prod project.
function assertEasSupabaseClientKey({ easBuildProfile, supabaseAnonKey } = {}) {
  if (!easBuildProfile) return;
  const raw = String(supabaseAnonKey || "");
  if (!raw) return;
  // Untrimmed, as in production: the binary gets exactly this string.
  if (raw === raw.trim()) {
    if (raw.startsWith(SUPABASE_PUBLISHABLE_KEY_PREFIX)) return;
    const claims = jwtClaims(raw);
    if (claims && claims.role === "anon") return;
  }
  throw new Error(EAS_SUPABASE_CLIENT_KEY_ERROR);
}

function productionAppOrigin(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    parsed.username = "";
    parsed.password = "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function assertProductionAppUrl({ easBuildProfile, appUrl } = {}) {
  if (easBuildProfile !== "production") return;
  const trimmed = String(appUrl || "").trim();
  if (!trimmed) return;
  if (productionAppOrigin(trimmed) === PRODUCTION_APP_ORIGIN) return;
  throw new Error(PRODUCTION_APP_URL_ERROR);
}

// `isAskAvailable()` in lib/ask/flag.ts, duplicated because this file is
// CommonJS that Expo evaluates outside the app's TypeScript. The spec runs
// both parses over the same values so the two cannot drift.
const ASK_ON_VALUES = ["1", "true"];

function isAskEnabledValue(raw) {
  return typeof raw === "string" && ASK_ON_VALUES.includes(raw.trim());
}

const PRODUCTION_ASK_ENABLED_ERROR = [
  "EAS production builds require EXPO_PUBLIC_ASK_ENABLED unset or off",
  '(only "1" and "true" switch it on, the parse in apps/mobile/lib/ask/flag.ts).',
  "Ask answers from a synthetic corpus, and the App Store listing and review",
  "notes describe a store binary with no Ask (#2259). Remove it from the EAS",
  "production environment (eas env:list --environment production).",
  "See docs/internal/environment/ENV_REFERENCE.md § apps/mobile (Expo — EAS).",
].join(" ");

function assertProductionAskDisabled({ easBuildProfile, askEnabled } = {}) {
  if (easBuildProfile !== "production") return;
  if (!isAskEnabledValue(askEnabled)) return;
  throw new Error(PRODUCTION_ASK_ENABLED_ERROR);
}

function applyMobileConfig(
  config,
  { env = process.env, existsSync = fs.existsSync } = {},
) {
  const googleServicesFile = resolveGoogleServicesFile({ env, existsSync });
  assertProductionAndroidGoogleServices({
    easBuildProfile: env.EAS_BUILD_PROFILE,
    easBuildPlatform: env.EAS_BUILD_PLATFORM,
    googleServicesFile,
  });
  assertProductionApiUrl({
    easBuildProfile: env.EAS_BUILD_PROFILE,
    apiUrl: env.EXPO_PUBLIC_API_URL,
  });
  assertProductionSupabasePublic({
    easBuildProfile: env.EAS_BUILD_PROFILE,
    supabaseUrl: env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  });
  assertNoSupabaseSecretKey({
    supabaseAnonKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  });
  // After the presence check above, so an empty key reports as missing.
  assertProductionSupabasePublishableKey({
    easBuildProfile: env.EAS_BUILD_PROFILE,
    supabaseAnonKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  });
  assertEasSupabaseClientKey({
    easBuildProfile: env.EAS_BUILD_PROFILE,
    supabaseAnonKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  });
  assertProductionAppUrl({
    easBuildProfile: env.EAS_BUILD_PROFILE,
    appUrl: env.EXPO_PUBLIC_APP_URL,
  });
  assertProductionAskDisabled({
    easBuildProfile: env.EAS_BUILD_PROFILE,
    askEnabled: env.EXPO_PUBLIC_ASK_ENABLED,
  });
  const gitSha = env.EAS_BUILD_GIT_COMMIT_HASH;
  return {
    ...config,
    extra: {
      ...(config.extra && typeof config.extra === "object" ? config.extra : {}),
      ...(typeof gitSha === "string" && gitSha.trim()
        ? { gitSha: gitSha.trim() }
        : {}),
    },
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
}

function applyExpoConfig({ config }) {
  return applyMobileConfig(config);
}

applyExpoConfig.resolveGoogleServicesFile = resolveGoogleServicesFile;
applyExpoConfig.assertProductionAndroidGoogleServices =
  assertProductionAndroidGoogleServices;
applyExpoConfig.assertProductionApiUrl = assertProductionApiUrl;
applyExpoConfig.assertProductionSupabasePublic = assertProductionSupabasePublic;
applyExpoConfig.assertProductionSupabasePublishableKey =
  assertProductionSupabasePublishableKey;
applyExpoConfig.assertNoSupabaseSecretKey = assertNoSupabaseSecretKey;
applyExpoConfig.assertEasSupabaseClientKey = assertEasSupabaseClientKey;
applyExpoConfig.assertProductionAppUrl = assertProductionAppUrl;
applyExpoConfig.assertProductionAskDisabled = assertProductionAskDisabled;
applyExpoConfig.isAskEnabledValue = isAskEnabledValue;
applyExpoConfig.applyMobileConfig = applyMobileConfig;
applyExpoConfig.PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR =
  PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR;
applyExpoConfig.PRODUCTION_API_URL_ERROR = PRODUCTION_API_URL_ERROR;
applyExpoConfig.PRODUCTION_SUPABASE_PUBLIC_ERROR =
  PRODUCTION_SUPABASE_PUBLIC_ERROR;
applyExpoConfig.PRODUCTION_SUPABASE_URL_ERROR = PRODUCTION_SUPABASE_URL_ERROR;
applyExpoConfig.PRODUCTION_SUPABASE_KEY_ERROR = PRODUCTION_SUPABASE_KEY_ERROR;
applyExpoConfig.PUBLIC_SUPABASE_SECRET_KEY_ERROR =
  PUBLIC_SUPABASE_SECRET_KEY_ERROR;
applyExpoConfig.EAS_SUPABASE_CLIENT_KEY_ERROR = EAS_SUPABASE_CLIENT_KEY_ERROR;
applyExpoConfig.PRODUCTION_APP_URL_ERROR = PRODUCTION_APP_URL_ERROR;
applyExpoConfig.PRODUCTION_ASK_ENABLED_ERROR = PRODUCTION_ASK_ENABLED_ERROR;
applyExpoConfig.PRODUCTION_API_ORIGIN = PRODUCTION_API_ORIGIN;
applyExpoConfig.PRODUCTION_SUPABASE_ORIGIN = PRODUCTION_SUPABASE_ORIGIN;
applyExpoConfig.PRODUCTION_APP_ORIGIN = PRODUCTION_APP_ORIGIN;

module.exports = applyExpoConfig;
