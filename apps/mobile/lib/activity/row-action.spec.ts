import { describe, expect, it } from "vitest";
import { activityRowActionsAllowed } from "@/lib/activity/row-action";

/**
 * When Activity's rows carry Confirm and Approve (#4437): the plan's own
 * verdict for a paid write, failing open where nothing proved a refusal.
 */
describe("activityRowActionsAllowed", () => {
  it("allows them on an active plan", () => {
    expect(activityRowActionsAllowed({ subscription_status: "active" })).toBe(
      true,
    );
  });

  it("refuses them where the plan refuses paid writes", () => {
    for (const status of ["incomplete", "canceled"]) {
      expect(activityRowActionsAllowed({ subscription_status: status })).toBe(
        false,
      );
    }
    // Paid writes stop at once on past_due, grace window or not.
    expect(
      activityRowActionsAllowed({
        subscription_status: "past_due",
        past_due_since: new Date().toISOString(),
      }),
    ).toBe(false);
  });

  it("fails open on a chapter not read yet or a status it doesn't model", () => {
    expect(activityRowActionsAllowed(undefined)).toBe(true);
    expect(activityRowActionsAllowed({ subscription_status: "trialing" })).toBe(
      true,
    );
  });
});
