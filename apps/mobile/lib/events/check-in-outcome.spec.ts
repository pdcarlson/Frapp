import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moduleDisabledMessage } from "@repo/validation";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import {
  ALREADY_CHECKED_IN_COPY,
  CHECK_IN_CODE_REFUSED_MESSAGE,
  CHECK_IN_LOCATION_DENIED_COPY,
  checkInFailure,
  checkInSuccess,
} from "./check-in-outcome";

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
        attemptOnly({ statusCode: 403, message: CHECK_IN_CODE_REFUSED_MESSAGE }),
      ).toBe(true);
    });

    it("marks a request that never got a real answer", () => {
      expect(attemptOnly(new TypeError("Network request failed"))).toBe(true);
      expect(attemptOnly(undefined)).toBe(true);
      expect(attemptOnly({ statusCode: 500, message: "Boom" })).toBe(true);
      expect(attemptOnly({ statusCode: 429, message: "Slow down" })).toBe(true);
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
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(
        here,
        "../../../api/src/application/services/attendance.service.ts",
      ),
      "utf8",
    );
    expect(source).toContain(`'${CHECK_IN_CODE_REFUSED_MESSAGE}'`);
  });
});
