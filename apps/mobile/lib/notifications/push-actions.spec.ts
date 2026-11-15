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
    chapterId: "chap-1",
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
      chapterId: "chap-1",
    });
    expect(excuseDecisionFrom(response(EXCUSE_DECLINE_ACTION))).toEqual({
      eventId: "evt-1",
      userId: "user-sam",
      decision: "DECLINED",
      chapterId: "chap-1",
    });
  });

  it("reads no chapter from a push sent before the field", () => {
    expect(
      excuseDecisionFrom(
        response(EXCUSE_APPROVE_ACTION, {
          target: { screen: "events", eventId: "evt-1" },
          excuseUserId: "user-sam",
        }),
      )?.chapterId,
    ).toBeNull();
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
  it("tells the officer a 409 was already handled, in the server's words", () => {
    const notice = excuseDecisionNotice({
      status: 409,
      message: "This excuse has already been decided",
    });
    expect(notice).toEqual({
      title: "Already handled",
      body: "This excuse has already been decided",
    });
    expect(excuseDecisionNotice({ status: 409 }).body).not.toMatch(
      /couldn't|error|failed/i,
    );
  });

  // Withdrawing deletes the row, so `decide` answers 404, not 409.
  it("tells the officer a withdrawn excuse (404) was already handled", () => {
    const notice = excuseDecisionNotice({ status: 404 });
    expect(notice.title).toBe("Already handled");
    expect(notice.body).toMatch(/withdrawn/);
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
