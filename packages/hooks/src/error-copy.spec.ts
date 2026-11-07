import { describe, expect, it } from "vitest";
import {
  OFFLINE_COPY,
  SERVER_MESSAGE_COPY,
  STATUS_ERROR_COPY,
} from "@repo/validation";
import {
  describeLoadFailure,
  errorCopy,
  LOAD_FAILURE_SERVER_COPY,
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
    expect(
      errorCopy(nest(409, "Role name already exists in this chapter")),
    ).toBe("A role with that name already exists. Pick another name.");
    expect(
      errorCopy(nest(400, 'File extension ".exe" is not allowed'), FALLBACK),
    ).toBe("That file type isn't supported.");
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
});
