import { describe, expect, it } from "vitest";
import {
  isActiveSessionConflict,
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

  it("does not hand a member the officer instructions the module gate returns", () => {
    // `ChapterGuard.enforceModule` throws
    // `{ code: 'chapter.module.disabled', message: 'The "hours" module is
    // disabled for this chapter. Re-enable it in Settings → Modules to make
    // changes.' }` — a sentence a member cannot act on. The structured code is
    // what tells it apart from an ordinary 403, since both arrive as 403.
    const copy = startErrorCopy({
      statusCode: 403,
      code: "chapter.module.disabled",
      message:
        'The "hours" module is disabled for this chapter. Re-enable it in Settings → Modules to make changes.',
    });
    expect(copy).not.toContain("Settings");
    expect(copy).toContain("An officer can turn the module back on.");
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
