import { describe, expect, it } from "vitest";
import {
  attendanceFromEvent,
  attendanceInvitesNobody,
  attendanceToWire,
  attendanceOfRole,
  attendanceRows,
  describeAttendance,
  eventAttendanceFor,
  eventLimitsAudience,
  eventOthersInvited,
  othersInvitedForCreate,
  eventRequiresAnyone,
} from "./event-attendance";

describe("eventAttendanceFor", () => {
  it("reads a row written before the new columns as before", () => {
    expect(eventAttendanceFor({ is_mandatory: true }, ["r"])).toEqual({
      status: "required",
      byRole: false,
    });
    expect(eventAttendanceFor({ is_mandatory: false }, [])).toEqual({
      status: "optional",
      byRole: false,
    });
  });

  it("keeps an older targeted row to its roles once migrated", () => {
    const event = { required_role_ids: ["exec"], others_invited: false };
    expect(eventAttendanceFor(event, ["exec"]).status).toBe("required");
    expect(eventAttendanceFor(event, ["member"]).status).toBe("not_invited");
  });

  it("gives a member with several listed roles the strongest", () => {
    const event = {
      required_role_ids: ["officer"],
      optional_role_ids: ["member"],
      excluded_role_ids: ["new"],
      others_invited: false,
    };
    expect(eventAttendanceFor(event, ["new", "officer"]).status).toBe(
      "required",
    );
    expect(eventAttendanceFor(event, ["new", "member"]).status).toBe(
      "optional",
    );
    expect(eventAttendanceFor(event, ["new"])).toEqual({
      status: "not_invited",
      byRole: true,
    });
    expect(eventAttendanceFor(event, ["alumni"])).toEqual({
      status: "not_invited",
      byRole: false,
    });
  });

  it("lets a listed role beat the default either way", () => {
    const event = {
      is_mandatory: true,
      optional_role_ids: ["alumni"],
      others_invited: true,
    };
    expect(eventAttendanceFor(event, ["alumni"]).status).toBe("optional");
    expect(eventAttendanceFor(event, ["member"]).status).toBe("required");
  });
});

describe("eventLimitsAudience / eventRequiresAnyone", () => {
  it("only limits the audience when someone is left out", () => {
    // A row without `others_invited` reads with the older meaning: a
    // non-empty required list was the whole audience.
    expect(eventLimitsAudience({ required_role_ids: ["x"] })).toBe(true);
    expect(
      eventLimitsAudience({ required_role_ids: ["x"], others_invited: true }),
    ).toBe(false);
    expect(eventLimitsAudience({ required_role_ids: [] })).toBe(false);
    expect(eventLimitsAudience({ others_invited: false })).toBe(true);
    expect(eventLimitsAudience({ excluded_role_ids: ["x"] })).toBe(true);
  });

  it("ignores is_mandatory when nobody else is invited", () => {
    expect(
      eventRequiresAnyone({ is_mandatory: true, others_invited: false }),
    ).toBe(false);
    expect(eventRequiresAnyone({ required_role_ids: ["x"] })).toBe(true);
    expect(eventRequiresAnyone({ is_mandatory: true })).toBe(true);
  });
});

describe("attendanceToWire / attendanceFromEvent", () => {
  it("round-trips a mixed rule and drops roles equal to the default", () => {
    const wire = attendanceToWire({
      everyone: "optional",
      roles: { officer: "required", member: "optional", new: "not_invited" },
    });
    expect(wire).toEqual({
      is_mandatory: false,
      others_invited: true,
      required_role_ids: ["officer"],
      optional_role_ids: [],
      excluded_role_ids: ["new"],
    });
    expect(attendanceFromEvent(wire)).toEqual({
      everyone: "optional",
      roles: { officer: "required", new: "not_invited" },
    });
  });

  it("reads an older targeted row as officers-only", () => {
    expect(
      attendanceFromEvent({
        is_mandatory: true,
        required_role_ids: ["exec"],
        others_invited: false,
      }),
    ).toEqual({ everyone: "not_invited", roles: { exec: "required" } });
  });
});

