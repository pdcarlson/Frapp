import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  askForNewLinkCopy,
  deadInviteCopy,
  inviteCardLine,
  inviterFirstName,
  type InviteDetails,
} from "./invite-card";
import { useAskForNewLink, useInviteDetails } from "./use-invites";
import { createHookWrapper } from "./test-utils";

/**
 * #5625. The card a visitor sees before they have an account: who invited
 * them, to what, and, for a dead link, whom to ask for a new one.
 */

function wrapperFor(client: unknown) {
  const queryClient = new QueryClient();
  return createHookWrapper({ client, queryClient, displayName: "Wrapper" });
}

const DETAILS: InviteDetails = {
  chapter_name: "Phi Gamma Delta",
  university: "Rensselaer Polytechnic Institute",
  mark_text: "FIJI",
  accent_color: null,
  invited_by: "Paul Carlson",
  role: null,
  expires_at: "2026-11-26T20:00:00.000Z",
  state: "live",
  chapter_id: "00000000-0000-4000-8000-000000000001",
  member_count: 41,
  sent_at: "2026-11-14T20:00:00.000Z",
};

describe("useInviteDetails (#5625)", () => {
  it("asks nothing until there is an invite", () => {
    const POST = vi.fn();
    const { result } = renderHook(() => useInviteDetails(null), {
      wrapper: wrapperFor({ POST }),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(POST).not.toHaveBeenCalled();
  });

  it("sends the token in the body and returns the card", async () => {
    const POST = vi.fn().mockResolvedValue({ data: DETAILS, error: undefined });
    const { result } = renderHook(() => useInviteDetails("token-1"), {
      wrapper: wrapperFor({ POST }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(POST).toHaveBeenCalledWith("/v1/invites/details", {
      signal: expect.any(AbortSignal),
      body: { token: "token-1" },
    });
    expect(result.current.data).toEqual(DETAILS);
  });

  it("doesn't retry a link that was never an invite", async () => {
    const POST = vi.fn().mockResolvedValue({
      data: undefined,
      error: { statusCode: 404, message: "Invite not found" },
    });
    const { result } = renderHook(() => useInviteDetails("nope"), {
      wrapper: wrapperFor({ POST }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(POST).toHaveBeenCalledTimes(1);
  });
});

describe("useAskForNewLink (#5625)", () => {
  it("posts the token", async () => {
    const POST = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: undefined });
    const { result } = renderHook(() => useAskForNewLink(), {
      wrapper: wrapperFor({ POST }),
    });
    await act(() => result.current.mutateAsync("token-1"));
    expect(POST).toHaveBeenCalledWith("/v1/invites/ask-for-new-link", {
      body: { token: "token-1" },
    });
  });
});

describe("the invite card's words (#5625)", () => {
  it("names the sender and the chapter's size", () => {
    expect(inviteCardLine(DETAILS)).toBe(
      "Paul Carlson invited you · 41 members",
    );
    expect(inviteCardLine({ invited_by: null, member_count: 1 })).toBe(
      "1 member",
    );
    expect(
      inviteCardLine({ invited_by: "Paul Carlson", member_count: 0 }),
    ).toBe("Paul Carlson invited you");
  });

  it("asks the sender by first name", () => {
    expect(inviterFirstName(DETAILS)).toBe("Paul");
    expect(inviterFirstName({ invited_by: "  " })).toBeNull();
    expect(deadInviteCopy({ ...DETAILS, state: "expired" })).toEqual({
      title: "This invite has expired",
      sent: "Paul Carlson sent it on Saturday, November 14",
      body: "Invite links stop working after a week so they can't spread. Ask Paul for a new one.",
      ask: "Ask Paul for a new link",
    });
    expect(askForNewLinkCopy(DETAILS).hint).toBe(
      "Paul gets a notification with your name.",
    );
  });

  it.each([
    ["used", "This invite was already used"],
    ["off", "This invite was turned off"],
  ] as const)("says why a %s link stopped working", (state, title) => {
    expect(deadInviteCopy({ ...DETAILS, state }).title).toBe(title);
  });

  it("still reads when the sender's profile is gone", () => {
    const copy = deadInviteCopy({
      ...DETAILS,
      invited_by: null,
      state: "expired",
    });
    expect(copy.sent).toBeNull();
    expect(copy.ask).toBe("Ask for a new link");
    expect(copy.body).toContain("Ask the officer who sent it for a new one.");
  });
});
