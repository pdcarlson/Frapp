import { describe, expect, it } from "vitest";
import { eligibleSetupLines, selectSetupChecklist } from "./setup-checklist";

// The real beta list, unmocked: dues is off for every chapter during the beta,
// so the officer setup checklist never offers "Send the first dues", even to a
// president whose chapter has dues switched on.
describe("setup checklist while dues is beta-off", () => {
  it("leaves the dues line out for a president with every module on", () => {
    expect(eligibleSetupLines(["*"], { dues: true })).not.toContain("dues");

    const list = selectSetupChecklist({
      permissions: ["*"],
      enabledModules: { dues: true },
      dismissed: [],
      counts: { invite: 1, event: 0, "study-zone": 0, document: 0, dues: 0 },
    });
    expect(list?.lines.map((l) => l.key)).not.toContain("dues");
  });
});
