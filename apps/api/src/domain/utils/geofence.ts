import {
  isValidZoneOutline,
  pointInPolygon as sharedPointInPolygon,
} from '@repo/validation';
import type { GeofenceCoordinate } from '../entities/study.entity';

/**
 * Ray-casting point-in-polygon test, and the check that a stored zone is a
 * usable polygon.
 *
 * Three consumers share one implementation, which lives in `@repo/validation`
 * (`zone-geometry.ts`): study sessions (`study.service.ts`, which validates a
 * member is inside a `study_geofences` polygon on start / heartbeat / stop),
 * event check-in (`attendance.service.ts`, which validates the scanner is
 * inside an event's `check_in_zone`), and the phone's s10 screen, which says
 * "You're here" before Start. Two divergent implementations of the anti-proxy
 * check is precisely the failure the geofence exists to prevent: the phone
 * would promise a start the server refuses.
 *
 * Fewer than three points is not a degenerate polygon that should pass — it is
 * a zone that cannot contain anything, and returning `false` keeps a malformed
 * zone closed rather than open.
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: GeofenceCoordinate[],
): boolean {
  return sharedPointInPolygon(lat, lng, polygon);
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
  return isValidZoneOutline(zone);
}
