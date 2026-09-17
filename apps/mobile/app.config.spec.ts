import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_API_ORIGIN as SHARED_PRODUCTION_API_ORIGIN,
  PRODUCTION_APP_ORIGIN as SHARED_PRODUCTION_APP_ORIGIN,
} from "@repo/validation";
import { afterEach, describe, expect, it } from "vitest";

/**
 * EAS production Android must not compile without Firebase client config.
 * The silent-dead-push path is `getExpoPushTokenAsync` throwing and
 * `use-push-runtime` swallowing it — a store APK that "works" and never
 * notifies. CI and `expo start` leave `EAS_BUILD_PROFILE` unset, so they
 * still omit the field. iOS production builds skip the fence (APNs).
 */

const requireConfig = createRequire(import.meta.url);

function loadConfig() {
  const resolved = requireConfig.resolve("./app.config.js");
  delete requireConfig.cache[resolved];
  return requireConfig(resolved) as {
    (args: { config: Record<string, unknown> }): Record<string, unknown>;
    resolveGoogleServicesFile: (opts?: {
      env?: NodeJS.Dict<string>;
      existsSync?: (p: string) => boolean;
      localPath?: string;
    }) => string | undefined;
    assertProductionAndroidGoogleServices: (opts?: {
      easBuildProfile?: string;
      easBuildPlatform?: string;
      googleServicesFile?: string;
    }) => void;
    applyMobileConfig: (
      config: Record<string, unknown>,
      opts?: {
        env?: NodeJS.Dict<string>;
        existsSync?: (p: string) => boolean;
      },
    ) => Record<string, unknown>;
    PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR: string;
    PRODUCTION_API_URL_ERROR: string;
    PRODUCTION_SUPABASE_PUBLIC_ERROR: string;
    PRODUCTION_SUPABASE_URL_ERROR: string;
    PRODUCTION_API_ORIGIN: string;
    PRODUCTION_SUPABASE_ORIGIN: string;
    PRODUCTION_APP_ORIGIN: string;
    PRODUCTION_APP_URL_ERROR: string;
    assertProductionApiUrl: (opts?: {
      easBuildProfile?: string;
      apiUrl?: string;
    }) => void;
    assertProductionSupabasePublic: (opts?: {
      easBuildProfile?: string;
      supabaseUrl?: string;
      supabaseAnonKey?: string;
    }) => void;
    assertProductionAppUrl: (opts?: {
      easBuildProfile?: string;
      appUrl?: string;
    }) => void;
  };
}

const missing = () => false;
const present = () => true;
const androidConfig = { android: { package: "live.frapp.mobile" } };
const easProductionApiUrl = (
  requireConfig("./eas.json") as {
    build: { production: { env: { EXPO_PUBLIC_API_URL: string } } };
  }
).build.production.env.EXPO_PUBLIC_API_URL;
const environmentsJson = requireConfig("../../.github/environments.json") as {
  environments: {
    staging: { supabaseProjectRef: string };
    production: { supabaseProjectRef: string };
  };
};
const easProductionSupabaseOrigin = `https://${environmentsJson.environments.production.supabaseProjectRef}.supabase.co`;
const easStagingSupabaseOrigin = `https://${environmentsJson.environments.staging.supabaseProjectRef}.supabase.co`;
const productionPublicEnv = {
  EXPO_PUBLIC_API_URL: easProductionApiUrl,
  EXPO_PUBLIC_SUPABASE_URL: easProductionSupabaseOrigin,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
};

