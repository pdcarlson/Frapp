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

/** Why a row's Check in failed (#4427): the chat event card's words. */
describe("rowActionFailure for a check-in", () => {
  it("says a refusal in the event card's words, and a location refusal as itself", async () => {
    const { rowActionFailure } = await import("@/lib/activity/row-action");
    const { checkInFailure } = await import("@/lib/events/check-in-outcome");
    const refusal = {
      status: 400,
      message: "You need to be at the event to check in.",
    };
    expect(rowActionFailure("check-in", refusal)).toEqual({
      text: checkInFailure(refusal).message,
      gate: false,
    });
    // What `requireForegroundFix` throws when the member refuses location.
    const { MemberFacingError } = await import("@repo/hooks/error-copy");
    const { CHECK_IN_LOCATION_DENIED_COPY } =
      await import("@/lib/events/check-in-outcome");
    expect(
      rowActionFailure(
        "check-in",
        new MemberFacingError(CHECK_IN_LOCATION_DENIED_COPY),
      ).text,
    ).toBe(CHECK_IN_LOCATION_DENIED_COPY);
  });
});
