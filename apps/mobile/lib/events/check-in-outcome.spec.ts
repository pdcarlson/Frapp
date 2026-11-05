import { describe, expect, it } from "vitest";
import { moduleDisabledMessage } from "@repo/validation";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import {
  ALREADY_CHECKED_IN_COPY,
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
    ).toEqual({ kind: "error", message: "You're outside the zone." });
    expect(checkInFailure(new Error("Allow location access."))).toEqual({
      kind: "error",
      message: "Allow location access.",
    });
    expect(checkInFailure(undefined)).toEqual({
      kind: "error",
      message: "Couldn't check you in.",
    });
  });
});
