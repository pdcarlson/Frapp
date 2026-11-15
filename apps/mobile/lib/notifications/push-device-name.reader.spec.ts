import { afterEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({
  osVersion: "26.1" as string | null,
  modelName: "iPhone 16 Pro" as string | null,
  deviceName: "Sam's iPhone" as string | null,
}));
const platform = vi.hoisted(() => ({ OS: "ios" }));

vi.mock("expo-device", () => device);
vi.mock("react-native", () => ({ Platform: platform }));

const { readPushDeviceName } = await import("./push-device-name");

afterEach(() => {
  platform.OS = "ios";
  device.osVersion = "26.1";
  device.modelName = "iPhone 16 Pro";
});

describe("readPushDeviceName", () => {
  it("labels an iPhone by platform, OS version and model, never its own name", () => {
    const label = readPushDeviceName();
    expect(label).toBe("ios 26.1 · iPhone 16 Pro");
    expect(label).not.toContain("Sam");
  });

  it("labels an Android phone the same way", () => {
    platform.OS = "android";
    device.osVersion = "15";
    device.modelName = "Pixel 9";
    expect(readPushDeviceName()).toBe("android 15 · Pixel 9");
  });

  it("sends nothing off iOS and Android", () => {
    platform.OS = "web";
    expect(readPushDeviceName()).toBeUndefined();
  });
});
