import { describe, expect, it } from "vitest";
import { geofenceStatusKind, geofenceStatusLabel } from "./geofence-status";

describe("geofenceStatusLabel", () => {
  it("says the state in sentence case beside its kind", () => {
    expect(geofenceStatusLabel(true)).toBe("Active");
    expect(geofenceStatusKind(true)).toBe("success");
    expect(geofenceStatusLabel(false)).toBe("Disabled");
    expect(geofenceStatusKind(false)).toBe("outline");
  });
});
