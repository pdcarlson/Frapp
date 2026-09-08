import { createRequire } from "node:module";
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
  };
}

const missing = () => false;
const present = () => true;
const androidConfig = { android: { package: "live.frapp.mobile" } };

afterEach(() => {
  delete process.env.EAS_BUILD_PROFILE;
  delete process.env.EAS_BUILD_PLATFORM;
  delete process.env.GOOGLE_SERVICES_JSON;
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

  it("wires googleServicesFile on a production Android EAS build when the file exists", () => {
    const { applyMobileConfig } = loadConfig();
    const result = applyMobileConfig(androidConfig, {
      env: {
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
});

describe("Expo default export", () => {
  it("is the function Expo loads, and evaluates process.env at call time", () => {
    const applyExpoConfig = loadConfig();
    process.env.EAS_BUILD_PROFILE = "preview";
    const result = applyExpoConfig({ config: androidConfig });
    expect(result.android).toMatchObject({ package: "live.frapp.mobile" });
  });
});
