import { describe, expect, it } from "vitest";
import { selectEventDetail } from "./select";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-1",
    name: "Chapter Meeting",
    location: "Great Room",
    start_time: "2026-09-01T20:00:00.000Z",
    end_time: "2026-09-01T21:00:00.000Z",
    point_value: 5,
    is_mandatory: true,
    description: "Bring your dues.",
    notes: "Motion to approve budget passed 12-0.",
    check_in_zone_name: null,
    check_in_zone: null,
    ...overrides,
  };
}

describe("selectEventDetail — notes", () => {
  it("carries meeting minutes through when present", () => {
    const detail = selectEventDetail(event());
    expect(detail?.notes).toBe("Motion to approve budget passed 12-0.");
  });

  it("is null when the event has no notes, rather than an empty string", () => {
    expect(selectEventDetail(event({ notes: null }))?.notes).toBeNull();
    expect(selectEventDetail(event({ notes: "" }))?.notes).toBeNull();
  });

  // A whitespace-only value must read as absent, or the section renders with
  // a label and an invisible body.
  it("is null for a whitespace-only value", () => {
    expect(selectEventDetail(event({ notes: "   " }))?.notes).toBeNull();
  });

  it("does not require notes for an otherwise-valid event to resolve", () => {
    const detail = selectEventDetail(event({ notes: undefined }));
    expect(detail).not.toBeNull();
    expect(detail?.notes).toBeNull();
  });
});