const restoredEnvKeys = [
  "EAS_BUILD_PROFILE",
  "EAS_BUILD_PLATFORM",
  "GOOGLE_SERVICES_JSON",
  "EXPO_PUBLIC_API_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
] as const;
const initialEnv = Object.fromEntries(
  restoredEnvKeys.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of restoredEnvKeys) {
    const value = initialEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("assertProductionAndroidGoogleServices", () => {
  it("allows CI and expo start (profile unset, no file)", () => {
    const { assertProductionAndroidGoogleServices } = loadConfig();
    expect(() =>
      assertProductionAndroidGoogleServices({
        googleServicesFile: undefined,
      }),
    ).not.toThrow();
  });

  it("allows preview and development profiles without a file", () => {
    const { assertProductionAndroidGoogleServices } = loadConfig();
    expect(() =>
      assertProductionAndroidGoogleServices({
        easBuildProfile: "preview",
        easBuildPlatform: "android",
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionAndroidGoogleServices({
        easBuildProfile: "development",
        easBuildPlatform: "android",
      }),
    ).not.toThrow();
  });

  it("allows iOS production builds without the Android client config", () => {
    const { assertProductionAndroidGoogleServices } = loadConfig();
    expect(() =>
      assertProductionAndroidGoogleServices({
        easBuildProfile: "production",
        easBuildPlatform: "ios",
      }),
    ).not.toThrow();
  });

  it("allows production Android when a google-services path resolved", () => {
    const { assertProductionAndroidGoogleServices } = loadConfig();
    expect(() =>
      assertProductionAndroidGoogleServices({
        easBuildProfile: "production",
        easBuildPlatform: "android",
        googleServicesFile: "/tmp/google-services.json",
      }),
    ).not.toThrow();
  });

  it("refuses production Android when neither path exists", () => {
    const {
      assertProductionAndroidGoogleServices,
      PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR,
    } = loadConfig();
    expect(() =>
      assertProductionAndroidGoogleServices({
        easBuildProfile: "production",
        easBuildPlatform: "android",
      }),
    ).toThrow(PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR);
  });

  it("refuses production when platform is unset (local production prebuild)", () => {
    const { assertProductionAndroidGoogleServices } = loadConfig();
    expect(() =>
      assertProductionAndroidGoogleServices({
        easBuildProfile: "production",
      }),
    ).toThrow(/GOOGLE_SERVICES_JSON/);
  });
});

describe("resolveGoogleServicesFile", () => {
  it("prefers GOOGLE_SERVICES_JSON when that path exists", () => {
    const { resolveGoogleServicesFile } = loadConfig();
    expect(
      resolveGoogleServicesFile({
        env: { GOOGLE_SERVICES_JSON: "/eas/google-services.json" },
        existsSync: (p) => p === "/eas/google-services.json",
      }),
    ).toBe("/eas/google-services.json");
  });

  it("ignores GOOGLE_SERVICES_JSON when the materialised path is missing", () => {
    const { resolveGoogleServicesFile } = loadConfig();
    expect(
      resolveGoogleServicesFile({
        env: { GOOGLE_SERVICES_JSON: "/eas/missing.json" },
        existsSync: missing,
      }),
    ).toBeUndefined();
  });

  it("falls back to ./google-services.json when the local file exists", () => {
    const { resolveGoogleServicesFile } = loadConfig();
    expect(
      resolveGoogleServicesFile({
        env: {},
        existsSync: present,
        localPath: "/repo/apps/mobile/google-services.json",
      }),
    ).toBe("./google-services.json");
  });
});

describe("applyMobileConfig", () => {
  it("omits googleServicesFile and does not throw when CI evaluates the config", () => {
    const { applyMobileConfig } = loadConfig();
    const result = applyMobileConfig(androidConfig, {
      env: {},
      existsSync: missing,
    });
    expect(result.android).toEqual({ package: "live.frapp.mobile" });
    expect(
      (result.android as { googleServicesFile?: string }).googleServicesFile,
    ).toBeUndefined();
  });

  it("parks the EAS git SHA in extra.gitSha and never uses it as a Sentry release name", () => {
    const { applyMobileConfig } = loadConfig();
    const sha = "deadbeefcafebabe0123456789abcdef01234567";
    const result = applyMobileConfig(
      { ...androidConfig, extra: { existing: true } },
      {
        env: { EAS_BUILD_GIT_COMMIT_HASH: sha },
        existsSync: missing,
      },
    );
    const extra = result.extra as { gitSha?: string; existing?: boolean };
    expect(extra.gitSha).toBe(sha);
    expect(extra.existing).toBe(true);
    expect(JSON.stringify(result)).not.toContain(
      `"release":"${sha}"`,
    );
  });

  it("omits extra.gitSha when EAS_BUILD_GIT_COMMIT_HASH is unset", () => {
    const { applyMobileConfig } = loadConfig();
    const result = applyMobileConfig(androidConfig, {
      env: {},
      existsSync: missing,
    });
    expect(
      (result.extra as { gitSha?: string } | undefined)?.gitSha,
    ).toBeUndefined();
  });

  it("wires googleServicesFile on a production Android EAS build when the file exists", () => {
    const { applyMobileConfig } = loadConfig();
    const result = applyMobileConfig(androidConfig, {
      env: {
        ...productionPublicEnv,
        EAS_BUILD_PROFILE: "production",
        EAS_BUILD_PLATFORM: "android",
        GOOGLE_SERVICES_JSON: "/eas/google-services.json",
      },
      existsSync: (p) => p === "/eas/google-services.json",
    });
    expect(
      (result.android as { googleServicesFile?: string }).googleServicesFile,
    ).toBe("/eas/google-services.json");
  });

  it("lets an iOS production EAS build proceed without the Android file", () => {
    const { applyMobileConfig } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          ...productionPublicEnv,
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "ios",
        },
        existsSync: missing,
      }),
    ).not.toThrow();
  });

  it("refuses a production Android EAS build when the file is absent", () => {
    const { applyMobileConfig, PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR } =
      loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "android",
        },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_ANDROID_GOOGLE_SERVICES_ERROR);
  });

  it("refuses when GOOGLE_SERVICES_JSON is set but the path does not exist", () => {
    const { applyMobileConfig } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "android",
          GOOGLE_SERVICES_JSON: "/eas/missing.json",
        },
        existsSync: missing,
      }),
    ).toThrow(/GOOGLE_SERVICES_JSON/);
  });

  it("refuses iOS production when EXPO_PUBLIC_API_URL is not the eas.json origin", () => {
    const { applyMobileConfig, PRODUCTION_API_URL_ERROR } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          ...productionPublicEnv,
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "ios",
          EXPO_PUBLIC_API_URL: "https://api-staging.frapp.live",
        },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_API_URL_ERROR);
  });

  it("refuses iOS production when a Supabase public value is missing", () => {
    const { applyMobileConfig, PRODUCTION_SUPABASE_PUBLIC_ERROR } =
      loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          EXPO_PUBLIC_API_URL: easProductionApiUrl,
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "ios",
        },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_SUPABASE_PUBLIC_ERROR);
  });

  it("refuses iOS production when EXPO_PUBLIC_SUPABASE_URL is the staging project", () => {
    const { applyMobileConfig, PRODUCTION_SUPABASE_URL_ERROR } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          ...productionPublicEnv,
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "ios",
          EXPO_PUBLIC_SUPABASE_URL: easStagingSupabaseOrigin,
        },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_SUPABASE_URL_ERROR);
  });

  it("refuses iOS production when EXPO_PUBLIC_APP_URL is staging", () => {
    const { applyMobileConfig, PRODUCTION_APP_URL_ERROR } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          ...productionPublicEnv,
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "ios",
          EXPO_PUBLIC_APP_URL: "https://app.staging.frapp.live",
        },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_APP_URL_ERROR);
  });

  it("refuses production Android with a google-services file when the API origin is wrong", () => {
    const { applyMobileConfig, PRODUCTION_API_URL_ERROR } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          ...productionPublicEnv,
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "android",
          GOOGLE_SERVICES_JSON: "/eas/google-services.json",
          EXPO_PUBLIC_API_URL: "http://localhost:3001",
        },
        existsSync: (p) => p === "/eas/google-services.json",
      }),
    ).toThrow(PRODUCTION_API_URL_ERROR);
  });

  it("refuses production Android with a google-services file when Supabase public env is missing", () => {
    const { applyMobileConfig, PRODUCTION_SUPABASE_PUBLIC_ERROR } =
      loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          EXPO_PUBLIC_API_URL: easProductionApiUrl,
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "android",
          GOOGLE_SERVICES_JSON: "/eas/google-services.json",
        },
        existsSync: (p) => p === "/eas/google-services.json",
      }),
    ).toThrow(PRODUCTION_SUPABASE_PUBLIC_ERROR);
  });
});

