import { describe, expect, it } from "vitest";
import {
  bestZoneId,
  isInsideOutline,
  measureZones,
  proximityCopy,
  sortByProximity,
} from "./proximity";
import { selectActiveZones, type StudyZoneModel } from "./zones";

/** A square about 110 m on a side, south-west corner at (lat, lng). */
function square(lat: number, lng: number) {
  const d = 0.001;
  return [
    { lat, lng },
    { lat: lat + d, lng },
    { lat: lat + d, lng: lng + d },
    { lat, lng: lng + d },
  ];
}

const UNION = square(42.73, -73.68);
/** About 1.1 km north of the Union. */
const FOLSOM = square(42.74, -73.68);

function zones(): StudyZoneModel[] {
  return selectActiveZones([
    { id: "union", name: "RPI Union", coordinates: UNION },
    { id: "folsom", name: "Folsom", coordinates: FOLSOM },
    { id: "broken", name: "Annex", coordinates: [{ lat: 1, lng: 1 }] },
  ]);
}

describe("isInsideOutline", () => {
  it("says inside and outside with the API's own check", () => {
    expect(isInsideOutline({ lat: 42.7305, lng: -73.6795 }, UNION)).toBe(true);
    expect(isInsideOutline({ lat: 42.7295, lng: -73.6795 }, UNION)).toBe(false);
  });

  it("never holds anything with fewer than three corners", () => {
    expect(isInsideOutline({ lat: 1, lng: 1 }, [{ lat: 1, lng: 1 }])).toBe(false);
  });
});

describe("measureZones", () => {
  it("says inside with no distance, and outside with the distance to the edge", () => {
    const map = measureZones(zones(), { lat: 42.7305, lng: -73.6795 });
    expect(map.get("union")).toEqual({ inside: true, distanceM: 0 });
    const folsom = map.get("folsom")!;
    expect(folsom.inside).toBe(false);
    // 0.0095 degrees of latitude to Folsom's south edge, about 1,056 m.
    expect(folsom.distanceM).toBeGreaterThan(1000);
    expect(folsom.distanceM).toBeLessThan(1100);
  });

  it("leaves out a zone whose outline can't be read", () => {
    const map = measureZones(zones(), { lat: 42.7305, lng: -73.6795 });
    expect(map.has("broken")).toBe(false);
  });
});

describe("bestZoneId and sortByProximity", () => {
  it("offers the zone the member is in, and lists it first", () => {
    const all = zones();
    const map = measureZones(all, { lat: 42.7405, lng: -73.6795 });
    expect(bestZoneId(all, map)).toBe("folsom");
    expect(sortByProximity(all, map).map((z) => z.id)).toEqual([
      "folsom",
      "union",
      "broken",
    ]);
  });

  it("offers the nearest when the member is in none", () => {
    const all = zones();
    // Just south of the Union.
    const map = measureZones(all, { lat: 42.7295, lng: -73.6795 });
    expect(bestZoneId(all, map)).toBe("union");
  });

  it("keeps the current zone when the member is inside it and another", () => {
    const overlapping = selectActiveZones([
      { id: "annex", name: "Annex", coordinates: UNION },
      { id: "library", name: "Library", coordinates: UNION },
    ]);
    const map = measureZones(overlapping, { lat: 42.7305, lng: -73.6795 });
    expect(bestZoneId(overlapping, map)).toBe("annex");
    expect(bestZoneId(overlapping, map, "library")).toBe("library");
  });

  it("keeps the alphabetical order without a fix", () => {
    const all = zones();
    expect(sortByProximity(all, null)).toBe(all);
    expect(bestZoneId(all, new Map())).toBeNull();
  });
});

describe("proximityCopy", () => {
  it.each([
    [{ inside: true, distanceM: 0 }, "You're here"],
    [{ inside: false, distanceM: 5 }, "50 ft away"],
    [{ inside: false, distanceM: 100 }, "350 ft away"],
    [{ inside: false, distanceM: 650 }, "0.4 mi away"],
    [{ inside: false, distanceM: 30_000 }, "19 mi away"],
  ])("%o reads %s", (p, copy) => {
    expect(proximityCopy(p)).toBe(copy);
  });
});
