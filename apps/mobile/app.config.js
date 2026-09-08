// Dynamic layer over app.json. Expo loads app.json first and hands it to this
// function as `config`; everything static stays in app.json (which is what
// `expo-doctor`'s schema check and #1801 validate). This file exists for the
// one field that cannot be static: the path to Firebase's Android client
// config.
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
// skip the fence — APNs does not use this file. Preview/development omit the
// field when the file is absent, so an internal tester APK can still compile
// before the Firebase project exists (#1826).
//
// The FCM V1 *service account* key (what Expo's push service uses to send) is
// a separate upload under EAS credentials → Android → FCM V1; it never touches
// this repo. iOS needs neither: EAS generates the APNs key on the first
// `eas build -p ios` against the Apple account.
//
// Source of truth for the credential inventory:
// docs/internal/environment/ENV_REFERENCE.md § apps/mobile.
const fs = require("node:fs");
const path = require("node:path");

const PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR = [
  "EAS production Android builds require Firebase client config.",
  "Set GOOGLE_SERVICES_JSON as an EAS environment variable of type File",
  "(scoped to the production environment this profile binds to), or place",
  "apps/mobile/google-services.json.",
  "Without it the APK compiles, getExpoPushTokenAsync throws, and members never receive push.",
  "See docs/internal/environment/ENV_REFERENCE.md § apps/mobile and GitHub issue #1826.",
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
applyExpoConfig.applyMobileConfig = applyMobileConfig;
applyExpoConfig.PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR =
  PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR;

module.exports = applyExpoConfig;
