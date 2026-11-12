import { describe, expect, it } from "vitest";
import {
  CHECK_IN_OPENS_ERROR,
  defaultEventStart,
  applyEventType,
  emptyEventDraft,
  moreOptionsSummary,
  repeatCaption,
  resolveEventTimes,
  shiftEnd,
  validateNewEvent,
  withDay,
  type NewEventDraft,
} from "./create-event";

/** Local wall-clock times, so the spec reads the same in any time zone. */
const AFTERNOON = new Date(2026, 10, 6, 14, 20);
const EVENING = new Date(2026, 10, 6, 19, 30);
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute);

function draft(patch: Partial<NewEventDraft> = {}): NewEventDraft {
  return { ...emptyEventDraft(), name: "Chapter meeting", ...patch };
}

describe("a new event's default times", () => {
  it("is today, 7 to 8 PM, before 7 PM", () => {
    expect(resolveEventTimes(emptyEventDraft(), AFTERNOON)).toEqual({
      start: local(6, 19),
      end: local(6, 20),
    });
  });

  it("is tomorrow once today's 7 PM has passed", () => {
    expect(defaultEventStart(EVENING)).toEqual(local(7, 19));
  });

  it("follows the clock the sheet is read against, not the one it was made on", () => {
    // The draft holds no time until one is picked, so a sheet mounted at
    // 2 PM and opened at 7:30 PM offers tomorrow, not a 7 PM gone.
    const kept = emptyEventDraft();
    expect(resolveEventTimes(kept, AFTERNOON).start).toEqual(local(6, 19));
    expect(resolveEventTimes(kept, EVENING).start).toEqual(local(7, 19));
  });

  it("puts an unpicked end an hour after a picked start", () => {
    expect(
      resolveEventTimes({ start: local(8, 21), end: null }, AFTERNOON),
    ).toEqual({ start: local(8, 21), end: local(8, 22) });
  });
});

describe("validateNewEvent", () => {
  it("builds the request", () => {
    const result = validateNewEvent(
      draft({
        start: local(8, 21),
        end: local(9, 1, 30),
        location: "  Great Hall ",
        pointsInput: "25",
        attendance: { everyone: "required", roles: {} },
        description: " Bring dues forms. ",
        recurrenceRule: "WEEKLY",
      }),
      AFTERNOON,
    );
    expect(result).toEqual({
      ok: true,
      body: {
        name: "Chapter meeting",
        start_time: local(8, 21).toISOString(),
        end_time: local(9, 1, 30).toISOString(),
        location: "Great Hall",
        description: "Bring dues forms.",
        point_value: 25,
        is_mandatory: true,
        recurrence_rule: "WEEKLY",
      },
    });
  });

  it("sends a check-in lead only when it isn't the server's default (#3703)", () => {
    const body = (checkInOpensInput: string) => {
      const result = validateNewEvent(
        draft({ start: local(8, 21), checkInOpensInput }),
        AFTERNOON,
      );
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return result.body;
    };
    expect(body("10")).not.toHaveProperty("check_in_opens_minutes");
    expect(body("")).not.toHaveProperty("check_in_opens_minutes");
    expect(body("0").check_in_opens_minutes).toBe(0);
    expect(body("45").check_in_opens_minutes).toBe(45);
  });

  it("refuses a check-in lead past two hours, or not a whole number", () => {
    for (const checkInOpensInput of ["121", "-5", "7.5", "soon"]) {
      const result = validateNewEvent(
        draft({ start: local(8, 21), checkInOpensInput }),
        AFTERNOON,
      );
      expect(result).toEqual({
        ok: false,
        errors: { checkInOpens: CHECK_IN_OPENS_ERROR },
      });
    }
  });

  it("omits a blank location and sends a blank points field as 0", () => {
    const result = validateNewEvent(draft({ pointsInput: " " }), AFTERNOON);
    expect(result.ok && result.body).not.toHaveProperty("location");
    expect(result.ok && result.body.point_value).toBe(0);
  });

  it("refuses a start that has passed", () => {
    const result = validateNewEvent(
      draft({ start: local(6, 9), end: local(6, 10) }),
      AFTERNOON,
    );
    expect(result).toEqual({
      ok: false,
      errors: { start: "That start time has already passed." },
    });
  });

  it("names every problem at once", () => {
    expect(
      validateNewEvent(
        draft({
          name: "  ",
          start: local(8, 10),
          end: local(8, 10),
          pointsInput: "1.5",
        }),
        AFTERNOON,
      ),
    ).toEqual({
      ok: false,
      errors: {
        name: "Give the event a name.",
        end: "The event has to end after it starts.",
        points: "Points must be a whole number, up to 100,000.",
      },
    });
  });
});

describe("attendance by role", () => {
  it("sends the roles that differ and says who else is invited", () => {
    const result = validateNewEvent(
      draft({
        attendance: {
          everyone: "optional",
          roles: { officers: "required", "new-members": "not_invited" },
        },
      }),
      AFTERNOON,
    );
    expect(result.ok && result.body).toMatchObject({
      is_mandatory: false,
      others_invited: true,
      required_role_ids: ["officers"],
      excluded_role_ids: ["new-members"],
    });
    expect(result.ok && result.body).not.toHaveProperty("optional_role_ids");
  });

  it("refuses an event that invites nobody", () => {
    const result = validateNewEvent(
      draft({ attendance: { everyone: "not_invited", roles: {} } }),
      AFTERNOON,
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        attendance: "Nobody is invited. Add a role, or invite everyone.",
      },
    });
  });
});

