import { describe, expect, it } from "vitest";
import { circleToPolygon } from "@repo/validation";
import { draftFromZone, zoneShapeLine } from "./zone-shape";

const circle = { lat: 42.7298, lng: -73.6826, radius_m: 75 };

describe("reopening a saved zone", () => {
  it("reopens a circle zone as its circle and radius", () => {
    const zone = { circle, coordinates: circleToPolygon(circle) };
    expect(draftFromZone(zone)).toMatchObject({
      mode: "circle",
      center: { lat: circle.lat, lng: circle.lng },
      radius_m: 75,
    });
    expect(zoneShapeLine(zone)).toBe("245 ft circle");
  });

  it("reopens a zone from before circles as its outline", () => {
    const coordinates = [
      { lat: 30.286, lng: -97.74 },
      { lat: 30.287, lng: -97.74 },
      { lat: 30.287, lng: -97.739 },
    ];
    const zone = { circle: null, coordinates };
    expect(draftFromZone(zone)).toMatchObject({ mode: "outline", points: coordinates });
    expect(zoneShapeLine(zone)).toBe("Outline, 3 corners");
  });

  it("trusts the outline over a circle it no longer matches", () => {
    // An older client retraced the zone and left the circle behind. Members
    // are checked against the outline, so that is what the editor shows.
    const coordinates = [
      { lat: 42.73, lng: -73.683 },
      { lat: 42.731, lng: -73.683 },
      { lat: 42.731, lng: -73.682 },
      { lat: 42.73, lng: -73.682 },
    ];
    const zone = { circle, coordinates };
    expect(draftFromZone(zone)).toMatchObject({ mode: "outline", points: coordinates });
    expect(zoneShapeLine(zone)).toBe("Outline, 4 corners");
  });
});
