import { describe, expect, it } from "vitest";
import {
  SERVICE_MINUTES_PER_POINT_DEFAULT,
  awardedPointsLabel,
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

describe("awardedPointsLabel", () => {
  const approved = { status: "APPROVED", points_awarded: true };

  it("states the number the approval recorded", () => {
    expect(awardedPointsLabel({ ...approved, awarded_points: 3 })).toBe(
      "3 points",
    );
    expect(awardedPointsLabel({ ...approved, awarded_points: 1 })).toBe(
      "1 point",
    );
  });

  it("says No points for a sub-rate approval", () => {
    expect(
      awardedPointsLabel({
        status: "APPROVED",
        points_awarded: false,
        awarded_points: 0,
      }),
    ).toBe("No points");
  });

  it("says nothing for a pending or rejected entry that awarded nothing", () => {
    expect(
      awardedPointsLabel({
        status: "PENDING",
        points_awarded: false,
        awarded_points: null,
      }),
    ).toBeNull();
    expect(
      awardedPointsLabel({
        status: "REJECTED",
        points_awarded: false,
        awarded_points: null,
      }),
    ).toBeNull();
  });

  it("falls back to the flag when an awarded entry carries no number", () => {
    expect(awardedPointsLabel({ ...approved, awarded_points: null })).toBe(
      "Points awarded",
    );
    expect(awardedPointsLabel(approved)).toBe("Points awarded");
  });

  it("keeps an award's number on an entry later marked rejected", () => {
    expect(
      awardedPointsLabel({
        status: "REJECTED",
        points_awarded: true,
        awarded_points: 2,
      }),
    ).toBe("2 points");
  });
});
