import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  it("is off when nothing is configured", () => {
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

type EasBuildProfile = { env?: Record<string, unknown> };

/**
 * No committed build profile may switch Ask on (#2259).
 *
 * A build without Ask shows a reviewer no Ask surface at all, which is what
 * the App Store listing and review notes rely on (`store/README.md`). A
 * profile's `env` block in `eas.json` is inlined into that build, so an on
 * value here would put the pill and the synthetic corpus in a store binary.
 *
 * **This alone cannot prove a build is off.** Each profile is also bound to an
 * EAS environment (`"environment": "production"` and so on), and variables set
 * there in the EAS dashboard or with `eas env:set` never reach the repo. This
 * guards the half the repo owns. The other half is no longer settled by hand:
 * `app.config.js` refuses to evaluate an EAS `production` build whose
 * environment switches Ask on (`assertProductionAskDisabled`, tested in
 * `app.config.spec.ts` against this file's parse), so an on value there fails
 * the build rather than shipping. Preview and development builds may still
 * carry Ask; `eas env:list --environment <name>` is how to see whether they do.
 */
describe("eas.json", () => {
  const easJson = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "eas.json"),
      "utf8",
    ),
  ) as { build?: Record<string, EasBuildProfile> };
  const profiles = Object.entries(easJson.build ?? {});

  it("has build profiles to check", () => {
    // Guards the guard: a moved file or renamed key would otherwise leave the
    // loop below with nothing to iterate and nothing to fail.
    expect(profiles.map(([name]) => name)).toEqual(
      expect.arrayContaining(["development", "preview", "production"]),
    );
  });

  it.each(profiles)("profile %s does not switch Ask on", (name, profile) => {
    const value = profile.env?.[KEY];
    if (value === undefined) return;
    // Judged by the same parse the app runs, so a spelling the app reads as
    // off (`"0"`, `"false"`) is allowed and anything it reads as on is not.
    process.env[KEY] = String(value);
    expect(
      isAskAvailable(),
      `eas.json build.${name}.env sets ${KEY}=${JSON.stringify(value)}`,
    ).toBe(false);
  });
});
