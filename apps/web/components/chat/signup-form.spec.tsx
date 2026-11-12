import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  emptySignupDraft,
  SIGNUP_END_PASSED_PROBLEM,
  SIGNUP_SPOTS_PROBLEM,
} from "@repo/chat-core/signups";
import { SignupForm } from "./signup-form";

describe("SignupForm (#3926)", () => {
  it("posts the card with each slot's spots, blank as no limit", async () => {
    const user = userEvent.setup();
    const onPost = vi.fn(async () => ({ ok: true as const }));
    const onDone = vi.fn();
    render(
      <SignupForm
        initialDraft={emptySignupDraft()}
        onPost={onPost}
        onDone={onDone}
        onDiscard={vi.fn()}
      />,
    );
    const post = screen.getByRole("button", { name: "Post sign-up" });
    expect(post).toBeDisabled();
    await user.type(
      screen.getByPlaceholderText("Sober drivers this weekend"),
      "Sober drivers",
    );
    await user.type(screen.getByLabelText("Slot 1 name"), "Friday");
    await user.type(screen.getByLabelText("Slot 1 spots"), "2");
    await user.type(screen.getByLabelText("Slot 2 name"), "Saturday");
    await user.click(post);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [signup] = onPost.mock.calls[0] as unknown as [
      {
        content: string;
        payload: { slots: { label: string; capacity: number | null }[] };
      },
    ];
    expect(signup.content).toBe("Sober drivers");
    expect(
      signup.payload.slots.map(({ label, capacity }) => ({ label, capacity })),
    ).toEqual([
      { label: "Friday", capacity: 2 },
      { label: "Saturday", capacity: null },
    ]);
  });

  it("names a bad Spots value and holds Post", async () => {
    const user = userEvent.setup();
    render(
      <SignupForm
        initialDraft={emptySignupDraft()}
        onPost={vi.fn()}
        onDone={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await user.type(
      screen.getByPlaceholderText("Sober drivers this weekend"),
      "T",
    );
    await user.type(screen.getByLabelText("Slot 1 name"), "Friday");
    await user.type(screen.getByLabelText("Slot 1 spots"), "0");

    expect(screen.getByRole("alert")).toHaveTextContent(SIGNUP_SPOTS_PROBLEM);
    expect(screen.getByLabelText("Slot 1 spots")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("button", { name: "Post sign-up" })).toBeDisabled();
  });

  it("keeps what the outbox refused, and says so", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(
      <SignupForm
        initialDraft={emptySignupDraft()}
        onPost={async () => ({ ok: false as const, error: "Couldn't post." })}
        onDone={onDone}
        onDiscard={vi.fn()}
      />,
    );
    await user.type(
      screen.getByPlaceholderText("Sober drivers this weekend"),
      "T",
    );
    await user.type(screen.getByLabelText("Slot 1 name"), "A");
    await user.click(screen.getByRole("button", { name: "Post sign-up" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't post.",
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Slot 1 name")).toHaveValue("A");
  });

  it("posts a headcount with an end time, and no slots to fill in", async () => {
    const user = userEvent.setup();
    const onPost = vi.fn(async () => ({ ok: true as const }));
    render(
      <SignupForm
        initialDraft={emptySignupDraft()}
        onPost={onPost}
        onDone={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Headcount" }));
    expect(screen.queryByLabelText("Slot 1 name")).toBeNull();
    await user.type(
      screen.getByPlaceholderText("Formal on Saturday"),
      "Formal",
    );
    await user.click(
      screen.getByRole("switch", { name: "Ends at a set time" }),
    );
    expect(screen.getByLabelText("Ends, time")).toHaveValue("18:00");
    await user.click(screen.getByRole("button", { name: "Post sign-up" }));

    await waitFor(() => expect(onPost).toHaveBeenCalled());
    const [signup] = onPost.mock.calls[0] as unknown as [
      { payload: { format?: string; closes_at?: string; slots: unknown[] } },
    ];
    expect(signup.payload.format).toBe("headcount");
    expect(signup.payload.slots).toHaveLength(2);
    expect(new Date(signup.payload.closes_at!).getHours()).toBe(18);
  });

  it("checks the end time again at Post, so a form left open can't post a closed card", async () => {
    const user = userEvent.setup();
    const onPost = vi.fn(async () => ({ ok: true as const }));
    render(
      <SignupForm
        initialDraft={emptySignupDraft()}
        onPost={onPost}
        onDone={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Headcount" }));
    await user.type(
      screen.getByPlaceholderText("Formal on Saturday"),
      "Formal",
    );
    await user.click(
      screen.getByRole("switch", { name: "Ends at a set time" }),
    );

    // Two days pass with the form open and nothing edited: tomorrow's end
    // time is now behind us.
    const later = Date.now() + 2 * 24 * 60 * 60 * 1000;
    const now = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      await user.click(screen.getByRole("button", { name: "Post sign-up" }));
      expect(onPost).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        SIGNUP_END_PASSED_PROBLEM,
      );
    } finally {
      now.mockRestore();
    }
  });
});
