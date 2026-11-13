import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_LINK_PATHS,
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
    googleIosUrlScheme: (iosClientId?: unknown) => string | undefined;
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
    assertProductionSupabasePublishableKey: (opts?: {
      easBuildProfile?: string;
      supabaseAnonKey?: string;
    }) => void;
    PRODUCTION_SUPABASE_KEY_ERROR: string;
    assertNoSupabaseSecretKey: (opts?: { supabaseAnonKey?: string }) => void;
    PUBLIC_SUPABASE_SECRET_KEY_ERROR: string;
    assertEasSupabaseClientKey: (opts?: {
      easBuildProfile?: string;
      supabaseAnonKey?: string;
    }) => void;
    EAS_SUPABASE_CLIENT_KEY_ERROR: string;
    assertProductionAppUrl: (opts?: {
      easBuildProfile?: string;
      appUrl?: string;
    }) => void;
    publicValueProfile: (env: NodeJS.Dict<string>) => string | undefined;
    PRODUCTION_UPDATE_SENTRY_DSN_ERROR: string;
    STAGING_PROFILE: string;
    STAGING_IDENTITY: { name: string; scheme: string; applicationId: string };
    APP_VARIANT_VALUE_ERROR: string;
    APP_VARIANT_PROFILE_ERROR: string;
    STAGING_VARIANT_PRODUCTION_ORIGIN_ERROR: string;
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
// Fixtures shaped like each kind of Supabase key, so the prefix fence sees
// the real shapes. None is a key.
const LEGACY_ANON_JWT_FIXTURE =
  "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.not-a-real-signature"; // gitleaks:allow
const PUBLISHABLE_KEY_FIXTURE = "sb_publishable_not-a-real-key"; // gitleaks:allow
const SECRET_KEY_FIXTURE = "sb_secret_not-a-real-key"; // gitleaks:allow
const USER_TOKEN_JWT_FIXTURE =
  "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCIsInN1YiI6IngifQ.not-a-real-signature"; // gitleaks:allow
// Values from the wrong field, neither of them a key. The JWT secret has no
// shape the secret-key denylist could refuse; a personal access token does.
const JWT_SECRET_FIXTURE = "not-a-real-jwt-secret-0123456789abcdef"; // gitleaks:allow
const ACCESS_TOKEN_FIXTURE = "sbp_not-a-real-token"; // gitleaks:allow
const SERVICE_ROLE_JWT_FIXTURE =
  "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.not-a-real-signature"; // gitleaks:allow

const productionPublicEnv = {
  EXPO_PUBLIC_API_URL: easProductionApiUrl,
  EXPO_PUBLIC_SUPABASE_URL: easProductionSupabaseOrigin,
  // A publishable key: production refuses anything else (#2526).
  EXPO_PUBLIC_SUPABASE_ANON_KEY: PUBLISHABLE_KEY_FIXTURE,
};

const restoredEnvKeys = [
  "EAS_BUILD_PROFILE",
  "EAS_BUILD_PLATFORM",
  "FRAPP_EAS_UPDATE_PROFILE",
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
    expect(JSON.stringify(result)).not.toContain(`"release":"${sha}"`);
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

  it("refuses iOS production with a legacy anon key, but reports an empty key as missing", () => {
    const {
      applyMobileConfig,
      PRODUCTION_SUPABASE_KEY_ERROR,
      PRODUCTION_SUPABASE_PUBLIC_ERROR,
    } = loadConfig();
    const env = {
      ...productionPublicEnv,
      EAS_BUILD_PROFILE: "production",
      EAS_BUILD_PLATFORM: "ios",
    };
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: { ...env, EXPO_PUBLIC_SUPABASE_ANON_KEY: LEGACY_ANON_JWT_FIXTURE },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_SUPABASE_KEY_ERROR);
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: { ...env, EXPO_PUBLIC_SUPABASE_ANON_KEY: "" },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_SUPABASE_PUBLIC_ERROR);
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

describe("native Google Sign-In plugin", () => {
  const iosClientId = "123-abc.apps.googleusercontent.com";

  it("reverses the iOS client ID into the URL scheme the SDK returns through", () => {
    const { googleIosUrlScheme } = loadConfig();
    expect(googleIosUrlScheme(iosClientId)).toBe(
      "com.googleusercontent.apps.123-abc",
    );
    expect(googleIosUrlScheme("")).toBeUndefined();
    expect(googleIosUrlScheme(undefined)).toBeUndefined();
    expect(() => googleIosUrlScheme("123-abc")).toThrow(
      /must be a Google OAuth iOS client ID/,
    );
  });

  it("adds the plugin and the queryable scheme only when the iOS client ID is set", () => {
    const { applyMobileConfig } = loadConfig();
    const withIds = (ids: Record<string, string>) => ({
      plugins: ["expo-router"],
      ios: { infoPlist: { ITSAppUsesNonExemptEncryption: false } },
      extra: { googleSignIn: { webClientId: "w", ...ids } },
    });

    const without = applyMobileConfig(withIds({ iosClientId: "" }), {
      env: {},
      existsSync: missing,
    });
    expect(without.plugins).toEqual(["expo-router"]);
    expect(without.ios).toEqual({
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
    });

    const withIos = applyMobileConfig(withIds({ iosClientId }), {
      env: {},
      existsSync: missing,
    });
    // lib/google-auth.ts asks canOpenURL for this scheme before it touches the
    // SDK, so a binary built without it stays on the browser flow.
    expect(withIos.ios).toEqual({
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        LSApplicationQueriesSchemes: ["com.googleusercontent.apps.123-abc"],
      },
    });
    expect(withIos.plugins).toEqual([
      "expo-router",
      [
        "@react-native-google-signin/google-signin",
        { iosUrlScheme: "com.googleusercontent.apps.123-abc" },
      ],
    ]);
  });

  it("app.json carries a Google OAuth Web client ID", () => {
    const appJson = JSON.parse(
      readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "app.json"),
        "utf8",
      ),
    ) as { expo: { extra: { googleSignIn: { webClientId: string } } } };
    expect(appJson.expo.extra.googleSignIn.webClientId).toMatch(
      /\.apps\.googleusercontent\.com$/,
    );
  });
});

