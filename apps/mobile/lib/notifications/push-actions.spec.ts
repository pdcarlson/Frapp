import { describe, expect, it } from "vitest";
import {
  claimActionPress,
  EXCUSE_APPROVE_ACTION,
  EXCUSE_DECLINE_ACTION,
  excuseDecisionFrom,
  excuseDecisionNotice,
} from "./push-actions";
import type { PushNotificationResponse } from "./push-types";

const DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";

function response(
  actionIdentifier: string,
  data: unknown = {
    target: { screen: "events", eventId: "evt-1" },
    excuseUserId: "user-sam",
    notificationId: "n-1",
  },
): PushNotificationResponse {
  return {
    actionIdentifier,
    notification: {
      date: 0,
      request: {
        identifier: "push-1",
        content: { title: "Sam can't make Chapter meeting", body: null, data },
      },
    },
  };
}

describe("excuseDecisionFrom (#4686)", () => {
  it("reads Approve and Decline as the decision for that member's excuse", () => {
    expect(excuseDecisionFrom(response(EXCUSE_APPROVE_ACTION))).toEqual({
      eventId: "evt-1",
      userId: "user-sam",
      decision: "APPROVED",
    });
    expect(excuseDecisionFrom(response(EXCUSE_DECLINE_ACTION))).toEqual({
      eventId: "evt-1",
      userId: "user-sam",
      decision: "DECLINED",
    });
  });

  it("is null for a plain tap, which only opens the event", () => {
    expect(excuseDecisionFrom(response(DEFAULT_ACTION))).toBeNull();
  });

  // An excuse push from a server before #4686 names no sender.
  it("is null when the push names no sender or no event", () => {
    expect(
      excuseDecisionFrom(
        response(EXCUSE_APPROVE_ACTION, {
          target: { screen: "events", eventId: "evt-1" },
        }),
      ),
    ).toBeNull();
    expect(
      excuseDecisionFrom(
        response(EXCUSE_APPROVE_ACTION, { excuseUserId: "user-sam" }),
      ),
    ).toBeNull();
    expect(
      excuseDecisionFrom(response(EXCUSE_APPROVE_ACTION, null)),
    ).toBeNull();
  });
});

describe("excuseDecisionNotice (#4686)", () => {
  it("tells the officer a 409 was already handled, not that it failed", () => {
    const notice = excuseDecisionNotice({ status: 409 });
    expect(notice.title).toBe("Already handled");
    expect(notice.body).not.toMatch(/couldn't|error|failed/i);
  });

  it("points anything else at the event the press opened", () => {
    expect(excuseDecisionNotice({ status: 403 }).title).toBe(
      "Couldn't save that decision",
    );
    expect(
      excuseDecisionNotice(new TypeError("Network request failed")).title,
    ).toBe("Couldn't save that decision");
  });
});

describe("claimActionPress", () => {
  it("acts on a press once, however many times it is handed over", () => {
    expect(claimActionPress("push-claim-1")).toBe(true);
    expect(claimActionPress("push-claim-1")).toBe(false);
    expect(claimActionPress("push-claim-2")).toBe(true);
  });
});