describe("the More options summary", () => {
  it("says points, who's coming and repeat while closed", () => {
    expect(
      moreOptionsSummary(
        {
          pointsInput: "10",
          checkInOpensInput: "10",
          attendance: { everyone: "required", roles: { a: "optional" } },
          recurrenceRule: "BIWEEKLY",
        },
        (id) => (id === "a" ? "Alumni" : undefined),
      ),
    ).toBe(
      "10 pts · Required for everyone, optional for Alumni · Every 2 weeks",
    );
    expect(moreOptionsSummary(emptyEventDraft(), () => undefined)).toBe(
      "10 pts · Optional for everyone · Doesn't repeat",
    );
  });

  it("says a check-in lead only when it isn't the default", () => {
    const summary = (checkInOpensInput: string) =>
      moreOptionsSummary(
        { ...emptyEventDraft(), checkInOpensInput },
        () => undefined,
      );
    expect(summary("30")).toBe(
      "10 pts · Optional for everyone · Check-in opens 30 min early · Doesn't repeat",
    );
    expect(summary("0")).toContain("Check-in opens at the start");
    expect(summary("")).not.toContain("Check-in");
    expect(summary("500")).toContain("Check-in time needs a fix");
  });

  it("says how long a series runs", () => {
    expect(repeatCaption(local(10, 20), "WEEKLY")).toBe(
      "13 meetings, the last on Feb 2, 2027.",
    );
    expect(repeatCaption(local(10, 20), null)).toBeNull();
  });
});

describe("moving times", () => {
  it("moves the end with the start, keeping the length", () => {
    const previous = { start: local(8, 19), end: local(8, 21) };
    expect(shiftEnd(previous, local(8, 23))).toEqual(local(9, 1));
  });

  it("gives an end set before the start the default hour again", () => {
    const previous = { start: local(8, 19), end: local(8, 18) };
    expect(shiftEnd(previous, local(8, 20))).toEqual(local(8, 21));
  });

  it("joins a picked day to a held time", () => {
    expect(withDay(local(6, 21, 15), local(20, 0))).toEqual(local(20, 21, 15));
  });
});

describe("applyEventType (#3730)", () => {
  const meeting = {
    id: "type-meeting",
    name: "Chapter meeting",
    point_value: 10,
    is_mandatory: true,
  };

  it("fills points, attendance and a blank name", () => {
    const patch = applyEventType(emptyEventDraft(), meeting);
    expect(patch).toMatchObject({
      eventTypeId: "type-meeting",
      pointsInput: "10",
      name: "Chapter meeting",
      attendance: { everyone: "required", roles: {} },
    });
  });

  it("keeps a name the officer typed, and roles set apart", () => {
    const draft = {
      ...emptyEventDraft(),
      name: "Fall kickoff",
      attendance: {
        everyone: "optional" as const,
        roles: { alumni: "not_invited" as const },
      },
    };
    const patch = applyEventType(draft, meeting);
    expect(patch.name).toBeUndefined();
    expect(patch.attendance).toEqual({
      everyone: "required",
      roles: { alumni: "not_invited" },
    });
  });

  it("lets the held type go and changes nothing else", () => {
    const draft = { ...emptyEventDraft(), eventTypeId: "type-meeting" };
    expect(applyEventType(draft, meeting)).toEqual({ eventTypeId: null });
  });

  it("sends the type on create only when one is held", () => {
    const now = new Date(2026, 10, 5, 14, 0);
    const base = { ...emptyEventDraft(), name: "Dinner" };
    const plain = validateNewEvent(base, now);
    const typed = validateNewEvent(
      { ...base, eventTypeId: "type-meeting" },
      now,
    );
    expect(plain.ok && plain.body).not.toHaveProperty("event_type_id");
    expect(typed.ok && typed.body.event_type_id).toBe("type-meeting");
  });
});

// #3709: any member with `events:create` makes an event, but only an
// `events:update` holder makes anyone required or attaches points.
describe("a member who can't edit events", () => {
  const now = new Date(2026, 10, 5, 14, 0);
  const meeting = {
    id: "type-meeting",
    name: "Chapter meeting",
    point_value: 10,
    is_mandatory: true,
  };

  it("makes an optional event worth no points, whatever the points field says", () => {
    const result = validateNewEvent(draft({ pointsInput: "25" }), now, false);
    expect(result.ok && result.body).toMatchObject({
      point_value: 0,
      is_mandatory: false,
    });
  });

  it("ignores a points field it can't see, even one that wouldn't parse", () => {
    const result = validateNewEvent(draft({ pointsInput: "1.5" }), now, false);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["for everyone", { everyone: "required" as const, roles: {} }],
    [
      "for a role",
      {
        everyone: "optional" as const,
        roles: { officers: "required" as const },
      },
    ],
  ])("can't make the event required %s", (_, attendance) => {
    const result = validateNewEvent(draft({ attendance }), now, false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.attendance).toBe(
      "Only officers can make an event required. Set it to optional.",
    );
  });

  it("may still leave a role out", () => {
    const result = validateNewEvent(
      draft({
        attendance: {
          everyone: "optional",
          roles: { pledges: "not_invited" },
        },
      }),
      now,
      false,
    );
    expect(result.ok && result.body.excluded_role_ids).toEqual(["pledges"]);
  });

  it("takes only a type's name, not its points or required default", () => {
    expect(applyEventType(emptyEventDraft(), meeting, false)).toEqual({
      eventTypeId: "type-meeting",
      name: "Chapter meeting",
      typeFilledName: "Chapter meeting",
    });
  });

  it("sees no points in the More options summary", () => {
    expect(
      moreOptionsSummary(emptyEventDraft(), () => undefined, false),
    ).not.toMatch(/pts/);
  });
});
