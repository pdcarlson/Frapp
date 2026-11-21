import {
  editRepeatDraft,
  isEmptyEventPatch,
  pickRepeatPreset,
} from "@repo/validation";
import { describe, expect, it, vi } from "vitest";
import {
  draftFromEvent,
  duplicateEventTemplate,
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
  check_in_opens_minutes: 10,
  attendance: {
    is_mandatory: true,
    others_invited: true,
    required_role_ids: [],
    optional_role_ids: [],
    excluded_role_ids: [],
  },
  description: null,
  notes: null,
  agenda: [],
  attachments: [],
  check_in_zone_name: null,
  event_type_id: null,
  created_by: null,
  hasCheckInZone: false,
  checkInNeedsCode: false,
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
    expect(isEmptyEventPatch(patchOf(single, () => {}))).toBe(true);
  });

  it("sends the check-in lead only when it changed", () => {
    expect(patchOf(single, (d) => (d.checkInOpensInput = "10"))).toEqual({});
    expect(patchOf(single, (d) => (d.checkInOpensInput = "20"))).toEqual({
      check_in_opens_minutes: 20,
    });
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
    expect(isEmptyEventPatch(patchOf(target, () => {}))).toBe(true);
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
    expect(
      patchOf(
        occurrence,
        (d) => (d.repeat = pickRepeatPreset(d.repeat, "NONE")),
      ),
    ).toEqual({ recurrence_rule: null });
  });

  it("leaves a legacy rule alone until Repeat is changed", () => {
    expect(patchOf(occurrence, (d) => (d.name = "Renamed"))).toEqual({
      name: "Renamed",
    });
    expect(
      patchOf(
        occurrence,
        (d) => (d.repeat = editRepeatDraft(d.repeat, { countInput: "4" })),
      ).recurrence_rule,
    ).toMatch(/^FREQ=WEEKLY;INTERVAL=1;BYDAY=\w\w;COUNT=4;TZID=/);
  });

  it("steps a changed rule from the parent, not an occurrence on another weekday", () => {
    // A Monday series, its head still ahead; the occurrence opened was moved
    // by hand to Thursday.
    const rule =
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=10;TZID=America/New_York";
    const parent = {
      id: "evt-parent",
      start_time: "2026-11-09T23:45:00.000Z",
      end_time: "2026-11-10T01:15:00.000Z",
    };
    const thursday: EventEditTarget = {
      event: {
        ...EVENT,
        id: "evt-3",
        parent_event_id: parent.id,
        start_time: "2026-11-26T23:45:00.000Z",
        end_time: "2026-11-27T01:15:00.000Z",
      },
      seriesRule: rule,
      parent,
    };
    expect(
      patchOf(
        thursday,
        (d) => (d.repeat = editRepeatDraft(d.repeat, { countInput: "6" })),
      ).recurrence_rule,
    ).toBe(rule.replace("COUNT=10", "COUNT=6"));
    // Moved a day later in the same save, the stored Monday moves with it.
    expect(
      patchOf(thursday, (d) => {
        d.start = new Date("2026-11-27T23:45:00.000Z");
        d.end = new Date("2026-11-28T01:15:00.000Z");
        d.repeat = editRepeatDraft(d.repeat, { countInput: "6" });
      }).recurrence_rule,
    ).toBe(rule.replace("MO;COUNT=10", "TU;COUNT=6"));
  });

  it("checks a started series' new end against its next meeting", () => {
    // The head (Sep 7) has started; the next meeting is Nov 9. An end date
    // between them would leave the new first meeting alone.
    const rule =
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=20;TZID=America/New_York";
    const started: EventEditTarget = { ...occurrence, seriesRule: rule };
    const draft = draftFromEvent(started);
    draft.repeat = editRepeatDraft(
      { ...draft.repeat, endKind: "until" },
      { until: "2026-11-12" },
    );
    const result = validateEventEdit(draft, started, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.repeat).toBeTruthy();
  });

  it("reads a structured series rule back without a change", () => {
    const rule =
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;COUNT=20;TZID=America/New_York";
    const head = {
      ...single,
      event: { ...EVENT, recurrence_rule: rule },
      seriesRule: rule,
    };
    expect(
      isEmptyEventPatch(
        patchOf(head, (d) => (d.repeat = editRepeatDraft(d.repeat, {}))),
      ),
    ).toBe(true);
  });
});

describe("duplicateEventTemplate (#5492)", () => {
  it("keeps an event still ahead as it is, as a one-time event", () => {
    const draft = duplicateEventTemplate(
      { ...EVENT, recurrence_rule: "WEEKLY" },
      NOW,
    );
    expect(draft.name).toBe("Chapter");
    expect(draft.start?.toISOString()).toBe(EVENT.start_time);
    expect(draft.end?.toISOString()).toBe(EVENT.end_time);
    expect(draft.repeat.preset).toBe("NONE");
  });

  it("moves an event that has started on by whole weeks, keeping its length", () => {
    // Three weeks and a day after the start.
    const later = new Date(
      new Date(EVENT.start_time).getTime() + 22 * 24 * 60 * 60 * 1000,
    );
    const draft = duplicateEventTemplate(EVENT, later);
    const start = draft.start!;
    expect(start > later).toBe(true);
    expect(
      (start.getTime() - new Date(EVENT.start_time).getTime()) /
        (24 * 60 * 60 * 1000),
    ).toBe(28);
    expect(draft.end!.getTime() - start.getTime()).toBe(90 * 60 * 1000);
  });

  it("lands ahead of now, at the same hour, across a spring-forward", () => {
    // A zone with a spring-forward; CI runs in UTC and Asia/Tokyo, which
    // have none. Node reads the zone afresh when it changes.
    vi.stubEnv("TZ", "America/New_York");
    try {
      // Saturday 7 PM EST; now is the next Saturday 7:30 PM EDT, a week
      // less half an hour later by the clock that changed in between.
      const start = new Date(2026, 2, 7, 19, 0);
      const now = new Date(2026, 2, 14, 19, 30);
      const draft = duplicateEventTemplate(
        {
          ...EVENT,
          start_time: start.toISOString(),
          end_time: new Date(start.getTime() + 3_600_000).toISOString(),
        },
        now,
      );
      expect(draft.start! > now).toBe(true);
      expect(draft.start!.getHours()).toBe(19);
      expect(draft.start!.getDate()).toBe(21);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
