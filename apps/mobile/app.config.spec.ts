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
 * permission regression guard (#2296).
 *
 * `getConfig` is the real resolution path — it loads `app.json`, hands it to
 * `app.config.js`, and evaluates the `plugins` list. That is the right assertion
 * for `ios.privacyManifests`, which is a *static* key the dynamic layer must not
 * drop: `applyMobileConfig` spreads `config` and overrides only `extra` and
 * `android`, and this pins that it keeps doing so.
 *
 * It is deliberately NOT used for `android.permissions`. CAMERA is contributed by
 * `expo-camera`'s plugin and can be taken away again by any plugin calling
 * `withBlockedPermissions`; both land in the Gradle/Xcode mods that only
 * `expo prebuild` (or `expo config --type introspect`) runs, so `getConfig`
 * reports a partial list. Rather than shell out to the CLI — slow, and it needs
 * the whole native toolchain in CI — the Android half is guarded at its *cause*:
 * no plugin entry may decline a permission this app requests at runtime. That is
 * the exact mechanism by which `expo-image-picker`'s `cameraPermission: false`
 * silently broke QR check-in on every Android build, and it is hermetic.
 */
describe("iOS privacy manifest (#2294)", () => {
  function resolvedIos() {
    const { getConfig } = requireConfig("expo/config") as {
      getConfig: (
        dir: string,
        opts?: { skipSDKVersionRequirement?: boolean; isModdedConfig?: boolean },
      ) => { exp: { ios?: { privacyManifests?: Record<string, unknown> } } };
    };
    return getConfig(path.dirname(fileURLToPath(import.meta.url)), {
      skipSDKVersionRequirement: true,
      isModdedConfig: true,
    }).exp.ios;
  }

  it("declares no tracking, so the manifest cannot contradict the nutrition label", () => {
    const manifests = resolvedIos()?.privacyManifests;
    expect(manifests).toBeDefined();
    expect(manifests?.NSPrivacyTracking).toBe(false);
    expect(manifests?.NSPrivacyTrackingDomains).toEqual([]);
  });

  it("declares a required reason for every bundled SDK that touches one", () => {
    const types = resolvedIos()?.privacyManifests?.NSPrivacyAccessedAPITypes as
      | { NSPrivacyAccessedAPIType: string; NSPrivacyAccessedAPITypeReasons: string[] }[]
      | undefined;

    // UserDefaults: @stripe/stripe-react-native (StripeSdkImpl.swift) and
    // expo-sharing (SharingModule.swift), neither of which ships a manifest of
    // its own. FileTimestamp: the app container's own file reads.
    // Absent these two, App Store Connect returns ITMS-91053 on upload.
    const byCategory = new Map(
      (types ?? []).map((t) => [t.NSPrivacyAccessedAPIType, t.NSPrivacyAccessedAPITypeReasons]),
    );
    expect(byCategory.get("NSPrivacyAccessedAPICategoryUserDefaults")).toEqual(["CA92.1"]);
    expect(byCategory.get("NSPrivacyAccessedAPICategoryFileTimestamp")).toEqual(["C617.1"]);
  });
});

describe("native permission declarations (#2296)", () => {
  function pluginEntries(): [string, Record<string, unknown>][] {
    const appJson = requireConfig("./app.json") as {
      expo: { plugins: (string | [string, Record<string, unknown>?])[] };
    };
    return appJson.expo.plugins
      .map((p) => (Array.isArray(p) ? p : [p, {}]))
      .map(([name, opts]) => [name, opts ?? {}] as [string, Record<string, unknown>]);
  }

  it("lets no plugin decline the camera permission the QR scanner requests", () => {
    // `app/(tabs)/check-in.tsx` calls `useCameraPermissions()`. A plugin option
    // of `cameraPermission: false` compiles to
    // `withBlockedPermissions(['android.permission.CAMERA'])`, which *removes*
    // what expo-camera added and writes `tools:node="remove"` into the manifest.
    // The result is a build where check-in can never be granted the camera.
    const decliners = pluginEntries()
      .filter(([, opts]) => opts.cameraPermission === false)
      .map(([name]) => name);
    expect(decliners).toEqual([]);
  });

  it("ships iOS usage-description strings only for features that exist", () => {
    // Each `*Permission`/`*UsageDescription` option with a *string* value becomes
    // a purpose string in the binary. A string for an unbuilt feature is a
    // Guideline 5.1.1(i)/2.1 rejection, so the set is pinned exactly rather than
    // merely checked for absences.
    const declared = pluginEntries()
      .flatMap(([name, opts]) =>
        Object.entries(opts)
          .filter(([key, value]) => /Permission$/.test(key) && typeof value === "string")
          .map(([key]) => `${name}:${key}`),
      )
      .sort();
    expect(declared).toEqual([
      "expo-camera:cameraPermission",
      "expo-location:locationWhenInUsePermission",
    ]);
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
