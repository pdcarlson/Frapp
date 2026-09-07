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
// The FCM V1 *service account* key (what Expo's push service uses to send) is
// a separate upload under EAS credentials → Android → FCM V1; it never touches
// this repo. iOS needs neither: EAS generates the APNs key on the first
// `eas build -p ios` against the Apple account.
//
// Source of truth for the credential inventory:
// docs/internal/environment/ENV_REFERENCE.md § Mobile.
const fs = require("node:fs");
const path = require("node:path");

function resolveGoogleServicesFile() {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const local = path.join(__dirname, "google-services.json");
  if (fs.existsSync(local)) return "./google-services.json";
  return undefined;
}

module.exports = ({ config }) => {
  const googleServicesFile = resolveGoogleServicesFile();
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
