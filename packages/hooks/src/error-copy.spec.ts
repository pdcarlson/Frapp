import { describe, expect, it } from "vitest";
import {
  AUDIT_LOG_READ_ONLY_REFUSAL,
  OFFLINE_COPY,
  SERVER_MESSAGE_COPY,
  STATUS_ERROR_COPY,
} from "@repo/validation";
import {
  canTryAgain,
  describeLoadFailure,
  errorCopy,
  LOAD_FAILURE_SERVER_COPY,
  LOAD_FAILURE_SIGN_IN_COPY,
  MemberFacingError,
  TRY_AGAIN,
} from "./error-copy";
import { SignedUploadError } from "./put-signed-upload";

const FALLBACK = "The event wasn't saved. Try again in a moment.";

function nest(statusCode: number, message: string | string[], code?: string) {
  return { statusCode, message, error: "x", requestId: "r", code };
}

describe("errorCopy", () => {
  it("never shows a raw server sentence it doesn't know", () => {
    expect(
      errorCopy(nest(400, "name must be shorter than 100"), FALLBACK),
    ).toBe(FALLBACK);
    expect(
      errorCopy(nest(400, ["title should not be empty", "x"]), FALLBACK),
    ).toBe(FALLBACK);
    expect(errorCopy(nest(500, "Internal server error"), FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("rewrites the refusals that carry a reason", () => {
    expect(errorCopy(nest(409, "Already checked in for this event"))).toBe(
      "You're already checked in.",
    );
    // A sign-up sheet slot that filled first (#3926).
    expect(
      errorCopy(
        nest(
          409,
          "That slot is full. Someone took the last spot just before you.",
        ),
      ),
    ).toBe("That slot is full. Someone took the last spot just before you.");
    expect(
      errorCopy(nest(409, "Role name already exists in this chapter")),
    ).toBe("A role with that name already exists. Pick another name.");
    expect(
      errorCopy(nest(400, 'File extension ".exe" is not allowed'), FALLBACK),
    ).toBe("That file type isn't supported.");
  });

  // Chat's refusals for the audit log, a card's length, a DM's members and a
  // poll card checked on send: the member reads why, not the 403/400 line.
  it.each([
    [
      403,
      AUDIT_LOG_READ_ONLY_REFUSAL,
      "The audit log is read-only. Only Frapp posts there, its entries stay, and nothing in it can be flagged or pinned.",
    ],
    [
      400,
      "This card is too long to post. Shorten it and try again.",
      "This card is too long to post. Shorten it and try again.",
    ],
    [
      400,
      "This form is too long to post. Shorten some questions or options and try again.",
      "This form is too long to post. Shorten some questions or options and try again.",
    ],
    [
      404,
      "Only members of your chapter can be in a direct message. Check who you picked and try again.",
      "Only members of your chapter can be in a direct message. Check who you picked and try again.",
    ],
    [400, "You can't start a DM with yourself", "You can't message yourself."],
    [
      400,
      "Group DMs require 2 to 10 members",
      "A group message needs 2 to 10 people.",
    ],
    [
      400,
      "A group DM holds up to 10 people, you included",
      "A group message holds up to 10 people, you included.",
    ],
    [
      400,
      "A poll needs a question and at least two options",
      "Add a question and at least two options.",
    ],
    [400, "A poll needs a question", "Add a question to the poll."],
    [
      400,
      "A poll needs 2 to 10 options",
      "A poll needs between 2 and 10 options.",
    ],
    [
      400,
      "A poll question can be at most 500 characters",
      "A poll question can be at most 500 characters.",
    ],
    [
      400,
      "An option can be at most 200 characters",
      "An option can be at most 200 characters.",
    ],
    [
      400,
      "Each option needs an id and a label",
      "Give every option some text.",
    ],
    [
      400,
      "Each option needs its own id",
      "This poll couldn't be read. Make it again and post it.",
    ],
    [
      400,
      "Unknown poll choice mode",
      "This poll couldn't be read. Make it again and post it.",
    ],
    [
      400,
      "A poll’s end time must be a date and time",
      "Pick a date and time for the poll to close.",
    ],
    [
      400,
      "A poll can end at most a year from now",
      "A poll can close at most a year from now.",
    ],
  ])("rewrites chat's %i %s", (status, sentence, copy) => {
    expect(errorCopy(nest(status, sentence), FALLBACK)).toBe(copy);
  });

  it("says what the status means where it means the same everywhere", () => {
    expect(errorCopy(nest(403, "Forbidden resource"), FALLBACK)).toBe(
      "Your role can't do this. Ask an officer if you need it.",
    );
    expect(
      errorCopy(
        nest(403, "Missing required permissions: events:create"),
        FALLBACK,
      ),
    ).not.toMatch(/events:create/);
    expect(errorCopy(nest(404, "Event not found"), FALLBACK)).toBe(
      "It may have been deleted. Refresh and try again.",
    );
    expect(errorCopy({ statusCode: 429 }, FALLBACK)).toMatch(/Wait a minute/);
  });

  it("names a module that's off and a lapsed subscription by code", () => {
    expect(
      errorCopy(nest(403, "whatever", "chapter.module.disabled"), FALLBACK),
    ).toMatch(/turned off for your chapter/);
    expect(
      errorCopy(
        nest(403, "whatever", "chapter.subscription.write_locked"),
        FALLBACK,
      ),
    ).toMatch(/subscription isn't active/);
  });

  it("tells a dropped connection apart from a bug", () => {
    expect(errorCopy(new TypeError("Failed to fetch"), FALLBACK)).toMatch(
      /Check your connection/,
    );
    expect(errorCopy(new TypeError("Network request failed"))).toMatch(
      /Check your connection/,
    );
    expect(
      errorCopy(
        new TypeError("Cannot read properties of undefined (reading 'id')"),
        FALLBACK,
      ),
    ).toBe(FALLBACK);
  });

  it("shows only client errors written for members", () => {
    expect(errorCopy(new Error("The API did not return an import id."))).toBe(
      TRY_AGAIN,
    );
    expect(
      errorCopy(new MemberFacingError("This file is already in this batch.")),
    ).toBe("This file is already in this batch.");
  });

  it("shows a refused upload's own member copy, or says it was too large", () => {
    expect(
      errorCopy(new SignedUploadError(403, "The file didn't upload.")),
    ).toBe("The file didn't upload.");
    expect(errorCopy(new SignedUploadError(413, "x"))).toBe(
      "That file is too large.",
    );
  });

  it("shows a route's own officer sentence only when the screen opts in", () => {
    const quota = nest(
      400,
      "Re-export with a smaller --partition (for example --partition 8mb).",
    );
    const pending = nest(400, "3 file(s) have not finished uploading yet.");
    const named = nest(400, "Pick a Frapp channel for #study_hall.");
    const off = nest(
      503,
      "Connecting Discord is not configured in this environment.",
    );
    const opt = { serverWritesForMembers: true };
    for (const e of [quota, pending, named, off]) {
      expect(errorCopy(e, FALLBACK, opt)).toBe(e.message);
      expect(errorCopy(e, FALLBACK)).toBe(FALLBACK);
    }
    expect(
      errorCopy(
        nest(403, "Missing required permissions: discord:import"),
        FALLBACK,
        opt,
      ),
    ).not.toMatch(/discord:import/);
  });

  it("writes every mapped line as a sentence", () => {
    for (const line of Object.values(SERVER_MESSAGE_COPY)) {
      expect(line).toMatch(/^[A-Z].*\.$/);
      expect(line).not.toMatch(/[A-Z]{3,}|_/);
    }
  });
});

describe("describeLoadFailure", () => {
  it("says offline when no response came back", () => {
    expect(describeLoadFailure(new TypeError("Failed to fetch"))).toBe(
      OFFLINE_COPY,
    );
  });

  it("uses the shared status line, so loads and actions match", () => {
    expect(describeLoadFailure(nest(403, "Forbidden resource"))).toBe(
      STATUS_ERROR_COPY[403],
    );
  });

  it("names a turned-off module rather than the role", () => {
    expect(
      describeLoadFailure(nest(403, "whatever", "chapter.module.disabled")),
    ).not.toBe(STATUS_ERROR_COPY[403]);
  });

  it("falls back to the server-side line for other statuses", () => {
    expect(describeLoadFailure(nest(500, "Internal server error"))).toBe(
      LOAD_FAILURE_SERVER_COPY,
    );
  });

  it("says the sign-in is refreshing for a 401, never that the member was signed out", () => {
    expect(describeLoadFailure(nest(401, "Unauthorized"))).toBe(
      LOAD_FAILURE_SIGN_IN_COPY,
    );
  });
});

describe("canTryAgain", () => {
  it("offers Try again when no response came back, or the server failed", () => {
    expect(canTryAgain(new TypeError("Failed to fetch"))).toBe(true);
    expect(canTryAgain(nest(500, "Internal server error"))).toBe(true);
    expect(canTryAgain(nest(503, "Service unavailable"))).toBe(true);
    expect(canTryAgain(nest(504, "Gateway timeout"))).toBe(true);
    // A proxy's timeout: the write may not have landed, so asking again helps.
    expect(canTryAgain(nest(408, "Request timeout"))).toBe(true);
  });

  it("reads the status chat-core wraps a refusal in", () => {
    const wrapped = Object.assign(new Error("x"), {
      response: { status: 502 },
    });
    expect(canTryAgain(wrapped)).toBe(true);
    const refused = Object.assign(new Error("x"), { context: { status: 403 } });
    expect(canTryAgain(refused)).toBe(false);
  });

  it("offers nothing for a refusal the API decided, which would only repeat", () => {
    expect(canTryAgain(nest(400, "Location is outside the geofence"))).toBe(
      false,
    );
    expect(canTryAgain(nest(403, "Forbidden resource"))).toBe(false);
    expect(canTryAgain(nest(409, "Already checked in for this event"))).toBe(
      false,
    );
    expect(canTryAgain(nest(429, "Too many requests"))).toBe(false);
  });

  it("offers nothing for a failure the client already explained", () => {
    expect(canTryAgain(new MemberFacingError("Pick a day first."))).toBe(false);
  });

  it("offers nothing for a statusless failure that would fail the same way", () => {
    // Location denied: a GeolocationPositionError, which isn't an Error.
    expect(canTryAgain({ code: 1, message: "User denied Geolocation" })).toBe(
      false,
    );
    expect(
      canTryAgain(new Error("Geolocation is not available in this browser.")),
    ).toBe(false);
    expect(
      canTryAgain(new TypeError("Cannot read properties of undefined")),
    ).toBe(false);
    expect(
      canTryAgain(Object.assign(new Error("x"), { name: "AbortError" })),
    ).toBe(false);
  });

  it("offers Try again for each runtime's dropped connection", () => {
    expect(canTryAgain(new TypeError("Load failed"))).toBe(true);
    expect(canTryAgain(new TypeError("Load failed (api.frapp.live)"))).toBe(
      true,
    );
    expect(canTryAgain(new TypeError("Network request failed"))).toBe(true);
    expect(
      canTryAgain(
        new Error(
          "fetch failed: UnexpectedException: The network connection was lost.",
        ),
      ),
    ).toBe(true);
    expect(
      canTryAgain(new Error("fetch failed: The operation was aborted.")),
    ).toBe(false);
  });
});
