import { renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { useInviteCardViewed, useInviteFunnel } from "./use-invite-funnel";
import { joinRedeemBody } from "./legal-acceptance";
import { createHookWrapper } from "./test-utils";

/** #5663. The invite card funnel, shared by web `/join` and the phone. */

const VISIT = "6f1c2a34-9b8d-4e5f-a1b2-c3d4e5f60718";

function wrapperFor(client: unknown) {
  return createHookWrapper({
    client,
    queryClient: new QueryClient(),
    displayName: "Wrapper",
  });
}

describe("useInviteFunnel", () => {
  it("posts a step with the token and the visit", () => {
    const POST = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useInviteFunnel("tok-1", VISIT), {
      wrapper: wrapperFor({ POST }),
    });

    result.current({ step: "sign-in-started", method: "apple" });

    expect(POST).toHaveBeenCalledWith("/v1/invites/funnel", {
      body: {
        token: "tok-1",
        visit_id: VISIT,
        step: "sign-in-started",
        method: "apple",
      },
    });
  });

  it("sends nothing without a visit, and never throws on a failed post", async () => {
    const POST = vi.fn().mockRejectedValue(new Error("offline"));
    const { result: noVisit } = renderHook(
      () => useInviteFunnel("tok-1", null),
      { wrapper: wrapperFor({ POST }) },
    );
    noVisit.current({ step: "card-viewed" });
    expect(POST).not.toHaveBeenCalled();

    const { result } = renderHook(() => useInviteFunnel("tok-1", VISIT), {
      wrapper: wrapperFor({ POST }),
    });
    expect(() => result.current({ step: "email-code-sent" })).not.toThrow();
    await Promise.resolve();
  });
});

describe("useInviteCardViewed", () => {
  it("records each state the card shows once, and nothing while it loads", () => {
    const record = vi.fn();
    type View = { state: "live" | "used"; signed_in: boolean } | null;
    const { rerender } = renderHook(
      ({ view }: { view: View }) => useInviteCardViewed(record, view),
      { initialProps: { view: null as View } },
    );
    expect(record).not.toHaveBeenCalled();

    rerender({ view: { state: "live", signed_in: false } });
    rerender({ view: { state: "live", signed_in: false } });
    rerender({ view: { state: "live", signed_in: true } });
    rerender({ view: { state: "used", signed_in: true } });

    expect(record.mock.calls.map(([input]) => input)).toEqual([
      { step: "card-viewed", state: "live", signed_in: false },
      { step: "card-viewed", state: "live", signed_in: true },
      { step: "card-viewed", state: "used", signed_in: true },
    ]);
  });
});

describe("joinRedeemBody", () => {
  it("carries the visit only when there is one", () => {
    expect(joinRedeemBody("tok-1")).toEqual({
      token: "tok-1",
      accept_terms_privacy: true,
    });
    expect(joinRedeemBody("tok-1", VISIT)).toEqual({
      token: "tok-1",
      accept_terms_privacy: true,
      visit_id: VISIT,
    });
  });
});
