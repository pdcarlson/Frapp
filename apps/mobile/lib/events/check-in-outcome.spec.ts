import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHECK_IN_CODES_UNCONFIGURED_MESSAGE } from "@repo/hooks";
import { moduleDisabledMessage } from "@repo/validation";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import {
  ALREADY_CHECKED_IN_COPY,
  CHECK_IN_CODE_REFUSED_MESSAGE,
  CHECK_IN_LOCATION_DENIED_COPY,
  CHECK_IN_TOKEN_FIELD,
  checkInFailure,
  checkInSuccess,
} from "./check-in-outcome";

/** A file of the API's source, read by the specs that keep a copy honest. */
const apiSource = (path: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../api/src", path),
    "utf8",
  );

/** The two gate refusals, shaped as the guards throw them. */
const SUBSCRIPTION_403 = {
  statusCode: 403,
  error: "Forbidden",
  message:
    "Chapter subscription is not active; complete checkout to use this feature.",
};
const MODULE_403 = {
  statusCode: 403,
  error: "Forbidden",
  message: moduleDisabledMessage("events"),
};

describe("checkInSuccess", () => {
  it("names the points when the event awards any", () => {
    expect(checkInSuccess(10).message).toBe("You're checked in. +10 pts");
    expect(checkInSuccess(0).message).toBe("You're checked in.");
    expect(checkInSuccess(null).message).toBe("You're checked in.");
  });

  it("splits the same words into the lines s18's panel draws", () => {
    expect(checkInSuccess(10)).toMatchObject({
      title: "You're checked in",
      pointsLabel: "+10 pts",
    });
    expect(checkInSuccess(0).pointsLabel).toBeNull();
    expect(checkInSuccess(undefined).pointsLabel).toBeNull();
  });
});

describe("checkInFailure", () => {
  it("never relays a gate refusal's server string", () => {
    expect(checkInFailure(SUBSCRIPTION_403)).toEqual({
      kind: "blocked",
      message: SUBSCRIPTION_REFUSAL_COPY.checkIn,
    });
    expect(checkInFailure(MODULE_403)).toEqual({
      kind: "blocked",
      message: MODULE_REFUSAL_COPY.checkIn,
    });
  });

  it("reads a 409 as already checked in", () => {
    expect(checkInFailure({ statusCode: 409, message: "Conflict" })).toEqual({
      kind: "already",
      message: ALREADY_CHECKED_IN_COPY,
    });
  });

  it("relays anything else, a thrown permission copy included", () => {
    expect(
      checkInFailure({ statusCode: 400, message: "You're outside the zone." }),
    ).toMatchObject({ kind: "error", message: "You're outside the zone." });
    expect(checkInFailure(new Error("Allow location access."))).toMatchObject({
      kind: "error",
      message: "Allow location access.",
    });
    expect(checkInFailure(undefined)).toMatchObject({
      kind: "error",
      message: "Couldn't check you in.",
    });
  });

  /**
   * s18 keeps a refusal on screen when the member opens the manual sheet only
   * if a typed code would meet it too.
   */
  describe("attemptOnly", () => {
    const attemptOnly = (error: unknown) => {
      const failure = checkInFailure(error);
      return failure.kind === "error" ? failure.attemptOnly : undefined;
    };

    it("marks a refusal of the code itself", () => {
      expect(
        attemptOnly({
          statusCode: 403,
          message: CHECK_IN_CODE_REFUSED_MESSAGE,
        }),
      ).toBe(true);
      // The API's validation of the scanned token: a QR that is ours in
      // shape but carries no code the server could check.
      expect(
        attemptOnly({
          statusCode: 400,
          error: "Bad Request",
          message: ["token must be shorter than or equal to 256 characters"],
        }),
      ).toBe(true);
      // Not when the validation is about anything else as well.
      expect(
        attemptOnly({
          statusCode: 400,
          message: [
            "token must be shorter than or equal to 256 characters",
            "lat must be a latitude string or number",
          ],
        }),
      ).toBe(false);
    });

    it("marks a request that may go through if sent again", () => {
      // `@repo/hooks`' `isTransientCheckInFailure`, which is the shared
      // "no real answer" rule plus the rate limit.
      expect(attemptOnly(new TypeError("Network request failed"))).toBe(true);
      expect(attemptOnly(undefined)).toBe(true);
      for (const statusCode of [500, 502, 503, 408, 499, 460, 429]) {
        expect(attemptOnly({ statusCode, message: "Try later" })).toBe(true);
      }
    });

    it("keeps what a typed code would meet too: where the member is, and who", () => {
      expect(
        attemptOnly({
          statusCode: 403,
          message: "You need to be at the event to check in",
        }),
      ).toBe(false);
      expect(
        attemptOnly({
          statusCode: 400,
          message:
            "This event checks you in by location — use the Frapp mobile app to check in.",
        }),
      ).toBe(false);
      expect(
        attemptOnly({
          statusCode: 400,
          message: "Check-in is only allowed during the event time window",
        }),
      ).toBe(false);
      expect(attemptOnly(new Error(CHECK_IN_LOCATION_DENIED_COPY))).toBe(false);
      expect(
        attemptOnly({
          statusCode: 400,
          message: ["lat must be a latitude string or number"],
        }),
      ).toBe(false);
      expect(attemptOnly({ statusCode: 404, message: "Event not found" })).toBe(
        false,
      );
    });

    it("keeps an environment with no check-in codes: a typed code meets it too", () => {
      expect(
        attemptOnly({
          statusCode: 503,
          message: CHECK_IN_CODES_UNCONFIGURED_MESSAGE,
        }),
      ).toBe(false);
    });
  });
});

