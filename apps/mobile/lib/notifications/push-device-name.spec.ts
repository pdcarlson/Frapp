import { describe, expect, it } from "vitest";
import { formatPushDeviceName } from "./push-device-name";

describe("formatPushDeviceName", () => {
  it("names the platform, OS version and model", () => {
    expect(
      formatPushDeviceName({
        os: "ios",
        osVersion: "26.1",
        modelName: "iPhone 16 Pro",
      }),
    ).toBe("ios 26.1 · iPhone 16 Pro");
  });

  it("leaves out a model the OS does not report", () => {
    expect(
      formatPushDeviceName({ os: "android", osVersion: "15", modelName: null }),
    ).toBe("android 15");
  });

  it("still names the platform without a version", () => {
    expect(
      formatPushDeviceName({ os: "android", osVersion: " ", modelName: "" }),
    ).toBe("android");
  });

  it("stays within the API's 255-character limit", () => {
    expect(
      formatPushDeviceName({
        os: "android",
        osVersion: "15",
        modelName: "x".repeat(400),
      }),
    ).toHaveLength(255);
  });
});
