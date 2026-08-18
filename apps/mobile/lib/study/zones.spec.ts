import { describe, expect, it } from "vitest";
import {
  findZone,
  graceWindowCopy,
  selectActiveZones,
  zoneRewardCopy,
} from "./zones";

function zone(overrides: Record<string, unknown> = {}) {
  return {
    id: "gf-1",
    chapter_id: "c-1",
    name: "Folsom Library",
    coordinates: [
      { lat: 42.7, lng: -73.6 },
      { lat: 42.8, lng: -73.6 },
      { lat: 42.8, lng: -73.5 },
    ],
    is_active: true,
    minutes_per_point: 30,
    points_per_interval: 1,
    min_session_minutes: 15,
    pause_grace_minutes: 5,
    ...overrides,
  };
}

describe("selectActiveZones", () => {
  it("narrows a zone into a startable option", () => {
    const [row] = selectActiveZones([zone()]);
    expect(row?.id).toBe("gf-1");
    expect(row?.name).toBe("Folsom Library");
    expect(row?.pauseGraceMinutes).toBe(5);
  });

  it("hides an inactive zone, which start would reject anyway", () => {
    expect(selectActiveZones([zone({ is_active: false })])).toEqual([]);
  });

  it("treats an absent is_active as active, matching the column default", () => {
    expect(selectActiveZones([zone({ is_active: undefined })])).toHaveLength(1);
  });

  it("sorts by name so the picker is stable between renders", () => {
    const rows = selectActiveZones([
      zone({ id: "b", name: "Union study room" }),
      zone({ id: "a", name: "Folsom Library" }),
    ]);
    expect(rows.map((row) => row.name)).toEqual([
      "Folsom Library",
      "Union study room",
    ]);
  });

  it("drops a nameless zone rather than offering a blank row", () => {
    expect(selectActiveZones([zone({ name: null })])).toEqual([]);
  });

  it("falls back to the server defaults for missing config", () => {
    const [row] = selectActiveZones([
      zone({
        minutes_per_point: null,
        points_per_interval: null,
        min_session_minutes: null,
        pause_grace_minutes: null,
      }),
    ]);
    expect(row?.minutesPerPoint).toBe(30);
    expect(row?.pointsPerInterval).toBe(1);
    expect(row?.minSessionMinutes).toBe(15);
    expect(row?.pauseGraceMinutes).toBe(5);
  });

  it("returns an empty list for a non-array body", () => {
    expect(selectActiveZones(undefined)).toEqual([]);
  });
});

describe("findZone", () => {
  it("resolves the selected zone, and nothing for no selection", () => {
    const zones = selectActiveZones([zone()]);
    expect(findZone(zones, "gf-1")?.name).toBe("Folsom Library");
    expect(findZone(zones, null)).toBeNull();
    expect(findZone(zones, "gf-missing")).toBeNull();
  });
});

describe("graceWindowCopy", () => {
  it("uses the zone's own window, not the drawn five", () => {
    const [tenMinutes] = selectActiveZones([zone({ pause_grace_minutes: 10 })]);
    expect(graceWindowCopy(tenMinutes!)).toContain("10-min");
  });

  it("falls back to the server default when no zone is selected", () => {
    expect(graceWindowCopy(null)).toContain("5-min");
  });
});

describe("zoneRewardCopy", () => {
  it("says what the zone actually pays", () => {
    const [row] = selectActiveZones([zone()]);
    expect(zoneRewardCopy(row!)).toBe("1 pt per 30 min · 15 min minimum");
  });

  it("pluralises the award", () => {
    const [row] = selectActiveZones([zone({ points_per_interval: 2 })]);
    expect(zoneRewardCopy(row!)).toContain("2 pts");
  });
});
