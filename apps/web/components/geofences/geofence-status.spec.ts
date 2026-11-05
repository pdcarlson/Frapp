import { describe, expect, it } from "vitest";
import {
  geofenceStatusKind,
  geofenceStatusLabel,
  studyZoneRulesLine,
} from "./geofence-status";

describe("geofenceStatusLabel", () => {
  it("says the state in sentence case beside its kind", () => {
    expect(geofenceStatusLabel(true)).toBe("Active");
    expect(geofenceStatusKind(true)).toBe("success");
    expect(geofenceStatusLabel(false)).toBe("Disabled");
    expect(geofenceStatusKind(false)).toBe("outline");
  });
});

describe("studyZoneRulesLine", () => {
  it("joins the four rules into one line", () => {
    expect(
      studyZoneRulesLine({
        points_per_interval: 1,
        minutes_per_point: 30,
        min_session_minutes: 15,
        pause_grace_minutes: 5,
      }),
    ).toBe("1 pt every 30 min · min 15 min session · 5 min pause grace");
  });

  it("keeps a 0-minute minimum session, which is a real rule", () => {
    expect(
      studyZoneRulesLine({
        points_per_interval: 2,
        minutes_per_point: 45,
        min_session_minutes: 0,
        pause_grace_minutes: 10,
      }),
    ).toBe("2 pt every 45 min · min 0 min session · 10 min pause grace");
  });

  it("drops a rule the row does not carry instead of inventing one", () => {
    expect(
      studyZoneRulesLine({
        points_per_interval: 1,
        minutes_per_point: 30,
        min_session_minutes: 15,
        pause_grace_minutes: null,
      }),
    ).toBe("1 pt every 30 min · min 15 min session");
  });
});
