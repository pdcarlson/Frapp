/**
 * Where the member is relative to each study zone, before they tap Start.
 *
 * The server decides whether a session may start: it checks the fix sent with
 * `POST /v1/study-sessions/start` against the zone's polygon (`pointInPolygon`
 * from `@repo/validation`). This module runs that same function on the phone so s10 can say "You're here" or "0.4 mi away"
 * on the card and in the zone picker, the way a store picker lists the nearest
 * store with its distance, instead of only saying "You're outside the zone"
 * after the tap. It informs; it never blocks Start, because the fix used here
 * can be a few seconds older than the one Start sends.
 */
import { distanceMeters, pointInPolygon } from "@repo/validation";
import type { StudyZoneModel, ZoneCorner } from "./zones";

export interface ZoneProximity {
  inside: boolean;
  /** Meters to the zone's edge; 0 inside. */
  distanceM: number;
}

/** Zone id to proximity, for the zones with a readable outline. */
export type ProximityMap = ReadonlyMap<string, ZoneProximity>;

/** The API's own check (`@repo/validation`'s `pointInPolygon`), so the two can't drift. */
export function isInsideOutline(point: ZoneCorner, outline: ZoneCorner[]): boolean {
  return pointInPolygon(point.lat, point.lng, outline);
}

/**
 * Meters from a point to the nearest edge of an outline.
 *
 * Projects onto a flat plane around the point (equirectangular), which is
 * accurate to well under a percent at campus distances; past a few kilometres
 * the figure is only shown rounded to a mile, so the error never shows.
 */
function distanceToOutlineM(point: ZoneCorner, outline: ZoneCorner[]): number {
  const metersPerDegLat = distanceMeters(point, { lat: point.lat + 1, lng: point.lng });
  const metersPerDegLng = metersPerDegLat * Math.cos((point.lat * Math.PI) / 180);
  const project = (c: ZoneCorner) => ({
    x: (c.lng - point.lng) * metersPerDegLng,
    y: (c.lat - point.lat) * metersPerDegLat,
  });
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = project(outline[j]!);
    const b = project(outline[i]!);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSq));
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

/** Each zone with a readable outline, measured from one fix. */
export function measureZones(
  zones: StudyZoneModel[],
  fix: ZoneCorner,
): Map<string, ZoneProximity> {
  const out = new Map<string, ZoneProximity>();
  for (const zone of zones) {
    if (zone.outline.length < 3) continue;
    const inside = isInsideOutline(fix, zone.outline);
    out.set(zone.id, {
      inside,
      distanceM: inside ? 0 : distanceToOutlineM(fix, zone.outline),
    });
  }
  return out;
}

/**
 * The zone the screen should offer from a fix: one the member is inside, else
 * the nearest, keeping `currentId` on a tie. Null when no zone could be
 * measured.
 */
export function bestZoneId(
  zones: StudyZoneModel[],
  proximity: ProximityMap,
  currentId: string | null = null,
): string | null {
  // The current choice wins a tie, so a member standing in two overlapping
  // zones keeps the one they always study in (their last session's) rather
  // than the alphabetically first.
  const current = currentId ? proximity.get(currentId) : undefined;
  let bestId: string | null = current ? currentId : null;
  let bestDistance = current ? current.distanceM : Number.POSITIVE_INFINITY;
  for (const zone of zones) {
    const p = proximity.get(zone.id);
    if (!p) continue;
    if (p.distanceM < bestDistance) {
      bestDistance = p.distanceM;
      bestId = zone.id;
    }
  }
  return bestId;
}

/**
 * Zones nearest first when there is a fix (the ones you're in at the top), in
 * their usual alphabetical order when there isn't, and unmeasurable ones last.
 */
export function sortByProximity(
  zones: StudyZoneModel[],
  proximity: ProximityMap | null,
): StudyZoneModel[] {
  if (!proximity || proximity.size === 0) return zones;
  const distance = (zone: StudyZoneModel) =>
    proximity.get(zone.id)?.distanceM ?? Number.POSITIVE_INFINITY;
  return [...zones].sort((a, b) => distance(a) - distance(b));
}

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

/**
 * "You're here", "300 ft away", "0.4 mi away", "12 mi away".
 *
 * US units, as the rest of the study zone copy is (`studyZoneRulesLine`, the
 * web zone editor's feet). Feet under a tenth of a mile, rounded to 50 so a
 * jittery fix doesn't flicker the number; then a decimal mile under ten.
 */
export function proximityCopy(p: ZoneProximity): string {
  if (p.inside) return "You're here";
  const miles = p.distanceM / METERS_PER_MILE;
  if (miles < 0.1) {
    const feet = Math.max(50, Math.round((p.distanceM * FEET_PER_METER) / 50) * 50);
    return `${feet} ft away`;
  }
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}