describe("Expo default export", () => {
  it("is the function Expo loads, and evaluates process.env at call time", () => {
    const applyExpoConfig = loadConfig();
    process.env.EAS_BUILD_PROFILE = "preview";
    const result = applyExpoConfig({ config: androidConfig });
    expect(result.android).toMatchObject({ package: "live.frapp.mobile" });
  });
});

describe("assertProductionApiUrl", () => {
  it("allows CI when the profile is unset", () => {
    const { assertProductionApiUrl } = loadConfig();
    expect(() => assertProductionApiUrl({})).not.toThrow();
  });

  it("allows preview pointed at staging", () => {
    const { assertProductionApiUrl } = loadConfig();
    expect(() =>
      assertProductionApiUrl({
        easBuildProfile: "preview",
        apiUrl: "https://api-staging.frapp.live",
      }),
    ).not.toThrow();
  });

  it("allows the eas.json production origin, ignoring a trailing slash", () => {
    const { assertProductionApiUrl, PRODUCTION_API_ORIGIN } = loadConfig();
    expect(() =>
      assertProductionApiUrl({
        easBuildProfile: "production",
        apiUrl: `${PRODUCTION_API_ORIGIN}/`,
      }),
    ).not.toThrow();
  });

  it("refuses a production build pointed at staging, localhost, or empty", () => {
    const { assertProductionApiUrl, PRODUCTION_API_URL_ERROR } = loadConfig();
    expect(() =>
      assertProductionApiUrl({
        easBuildProfile: "production",
        apiUrl: "https://api-staging.frapp.live",
      }),
    ).toThrow(PRODUCTION_API_URL_ERROR);
    expect(() =>
      assertProductionApiUrl({
        easBuildProfile: "production",
        apiUrl: "http://localhost:3001",
      }),
    ).toThrow(PRODUCTION_API_URL_ERROR);
    expect(() =>
      assertProductionApiUrl({
        easBuildProfile: "production",
        apiUrl: "",
      }),
    ).toThrow(PRODUCTION_API_URL_ERROR);
  });
});