describe("the staging variant (#2511)", () => {
  const appJson = (
    requireConfig("./app.json") as { expo: Record<string, unknown> }
  ).expo;
  const easStagingEnv = (
    requireConfig("./eas.json") as {
      build: { staging: { channel: string; env: Record<string, string> } };
    }
  ).build.staging;
  const stagingBuildEnv = {
    EAS_BUILD_PROFILE: "staging",
    EAS_BUILD_PLATFORM: "ios",
    ...easStagingEnv.env,
    EXPO_PUBLIC_SUPABASE_URL: easStagingSupabaseOrigin,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: PUBLISHABLE_KEY_FIXTURE,
  };

  it("is what eas.json's staging profile builds, on a channel of its own", () => {
    const { applyMobileConfig, STAGING_IDENTITY, STAGING_PROFILE } =
      loadConfig();
    expect(STAGING_PROFILE).toBe("staging");
    expect(easStagingEnv.channel).toBe("staging");
    const result = applyMobileConfig(appJson, {
      env: stagingBuildEnv,
      existsSync: missing,
    }) as {
      name: string;
      scheme: string;
      slug: string;
      ios: Record<string, unknown>;
      android: Record<string, unknown>;
      updates: unknown;
    };
    expect(STAGING_IDENTITY).toEqual({
      name: "Frapp Staging",
      scheme: "frapp-staging",
      applicationId: "live.frapp.mobile.staging",
    });
    expect(result.name).toBe("Frapp Staging");
    expect(result.scheme).toBe("frapp-staging");
    expect(result.ios.bundleIdentifier).toBe("live.frapp.mobile.staging");
    expect(result.android.package).toBe("live.frapp.mobile.staging");
    // The production app's https links stay the production app's.
    expect(result.ios).not.toHaveProperty("associatedDomains");
    expect(result.android).not.toHaveProperty("intentFilters");
    // Shared with the production app, and the rest of each platform block kept.
    expect(result.slug).toBe(appJson.slug);
    expect(result.updates).toEqual(appJson.updates);
    expect(result.ios.usesAppleSignIn).toBe(true);
    expect(result.android.adaptiveIcon).toEqual(
      (appJson.android as { adaptiveIcon: unknown }).adaptiveIcon,
    );
  });

  it("leaves app.json's config untouched", () => {
    const { applyMobileConfig } = loadConfig();
    const before = structuredClone(appJson);
    applyMobileConfig(appJson, { env: stagingBuildEnv, existsSync: missing });
    expect(appJson).toEqual(before);
  });

  it("is off without the variable, so every other run builds the production app", () => {
    const { applyMobileConfig } = loadConfig();
    const result = applyMobileConfig(appJson, {
      env: { EAS_BUILD_PROFILE: "preview" },
      existsSync: missing,
    }) as { name: string; scheme: string; ios: Record<string, unknown> };
    expect(result.name).toBe("Frapp");
    expect(result.scheme).toBe("frapp");
    expect(result.ios.bundleIdentifier).toBe("live.frapp.mobile");
    expect(result.ios.associatedDomains).toEqual(["applinks:app.frapp.live"]);
  });

  it("may be set by hand on a run with no profile (expo start, a local prebuild)", () => {
    const { applyMobileConfig } = loadConfig();
    const result = applyMobileConfig(appJson, {
      env: { FRAPP_APP_VARIANT: "staging" },
      existsSync: missing,
    });
    expect(result.scheme).toBe("frapp-staging");
  });

  it("refuses any value but staging", () => {
    const { applyMobileConfig, APP_VARIANT_VALUE_ERROR } = loadConfig();
    for (const value of ["production", "Staging", "preview", "1"]) {
      expect(() =>
        applyMobileConfig(appJson, {
          env: { FRAPP_APP_VARIANT: value },
          existsSync: missing,
        }),
      ).toThrow(APP_VARIANT_VALUE_ERROR);
    }
  });

  it("refuses the variant on every other profile, for a build or a guarded update", () => {
    const { applyMobileConfig, APP_VARIANT_PROFILE_ERROR } = loadConfig();
    for (const profile of ["production", "preview", "development", "e2e"]) {
      for (const key of ["EAS_BUILD_PROFILE", "FRAPP_EAS_UPDATE_PROFILE"]) {
        expect(() =>
          applyMobileConfig(appJson, {
            env: {
              ...productionPublicEnv,
              [key]: profile,
              FRAPP_APP_VARIANT: "staging",
            },
            existsSync: present,
          }),
        ).toThrow(APP_VARIANT_PROFILE_ERROR);
      }
    }
  });

  it("refuses the staging profile without the variant", () => {
    const { applyMobileConfig, APP_VARIANT_PROFILE_ERROR } = loadConfig();
    const withoutVariant: Record<string, string> = { ...stagingBuildEnv };
    delete withoutVariant.FRAPP_APP_VARIANT;
    expect(() =>
      applyMobileConfig(appJson, { env: withoutVariant, existsSync: missing }),
    ).toThrow(APP_VARIANT_PROFILE_ERROR);
  });

  it("refuses the production API or Supabase project", () => {
    const { applyMobileConfig, STAGING_VARIANT_PRODUCTION_ORIGIN_ERROR } =
      loadConfig();
    for (const override of [
      { EXPO_PUBLIC_API_URL: `${easProductionApiUrl}/` },
      { EXPO_PUBLIC_SUPABASE_URL: easProductionSupabaseOrigin },
    ]) {
      expect(() =>
        applyMobileConfig(appJson, {
          env: { ...stagingBuildEnv, ...override },
          existsSync: missing,
        }),
      ).toThrow(STAGING_VARIANT_PRODUCTION_ORIGIN_ERROR);
    }
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

describe("assertProductionSupabasePublishableKey (#2526)", () => {
  it("allows CI, and preview or development builds on a legacy key", () => {
    const { assertProductionSupabasePublishableKey } = loadConfig();
    expect(() => assertProductionSupabasePublishableKey({})).not.toThrow();
    for (const easBuildProfile of ["preview", "development"]) {
      expect(() =>
        assertProductionSupabasePublishableKey({
          easBuildProfile,
          supabaseAnonKey: LEGACY_ANON_JWT_FIXTURE,
        }),
      ).not.toThrow();
    }
  });

  it("allows a publishable key in production", () => {
    const { assertProductionSupabasePublishableKey } = loadConfig();
    expect(() =>
      assertProductionSupabasePublishableKey({
        easBuildProfile: "production",
        supabaseAnonKey: PUBLISHABLE_KEY_FIXTURE,
      }),
    ).not.toThrow();
  });

  // Expo inlines the value verbatim and lib/supabase.ts doesn't trim it, so a
  // pasted newline would reach every request the binary makes.
  it.each([
    ["a trailing newline", `${PUBLISHABLE_KEY_FIXTURE}\n`],
    ["a leading space", ` ${PUBLISHABLE_KEY_FIXTURE}`],
    ["a trailing quote", `${PUBLISHABLE_KEY_FIXTURE}"`],
    ["a zero-width space", `${PUBLISHABLE_KEY_FIXTURE}\u200b`],
  ])("refuses a publishable key with %s", (_label, supabaseAnonKey) => {
    const {
      assertProductionSupabasePublishableKey,
      PRODUCTION_SUPABASE_KEY_ERROR,
    } = loadConfig();
    expect(() =>
      assertProductionSupabasePublishableKey({
        easBuildProfile: "production",
        supabaseAnonKey,
      }),
    ).toThrow(PRODUCTION_SUPABASE_KEY_ERROR);
  });

  // The legacy key goes dead in the field after 2026; a secret key would ship
  // an RLS bypass inside every binary. One pattern refuses both.
  it.each([
    ["the legacy JWT anon key", LEGACY_ANON_JWT_FIXTURE],
    ["a secret key", SECRET_KEY_FIXTURE],
    ["an unresolved reference", "${SUPABASE_ANON_KEY}"],
    ["a prefix typo", "sb_publishable"],
  ])("refuses %s in production", (_label, supabaseAnonKey) => {
    const {
      assertProductionSupabasePublishableKey,
      PRODUCTION_SUPABASE_KEY_ERROR,
    } = loadConfig();
    expect(() =>
      assertProductionSupabasePublishableKey({
        easBuildProfile: "production",
        supabaseAnonKey,
      }),
    ).toThrow(PRODUCTION_SUPABASE_KEY_ERROR);
  });
});

describe("assertNoSupabaseSecretKey (#2526)", () => {
  // Every EXPO_PUBLIC_* value is inlined into the bundle, so a key that
  // bypasses RLS is refused whatever the profile: a preview build is an
  // installable binary too.
  it.each([
    ["a secret key", SECRET_KEY_FIXTURE],
    ["a service_role JWT", SERVICE_ROLE_JWT_FIXTURE],
    ["a user's access token", USER_TOKEN_JWT_FIXTURE],
    // With no profile this is the only key check, so a pasted secret prefix
    // or JWT is found wherever it sits: trim() leaves quotes and a zero-width
    // space.
    ["a secret key in quotes", `"${SECRET_KEY_FIXTURE}"`],
    ["a secret key behind a zero-width space", `\u200b${SECRET_KEY_FIXTURE}`],
    ["a personal access token", ACCESS_TOKEN_FIXTURE],
    ["a personal access token in quotes", `"${ACCESS_TOKEN_FIXTURE}"`],
    // Pasted onto the end of a real key: the allowlist patterns accept key
    // characters to the end, so this check is the one that sees it, and a
    // production build would otherwise ship it.
    ["a secret key appended to a publishable key", `${PUBLISHABLE_KEY_FIXTURE}${SECRET_KEY_FIXTURE}`],
    ["an access token appended to a publishable key", `${PUBLISHABLE_KEY_FIXTURE}${ACCESS_TOKEN_FIXTURE}`],
    ["a secret key appended to an anon JWT", `${LEGACY_ANON_JWT_FIXTURE}${SECRET_KEY_FIXTURE}`],
    ["a URL-encoded secret key", `%22${SECRET_KEY_FIXTURE}%22`],
    // A JWT among other dotted text doesn't split into three parts, so its
    // claims are found as an `eyJ` segment after a dot instead; one that
    // looks like a header (an `alg` and no `role`) is skipped.
    ["a service_role JWT appended to an anon JWT", `${LEGACY_ANON_JWT_FIXTURE}${SERVICE_ROLE_JWT_FIXTURE}`],
    ["a service_role JWT after an anon JWT and a space", `${LEGACY_ANON_JWT_FIXTURE} ${SERVICE_ROLE_JWT_FIXTURE}`],
    ["a service_role JWT with a trailing period", `${SERVICE_ROLE_JWT_FIXTURE}.`],
    ["a service_role JWT after the project URL", `https://ref.supabase.co ${SERVICE_ROLE_JWT_FIXTURE}`],
    // Claims with no role aren't anon either, wherever they sit.
    [
      "a JWT with no role after the project URL",
      "https://ref.supabase.co eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.not-a-real-signature", // gitleaks:allow
    ],
    // Wrapped across lines by a terminal, after other dotted text.
    [
      "a line-wrapped service_role JWT after the project URL",
      `https://ref.supabase.co ${SERVICE_ROLE_JWT_FIXTURE.slice(0, 30)}\n${SERVICE_ROLE_JWT_FIXTURE.slice(30)}`,
    ],
  ])("refuses %s on any profile, or none", (_label, supabaseAnonKey) => {
    const {
      applyMobileConfig,
      assertNoSupabaseSecretKey,
      PUBLIC_SUPABASE_SECRET_KEY_ERROR,
    } = loadConfig();
    expect(() => assertNoSupabaseSecretKey({ supabaseAnonKey })).toThrow(
      PUBLIC_SUPABASE_SECRET_KEY_ERROR,
    );
    // `undefined` is `expo start` / `expo export` / CI prebuild: no EAS
    // profile at all, and the key must still be refused.
    for (const EAS_BUILD_PROFILE of [
      undefined,
      "preview",
      "development",
      "production",
    ]) {
      expect(() =>
        applyMobileConfig(androidConfig, {
          env: {
            ...productionPublicEnv,
            ...(EAS_BUILD_PROFILE
              ? { EAS_BUILD_PROFILE, EAS_BUILD_PLATFORM: "ios" }
              : {}),
            EXPO_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
          },
          existsSync: missing,
        }),
      ).toThrow(PUBLIC_SUPABASE_SECRET_KEY_ERROR);
    }
  });

  it("allows the keys a client is meant to hold, and no key at all", () => {
    const { assertNoSupabaseSecretKey } = loadConfig();
    for (const supabaseAnonKey of [
      PUBLISHABLE_KEY_FIXTURE,
      LEGACY_ANON_JWT_FIXTURE,
      "not-a-jwt",
      // Three parts, but the middle is `[]`: JWT claims are an object, so this
      // is a placeholder, not a credential to tell anyone to rotate.
      "x.W10.y",
      // The second JWT's header follows a dot; it is skipped, not read as
      // role-less claims.
      `${LEGACY_ANON_JWT_FIXTURE}.${LEGACY_ANON_JWT_FIXTURE}`,
      undefined,
    ]) {
      expect(() => assertNoSupabaseSecretKey({ supabaseAnonKey })).not.toThrow();
    }
  });
});

describe("assertEasSupabaseClientKey (#2526)", () => {
  // Every EAS profile produces a binary that goes to testers or the store. A
  // value pasted from the wrong field of Supabase's settings has no shape to
  // deny, so an EAS build allows only the two client keys.
  it.each([
    ["the legacy JWT secret", JWT_SECRET_FIXTURE],
    ["an unresolved reference", "${SUPABASE_ANON_KEY}"],
    // Expo inlines the value verbatim and lib/supabase.ts doesn't trim it.
    ["a publishable key with a trailing newline", `${PUBLISHABLE_KEY_FIXTURE}\n`],
    ["an anon JWT with a leading space", ` ${LEGACY_ANON_JWT_FIXTURE}`],
    ["only whitespace", "   "],
    // Nor anything else a paste leaves around a key, which trim() can't see.
    ["an anon JWT in quotes", `"${LEGACY_ANON_JWT_FIXTURE}"`],
    ["an anon JWT behind a zero-width space", `\u200b${LEGACY_ANON_JWT_FIXTURE}`],
    ["a publishable key with a trailing quote", `${PUBLISHABLE_KEY_FIXTURE}"`],
    [
      "anon claims between segments that aren't a JWT",
      `junk.${LEGACY_ANON_JWT_FIXTURE.split(".")[1]}.junk`,
    ],
  ])("refuses %s on every EAS profile", (_label, supabaseAnonKey) => {
    const {
      applyMobileConfig,
      assertEasSupabaseClientKey,
      EAS_SUPABASE_CLIENT_KEY_ERROR,
    } = loadConfig();
    for (const EAS_BUILD_PROFILE of ["development", "preview", "production"]) {
      expect(() =>
        assertEasSupabaseClientKey({
          easBuildProfile: EAS_BUILD_PROFILE,
          supabaseAnonKey,
        }),
      ).toThrow(EAS_SUPABASE_CLIENT_KEY_ERROR);
    }
    // Through the whole config, where production's stricter check speaks first.
    for (const EAS_BUILD_PROFILE of ["development", "preview"]) {
      expect(() =>
        applyMobileConfig(androidConfig, {
          env: {
            ...productionPublicEnv,
            EAS_BUILD_PROFILE,
            EAS_BUILD_PLATFORM: "ios",
            EXPO_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
          },
          existsSync: missing,
        }),
      ).toThrow(EAS_SUPABASE_CLIENT_KEY_ERROR);
    }
  });

  it("allows the two client keys, and no key, on every EAS profile", () => {
    const { assertEasSupabaseClientKey } = loadConfig();
    for (const easBuildProfile of ["development", "preview", "production"]) {
      for (const supabaseAnonKey of [
        PUBLISHABLE_KEY_FIXTURE,
        LEGACY_ANON_JWT_FIXTURE,
        "",
        undefined,
      ]) {
        expect(() =>
          assertEasSupabaseClientKey({ easBuildProfile, supabaseAnonKey }),
        ).not.toThrow();
      }
    }
  });

  // `expo start`, CI prebuild and `expo export` set no profile, and
  // placeholders are normal there. `eas update` publishes an `expo export`
  // with no profile either, so there the secret denylist above is the only key
  // check (spec/environments/README.md § Mobile (EAS) keeps it off until an
  // update pipeline sets one).
  it("leaves a run with no EAS profile to the denylist", () => {
    const { applyMobileConfig, assertEasSupabaseClientKey } = loadConfig();
    for (const supabaseAnonKey of ["test-anon-key", JWT_SECRET_FIXTURE]) {
      expect(() => assertEasSupabaseClientKey({ supabaseAnonKey })).not.toThrow();
      expect(() =>
        applyMobileConfig(androidConfig, {
          env: {
            ...productionPublicEnv,
            EXPO_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
          },
          existsSync: missing,
        }),
      ).not.toThrow();
    }
  });
});

/**
 * Dormant `expo-updates` (#2526). The first store binary is the only chance to
 * ship an OTA client: every install keeps the native code it was built with,
 * so a build without one can never take an over-the-air fix. "Dormant" means
 * installed and configured, with nothing published: an app that checks
 * `ON_LOAD` and finds no update for its channel and runtime runs the bundle
 * it was built with.
 */
describe("expo-updates, installed dormant (#2526)", () => {
  const appJson = requireConfig("./app.json") as {
    expo: {
      runtimeVersion?: unknown;
      updates?: Record<string, unknown>;
      extra: { eas: { projectId: string } };
    };
  };
  const easJson = requireConfig("./eas.json") as {
    build: Record<string, { channel?: string }>;
  };
  const packageJson = requireConfig("./package.json") as {
    dependencies: Record<string, string>;
  };

  it("is a dependency, so its native module is in every build", () => {
    expect(packageJson.dependencies["expo-updates"]).toBeDefined();
  });

  // Keyed to `expo.version`, which is only safe because every build whose
  // native code changes gets a new version. `spec/environments/README.md`
  // § Mobile (EAS) owns that rule and why `fingerprint` was rejected.
  it("keys the runtime version to the app version", () => {
    expect(appJson.expo.runtimeVersion).toEqual({ policy: "appVersion" });
  });

  it("points at this project's EAS Update URL and checks at launch without waiting", () => {
    expect(appJson.expo.updates).toEqual({
      url: `https://u.expo.dev/${appJson.expo.extra.eas.projectId}`,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    });
  });

  it("gives every build profile its own channel, named after the profile", () => {
    for (const [profile, config] of Object.entries(easJson.build)) {
      expect(config.channel, profile).toBe(profile);
    }
    expect(easJson.build.production?.channel).toBe("production");
  });
});

// `npm run eas -- update` (scripts/eas-update.mjs) sets FRAPP_EAS_UPDATE_PROFILE
// to the channel's build profile, because `eas update` sets no EAS_BUILD_PROFILE
// and would otherwise skip every fence on public values (#3472).
describe("an OTA update through the guard (#3472)", () => {
  const productionUpdateEnv = {
    ...productionPublicEnv,
    EXPO_PUBLIC_SENTRY_DSN: "https://public@o0.ingest.sentry.io/0",
    FRAPP_EAS_UPDATE_PROFILE: "production",
  };

  it("takes the build's profile first, then the update's", () => {
    const { publicValueProfile } = loadConfig();
    expect(publicValueProfile({})).toBeUndefined();
    expect(publicValueProfile({ FRAPP_EAS_UPDATE_PROFILE: "production" })).toBe(
      "production",
    );
    expect(
      publicValueProfile({
        EAS_BUILD_PROFILE: "preview",
        FRAPP_EAS_UPDATE_PROFILE: "production",
      }),
    ).toBe("preview");
  });

  it("passes with production values, and needs no google-services file", () => {
    const { applyMobileConfig } = loadConfig();
    const result = applyMobileConfig(androidConfig, {
      env: { ...productionUpdateEnv, FRAPP_EAS_UPDATE_GIT_SHA: "abc123" },
      existsSync: missing,
    });
    expect(
      (result.android as { googleServicesFile?: string }).googleServicesFile,
    ).toBeUndefined();
    expect((result.extra as { gitSha?: string }).gitSha).toBe("abc123");
  });

  it("runs the production API fence, so a bundle can't call localhost", () => {
    const { applyMobileConfig, PRODUCTION_API_URL_ERROR } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: { ...productionUpdateEnv, EXPO_PUBLIC_API_URL: undefined },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_API_URL_ERROR);
  });

  it("runs the production Supabase fences", () => {
    const { applyMobileConfig, PRODUCTION_SUPABASE_URL_ERROR, PRODUCTION_SUPABASE_KEY_ERROR } =
      loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: { ...productionUpdateEnv, EXPO_PUBLIC_SUPABASE_URL: easStagingSupabaseOrigin },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_SUPABASE_URL_ERROR);
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: { ...productionUpdateEnv, EXPO_PUBLIC_SUPABASE_ANON_KEY: LEGACY_ANON_JWT_FIXTURE },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_SUPABASE_KEY_ERROR);
  });

  it("refuses a production update with no Sentry DSN, which a Secret EAS variable never supplies locally", () => {
    const { applyMobileConfig, PRODUCTION_UPDATE_SENTRY_DSN_ERROR } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: { ...productionUpdateEnv, EXPO_PUBLIC_SENTRY_DSN: undefined },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_UPDATE_SENTRY_DSN_ERROR);
    // Builds keep their own rules: EAS loads Secret variables for them, even
    // when the shell still carries the update marker from an earlier publish.
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          ...productionPublicEnv,
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "ios",
          FRAPP_EAS_UPDATE_PROFILE: "production",
        },
        existsSync: missing,
      }),
    ).not.toThrow();
  });

  it("holds a preview update to the client-key allowlist, not the production fences", () => {
    const { applyMobileConfig, EAS_SUPABASE_CLIENT_KEY_ERROR } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: { FRAPP_EAS_UPDATE_PROFILE: "preview", EXPO_PUBLIC_API_URL: "https://api-staging.frapp.live" },
        existsSync: missing,
      }),
    ).not.toThrow();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: { FRAPP_EAS_UPDATE_PROFILE: "preview", EXPO_PUBLIC_SUPABASE_ANON_KEY: JWT_SECRET_FIXTURE },
        existsSync: missing,
      }),
    ).toThrow(EAS_SUPABASE_CLIENT_KEY_ERROR);
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
 * App Store compliance: the iOS privacy manifest (#2294), and the media-picker
 * dependencies #2296 removed and #2464 brought back.
 *
 * `getConfig` is the real resolution path — it loads `app.json`, hands it to
 * `app.config.js`, and evaluates the `plugins` list. `ios.privacyManifests` is
 * a *static* key the dynamic layer must not drop: `applyMobileConfig` spreads
 * `config` and overrides only `extra` and `android`, and these tests pin that
 * it keeps doing so.
 *
 * WHAT MOVED (#2343). The permission roster isn't here any more: which iOS
 * purpose strings ship, their exact text, the Android permissions a screen
 * requests and the app manifest's removals. It lives in
 * `scripts/check-mobile-native-declarations.mjs`, which `mobile-validate` runs
 * over `expo config --type introspect`. That reads the Info.plist and
 * AndroidManifest the plugins' mods produce, so it sees what an assertion here
 * couldn't: an **omitted** option shipping its plugin's default purpose string
 * (`IOSConfig.Permissions.applyPermissions` deletes a key only for a strict
 * `false`), and a vendor option not spelled `*Permission`. The same gate
 * scans every linked iOS pod in node_modules for required-reason APIs and
 * fails on a category the array below doesn't declare, so the bundled-SDK side
 * of #2294 is encoded rather than narrated. It can't tell which reason code a
 * use needs, and it can't read native code fetched from elsewhere: podspec
 * dependencies (sentry-cocoa, SDWebImage, ReachabilitySwift, the Stripe iOS
 * SDK's pods, which stripe-react-native 0.77 takes from CocoaPods,
 * react-native's third-party pods, hermes-engine). The audit recorded in the
 * array test below covers sentry-cocoa and SDWebImage; the rest are unaudited
 * (#3030).
 */
describe("iOS privacy manifest (#2294)", () => {
  function resolved() {
    const { getConfig } = requireConfig("expo/config") as {
      getConfig: (
        dir: string,
        opts?: {
          skipSDKVersionRequirement?: boolean;
          isModdedConfig?: boolean;
        },
      ) => {
        exp: {
          ios?: { privacyManifests?: Record<string, unknown> };
        };
      };
    };
    // `app.config.js` throws on an EAS *production* profile without Firebase
    // config, and getConfig offers no env injection point — so an inherited
    // EAS_BUILD_PROFILE (an `eas build --local` shell, or a prebuild hook that
    // runs this suite) would fail these tests with an unrelated Firebase
    // message. Clear both; the root `afterEach` restores them, because
    // `restoredEnvKeys` above already owns these two keys — deliberately not a
    // second restore policy in this file.
    delete process.env.EAS_BUILD_PROFILE;
    delete process.env.EAS_BUILD_PLATFORM;
    // The update guard's profile turns the same fences on (#3472).
    delete process.env.FRAPP_EAS_UPDATE_PROFILE;
    return getConfig(path.dirname(fileURLToPath(import.meta.url)), {
      skipSDKVersionRequirement: true,
      isModdedConfig: true,
    }).exp;
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
    // the types belongs with #2305, which is actively rewriting the label those
    // declarations would have to match — declaring them here first would create
    // a second home for a fact in flux. (Not #2304: that one is the store
    // listing description under Guideline 2.3 and touches no label answer.)
    const manifests = resolved().ios?.privacyManifests;
    expect(manifests).toBeDefined();
    expect(manifests?.NSPrivacyTracking).toBe(false);
    expect(manifests?.NSPrivacyTrackingDomains).toEqual([]);
  });

  it("declares exactly the four required-reason categories app.json is meant to carry", () => {
    // HOW THE SHIPPED MANIFEST IS BUILT, which is what every row below rests
    // on. Prebuild writes `PrivacyInfo.xcprivacy` from this key
    // (`withPrivacyInfo`, a default plugin). `pod install` then merges in
    // react-native's hard-coded core list (C617.1, CA92.1, 35F9.1) and every
    // pod's own manifest that is wired in as a `resource_bundles` entry
    // (`react-native/scripts/cocoapods/privacy_manifest_utils.rb`, on unless
    // `apple.privacyManifestAggregationEnabled` is "false"). Three pods fall
    // through that net, and they are why this list is not just "what the pods
    // don't already say":
    //
    //  - sentry-cocoa is linked as a static xcframework through
    //    FRAMEWORK_SEARCH_PATHS and `-force_load` (RNSentry.podspec), with no
    //    resource bundle, so its own manifest never ships while its code sits
    //    in the app binary.
    //  - Expo's template precompiles modules by default
    //    (EXPO_USE_PRECOMPILED_MODULES), and the prebuilt expo-file-system
    //    tarball carries no manifest, so its declaration is dropped too.
    //  - The precompiled SDWebImage framework that expo-image-manipulator
    //    pulls in carries none either.
    //
    // UserDefaults / CA92.1 is the load-bearing row for
    // @stripe/stripe-react-native: StripeSdkImpl.swift reads and writes
    // `UserDefaults.standard` (app-local, which is what CA92.1 covers).
    // expo-updates (#2526) and its EASClient do the same. expo-sharing also
    // uses UserDefaults, but via `UserDefaults(suiteName:)`, the app-group
    // case, whose reason is 1C8F.1, not CA92.1. That path is unreachable today
    // because this app configures no app group; if a share extension or app
    // group is ever added, 1C8F.1 has to be declared rather than assumed
    // covered by this row.
    //
    // FileTimestamp / C617.1 was required by #2296's acceptance criteria. It
    // covers the app's own container reads, and sentry-cocoa's and the
    // prebuilt SDWebImage's timestamp reads, neither of which ships a manifest.
    // 0A2A.1 is NOT added: Apple reserves it for a third-party SDK wrapping
    // timestamp APIs, so it is a reason for an SDK's manifest, not the app's.
    //
    // SystemBootTime / 35F9.1 (#2526): sentry-cocoa reads `systemUptime` to
    // time in-app events, and its manifest doesn't ship (above). RN's
    // aggregation adds this row too; declaring it here keeps it from depending
    // on that staying on.
    //
    // DiskSpace / E174.1 (#2526): expo-file-system reads free and total space
    // (FileSystemModule.swift, FileSystemLegacyModule.swift), and its own
    // manifest is dropped when it is precompiled (above). E174.1, "check there
    // is enough space to write files", is the reason Expo's own manifest gives.
    //
    // Pinned as the whole array rather than per-category lookups: a keyed lookup
    // is last-wins, so a duplicate category or an extra entry carrying an
    // invalid reason code — which Apple rejects on upload — would pass unseen.
    expect(resolved().ios?.privacyManifests?.NSPrivacyAccessedAPITypes).toEqual(
      [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
          NSPrivacyAccessedAPITypeReasons: ["C617.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
          NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
          NSPrivacyAccessedAPITypeReasons: ["E174.1"],
        },
      ],
    );
  });
});

describe("media picker dependencies (#2296, #2464)", () => {
  it("depends on a media picker only where a surface imports one", () => {
    const pkg = requireConfig("./package.json") as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...(pkg.devDependencies ?? {}) };

    // `expo-image-picker` came back with the chat photo-upload surface, which
    // is the condition #2296 set on re-adding it ("a picker returns only with
    // the slice that actually builds a picker surface"). `lib/chat/attachment-upload.ts`
    // is that importer, and the assertion below is what keeps the dependency
    // honest: if the surface is ever deleted, this test fails rather than
    // leaving a photo-library purpose string in the binary for nothing, which
    // is the Guideline 5.1.1(i) finding the whole episode was about.
    expect(all["expo-image-picker"]).toBeDefined();
    expect(all["expo-image-manipulator"]).toBeDefined();

    // Still absent, and for the original reason: no surface picks a document.
    expect(all["expo-document-picker"]).toBeUndefined();
  });

  it("keeps a source importer for every media picker it depends on", () => {
    // The pairing above is only meaningful if something actually imports them.
    // #1045 shipped the dependency a month ahead of any importer, and the
    // purpose string rode along into the binary for a feature that did not
    // exist; this is the check that would have caught it. Spec files do not
    // count — a mock is not a surface.
    const mobileRoot = path.dirname(fileURLToPath(import.meta.url));

    function importersUnder(dir: string): string[] {
      const found: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          found.push(...importersUnder(full));
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (/\.spec\.[tj]sx?$/.test(entry.name)) continue;
        const source = readFileSync(full, "utf8");
        if (
          source.includes("expo-image-picker") ||
          source.includes("expo-image-manipulator")
        ) {
          found.push(path.relative(mobileRoot, full));
        }
      }
      return found;
    }

    const importers = [
      ...importersUnder(path.join(mobileRoot, "lib")),
      ...importersUnder(path.join(mobileRoot, "components")),
    ];

    expect(importers).not.toEqual([]);
  });
});

describe("invite links open the app (#4002)", () => {
  // The binary's half of universal links and App Links. The web's half is
  // `/.well-known/apple-app-site-association` and `assetlinks.json` on
  // app.frapp.live, which claim `APP_LINK_PATHS` (the invite and the
  // check-in code); the two must agree, except a path whose Android claim
  // waits on the next native version (an intent filter is in the binary, and
  // a change to it would stop 0.12.0 getting updates over the air).
  // `/check-in` (2026-11-13) reaches Android with #4763; until then its web
  // page hands off with Open in Frapp. iOS reads its paths from the web's
  // file, so it needs no build for a new one.
  const ANDROID_CLAIMS_LATER: readonly string[] = ["/check-in"];
  it("claims exactly the web's app-link paths on app.frapp.live, on both platforms", () => {
    const appJson = JSON.parse(
      readFileSync(new URL("./app.json", import.meta.url), "utf8"),
    ) as {
      expo: {
        ios: { associatedDomains?: string[] };
        android: {
          intentFilters?: {
            action: string;
            autoVerify?: boolean;
            data: { scheme: string; host: string; path?: string }[];
            category: string[];
          }[];
        };
      };
    };
    expect(appJson.expo.ios.associatedDomains).toEqual([
      "applinks:app.frapp.live",
    ]);
    const filters = appJson.expo.android.intentFilters ?? [];
    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatchObject({
      action: "VIEW",
      autoVerify: true,
      category: ["BROWSABLE", "DEFAULT"],
    });
    expect(filters[0]!.data).toEqual(
      APP_LINK_PATHS.filter(
        (path) => !ANDROID_CLAIMS_LATER.includes(path),
      ).map((path) => ({
        scheme: "https",
        host: "app.frapp.live",
        path,
      })),
    );
  });
});

// The device pass's automated half (`.eas/workflows/device-smoke.yml`,
// docs/mobile/testing.md § Automated flows) builds with the `e2e` profile. The
// Maestro flows sign in with the staging smoke account and post to #general,
// so this profile must never point at production or carry signing
// credentials: a build from it is an emulator or simulator app only.
describe("the e2e profile behind the Maestro flows (#808)", () => {
  const easJson = requireConfig("./eas.json") as {
    build: Record<
      string,
      {
        environment?: string;
        extends?: string;
        distribution?: string;
        withoutCredentials?: boolean;
        ios?: { simulator?: boolean };
        android?: { buildType?: string };
        env?: Record<string, string>;
      }
    >;
  };
  const e2e = easJson.build.e2e;
  const workflow = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      ".eas/workflows/device-smoke.yml",
    ),
    "utf8",
  );

  it("builds a simulator app and an emulator APK, without signing credentials", () => {
    expect(e2e?.ios?.simulator).toBe(true);
    expect(e2e?.android?.buildType).toBe("apk");
    expect(e2e?.withoutCredentials).toBe(true);
    expect(e2e?.distribution).toBe("internal");
  });

  it("points at staging, never production", () => {
    expect(e2e?.environment).toBe("preview");
    expect(e2e?.extends).toBeUndefined();
    expect(e2e?.env?.EXPO_PUBLIC_API_URL).toBe(
      "https://api-staging.frapp.live",
    );
    expect(e2e?.env?.EXPO_PUBLIC_API_URL).not.toBe(easProductionApiUrl);
    expect(e2e?.env?.EXPO_PUBLIC_SENTRY_ENVIRONMENT).toBe("e2e");
  });

  it("is the only profile the workflow builds", () => {
    const profiles = [...workflow.matchAll(/^\s*profile:\s*(\S+)\s*$/gm)].map(
      (match) => match[1],
    );
    expect(profiles).toEqual(["e2e", "e2e"]);
  });
});
