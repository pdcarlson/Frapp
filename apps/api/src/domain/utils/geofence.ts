import type { GeofenceCoordinate } from '../entities/study.entity';

/**
 * Ray-casting point-in-polygon test.
 *
 * Coordinates are an array of `{lat, lng}` forming a closed polygon; the closing
 * edge is implicit, so a caller does not repeat the first vertex.
 *
 * Two consumers share this: study sessions (`study.service.ts`, which validates a
 * member is inside a `study_geofences` polygon on start / heartbeat / stop) and
 * event check-in (`attendance.service.ts`, which validates the scanner is inside
 * an event's `check_in_zone`). It lived in `study.service.ts` until event
 * check-in needed it — moved here rather than copied, because two divergent
 * implementations of the anti-proxy check is precisely the failure the geofence
 * exists to prevent.
 *
 * Fewer than three points is not a degenerate polygon that should pass — it is a
 * zone that cannot contain anything, and returning `false` keeps a malformed
 * zone closed rather than open.
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: GeofenceCoordinate[],
): boolean {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Whether a stored zone is usable as a geofence.
 *
 * A zone is either absent (the event has no geofence) or a real polygon. Anything
 * else — a non-array, a two-point line, a member with a non-numeric coordinate —
 * is malformed, and callers must treat it as a **hard failure** rather than as
 * "no zone", or a corrupted zone silently disables the check it encodes.
 */
export function isValidZone(zone: unknown): zone is GeofenceCoordinate[] {
  return (
    Array.isArray(zone) &&
    zone.length >= 3 &&
    zone.every(
      (point): point is GeofenceCoordinate =>
        !!point &&
        typeof point === 'object' &&
        Number.isFinite((point as GeofenceCoordinate).lat) &&
        Number.isFinite((point as GeofenceCoordinate).lng),
    )
  );
}