describe("assertProductionSupabasePublic", () => {
  it("allows CI when the profile is unset", () => {
    const { assertProductionSupabasePublic } = loadConfig();
    expect(() => assertProductionSupabasePublic({})).not.toThrow();
  });

  it("refuses a production build when either Supabase public value is missing", () => {
    const { assertProductionSupabasePublic, PRODUCTION_SUPABASE_PUBLIC_ERROR } =
      loadConfig();
    expect(() =>
      assertProductionSupabasePublic({
        easBuildProfile: "production",
        supabaseUrl: "https://example.supabase.co",
      }),
    ).toThrow(PRODUCTION_SUPABASE_PUBLIC_ERROR);
    expect(() =>
      assertProductionSupabasePublic({
        easBuildProfile: "production",
        supabaseAnonKey: "test-anon-key",
      }),
    ).toThrow(PRODUCTION_SUPABASE_PUBLIC_ERROR);
    expect(() =>
      assertProductionSupabasePublic({
        easBuildProfile: "production",
        supabaseUrl: "   ",
        supabaseAnonKey: "test-anon-key",
      }),
    ).toThrow(PRODUCTION_SUPABASE_PUBLIC_ERROR);
  });

  it("allows the frapp-prod origin, ignoring a trailing slash", () => {
    const { assertProductionSupabasePublic, PRODUCTION_SUPABASE_ORIGIN } =
      loadConfig();
    expect(() =>
      assertProductionSupabasePublic({
        easBuildProfile: "production",
        supabaseUrl: `${PRODUCTION_SUPABASE_ORIGIN}/`,
        supabaseAnonKey: "test-anon-key",
      }),
    ).not.toThrow();
  });

  it("refuses a production build pointed at staging, localhost, another project, or http", () => {
    const { assertProductionSupabasePublic, PRODUCTION_SUPABASE_URL_ERROR } =
      loadConfig();
    expect(() =>
      assertProductionSupabasePublic({
        easBuildProfile: "production",
        supabaseUrl: easStagingSupabaseOrigin,
        supabaseAnonKey: "test-anon-key",
      }),
    ).toThrow(PRODUCTION_SUPABASE_URL_ERROR);
    expect(() =>
      assertProductionSupabasePublic({
        easBuildProfile: "production",
        supabaseUrl: "http://127.0.0.1:54321",
        supabaseAnonKey: "test-anon-key",
      }),
    ).toThrow(PRODUCTION_SUPABASE_URL_ERROR);
    expect(() =>
      assertProductionSupabasePublic({
        easBuildProfile: "production",
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "test-anon-key",
      }),
    ).toThrow(PRODUCTION_SUPABASE_URL_ERROR);
    expect(() =>
      assertProductionSupabasePublic({
        easBuildProfile: "production",
        supabaseUrl: easProductionSupabaseOrigin.replace("https://", "http://"),
        supabaseAnonKey: "test-anon-key",
      }),
    ).toThrow(PRODUCTION_SUPABASE_URL_ERROR);
    expect(() =>
      assertProductionSupabasePublic({
        easBuildProfile: "production",
        supabaseUrl: `${easProductionSupabaseOrigin}/rest/v1`,
        supabaseAnonKey: "test-anon-key",
      }),
    ).toThrow(PRODUCTION_SUPABASE_URL_ERROR);
  });
});

