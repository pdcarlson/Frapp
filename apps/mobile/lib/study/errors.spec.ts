import { describe, expect, it } from "vitest";
import { moduleDisabledMessage } from "@repo/validation";
import {
  isActiveSessionConflict,
  MODULE_OFF_COPY,
  serverMessageOf,
  sessionErrorCopy,
  startErrorCopy,
  statusOf,
} from "./errors";

describe("statusOf", () => {
  it("reads the status from either shape the SDK produces", () => {
    expect(statusOf({ statusCode: 409 })).toBe(409);
    expect(statusOf({ status: 403 })).toBe(403);
    expect(statusOf({})).toBeUndefined();
    expect(statusOf(null)).toBeUndefined();
  });
});

describe("serverMessageOf", () => {
  it("joins a validation-pipe message array", () => {
    expect(serverMessageOf({ message: ["lat must be a number", "lng too"] })).toBe(
      "lat must be a number, lng too",
    );
  });

  it("treats an empty message as absent", () => {
    expect(serverMessageOf({ message: "" })).toBeNull();
    expect(serverMessageOf({ message: [] })).toBeNull();
  });
});

describe("isActiveSessionConflict", () => {
  it("recognises the one conflict start can produce", () => {
    expect(isActiveSessionConflict({ statusCode: 409 })).toBe(true);
    expect(isActiveSessionConflict({ statusCode: 400 })).toBe(false);
  });
});

describe("startErrorCopy", () => {
  it("relays the server's specific 400, which already names the fix", () => {
    expect(
      startErrorCopy({
        statusCode: 400,
        message: "Location is outside the geofence",
      }),
    ).toBe("Location is outside the geofence");
  });

  it("relays the alumni refusal verbatim", () => {
    const message = "Alumni members cannot record study hours in this chapter";
    expect(startErrorCopy({ statusCode: 403, message })).toBe(message);
  });

  it("tells a member whose zone vanished to pick another", () => {
    expect(startErrorCopy({ statusCode: 404 })).toContain("Pick another");
  });

  it("falls back to actionable copy when the server says nothing", () => {
    expect(startErrorCopy({})).toContain("try again");
    expect(startErrorCopy({ statusCode: 400 })).toContain("inside the study zone");
  });
});

describe("sessionErrorCopy", () => {
  it("reassures rather than alarms when the session was already closed", () => {
    const copy = sessionErrorCopy({ statusCode: 404 });
    expect(copy).toContain("already been closed");
    expect(copy).toContain("safe");
  });

  it("does not claim local time was lost on a network failure", () => {
    // The server owns the clock, so an unreachable API costs the member
    // nothing that was already credited — saying otherwise would be a lie the
    // member cannot check.
    expect(sessionErrorCopy({})).toContain("server-side time");
  });
});

describe("the subscription gate, on both study paths", () => {
  /**
   * The four envelope keys without the guard's `code`, the shape the API sent
   * until #1020. The detector is keyed on the message (#2995 adds the code),
   * and this is the body that proves the message path works on its own.
   */
  const refusal = {
    statusCode: 403,
    error: "Forbidden",
    message:
      "Chapter subscription is not active; complete checkout to use this feature.",
    requestId: "req_test",
  };

  it("replaces the relayed server message on start", () => {
    // Without this branch the 403 arm returns `serverMessage`, so the member
    // is shown "…complete checkout to use this feature." — a purchase
    // instruction inside the iOS app, which the store declaration forbids.
    const copy = startErrorCopy(refusal);
    expect(copy).not.toMatch(/checkout/i);
    expect(copy).toMatch(/officer/i);
  });

  it("replaces the relayed server message on pause/resume/stop", () => {
    const copy = sessionErrorCopy(refusal);
    expect(copy).not.toMatch(/checkout/i);
    expect(copy).toMatch(/officer/i);
  });

  it("leaves an ordinary permission denial exactly as it was", () => {
    // The other direction, and the one a previous attempt broke: a plain 403
    // still relays the server's own sentence and keeps its retry.
    const denial = {
      statusCode: 403,
      error: "Forbidden",
      message: "Alumni cannot record study hours.",
      requestId: "req_test",
    };
    expect(startErrorCopy(denial)).toBe("Alumni cannot record study hours.");
    expect(sessionErrorCopy(denial)).toBe("Alumni cannot record study hours.");
  });

  it("leaves the 404 and 409 cases untouched", () => {
    expect(sessionErrorCopy({ statusCode: 404 })).toMatch(/already been closed/i);
    expect(startErrorCopy({ statusCode: 404 })).toMatch(/no longer available/i);
  });
});

describe("the module gate, on both study paths (#2393)", () => {
  /**
   * The shape the API sent until #1020, and the whole bug: four keys, no
   * `code`. The branch this replaced keyed on `code` and was tested with a
   * hand-built body that carried it, so it was green in the suite and dead in
   * every shipped build. Don't add `code` here: this body proves the message
   * path, which installed builds rely on, works without it.
   */
  const moduleOff = {
    statusCode: 403,
    error: "Forbidden",
    message: moduleDisabledMessage("hours"),
    requestId: "req_test",
  };

  it("gives a member their own copy on start, not the officer instruction", () => {
    const copy = startErrorCopy(moduleOff);
    expect(copy).toBe(MODULE_OFF_COPY.start);
    expect(copy).not.toContain("Settings");
  });

  it("gives a running session its own copy on pause/resume/stop", () => {
    const copy = sessionErrorCopy(moduleOff);
    expect(copy).toBe(MODULE_OFF_COPY.session);
    expect(copy).not.toContain("Settings");
  });

  it("needs the 403: the same sentence on another status is not the gate", () => {
    expect(startErrorCopy({ ...moduleOff, statusCode: 400 })).toBe(
      moduleOff.message,
    );
  });

  it("leaves an ordinary permission denial relayed as it was", () => {
    const denial = {
      statusCode: 403,
      error: "Forbidden",
      message: "Alumni cannot record study hours.",
      requestId: "req_test",
    };
    expect(startErrorCopy(denial)).toBe(denial.message);
    expect(sessionErrorCopy(denial)).toBe(denial.message);
  });
});
