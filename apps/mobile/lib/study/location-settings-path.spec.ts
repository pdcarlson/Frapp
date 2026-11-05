import { afterEach, describe, expect, it } from "vitest";
import { Platform } from "react-native";
import appJson from "../../app.json";
import { locationSettingsPath } from "./location-settings-path";

/**
 * Settings lists the app under `expo.name`, so the name is read from `app.json`
 * rather than restated: renaming the binary without these paths fails here as
 * well as in `frapp-naming.test.mjs` (ADR-25 step 2).
 */
const APP_NAME = appJson.expo.name;

const platform = Platform as { OS: string; Version?: string | number };
const { OS, Version } = platform;
afterEach(() => {
  platform.OS = OS;
  platform.Version = Version;
});

function pathOn(os: string, version: string | number | undefined) {
  platform.OS = os;
  platform.Version = version;
  return locationSettingsPath();
}

describe("locationSettingsPath", () => {
  it("lists the app on Settings' root before iOS 18, where there is no Apps row", () => {
    // 16.4 is Expo SDK 57's floor, so the oldest iPhone the app installs on.
    expect(pathOn("ios", "16.4")).toBe(`Settings → ${APP_NAME} → Location`);
    expect(pathOn("ios", "17.7.2")).toBe(`Settings → ${APP_NAME} → Location`);
  });

  it("goes through the Apps row from iOS 18", () => {
    expect(pathOn("ios", "18.0")).toBe(
      `Settings → Apps → ${APP_NAME} → Location`,
    );
    expect(pathOn("ios", "26.1")).toBe(
      `Settings → Apps → ${APP_NAME} → Location`,
    );
  });

  it("takes an unreadable iOS version as a current one", () => {
    expect(pathOn("ios", undefined)).toBe(
      `Settings → Apps → ${APP_NAME} → Location`,
    );
  });

  it("names Android's own Permissions page, whatever its API level", () => {
    // `Platform.Version` is an API level on Android, so 33 must not read as
    // an iOS version.
    expect(pathOn("android", 33)).toBe(
      `Settings → Apps → ${APP_NAME} → Permissions → Location`,
    );
    expect(pathOn("android", 17)).toBe(
      `Settings → Apps → ${APP_NAME} → Permissions → Location`,
    );
  });
});
