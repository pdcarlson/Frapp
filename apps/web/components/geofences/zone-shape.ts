import {
  circleToPolygon,
  formatZoneRadius,
  isValidZoneCircle,
  outlineCenter,
  ZONE_OUTLINE_MAX_POINTS,
  ZONE_RADIUS_DEFAULT_M,
  ZONE_RADIUS_MAX_M,
  ZONE_RADIUS_MIN_M,
  type ZoneCircle,
  type ZonePoint,
} from "@repo/validation";

/**
 * What the zone editor holds while an officer draws: a circle (a pin and a
 * radius) or an outline (corners clicked around a building). Both halves are
 * kept, so flipping between Circle and Outline to compare loses neither.
 */
export type ZoneDraft = {
  mode: "circle" | "outline";
  center: ZonePoint | null;
  radius_m: number;
  points: ZonePoint[];
};

/** A zone as `GET /v1/geofences` returns it, as far as the shape goes. */
export type ZoneShapeRow = {
  coordinates: ZonePoint[] | null;
  circle?: unknown;
};

export function emptyZoneDraft(): ZoneDraft {
  return {
    mode: "circle",
    center: null,
    radius_m: ZONE_RADIUS_DEFAULT_M,
    points: [],
  };
}

/**
 * The zone's circle, when it was drawn as one and its stored outline is still
 * that circle's. Anything else that rewrote `coordinates` (an older client, a
 * hand edit) leaves a stale `circle` behind, and the outline is what members
 * are checked against, so the outline wins.
 */
function zoneCircle(zone: ZoneShapeRow): ZoneCircle | null {
  if (!isValidZoneCircle(zone.circle)) return null;
  const points = Array.isArray(zone.coordinates) ? zone.coordinates : [];
  const derived = circleToPolygon(zone.circle);
  if (points.length !== derived.length) return null;
  const close = (a: ZonePoint, b: ZonePoint) =>
    Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
  return points.every((point, i) => close(point, derived[i]!))
    ? zone.circle
    : null;
}

/**
 * The draft a saved zone reopens as: a circle when it was drawn as one, else
 * its outline. A zone saved before circles existed is an outline, which is
 * what it always was.
 */
export function draftFromZone(zone: ZoneShapeRow): ZoneDraft {
  const points = Array.isArray(zone.coordinates) ? zone.coordinates : [];
  const circle = zoneCircle(zone);
  if (circle) {
    return {
      mode: "circle",
      center: { lat: circle.lat, lng: circle.lng },
      radius_m: circle.radius_m,
      points: [],
    };
  }
  return {
    mode: "outline",
    center: outlineCenter(points),
    radius_m: ZONE_RADIUS_DEFAULT_M,
    points,
  };
}

export function clampRadius(meters: number): number {
  if (!Number.isFinite(meters)) return ZONE_RADIUS_DEFAULT_M;
  return Math.min(ZONE_RADIUS_MAX_M, Math.max(ZONE_RADIUS_MIN_M, meters));
}

/** The request body's shape half, or why the draft can't be saved yet. */
export function zoneShapeBody(
  draft: ZoneDraft,
):
  | { ok: true; body: { circle: ZoneCircle } | { coordinates: ZonePoint[] } }
  | { ok: false; error: string } {
  if (draft.mode === "circle") {
    if (!draft.center) {
      return {
        ok: false,
        error: "Search for the place or click the map to drop the pin.",
      };
    }
    return {
      ok: true,
      body: {
        circle: {
          lat: draft.center.lat,
          lng: draft.center.lng,
          radius_m: Math.round(clampRadius(draft.radius_m) * 10) / 10,
        },
      },
    };
  }
  if (draft.points.length < 3) {
    return {
      ok: false,
      error: "Click at least three corners around the building.",
    };
  }
  if (draft.points.length > ZONE_OUTLINE_MAX_POINTS) {
    return {
      ok: false,
      error: `Use ${ZONE_OUTLINE_MAX_POINTS} corners or fewer.`,
    };
  }
  return { ok: true, body: { coordinates: draft.points } };
}

/** The polygon the draft draws on the map, open (the map closes it). */
export function draftPolygon(draft: ZoneDraft): ZonePoint[] {
  if (draft.mode === "circle") {
    return draft.center
      ? circleToPolygon({ ...draft.center, radius_m: draft.radius_m })
      : [];
  }
  return draft.points;
}

/**
 * The zone's shape in a few words, for its row in the list: "245 ft circle"
 * or "Outline, 6 corners". Never coordinates (principles.md P2).
 */
export function zoneShapeLine(zone: ZoneShapeRow): string {
  const circle = zoneCircle(zone);
  if (circle) return `${formatZoneRadius(circle.radius_m)} circle`;
  const corners = Array.isArray(zone.coordinates)
    ? zone.coordinates.length
    : 0;
  return `Outline, ${corners} corners`;
}
