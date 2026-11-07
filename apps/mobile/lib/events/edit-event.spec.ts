import { describe, expect, it } from "vitest";
import {
  draftFromEvent,
  isEmptyPatch,
  leavesAfterSave,
  saveRequestFor,
  saveScopeFor,
  seriesRuleOf,
  validateEventEdit,
  type EventEditTarget,
} from "./edit-event";
import type { EventDetail } from "./select";

const NOW = new Date("2026-11-08T22:00:00Z");

const EVENT: EventDetail = {
  id: "evt-1",
  name: "Chapter",
  location: "Sanctuary",
  start_time: "2026-11-09T23:45:00.000Z",
  end_time: "2026-11-10T01:15:00.000Z",
  point_value: 10,
  attendance: {
    is_mandatory: true,
    others_invited: true,
    required_role_ids: [],
    optional_role_ids: [],
    excluded_role_ids: [],
  },
  description: null,
  notes: null,
  check_in_zone_name: null,
  hasCheckInZone: false,
  recurrence_rule: null,
  parent_event_id: null,
};

const single: EventEditTarget = {
  event: EVENT,
  seriesRule: null,
  parent: null,
};

const PARENT = {
  id: "evt-parent",
  start_time: "2026-09-07T22:45:00.000Z",
  end_time: "2026-09-08T00:15:00.000Z",
};
const occurrence: EventEditTarget = {
  event: { ...EVENT, parent_event_id: PARENT.id },
  seriesRule: "WEEKLY",
  parent: PARENT,
};

function patchOf(
  target: EventEditTarget,
  change: (draft: ReturnType<typeof draftFromEvent>) => void,
  now = NOW,
) {
  const draft = draftFromEvent(target);
  change(draft);
  const result = validateEventEdit(draft, target, now);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.patch;
}

describe("validateEventEdit", () => {
  it("sends nothing for an untouched form", () => {
    expect(isEmptyPatch(patchOf(single, () => {}))).toBe(true);
  });

  it("sends only the name for a typo fix, so nobody is paged", () => {
    expect(patchOf(single, (d) => (d.name = "Chapter meeting"))).toEqual({
      name: "Chapter meeting",
    });
  });

  it("sends the location when the room changes", () => {
    expect(patchOf(single, (d) => (d.location = "Great Hall"))).toEqual({
      location: "Great Hall",
    });
  });

  it("sends both times only when the event moved", () => {
    const patch = patchOf(single, (d) => {
      d.start = new Date("2026-11-10T00:00:00.000Z");
      d.end = new Date("2026-11-10T01:30:00.000Z");
    });
    expect(patch).toEqual({
      start_time: "2026-11-10T00:00:00.000Z",
      end_time: "2026-11-10T01:30:00.000Z",
    });
  });

  it("lets an event already under way run later", () => {
    const during = new Date("2026-11-10T00:30:00Z");
    const patch = patchOf(
      single,
      (d) => (d.end = new Date("2026-11-10T01:45:00.000Z")),
      during,
    );
    expect(patch).toEqual({ end_time: "2026-11-10T01:45:00.000Z" });
  });

  it("refuses a start moved into the past", () => {
    const draft = draftFromEvent(single);
    draft.start = new Date("2026-11-08T12:00:00Z");
    const result = validateEventEdit(draft, single, NOW);
    expect(result).toEqual({
      ok: false,
      errors: { start: "That start time has already passed." },
    });
  });

  it("sends every attendance field together when who's coming changes", () => {
    const patch = patchOf(single, (d) => {
      d.attendance = { everyone: "optional", roles: { "role-nm": "required" } };
    });
    expect(patch).toEqual({
      is_mandatory: false,
      others_invited: true,
      required_role_ids: ["role-nm"],
      optional_role_ids: [],
      excluded_role_ids: [],
    });
  });

  it("doesn't read a stored stray space as a change", () => {
    const target = {
      ...single,
      event: { ...EVENT, name: "Chapter ", location: "Sanctuary " },
    };
    expect(isEmptyPatch(patchOf(target, () => {}))).toBe(true);
  });

  it("clears a description emptied out", () => {
    const target = {
      ...single,
      event: { ...EVENT, description: "Bring pins" },
    };
    expect(patchOf(target, (d) => (d.description = "  "))).toEqual({
      description: "",
    });
  });

  it("ends a series with a null rule", () => {
    expect(patchOf(occurrence, (d) => (d.recurrenceRule = null))).toEqual({
      recurrence_rule: null,
    });
  });
});

