/**
 * The shape of a study zone, shared by the API that stores it and the web map
 * that draws it.
 *
 * A zone is either a circle (a center and a radius, the way an officer thinks
 * of "the library and a bit around it") or an outline the officer traces
 * around a building. Containment is always checked against a polygon
 * (`pointInPolygon` in the API), so a circle is stored with the polygon it
 * becomes: `circleToPolygon` here is the one place that turns one into the
 * other, and the API calls it rather than trusting a polygon a client drew.
 */

export type ZonePoint = { lat: number; lng: number };

export type ZoneCircle = {
  lat: number;
  lng: number;
  /** Meters. */
  radius_m: number;
};

/**
 * A phone indoors is often 20 to 50 m off, and the API accepts fixes up to
 * 100 m of reported accuracy, so a circle much under 25 m would refuse members
 * who are sitting inside it. 5 km covers a whole campus.
 */
export const ZONE_RADIUS_MIN_M = 25;
export const ZONE_RADIUS_MAX_M = 5000;
/** What a new circle starts at: about a large library's footprint. */
export const ZONE_RADIUS_DEFAULT_M = 75;

/** An outline with more corners than this is a mistake, not a building. */
export const ZONE_OUTLINE_MAX_POINTS = 200;

/** Corners of the polygon a circle is stored as. */
const CIRCLE_SEGMENTS = 64;

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance between two points, in meters. */
export function distanceMeters(a: ZonePoint, b: ZonePoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point `meters` from `origin` along `bearingDeg` (0 is north). */
export function destinationPoint(
  origin: ZonePoint,
  meters: number,
  bearingDeg: number,
): ZonePoint {
  const angular = meters / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    lat: Number(toDeg(lat2).toFixed(7)),
    // Normalize to [-180, 180) so a zone near the antimeridian stays valid.
    lng: Number((((toDeg(lng2) + 540) % 360) - 180).toFixed(7)),
  };
}

/**
 * The polygon a circle is stored as: `CIRCLE_SEGMENTS` corners, pushed out by
 * 1/cos(pi/n) so every edge sits on or outside the circle. A member standing
 * just inside the drawn circle is inside the stored zone, never refused by the
 * flat edge between two corners.
 */
export function circleToPolygon(circle: ZoneCircle): ZonePoint[] {
  const vertexRadius = circle.radius_m / Math.cos(Math.PI / CIRCLE_SEGMENTS);
  const points: ZonePoint[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    points.push(
      destinationPoint(circle, vertexRadius, (360 / CIRCLE_SEGMENTS) * i),
    );
  }
  return points;
}

/** The middle of an outline's corners, for centering a map on it. */
export function outlineCenter(points: readonly ZonePoint[]): ZonePoint | null {
  if (points.length === 0) return null;
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/** Whether a stored circle is one this module would accept. */
export function isValidZoneCircle(value: unknown): value is ZoneCircle {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.lat === "number" &&
    typeof c.lng === "number" &&
    typeof c.radius_m === "number" &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lng) &&
    c.lat >= -90 &&
    c.lat <= 90 &&
    c.lng >= -180 &&
    c.lng <= 180 &&
    c.radius_m >= ZONE_RADIUS_MIN_M &&
    c.radius_m <= ZONE_RADIUS_MAX_M
  );
}

const METERS_PER_FOOT = 0.3048;

/**
 * A radius in the words a US chapter uses: feet up to a quarter mile, then
 * miles. Stored in meters; shown in feet because that is what an officer
 * pacing out a library thinks in.
 */
export function formatZoneRadius(meters: number): string {
  const feet = meters / METERS_PER_FOOT;
  if (feet < 1320) return `${Math.round(feet / 5) * 5} ft`;
  return `${(feet / 5280).toFixed(1)} mi`;
}

export function feetToMeters(feet: number): number {
  return feet * METERS_PER_FOOT;
}

export function metersToFeet(meters: number): number {
  return meters / METERS_PER_FOOT;
}
