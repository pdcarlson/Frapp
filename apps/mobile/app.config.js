// Dynamic layer over app.json. Expo loads app.json first and hands it to this
// function as `config`; everything static stays in app.json (which is what
// `expo-doctor`'s schema check and #1801 validate). This file exists for the
// fields that cannot be static: Firebase's Android client config path, and
// the EAS production fences on public env that is inlined into the store
// binary.
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
// The FCM V1 *service account* key (what Expo's push service uses to send) is
// a separate upload under EAS credentials → Android → FCM V1; it never touches
// this repo. iOS needs neither: EAS generates the APNs key on the first
// `eas build -p ios` against the Apple account.
//
// Source of truth for the credential inventory:
// docs/internal/environment/ENV_REFERENCE.md § Mobile.
const fs = require("node:fs");
const path = require("node:path");
const easJson = require("./eas.json");

const PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR = [
  "EAS production Android builds require Firebase client config.",
  "Set GOOGLE_SERVICES_JSON as an EAS environment variable of type File",
  "(scoped to the production environment this profile binds to), or place",
  "apps/mobile/google-services.json.",
  "Without it the APK compiles, getExpoPushTokenAsync throws, and members never receive push.",
  "See docs/internal/environment/ENV_REFERENCE.md § Mobile and GitHub issue #1826.",
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
  "See docs/internal/environment/ENV_REFERENCE.md § Mobile.",
].join(" ");

const PRODUCTION_SUPABASE_PUBLIC_ERROR = [
  "EAS production builds require EXPO_PUBLIC_SUPABASE_URL and",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY (EAS dashboard per environment; there is",
  "no Infisical→EAS sync). Without them getSupabaseClient() returns null and",
  "the store binary shows sign-in as unavailable. See",
  "docs/internal/environment/ENV_REFERENCE.md § Mobile.",
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
  "See docs/internal/environment/ENV_REFERENCE.md § Mobile.",
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
  "See docs/internal/environment/ENV_REFERENCE.md § Mobile.",
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
  assertProductionAppUrl({
    easBuildProfile: env.EAS_BUILD_PROFILE,
    appUrl: env.EXPO_PUBLIC_APP_URL,
  });
  return {
    ...config,
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
applyExpoConfig.assertProductionAppUrl = assertProductionAppUrl;
applyExpoConfig.applyMobileConfig = applyMobileConfig;
applyExpoConfig.PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR =
  PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR;
applyExpoConfig.PRODUCTION_API_URL_ERROR = PRODUCTION_API_URL_ERROR;
applyExpoConfig.PRODUCTION_SUPABASE_PUBLIC_ERROR =
  PRODUCTION_SUPABASE_PUBLIC_ERROR;
applyExpoConfig.PRODUCTION_SUPABASE_URL_ERROR = PRODUCTION_SUPABASE_URL_ERROR;
applyExpoConfig.PRODUCTION_APP_URL_ERROR = PRODUCTION_APP_URL_ERROR;
applyExpoConfig.PRODUCTION_API_ORIGIN = PRODUCTION_API_ORIGIN;
applyExpoConfig.PRODUCTION_SUPABASE_ORIGIN = PRODUCTION_SUPABASE_ORIGIN;
applyExpoConfig.PRODUCTION_APP_ORIGIN = PRODUCTION_APP_ORIGIN;

module.exports = applyExpoConfig;
