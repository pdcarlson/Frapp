import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ASK_FLAG_ENV_KEY, isAskAvailable } from "./flag";

/**
 * The flag is the only thing standing between a member and a synthetic dues
 * figure (`corpus.ts` says why that is acceptable and under what condition), so
 * these tests are about the *closed* direction: what fails to open it.
 *
 * Modelled on `lib/payments/stripe.spec.ts` — mutate `process.env` around the
 * helper, restore in `afterEach`. `clearMocks` is off suite-wide, but nothing
 * here is a mock, so the only shared state to reset is the variable itself.
 */

const KEY = ASK_FLAG_ENV_KEY;

beforeEach(() => {
  delete process.env[KEY];
});

afterEach(() => {
  delete process.env[KEY];
});

describe("isAskAvailable", () => {
  it("is off when nothing is configured, and no eas.json profile configures it", () => {
    expect(isAskAvailable()).toBe(false);
  });

  it("is on for the two exact spellings, and only those", () => {
    for (const on of ["1", "true"]) {
      process.env[KEY] = on;
      expect(isAskAvailable()).toBe(true);
    }
  });

  it("tolerates surrounding whitespace, which a .env file adds by accident", () => {
    process.env[KEY] = " true ";
    expect(isAskAvailable()).toBe(true);
  });

  it("stays off for every near-miss spelling", () => {
    // Deliberately strict rather than truthy: an ambiguous value must not put
    // an invented dues figure in front of a member. `"TRUE"` is included on
    // purpose — the match is case-sensitive and that is the documented rule,
    // not an oversight.
    for (const off of ["", "  ", "0", "false", "TRUE", "True", "yes", "on"]) {
      process.env[KEY] = off;
      expect(
        isAskAvailable(),
        `expected ${JSON.stringify(off)} to be off`,
      ).toBe(false);
    }
  });
});