describe("saveScopeFor", () => {
  it("asks for an event in a series", () => {
    expect(saveScopeFor(occurrence, { name: "x" }, NOW)).toBe("ask");
    const head = {
      ...single,
      event: { ...EVENT, recurrence_rule: "WEEKLY" },
      seriesRule: "WEEKLY" as const,
    };
    expect(saveScopeFor(head, { name: "x" }, NOW)).toBe("ask");
  });

  it("doesn't ask for a one-time event", () => {
    expect(saveScopeFor(single, { name: "x" }, NOW)).toBe("instance");
  });

  it("doesn't offer All upcoming for an event already under way", () => {
    // The server never edits a started event with the series, so the choice
    // would skip the event on screen.
    const during = new Date("2026-11-10T00:00:00Z");
    expect(saveScopeFor(occurrence, { name: "x" }, during)).toBe("instance");
  });

  it("doesn't offer All upcoming when the series parent couldn't be read", () => {
    const orphan = { ...occurrence, parent: null };
    expect(saveScopeFor(orphan, { name: "x" }, NOW)).toBe("instance");
  });

  it("treats a Repeat change as a series change", () => {
    expect(saveScopeFor(single, { recurrence_rule: "WEEKLY" }, NOW)).toBe(
      "series",
    );
    expect(saveScopeFor(occurrence, { recurrence_rule: null }, NOW)).toBe(
      "series",
    );
  });
});

describe("saveRequestFor", () => {
  it("sends this-event edits to the event", () => {
    expect(saveRequestFor(occurrence, { name: "x" }, "instance")).toEqual({
      id: "evt-1",
      scope: "instance",
      body: { name: "x" },
    });
  });

  it("moves the whole series by the same shift, through the parent", () => {
    // 6:45 PM → 7:00 PM on this occurrence, and 15 minutes longer.
    const request = saveRequestFor(
      occurrence,
      {
        name: "Chapter",
        start_time: "2026-11-10T00:00:00.000Z",
        end_time: "2026-11-10T01:45:00.000Z",
      },
      "series",
    );
    expect(request).toEqual({
      id: "evt-parent",
      scope: "series",
      body: {
        name: "Chapter",
        start_time: "2026-09-07T23:00:00.000Z",
        end_time: "2026-09-08T00:45:00.000Z",
      },
    });
  });

  it("sends a series rename to the parent without times", () => {
    expect(saveRequestFor(occurrence, { name: "x" }, "series")).toEqual({
      id: "evt-parent",
      scope: "series",
      body: { name: "x" },
    });
  });

  it("falls back to the occurrence when its parent can't be read", () => {
    const orphan = { ...occurrence, parent: null };
    expect(saveRequestFor(orphan, { name: "x" }, "series").id).toBe("evt-1");
  });
});

describe("leavesAfterSave", () => {
  it("stays for a this-event edit", () => {
    const request = saveRequestFor(occurrence, { name: "x" }, "instance");
    expect(leavesAfterSave(request, occurrence, "evt-1")).toBe(false);
  });

  it("stays for a series rename, patched in place", () => {
    const request = saveRequestFor(occurrence, { name: "x" }, "series");
    expect(leavesAfterSave(request, occurrence, "evt-parent")).toBe(false);
  });

  it("leaves when a series move rebuilds the occurrence on screen", () => {
    const request = saveRequestFor(
      occurrence,
      { start_time: "2026-11-10T00:00:00.000Z" },
      "series",
    );
    expect(leavesAfterSave(request, occurrence, "evt-parent")).toBe(true);
  });

  it("leaves when a started series moves onto its next event", () => {
    const head = { ...single, seriesRule: "WEEKLY" as const };
    const request = saveRequestFor(head, { name: "x" }, "series");
    expect(leavesAfterSave(request, head, "evt-next")).toBe(true);
    expect(leavesAfterSave(request, head, "evt-1")).toBe(false);
  });
});

describe("seriesRuleOf", () => {
  it("reads a parent's own rule and an occurrence's parent's", () => {
    expect(seriesRuleOf({ ...EVENT, recurrence_rule: "MONTHLY" }, null)).toBe(
      "MONTHLY",
    );
    expect(
      seriesRuleOf(occurrence.event, { recurrence_rule: "BIWEEKLY" }),
    ).toBe("BIWEEKLY");
    expect(seriesRuleOf(occurrence.event, null)).toBeNull();
  });
});