describe("CHECK_IN_CODE_REFUSED_MESSAGE", () => {
  /**
   * The refusal has no `code`, so its message is the match. Read from the
   * API's source so a reworded refusal breaks here, not by leaving a stale
   * "not valid" line in a member's manual sheet.
   */
  it("is the API's refusal of a code, word for word", () => {
    expect(apiSource("application/services/attendance.service.ts")).toContain(
      `'${CHECK_IN_CODE_REFUSED_MESSAGE}'`,
    );
  });
});

describe("CHECK_IN_CODES_UNCONFIGURED_MESSAGE", () => {
  /**
   * `@repo/hooks`' match for the API's 503 where no signing secret is set,
   * read here because that package has no Node types to read a file with.
   * The refusal has no `code`, so its message is the match: reworded, s22
   * would keep polling a screen that can never get a code, and s18 would
   * clear the line before a typed code meets the same refusal.
   */
  it("is the API's 503 for an environment with no signing secret, word for word", () => {
    expect(apiSource("application/services/attendance.service.ts")).toContain(
      `'${CHECK_IN_CODES_UNCONFIGURED_MESSAGE}'`,
    );
  });
});

describe("CHECK_IN_TOKEN_FIELD", () => {
  /**
   * A 400 that refuses the scanned token is told apart by its validation
   * lines, which class-validator starts with the property's name unless a
   * decorator sets its own `message`. Read from the DTO so a renamed field,
   * or a custom message, breaks here rather than leaving the refusal in the
   * member's manual sheet.
   */
  it("is the check-in body's token, validated with class-validator's own messages", () => {
    const dto = apiSource("interface/dtos/attendance.dto.ts");
    const body = dto.slice(dto.indexOf("export class CheckInDto {"));
    const declaration = `  ${CHECK_IN_TOKEN_FIELD}?: string;`;
    expect(body).toContain(declaration);
    const preceding = body.slice(0, body.indexOf(declaration));
    // The decorators since the property before it, if any.
    const decorators = preceding.slice(preceding.lastIndexOf(";") + 1);
    expect(decorators).toContain("@MaxLength(");
    expect(decorators).not.toMatch(/\bmessage\s*:/);
  });
});
