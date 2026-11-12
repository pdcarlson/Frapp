import { describe, expect, it } from "vitest";
import { sanitizeIdentifiedPostHogCapture } from "@repo/observability/next";
import {
  runningUpdateProperties,
  type RunningUpdateSource,
} from "./running-update";

const UPDATE_ID = "0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D";

const base: RunningUpdateSource = {
  isEnabled: true,
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  updateId: UPDATE_ID,
  channel: "production",
  runtimeVersion: "0.12.0",
  createdAt: new Date("2026-11-12T20:00:00.000Z"),
};

describe("runningUpdateProperties", () => {
  it("names the update an over-the-air launch runs", () => {
    expect(runningUpdateProperties(base)).toEqual({
      app_launch: "update",
      app_update_id: UPDATE_ID.toLowerCase(),
      app_update_published_at: "2026-11-12T20:00:00.000Z",
      app_update_channel: "production",
      app_runtime_version: "0.12.0",
    });
  });

  it("says store_build, with no update id, when the binary's own JS runs", () => {
    expect(
      runningUpdateProperties({ ...base, isEmbeddedLaunch: true }),
    ).toMatchObject({
      app_launch: "store_build",
      app_update_id: null,
      app_update_published_at: null,
      app_update_channel: "production",
    });
  });

  it("flags an emergency launch, where an update failed to start and the app fell back", () => {
    expect(
      runningUpdateProperties({ ...base, isEmergencyLaunch: true }),
    ).toMatchObject({
      app_launch: "emergency",
      app_update_id: null,
    });
  });

  it("says development where expo-updates is off", () => {
    expect(
      runningUpdateProperties({
        ...base,
        isEnabled: false,
        updateId: null,
        channel: null,
        runtimeVersion: null,
        createdAt: null,
      }),
    ).toEqual({
      app_launch: "development",
      app_update_id: null,
      app_update_published_at: null,
      app_update_channel: null,
      app_runtime_version: null,
    });
  });

  it("survives the capture sanitizer every mobile event passes through", () => {
    const properties = runningUpdateProperties(base);
    const sanitized = sanitizeIdentifiedPostHogCapture({ properties });
    expect(sanitized?.properties).toEqual(properties);
  });
});
