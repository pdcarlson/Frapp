import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ASK_FLAG_ENV_KEY, askUnavailableReason, isAskAvailable } from "./flag";

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
  it("is off when nothing is configured, which is every shipped build today", () => {
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

describe("askUnavailableReason", () => {
  it("says nobody has switched it on when the variable is absent", () => {
    const reason = askUnavailableReason();
    expect(reason).toContain("isn't switched on for this build");
    // §5: a blocked control names its blocker *and* leaves somewhere to go.
    expect(reason).toContain("Documents");
  });

  it("says somebody switched it off when the variable is set to off", () => {
    process.env[KEY] = "0";
    expect(askUnavailableReason()).toContain("has been switched off");
  });

  it("gives the two causes genuinely different sentences", () => {
    const absent = askUnavailableReason();
    process.env[KEY] = "false";
    expect(askUnavailableReason()).not.toBe(absent);
  });

  it("is null when Ask is available, so the sheet has no excuse to show one", () => {
    process.env[KEY] = "1";
    expect(askUnavailableReason()).toBeNull();
  });
});
