import { describe, expect, it } from "vitest";
import {
  circleToPolygon,
  destinationPoint,
  distanceMeters,
  isValidZoneCircle,
  outlineCenter,
  studyZoneRulesLine,
  ZONE_RADIUS_MAX_M,
  ZONE_RADIUS_MIN_M,
} from "./study-zone-shape";

/** Ray casting, the same test the API runs (`domain/utils/geofence.ts`). */
function inside(lat: number, lng: number, poly: { lat: number; lng: number }[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng;
    const yi = poly[i].lat;
    const xj = poly[j].lng;
    const yj = poly[j].lat;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

const library = { lat: 42.7298, lng: -73.6826 };

describe("distanceMeters / destinationPoint", () => {
  it("round-trips a point 100 m out", () => {
    for (const bearing of [0, 45, 90, 180, 270]) {
      const p = destinationPoint(library, 100, bearing);
      expect(distanceMeters(library, p)).toBeCloseTo(100, 0);
    }
  });
});

describe("circleToPolygon", () => {
  const circle = { ...library, radius_m: 75 };
  const polygon = circleToPolygon(circle);

  it("draws enough corners to read as a circle", () => {
    expect(polygon.length).toBeGreaterThanOrEqual(32);
  });

  it("contains every point just inside the circle", () => {
    for (let bearing = 0; bearing < 360; bearing += 7) {
      const p = destinationPoint(library, 74.5, bearing);
      expect(inside(p.lat, p.lng, polygon)).toBe(true);
    }
  });

  it("leaves out points well outside it", () => {
    for (let bearing = 0; bearing < 360; bearing += 30) {
      const p = destinationPoint(library, 80, bearing);
      expect(inside(p.lat, p.lng, polygon)).toBe(false);
    }
  });
});

describe("isValidZoneCircle", () => {
  it("accepts a circle in range", () => {
    expect(isValidZoneCircle({ ...library, radius_m: 75 })).toBe(true);
  });

  it("refuses radii outside the bounds and malformed values", () => {
    expect(
      isValidZoneCircle({ ...library, radius_m: ZONE_RADIUS_MIN_M - 1 }),
    ).toBe(false);
    expect(
      isValidZoneCircle({ ...library, radius_m: ZONE_RADIUS_MAX_M + 1 }),
    ).toBe(false);
    expect(isValidZoneCircle({ lat: 91, lng: 0, radius_m: 75 })).toBe(false);
    expect(isValidZoneCircle(null)).toBe(false);
    expect(isValidZoneCircle({ lat: "1", lng: 0, radius_m: 75 })).toBe(false);
  });
});

describe("outlineCenter", () => {
  it("averages the corners, or says nothing for none", () => {
    expect(
      outlineCenter([
        { lat: 0, lng: 0 },
        { lat: 2, lng: 4 },
      ]),
    ).toEqual({ lat: 1, lng: 2 });
    expect(outlineCenter([])).toBeNull();
  });
});

describe("studyZoneRulesLine", () => {
  it("says what a session earns, in words", () => {
    expect(
      studyZoneRulesLine({
        points_per_interval: 1,
        minutes_per_point: 30,
        min_session_minutes: 15,
      }),
    ).toBe("1 point every 30 min · 15 min minimum");
  });

  it("reads an hourly rate as an hour, and leaves out a zero minimum", () => {
    expect(
      studyZoneRulesLine({
        points_per_interval: 5,
        minutes_per_point: 60,
        min_session_minutes: 0,
      }),
    ).toBe("5 points an hour");
  });

  it("drops a rule the row does not carry instead of inventing one", () => {
    expect(
      studyZoneRulesLine({
        points_per_interval: 1,
        minutes_per_point: null,
        min_session_minutes: 15,
      }),
    ).toBe("15 min minimum");
  });
});
