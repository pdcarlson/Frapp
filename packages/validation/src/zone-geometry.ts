/**
 * Whether a point is inside a zone's outline: the one check the API runs on
 * every study session and every zoned event check-in, and the one the phone
 * runs to say "You're here" before a member taps Start.
 *
 * It lives here so the server and the phone run the same code. Two copies of
 * the anti-proxy check that drift apart would have the phone promise a start
 * the server refuses.
 */

export type OutlinePoint = { lat: number; lng: number };

/**
 * Ray-casting point-in-polygon. The closing edge is implicit, so an outline
 * does not repeat its first corner. Fewer than three corners holds nothing:
 * a malformed zone stays closed rather than open.
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: readonly OutlinePoint[],
): boolean {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]!.lng;
    const yi = polygon[i]!.lat;
    const xj = polygon[j]!.lng;
    const yj = polygon[j]!.lat;

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Whether a stored outline is a usable polygon: an array of at least three
 * corners with finite coordinates. Anything else is malformed, and callers
 * treat it as a hard failure rather than as "no zone".
 */
export function isValidZoneOutline(zone: unknown): zone is OutlinePoint[] {
  return (
    Array.isArray(zone) &&
    zone.length >= 3 &&
    zone.every(
      (point): point is OutlinePoint =>
        !!point &&
        typeof point === "object" &&
        Number.isFinite((point as OutlinePoint).lat) &&
        Number.isFinite((point as OutlinePoint).lng),
    )
  );
}
