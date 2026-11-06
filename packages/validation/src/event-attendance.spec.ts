import { describe, expect, it } from "vitest";
import {
  attendanceFromEvent,
  attendanceToWire,
  describeAttendance,
  eventAttendanceFor,
  eventLimitsAudience,
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
    expect(eventLimitsAudience({ required_role_ids: ["x"] })).toBe(false);
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

  it("names up to two roles that differ", () => {
    expect(
      describeAttendance(
        { everyone: "required", roles: { new: "not_invited" } },
        name,
      ),
    ).toBe("Required for everyone, not invited for New Members");
  });

  it("counts more than two", () => {
    expect(
      describeAttendance(
        {
          everyone: "optional",
          roles: { a: "required", b: "required", c: "required" },
        },
        name,
      ),
    ).toBe("Optional for everyone, 3 roles differ");
  });

  it("names an invite-only audience", () => {
    expect(
      describeAttendance(
        { everyone: "not_invited", roles: { exec: "required" } },
        name,
      ),
    ).toBe("Executive Board only, required");
  });
});
