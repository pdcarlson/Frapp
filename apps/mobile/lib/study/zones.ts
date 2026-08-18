/**
 * Narrowing for `GET /v1/geofences` — the chapter's study zones.
 *
 * Members may *read* zones even though the route carries `@RequireModule('geofences')`:
 * `ChapterGuard.enforceModule` returns early for GET, so only zone writes ride
 * the module toggle. Which matters, because most org archetypes ship
 * `geofences: false` while still enabling `hours` — a chapter that never
 * administers zones from the app still has members who study in them.
 */
import { num, records, str } from "../more/narrow";

export interface StudyZoneModel {
  id: string;
  name: string;
  isActive: boolean;
  minutesPerPoint: number;
  pointsPerInterval: number;
  minSessionMinutes: number;
  pauseGraceMinutes: number;
}

/** Server defaults, mirrored so a zone row missing a field still reads honestly. */
const DEFAULTS = {
  minutesPerPoint: 30,
  pointsPerInterval: 1,
  minSessionMinutes: 15,
  pauseGraceMinutes: 5,
} as const;

function toZone(row: Record<string, unknown>): StudyZoneModel | null {
  const id = str(row, "id");
  const name = str(row, "name");
  if (!id || !name) return null;

  return {
    id,
    name,
    // Absent reads as active, matching the column's `DEFAULT true`. Treating an
    // unreadable flag as inactive would hide every zone in a chapter whose rows
    // predate the column.
    isActive: row.is_active !== false,
    minutesPerPoint: num(row, "minutes_per_point") ?? DEFAULTS.minutesPerPoint,
    pointsPerInterval:
      num(row, "points_per_interval") ?? DEFAULTS.pointsPerInterval,
    minSessionMinutes:
      num(row, "min_session_minutes") ?? DEFAULTS.minSessionMinutes,
    pauseGraceMinutes:
      num(row, "pause_grace_minutes") ?? DEFAULTS.pauseGraceMinutes,
  };
}

/** Zones a member can actually start a session in, alphabetical. */
export function selectActiveZones(data: unknown): StudyZoneModel[] {
  return records(data)
    .map(toZone)
    .filter((zone): zone is StudyZoneModel => !!zone && zone.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findZone(
  zones: StudyZoneModel[],
  id: string | null,
): StudyZoneModel | null {
  if (!id) return null;
  return zones.find((zone) => zone.id === id) ?? null;
}

/**
 * The drawn helper line under the session card.
 *
 * Canvas hard-codes "a 5-min grace window", but the window is per-zone
 * (`study_geofences.pause_grace_minutes`) and `patterns.md` says s10 "surfaces
 * it" — so the number comes from the zone. A chapter that configures ten
 * minutes must not be told five.
 */
export function graceWindowCopy(zone: StudyZoneModel | null): string {
  const minutes = zone?.pauseGraceMinutes ?? DEFAULTS.pauseGraceMinutes;
  return `Leaving the zone pauses with a ${minutes}-min grace window.`;
}

/** e.g. `1 pt per 30 min · 15 min minimum` — what a zone actually pays. */
export function zoneRewardCopy(zone: StudyZoneModel): string {
  const points =
    zone.pointsPerInterval === 1 ? "1 pt" : `${zone.pointsPerInterval} pts`;
  return `${points} per ${zone.minutesPerPoint} min · ${zone.minSessionMinutes} min minimum`;
}
