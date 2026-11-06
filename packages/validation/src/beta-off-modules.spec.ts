import { describe, expect, it } from "vitest";
import { BETA_OFF_MODULES, isBetaOffModule } from "./beta-off-modules";
import { isModuleEnabled } from "./index";
import { selectOpsNudge } from "./ops-nudges";

describe("BETA_OFF_MODULES", () => {
  // The decision itself (Paul, 2026-11-06). Removing `dues` here is how it
  // comes back, and that change should have to touch this line on purpose.
  it("holds dues for the beta", () => {
    expect(BETA_OFF_MODULES).toEqual(["dues"]);
  });

  it("names only what it holds", () => {
    expect(isBetaOffModule("dues")).toBe(true);
    expect(isBetaOffModule("events")).toBe(false);
  });
});

describe.each(BETA_OFF_MODULES)("beta-off module %s", (key) => {
  it("is off whatever the chapter's map says, and before it loads", () => {
    expect(isModuleEnabled({ [key]: true }, key)).toBe(false);
    expect(isModuleEnabled({}, key)).toBe(false);
    expect(isModuleEnabled(null, key)).toBe(false);
    expect(isModuleEnabled(undefined, key)).toBe(false);
  });

  it("leaves every other module to the chapter", () => {
    expect(isModuleEnabled({ [key]: true }, "events")).toBe(true);
    expect(isModuleEnabled({ events: false }, "events")).toBe(false);
    expect(isModuleEnabled(undefined, "events")).toBe(true);
  });

  // A nudge to enable a module that can't turn on would lead nowhere.
  it("is never offered as a setup nudge", () => {
    expect(selectOpsNudge({ [key]: false })?.key).not.toBe(key);
  });
});

describe("selectOpsNudge while dues is beta-off", () => {
  it("moves on to the next module in priority order", () => {
    expect(selectOpsNudge({ dues: false, events: false })?.key).toBe("events");
  });
});