describe("PRODUCTION_SUPABASE_ORIGIN", () => {
  it("is the frapp-prod origin from .github/environments.json", () => {
    const { PRODUCTION_SUPABASE_ORIGIN } = loadConfig();
    expect(PRODUCTION_SUPABASE_ORIGIN).toBe(easProductionSupabaseOrigin);
  });
});

describe("PRODUCTION_API_ORIGIN", () => {
  it("is the production origin committed in eas.json", () => {
    const { PRODUCTION_API_ORIGIN } = loadConfig();
    const eas = requireConfig("./eas.json") as {
      build: { production: { env: { EXPO_PUBLIC_API_URL: string } } };
    };
    expect(PRODUCTION_API_ORIGIN).toBe(
      eas.build.production.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, ""),
    );
    expect(PRODUCTION_API_ORIGIN).toBe(SHARED_PRODUCTION_API_ORIGIN);
  });
});

describe("assertProductionAppUrl", () => {
  it("allows CI when the profile is unset", () => {
    const { assertProductionAppUrl } = loadConfig();
    expect(() => assertProductionAppUrl({})).not.toThrow();
  });

  it("allows preview pointed at staging", () => {
    const { assertProductionAppUrl } = loadConfig();
    expect(() =>
      assertProductionAppUrl({
        easBuildProfile: "preview",
        appUrl: "https://app.staging.frapp.live",
      }),
    ).not.toThrow();
  });

  it("allows production when APP_URL is unset or the production origin", () => {
    const { assertProductionAppUrl, PRODUCTION_APP_ORIGIN } = loadConfig();
    expect(() =>
      assertProductionAppUrl({ easBuildProfile: "production" }),
    ).not.toThrow();
    expect(() =>
      assertProductionAppUrl({
        easBuildProfile: "production",
        appUrl: "",
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionAppUrl({
        easBuildProfile: "production",
        appUrl: `${PRODUCTION_APP_ORIGIN}/`,
      }),
    ).not.toThrow();
  });

  it("refuses a production build that inlines staging or localhost", () => {
    const { assertProductionAppUrl, PRODUCTION_APP_URL_ERROR } = loadConfig();
    expect(() =>
      assertProductionAppUrl({
        easBuildProfile: "production",
        appUrl: "https://app.staging.frapp.live",
      }),
    ).toThrow(PRODUCTION_APP_URL_ERROR);
    expect(() =>
      assertProductionAppUrl({
        easBuildProfile: "production",
        appUrl: "http://localhost:3000",
      }),
    ).toThrow(PRODUCTION_APP_URL_ERROR);
  });
});

describe("PRODUCTION_APP_ORIGIN", () => {
  it("matches @repo/validation so the CommonJS duplicate cannot drift", () => {
    const { PRODUCTION_APP_ORIGIN } = loadConfig();
    expect(PRODUCTION_APP_ORIGIN).toBe(SHARED_PRODUCTION_APP_ORIGIN);
  });
});


/**
 * App Store compliance: the iOS privacy manifest (#2294) and the native
 * permission declarations (#2296).
 *
 * `getConfig` is the real resolution path — it loads `app.json`, hands it to
 * `app.config.js`, and evaluates the `plugins` list. Both halves of the #2296
 * defect are visible in its output, because `withPermissions` and
 * `withBlockedPermissions` (`@expo/config-plugins/build/android/Permissions.js`)
 * mutate `config.android.permissions` *synchronously* before returning their mod;
 * only the `tools:node="remove"` attribute is prebuild-only. So the Android
 * permission set is asserted at the effect level here, hermetically, with no
 * native toolchain — and at the cause level too, because the eager filter is
 * plugin-order sensitive: a blocker listed before `expo-camera` would be undone
 * by it and slip past an effect-level check alone.
 *
 * `ios.privacyManifests` is likewise a *static* key the dynamic layer must not
 * drop: `applyMobileConfig` spreads `config` and overrides only `extra` and
 * `android`, and these tests pin that it keeps doing so.
 *
 * WHAT IS NOT COVERED, stated so a green run is not read for more than it earns.
 * The iOS purpose strings that actually ship are written by
 * `IOSConfig.Permissions.applyPermissions`, which runs in the Xcode *mods*, and
 * it deletes a key only when the option is strictly `false`. An option left
 * **omitted** inherits the plugin's own default string (e.g. "Allow
 * $(PRODUCT_NAME) to access your microphone") and still ships. No assertion over
 * `app.json` can see that, here or in
 * `scripts/ci/__tests__/signet-mobile-permissions.test.mjs`, which also reads the
 * file rather than the built binary. Nor is the *bundled-SDK* side of #2294
 * encoded: the audit behind the two declared categories was run by hand, so a
 * future native dependency that uses a required-reason API without shipping its
 * own manifest would be an ITMS-91053 rejection with every test green. Both gaps
 * want the introspected config in CI, and both are filed as #2343 — which also
 * owns collapsing this roster and the Signet copy lock's into one home.
 */
describe("iOS privacy manifest (#2294)", () => {
  function resolved() {
    const { getConfig } = requireConfig("expo/config") as {
      getConfig: (
        dir: string,
        opts?: { skipSDKVersionRequirement?: boolean; isModdedConfig?: boolean },
      ) => {
        exp: {
          ios?: { privacyManifests?: Record<string, unknown> };
          android?: { permissions?: string[]; blockedPermissions?: string[] };
        };
      };
    };
    // `app.config.js` throws on an EAS *production* profile without Firebase
    // config, and getConfig offers no env injection point — so an inherited
    // EAS_BUILD_PROFILE (an `eas build --local` shell, or a prebuild hook that
    // runs this suite) would fail these tests with an unrelated Firebase
    // message. Neutralize it; the production fences have their own tests above.
    const saved = {
      EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE,
      EAS_BUILD_PLATFORM: process.env.EAS_BUILD_PLATFORM,
    };
    delete process.env.EAS_BUILD_PROFILE;
    delete process.env.EAS_BUILD_PLATFORM;
    try {
      return getConfig(path.dirname(fileURLToPath(import.meta.url)), {
        skipSDKVersionRequirement: true,
        isModdedConfig: true,
      }).exp;
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it("declares no tracking, so the manifest cannot contradict the nutrition label", () => {
    // NSPrivacyCollectedDataTypes is deliberately NOT declared — but note what
    // that means: `mergePrivacyInfo` destructures it with an `= []` default and
    // returns all four keys, so the generated PrivacyInfo.xcprivacy ships an
    // *empty* collected-data array either way. Omitting is therefore not
    // "unspecified", and the generated privacy report understates what App Store
    // Connect declares. It is not an ITMS-91053/91061 target (those validate
    // NSPrivacyAccessedAPITypes only) and nothing cross-checks it against the
    // label, so this is an accuracy gap rather than a rejection risk. Declaring
    // the types belongs with #2304/#2305, which are actively rewriting the label
    // those declarations would have to match — declaring them here first would
    // create a second home for a fact in flux.
    const manifests = resolved().ios?.privacyManifests;
    expect(manifests).toBeDefined();
    expect(manifests?.NSPrivacyTracking).toBe(false);
    expect(manifests?.NSPrivacyTrackingDomains).toEqual([]);
  });

  it("declares exactly the two required-reason categories app.json is meant to carry", () => {
    // UserDefaults / CA92.1 is the load-bearing row, and its basis is
    // @stripe/stripe-react-native alone: StripeSdkImpl.swift reads and writes
    // `UserDefaults.standard` (app-local, which is what CA92.1 covers) and ships
    // no manifest of its own. expo-sharing also uses UserDefaults, but via
    // `UserDefaults(suiteName:)` — the app-group case, whose reason is 1C8F.1,
    // not CA92.1. That path is unreachable today because this app configures no
    // app group; if a share extension or app group is ever added, 1C8F.1 has to
    // be declared rather than assumed covered by this row.
    //
    // FileTimestamp / C617.1 is required by #2296's acceptance criteria and is
    // harmless, but it is NOT what averts ITMS-91053: react-native, cxxreact,
    // expo-application and @react-native-async-storage all already declare
    // C617.1 in their own pod manifests. It stands for the app target's own
    // container reads.
    //
    // Pinned as the whole array rather than per-category lookups: a keyed lookup
    // is last-wins, so a duplicate category or an extra entry carrying an
    // invalid reason code — which Apple rejects on upload — would pass unseen.
    expect(resolved().ios?.privacyManifests?.NSPrivacyAccessedAPITypes).toEqual([
      {
        NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
        NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
      },
      {
        NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
        NSPrivacyAccessedAPITypeReasons: ["C617.1"],
      },
    ]);
  });

  it("resolves the camera permission the QR scanner requests (#2296, effect level)", () => {
    // The acceptance criterion for #2296, asserted rather than only pasted into
    // the PR: whatever the plugin list does, the resolved set must contain
    // CAMERA. `app/(tabs)/check-in.tsx` calls `useCameraPermissions()`.
    const android = resolved().android;
    expect(android?.permissions ?? []).toContain("android.permission.CAMERA");
    // The other route to the same defect, and the one a plugin cannot undo.
    expect(android?.blockedPermissions ?? []).not.toContain(
      "android.permission.CAMERA",
    );
  });
});

describe("native permission declarations (#2296)", () => {
  function appJson(): {
    expo: {
      plugins: (string | [string, Record<string, unknown>?])[];
      ios?: { infoPlist?: Record<string, unknown> };
    };
  } {
    return requireConfig("./app.json");
  }

  function pluginEntries(): [string, Record<string, unknown>][] {
    return appJson().expo.plugins.map((plugin) =>
      Array.isArray(plugin)
        ? [plugin[0], plugin[1] ?? {}]
        : [plugin, {} as Record<string, unknown>],
    );
  }

  /** Every option that resolves to an iOS purpose string, declared or declined. */
  function permissionOptions(): [string, unknown][] {
    return pluginEntries()
      .flatMap(([name, opts]) =>
        Object.entries(opts)
          .filter(([key]) => /(?:Permission|UsageDescription)$/.test(key))
          .map(([key, value]) => [`${name}:${key}`, value] as [string, unknown]),
      )
      .sort(([a], [b]) => a.localeCompare(b));
  }

  /**
   * Options this app must never decline, because a screen requests the
   * underlying permission at runtime. Declining is not inert: it compiles to
   * `withBlockedPermissions`, which strips what another plugin contributed, so
   * the permission can never be granted on Android — silently. That is how
   * `expo-image-picker`'s `cameraPermission: false` broke QR check-in. Every
   * other declined option below is safe precisely because no source file asks
   * for it (no microphone, FaceID, motion or background-location use); add the
   * option here in the same slice that introduces such a use.
   */
  const REQUESTED_AT_RUNTIME = [
    // app/(tabs)/check-in.tsx → useCameraPermissions()
    "cameraPermission",
    // study zones, and the check-in location confirm
    "locationWhenInUsePermission",
  ];

  it("lets no plugin decline a permission a screen requests at runtime", () => {
    const decliners = permissionOptions()
      .filter(
        ([key, value]) =>
          value === false &&
          REQUESTED_AT_RUNTIME.some((option) => key.endsWith(`:${option}`)),
      )
      .map(([key]) => key);
    expect(decliners).toEqual([]);
  });

  it("ships iOS purpose strings only for features that exist", () => {
    // A purpose string for an unbuilt feature is a Guideline 5.1.1(i)/2.1
    // rejection — that is what expo-image-picker's photosPermission was. The
    // full option set is pinned, values included, so neither a new string nor a
    // flipped decline slips through.
    expect(permissionOptions()).toEqual([
      ["expo-camera:cameraPermission", "Signet uses the camera to scan the check-in code at chapter events."],
      ["expo-camera:microphonePermission", false],
      ["expo-location:locationAlwaysAndWhenInUsePermission", false],
      ["expo-location:locationAlwaysPermission", false],
      ["expo-location:locationWhenInUsePermission", "Signet confirms you are inside a chapter study zone while you track study hours, and that you are at the event when you scan a check-in code."],
      ["expo-location:motionUsagePermission", false],
      ["expo-secure-store:faceIDPermission", false],
    ]);
  });

  it("hand-writes no purpose string under ios.infoPlist", () => {
    // The plugin roster above is not the only way in: a key written straight
    // into `ios.infoPlist` bypasses plugins entirely and prebuild copies it
    // verbatim into Info.plist — the route ITSAppUsesNonExemptEncryption uses.
    const infoPlist = appJson().expo.ios?.infoPlist ?? {};
    expect(
      Object.keys(infoPlist).filter((key) => /UsageDescription$/.test(key)),
    ).toEqual([]);
  });

  it("does not depend on the media pickers no source file imports", () => {
    const pkg = requireConfig("./package.json") as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...(pkg.devDependencies ?? {}) };
    // Re-add these in the slice that actually builds a picker surface (#1045
    // added them ahead of one); expo-image-picker also strips CAMERA above.
    expect(all["expo-image-picker"]).toBeUndefined();
    expect(all["expo-document-picker"]).toBeUndefined();
  });
});
