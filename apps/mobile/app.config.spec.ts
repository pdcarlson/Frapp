import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_API_ORIGIN as SHARED_PRODUCTION_API_ORIGIN,
  PRODUCTION_APP_ORIGIN as SHARED_PRODUCTION_APP_ORIGIN,
} from "@repo/validation";
import { afterEach, describe, expect, it } from "vitest";
import { ASK_FLAG_ENV_KEY, isAskAvailable } from "./lib/ask/flag";

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
    assertProductionSupabasePublishableKey: (opts?: {
      easBuildProfile?: string;
      supabaseAnonKey?: string;
    }) => void;
    PRODUCTION_SUPABASE_KEY_ERROR: string;
    assertNoSupabaseSecretKey: (opts?: { supabaseAnonKey?: string }) => void;
    PUBLIC_SUPABASE_SECRET_KEY_ERROR: string;
    assertProductionAppUrl: (opts?: {
      easBuildProfile?: string;
      appUrl?: string;
    }) => void;
    assertProductionAskDisabled: (opts?: {
      easBuildProfile?: string;
      askEnabled?: string;
    }) => void;
    isAskEnabledValue: (raw: unknown) => boolean;
    PRODUCTION_ASK_ENABLED_ERROR: string;
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
  "GOOGLE_SERVICES_JSON",
  "EXPO_PUBLIC_API_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_ASK_ENABLED",
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

  it("refuses iOS production when EXPO_PUBLIC_ASK_ENABLED switches Ask on", () => {
    const { applyMobileConfig, PRODUCTION_ASK_ENABLED_ERROR } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          ...productionPublicEnv,
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_PLATFORM: "ios",
          EXPO_PUBLIC_ASK_ENABLED: "1",
        },
        existsSync: missing,
      }),
    ).toThrow(PRODUCTION_ASK_ENABLED_ERROR);
  });

  it("lets a preview build with Ask on evaluate", () => {
    const { applyMobileConfig } = loadConfig();
    expect(() =>
      applyMobileConfig(androidConfig, {
        env: {
          EAS_BUILD_PROFILE: "preview",
          EAS_BUILD_PLATFORM: "ios",
          EXPO_PUBLIC_ASK_ENABLED: "true",
        },
        existsSync: missing,
      }),
    ).not.toThrow();
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
  // an RLS bypass inside every binary. Both are refused by one prefix test.
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
  ])("refuses %s on any profile, or none", (_label, supabaseAnonKey) => {
    const {
      applyMobileConfig,
      assertNoSupabaseSecretKey,
      PUBLIC_SUPABASE_SECRET_KEY_ERROR,
    } = loadConfig();
    expect(() => assertNoSupabaseSecretKey({ supabaseAnonKey })).toThrow(
      PUBLIC_SUPABASE_SECRET_KEY_ERROR,
    );
    for (const EAS_BUILD_PROFILE of ["preview", "development", "production"]) {
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
      ).toThrow(PUBLIC_SUPABASE_SECRET_KEY_ERROR);
    }
  });

  it("allows the keys a client is meant to hold, and no key at all", () => {
    const { assertNoSupabaseSecretKey } = loadConfig();
    for (const supabaseAnonKey of [
      PUBLISHABLE_KEY_FIXTURE,
      LEGACY_ANON_JWT_FIXTURE,
      "not-a-jwt",
      undefined,
    ]) {
      expect(() => assertNoSupabaseSecretKey({ supabaseAnonKey })).not.toThrow();
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

  // appVersion ties an update to `expo.version`: an update published for
  // 0.9.x reaches only binaries built at 0.9.x. `fingerprint` is still marked
  // experimental in Expo's docs, which is not a policy to freeze into a binary.
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
 * The store binary has no Ask (#2259), and `eas.json` can only show the half
 * of that the repo owns: a value set in the EAS `production` environment
 * reaches the bundle with no repo change. This fence is the other half — a
 * production build with Ask on fails to evaluate its config.
 */
describe("assertProductionAskDisabled", () => {
  /** Every spelling the flag spec exercises, on and off. */
  const spellings = [
    "1",
    "true",
    " true ",
    "",
    "  ",
    "0",
    "false",
    "TRUE",
    "True",
    "yes",
    "on",
  ];

  it("allows CI and expo start with Ask on (profile unset)", () => {
    const { assertProductionAskDisabled } = loadConfig();
    expect(() =>
      assertProductionAskDisabled({ askEnabled: "1" }),
    ).not.toThrow();
  });

  it("allows preview and development builds with Ask on", () => {
    const { assertProductionAskDisabled } = loadConfig();
    for (const easBuildProfile of ["preview", "development"]) {
      expect(() =>
        assertProductionAskDisabled({ easBuildProfile, askEnabled: "true" }),
      ).not.toThrow();
    }
  });

  it("allows production with the flag unset", () => {
    const { assertProductionAskDisabled } = loadConfig();
    expect(() =>
      assertProductionAskDisabled({ easBuildProfile: "production" }),
    ).not.toThrow();
  });

  it("refuses production exactly when the app would switch Ask on", () => {
    const { assertProductionAskDisabled, PRODUCTION_ASK_ENABLED_ERROR } =
      loadConfig();
    for (const askEnabled of spellings) {
      process.env[ASK_FLAG_ENV_KEY] = askEnabled;
      const check = () =>
        assertProductionAskDisabled({
          easBuildProfile: "production",
          askEnabled,
        });
      if (isAskAvailable()) {
        expect(check, JSON.stringify(askEnabled)).toThrow(
          PRODUCTION_ASK_ENABLED_ERROR,
        );
      } else {
        expect(check, JSON.stringify(askEnabled)).not.toThrow();
      }
    }
  });

  it("parses the value the way lib/ask/flag.ts does, so the duplicate cannot drift", () => {
    const { isAskEnabledValue } = loadConfig();
    for (const raw of spellings) {
      process.env[ASK_FLAG_ENV_KEY] = raw;
      expect(isAskEnabledValue(raw), JSON.stringify(raw)).toBe(
        isAskAvailable(),
      );
    }
    delete process.env[ASK_FLAG_ENV_KEY];
    expect(isAskEnabledValue(undefined)).toBe(isAskAvailable());
    // Both directions are exercised, or the loop above proves nothing.
    expect(spellings.filter((raw) => isAskEnabledValue(raw))).toEqual([
      "1",
      "true",
      " true ",
    ]);
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
 * encoded: the audit behind the declared categories was run by hand (#2294,
 * then again for #2526 with expo-updates), so a
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
        opts?: {
          skipSDKVersionRequirement?: boolean;
          isModdedConfig?: boolean;
        },
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
    // message. Clear both; the root `afterEach` restores them, because
    // `restoredEnvKeys` above already owns these two keys — deliberately not a
    // second restore policy in this file.
    delete process.env.EAS_BUILD_PROFILE;
    delete process.env.EAS_BUILD_PLATFORM;
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
    // `apple.privacyManifestAggregationEnabled` is "false"). Two things fall
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
          .map(
            ([key, value]) => [`${name}:${key}`, value] as [string, unknown],
          ),
      )
      .sort(([a], [b]) => a.localeCompare(b));
  }

  /**
   * Options this app must never decline, because a screen requests the
   * underlying permission at runtime. Declining is not inert, but be precise
   * about what it costs, because it differs per plugin:
   *
   * - For all three plugins registered today, `false` reaches only
   *   `IOSConfig.Permissions.createPermissionsPlugin`, which *deletes* the iOS
   *   purpose-string key. iOS requires that string to be present when a screen
   *   requests the permission, so the cost is a failed or crashing request and a
   *   Guideline 5.1.1(i) problem — not an Android strip. `expo-camera` and
   *   `expo-location` add their Android permissions via `withPermissions`
   *   *unconditionally*, whatever these options say.
   * - A plugin *can* also call `AndroidConfig.Permissions.withBlockedPermissions`
   *   off such an option, which strips what another plugin contributed and can
   *   never be granted on Android. That is what `expo-image-picker` did to
   *   CAMERA, and it is why QR check-in was broken. **One plugin in `app.json`
   *   still behaves that way**: `expo-image-picker`'s `microphonePermission:
   *   false` reaches `withBlockedPermissions(['android.permission.RECORD_AUDIO'])`.
   *   That is deliberate and currently harmless — nothing requests the
   *   microphone, and `expo-camera` sets `recordAudioAndroid: false` so nothing
   *   contributes RECORD_AUDIO for the block to strip. It stops being harmless
   *   the moment a slice turns `recordAudioAndroid` back on or adds a
   *   microphone surface: the block would silently remove the permission on
   *   every Android build, which is the #2296 defect in a new permission. The
   *   resolved-permission test above pins CAMERA only, so nothing would go red
   *   — decline this option's twin, or widen that test, in the same slice.
   *   `expo-camera` and `expo-location` add their Android permissions via
   *   `withPermissions` unconditionally and block nothing.
   *
   * Every other declined option below is safe precisely because no source file
   * asks for it (no microphone, FaceID, motion or background-location use); add
   * the option here in the same slice that introduces such a use.
   */
  const REQUESTED_AT_RUNTIME = [
    // app/(tabs)/check-in.tsx → useCameraPermissions()
    "cameraPermission",
    // study zones, and the check-in location confirm
    "locationWhenInUsePermission",
    // lib/chat/attachment-upload.ts → requestMediaLibraryPermissionsAsync()
    "photosPermission",
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
      [
        "expo-camera:cameraPermission",
        "Signet uses the camera to scan the check-in code at chapter events.",
      ],
      ["expo-camera:microphonePermission", false],
      // `expo-image-picker` carries NO `cameraPermission` key, deliberately, and
      // that is not the omitted-option hazard the block above warns about.
      // `IOSConfig.Permissions.applyPermissions` resolves each key as
      // `permissions[key] || infoPlist[key] || default`, so an undefined option
      // falls through to whatever a plugin already wrote before reaching the
      // vendor default — and `expo-camera` above always writes
      // NSCameraUsageDescription explicitly, in either plugin order. Setting it
      // to `false` is what must never happen: that is the #2296 defect, because
      // image-picker compiles a declined `cameraPermission` into
      // `withBlockedPermissions(['android.permission.CAMERA'])` and strips the
      // permission QR check-in requests. The resolved-permission test above is
      // the tripwire for exactly that.
      //
      // `microphonePermission: false` IS set, and must stay set. Omitting it is
      // not inert here: `withAndroidImagePickerPermissions` adds
      // `android.permission.RECORD_AUDIO` whenever the option is anything other
      // than `false`, and the iOS half would write the vendor's default
      // microphone purpose string for a feature this app does not have — a
      // Guideline 5.1.1(i) finding of the same shape `photosPermission` used to
      // be. Declining is safe because nothing requests the microphone, and it
      // strips nothing another plugin contributes: `expo-camera` above sets
      // `recordAudioAndroid: false`, so it never adds RECORD_AUDIO either.
      ["expo-image-picker:microphonePermission", false],
      [
        "expo-image-picker:photosPermission",
        "Signet uses your photo library so you can send photos in chapter chat.",
      ],
      ["expo-location:locationAlwaysAndWhenInUsePermission", false],
      ["expo-location:locationAlwaysPermission", false],
      [
        "expo-location:locationWhenInUsePermission",
        "Signet confirms you are inside a chapter study zone while you track study hours, and that you are at the event when you scan a check-in code.",
      ],
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
