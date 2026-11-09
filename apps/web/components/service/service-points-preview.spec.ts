import { describe, expect, it } from "vitest";
import { approvePointsPreview } from "./service-points-preview";

describe("approvePointsPreview", () => {
  it("states the points at the default hourly rate", () => {
    expect(approvePointsPreview(180, 60)).toBe(
      "Approving awards 3 service points, at the chapter's current rate of 1 per hour.",
    );
  });

  it("rounds down like the approve path and uses the singular", () => {
    expect(approvePointsPreview(119, 60)).toBe(
      "Approving awards 1 service point, at the chapter's current rate of 1 per hour.",
    );
  });

  it("says plainly when the entry is under the rate", () => {
    expect(approvePointsPreview(45, 60)).toBe(
      "Approving awards no points: 45m is under the chapter's current rate of 1 point per hour.",
    );
  });

  it("names a non-hourly rate as a duration", () => {
    expect(approvePointsPreview(100, 30)).toBe(
      "Approving awards 3 service points, at the chapter's current rate of 1 per 30m.",
    );
    expect(approvePointsPreview(60, 90)).toBe(
      "Approving awards no points: 1h is under the chapter's current rate of 1 point per 1h 30m.",
    );
  });

  it("applies the default rate the API falls back to for an invalid stored rate", () => {
    expect(approvePointsPreview(120, 0)).toBe(
      "Approving awards 2 service points, at the chapter's current rate of 1 per hour.",
    );
  });

  it("says nothing when the rate isn't known", () => {
    expect(approvePointsPreview(180, undefined)).toBeNull();
    expect(approvePointsPreview(180, null)).toBeNull();
  });
});
