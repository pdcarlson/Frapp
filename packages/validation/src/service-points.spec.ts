import { describe, expect, it } from "vitest";
import {
  SERVICE_MINUTES_PER_POINT_DEFAULT,
  effectiveMinutesPerPoint,
  servicePointsForDuration,
} from "./service-points";

describe("servicePointsForDuration", () => {
  it("awards one point per whole rate, rounding down", () => {
    expect(servicePointsForDuration(180, 60)).toBe(3);
    expect(servicePointsForDuration(179, 60)).toBe(2);
    expect(servicePointsForDuration(100, 30)).toBe(3);
  });

  it("awards nothing for a duration under the rate", () => {
    expect(servicePointsForDuration(45, 60)).toBe(0);
    expect(servicePointsForDuration(59, 60)).toBe(0);
    expect(servicePointsForDuration(60, 60)).toBe(1);
  });

  it("uses the 60-minute default when the chapter has no rate", () => {
    expect(SERVICE_MINUTES_PER_POINT_DEFAULT).toBe(60);
    expect(servicePointsForDuration(150, undefined)).toBe(2);
    expect(servicePointsForDuration(150, null)).toBe(2);
  });

  it("falls back to the default rather than dividing by a bad rate", () => {
    expect(servicePointsForDuration(120, 0)).toBe(2);
    expect(servicePointsForDuration(120, -5)).toBe(2);
    expect(servicePointsForDuration(120, 1.5)).toBe(2);
    expect(servicePointsForDuration(120, "30")).toBe(2);
  });

  it("never awards for a non-positive or non-finite duration", () => {
    expect(servicePointsForDuration(0, 60)).toBe(0);
    expect(servicePointsForDuration(-60, 60)).toBe(0);
    expect(servicePointsForDuration(Number.NaN, 60)).toBe(0);
  });
});

describe("effectiveMinutesPerPoint", () => {
  it("keeps a valid rate", () => {
    expect(effectiveMinutesPerPoint(1)).toBe(1);
    expect(effectiveMinutesPerPoint(90)).toBe(90);
  });
});
