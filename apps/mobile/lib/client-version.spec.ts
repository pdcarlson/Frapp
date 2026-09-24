import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";

const application = vi.hoisted(() => ({
  nativeApplicationVersion: "0.9.0" as string | null,
  nativeBuildVersion: "12" as string | null,
}));
vi.mock("expo-application", () => application);

const expoGo = vi.hoisted(() => ({ value: false }));
vi.mock("./expo-go", () => ({ isExpoGo: () => expoGo.value }));

import { formatClientVersion, readClientVersion } from "./client-version";

describe("formatClientVersion", () => {
  it("joins platform, version and build in the shape the API parses", () => {
    expect(
      formatClientVersion({ platform: "ios", version: "0.9.0", build: "12" }),
    ).toBe("ios/0.9.0+12");
  });

  it("drops a missing build rather than inventing one", () => {
    expect(
      formatClientVersion({ platform: "android", version: "0.9.0", build: null }),
    ).toBe("android/0.9.0");
  });

  it("omits the header when there is no version to report", () => {
    expect(
      formatClientVersion({ platform: "ios", version: " ", build: "12" }),
    ).toBeUndefined();
  });
});

describe("readClientVersion", () => {
  const originalOs = Platform.OS;

  afterEach(() => {
    (Platform as { OS: string }).OS = originalOs;
    expoGo.value = false;
    application.nativeApplicationVersion = "0.9.0";
    application.nativeBuildVersion = "12";
  });

  it("reports a native store build", () => {
    (Platform as { OS: string }).OS = "android";
    application.nativeBuildVersion = "7";
    expect(readClientVersion()).toBe("android/0.9.0+7");
  });

  // Expo Go reports its own version here. Sending it would let a minimum
  // meant for store builds lock every development session out.
  it("sends nothing from Expo Go", () => {
    expoGo.value = true;
    expect(readClientVersion()).toBeUndefined();
  });

  it("sends nothing on web", () => {
    (Platform as { OS: string }).OS = "web";
    expect(readClientVersion()).toBeUndefined();
  });
});
