import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatMessage } from "@repo/chat-core/types";
import { SignupCard } from "./signup-card";

const names: Record<string, string> = {
  u1: "Devin Okafor",
  u2: "Julian Reyes",
};
const nameFor = (id: string) => names[id] ?? null;

function card(claims: { user: string; slots: string[] }[]): ChatMessage {
  return {
    id: "m1",
    channel_id: "c1",
    sender_id: "u9",
    content: "Sober drivers",
    kind: "signup",
    payload: {
      title: "Sober drivers",
      note: "10pm to 2am",
      slots: [
        { id: "fri", label: "Friday", capacity: 2 },
        { id: "sat", label: "Saturday", capacity: 1 },
      ],
    },
    actions: claims.map((claim, i) => ({
      id: `a${i}`,
      message_id: "m1",
      user_id: claim.user,
      action_type: "signup",
      payload: { slot_ids: claim.slots },
      created_at: `2026-11-12T10:0${i}:00Z`,
    })),
  } as unknown as ChatMessage;
}

describe("SignupCard (#3926)", () => {
  it("shows each slot's count and who holds it, and greys a full slot", () => {
    render(
      <SignupCard
        message={card([
          { user: "u1", slots: ["fri"] },
          { user: "u2", slots: ["sat"] },
        ])}
        viewerId="me"
        nameFor={nameFor}
        isConfirmed
        onClaim={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Sign-up · 2 of 3 spots taken"),
    ).toBeInTheDocument();
    expect(screen.getByText("10pm to 2am")).toBeInTheDocument();
    const friday = screen.getByText("Friday").closest("li")!;
    expect(within(friday).getByText("1/2")).toBeInTheDocument();
    expect(within(friday).getByText("Devin Okafor")).toBeInTheDocument();
    const saturday = screen.getByRole("button", { name: "Full: Saturday" });
    expect(saturday).toBeDisabled();
    // Full and not the viewer's: the row says so where its count would be,
    // and a reader still hears the count.
    expect(within(saturday).getByText("Full")).toBeInTheDocument();
    expect(saturday).toHaveAccessibleDescription("1 of 1 spot taken");
    expect(screen.getByText("2 people signed up")).toBeInTheDocument();
  });

  it("takes a slot with the viewer's whole list, and shows a held slot as theirs", async () => {
    const user = userEvent.setup();
    const onClaim = vi.fn();
    const { rerender } = render(
      <SignupCard
        message={card([])}
        viewerId="me"
        nameFor={nameFor}
        isConfirmed
        onClaim={onClaim}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sign up: Friday" }));
    expect(onClaim).toHaveBeenCalledWith("m1", "signup", { slot_ids: ["fri"] });

    rerender(
      <SignupCard
        message={card([{ user: "me", slots: ["fri"] }])}
        viewerId="me"
        nameFor={nameFor}
        isConfirmed
        onClaim={onClaim}
      />,
    );
    const held = screen.getByRole("button", { name: "Signed up: Friday" });
    expect(held).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("You're signed up for Friday")).toBeInTheDocument();
  });

  it("offers nothing on a card that hasn't reached the server", () => {
    render(
      <SignupCard
        message={card([])}
        viewerId="me"
        nameFor={nameFor}
        isConfirmed={false}
        onClaim={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Sign up: Friday" }),
    ).toBeDisabled();
  });
});
