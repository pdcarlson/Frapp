import { describe, expect, it } from "vitest";
import {
  assertContentFreeProperties,
  inviteFunnelEventName,
  inviteFunnelProperties,
  inviteJoinFailureReason,
  INVITE_FUNNEL_STEPS,
} from "./index";

describe("invite card funnel (#5663)", () => {
  it("names each step's event invite-<step>", () => {
    expect(inviteFunnelEventName("card-viewed")).toBe("invite-card-viewed");
    expect(inviteFunnelEventName("email-code-verified")).toBe(
      "invite-email-code-verified",
    );
  });

  it("keeps only the fields a step may carry", () => {
    expect(
      inviteFunnelProperties({
        step: "card-viewed",
        state: "live",
        signed_in: false,
        method: "apple",
      }),
    ).toEqual({ state: "live", signed_in: false });
    expect(
      inviteFunnelProperties({
        step: "sign-in-started",
        method: "email",
        state: "live",
      }),
    ).toEqual({ method: "email" });
    expect(
      inviteFunnelProperties({ step: "join-failed", reason: "gone" }),
    ).toEqual({ reason: "gone" });
    expect(
      inviteFunnelProperties({ step: "email-code-sent", reason: "gone" }),
    ).toEqual({});
  });

  it("never builds properties the analytics gate refuses", () => {
    for (const step of INVITE_FUNNEL_STEPS) {
      const properties = inviteFunnelProperties({
        step,
        state: "used",
        signed_in: true,
        method: "google",
        reason: "server",
      });
      expect(() =>
        assertContentFreeProperties({
          name: inviteFunnelEventName(step),
          properties,
        }),
      ).not.toThrow();
    }
  });

  it("classifies a failed join without its error text", () => {
    expect(inviteJoinFailureReason(410, false)).toBe("gone");
    expect(inviteJoinFailureReason(403, false)).toBe("forbidden");
    expect(inviteJoinFailureReason(429, false)).toBe("rate_limited");
    expect(inviteJoinFailureReason(503, false)).toBe("server");
    expect(inviteJoinFailureReason(undefined, true)).toBe("offline");
    expect(inviteJoinFailureReason(undefined, false)).toBe("other");
    expect(inviteJoinFailureReason(400, true)).toBe("other");
  });
});