describe("describeAttendance", () => {
  const names: Record<string, string> = {
    exec: "Executive Board",
    new: "New Members",
    a: "A",
    b: "B",
    c: "C",
  };
  const name = (id: string) => names[id];

  it("says the default alone when no role differs", () => {
    expect(describeAttendance({ everyone: "required", roles: {} }, name)).toBe(
      "Required for everyone",
    );
  });

  it("names the roles set apart, then the default", () => {
    expect(
      describeAttendance(
        { everyone: "required", roles: { new: "not_invited" } },
        name,
      ),
    ).toBe("New Members not invited, everyone else required");
  });

  it("groups by answer, required first, and shortens past two", () => {
    expect(
      describeAttendance(
        {
          everyone: "optional",
          roles: {
            c: "required",
            a: "required",
            b: "required",
            new: "not_invited",
          },
        },
        name,
      ),
    ).toBe("A, B +1 required, New Members not invited, everyone else optional");
  });

  it("says nobody else is invited for an invite-only audience", () => {
    expect(
      describeAttendance(
        {
          everyone: "not_invited",
          roles: { exec: "required", new: "optional" },
        },
        name,
      ),
    ).toBe(
      "Executive Board required, New Members optional, nobody else invited",
    );
  });

  it("says nobody is invited yet when nothing is", () => {
    expect(
      describeAttendance({ everyone: "not_invited", roles: {} }, name),
    ).toBe("Nobody invited yet");
  });
});

describe("attendanceRows", () => {
  const roles = [
    { id: "b", name: "Brothers" },
    { id: "a", name: "Alumni" },
    { id: "o", name: "Officers" },
    { id: "n", name: "New Members" },
  ];

  it("puts the roles set apart first, then the rest, each by name", () => {
    expect(
      attendanceRows(roles, ["o", "a"], "", "Removed role").map((r) => r.id),
    ).toEqual(["a", "o", "b", "n"]);
  });

  it("keeps a row for a role deleted since, so it can be reset", () => {
    expect(attendanceRows(roles, ["gone"], "", "Removed role")[0]).toEqual({
      id: "gone",
      name: "Removed role",
    });
  });

  it("matches every typed word", () => {
    expect(
      attendanceRows(roles, [], "new mem", "Removed role").map((r) => r.id),
    ).toEqual(["n"]);
  });
});

describe("attendanceOfRole", () => {
  it("reads a role's own answer, else the default", () => {
    const draft = {
      everyone: "optional" as const,
      roles: { o: "required" as const },
    };
    expect(attendanceOfRole(draft, "o")).toBe("required");
    expect(attendanceOfRole(draft, "b")).toBe("optional");
  });
});

describe("others_invited on a row written without it", () => {
  it("derives it from required_role_ids, the older meaning", () => {
    expect(eventOthersInvited({})).toBe(true);
    expect(eventOthersInvited({ others_invited: null })).toBe(true);
    expect(eventOthersInvited({ required_role_ids: ["o"] })).toBe(false);
    expect(
      eventOthersInvited({ required_role_ids: ["o"], others_invited: true }),
    ).toBe(true);
    expect(
      eventAttendanceFor({ is_mandatory: true, required_role_ids: ["o"] }, [
        "m",
      ]).status,
    ).toBe("not_invited");
  });

  it("is sent on create only when a null would read differently", () => {
    const wire = (others: boolean, required: string[] = []) => ({
      is_mandatory: false,
      others_invited: others,
      required_role_ids: required,
      optional_role_ids: [],
      excluded_role_ids: [],
    });
    expect(othersInvitedForCreate(wire(true))).toBeUndefined();
    expect(othersInvitedForCreate(wire(false, ["o"]))).toBeUndefined();
    expect(othersInvitedForCreate(wire(true, ["o"]))).toBe(true);
    expect(othersInvitedForCreate(wire(false))).toBe(false);
  });

  it("refuses a rule that invites nobody", () => {
    expect(
      attendanceInvitesNobody(
        attendanceToWire({ everyone: "not_invited", roles: {} }),
      ),
    ).toBe(true);
    expect(
      attendanceInvitesNobody(
        attendanceToWire({ everyone: "not_invited", roles: { o: "optional" } }),
      ),
    ).toBe(false);
  });
});
