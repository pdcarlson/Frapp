import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyPollDraft, pollDraftFromArgs } from "@repo/chat-core/poll-draft";
import { PollForm } from "./poll-form";

const NOW = new Date("2026-11-09T12:00:00Z");

describe("PollForm (#3865, #3983)", () => {
  it("posts the card /poll would, closing a day out by default", async () => {
    const user = userEvent.setup();
    const onPost = vi.fn(async () => ({ ok: true as const }));
    const onDone = vi.fn();
    render(
      <PollForm
        canCloseEarly
        onDone={onDone}
        onDiscard={vi.fn()}
        initialDraft={emptyPollDraft()}
        onPost={onPost}
        now={() => NOW}
      />,
    );
    const post = screen.getByRole("button", { name: "Post poll" });
    expect(post).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Ask a question"), "Who drives?");
    await user.type(screen.getByLabelText("Option 1"), "Sam");
    await user.type(screen.getByLabelText("Option 2"), "Alex");
    await user.click(post);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [poll] = onPost.mock.calls[0] as unknown as [
      { content: string; payload: { options: { label: string }[]; closes_at: string } },
    ];
    expect(poll.content).toBe("Who drives?");
    expect(poll.payload.options.map((option) => option.label)).toEqual([
      "Sam",
      "Alex",
    ]);
    expect(poll.payload.closes_at).toBe("2026-11-10T12:00:00.000Z");
  });

  it("posts a poll with no deadline for Doesn't close (#3896)", async () => {
    const user = userEvent.setup();
    const onPost = vi.fn(async () => ({ ok: true as const }));
    const onDone = vi.fn();
    render(
      <PollForm
        canCloseEarly
        onDone={onDone}
        onDiscard={vi.fn()}
        initialDraft={pollDraftFromArgs('"Standing lunch?" Subs Pizza')}
        onPost={onPost}
        now={() => NOW}
      />,
    );
    const closes = screen.getByRole("combobox", { name: "Voting closes in" });
    // A day stays the default; Doesn't close is the last choice offered.
    expect(closes).toHaveTextContent("1 day");
    await user.click(closes);
    await user.click(screen.getByRole("option", { name: "Doesn't close" }));
    await user.click(screen.getByRole("button", { name: "Post poll" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [poll] = onPost.mock.calls[0] as unknown as [
      { payload: { closes_at: string | null } },
    ];
    expect(poll.payload.closes_at).toBeNull();
  });

  it("posts a single-choice card unless more than one choice is allowed (#3793)", async () => {
    const user = userEvent.setup();
    const onPost = vi.fn(async () => ({ ok: true as const }));
    const draft = () => pollDraftFromArgs('"Which days?" Fri Sat');
    const { unmount } = render(
      <PollForm
        onDone={vi.fn()}
        onDiscard={vi.fn()}
        initialDraft={draft()}
        onPost={onPost}
        canCloseEarly
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: "Allow more than one choice",
    });
    expect(toggle).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Post poll" }));
    await waitFor(() => expect(onPost).toHaveBeenCalledTimes(1));
    unmount();

    render(
      <PollForm
        onDone={vi.fn()}
        onDiscard={vi.fn()}
        initialDraft={draft()}
        onPost={onPost}
        canCloseEarly
      />,
    );
    await user.click(
      screen.getByRole("switch", { name: "Allow more than one choice" }),
    );
    await user.click(screen.getByRole("button", { name: "Post poll" }));
    await waitFor(() => expect(onPost).toHaveBeenCalledTimes(2));

    const payloads = (
      onPost.mock.calls as unknown as [{ payload: Record<string, unknown> }][]
    ).map(([poll]) => poll.payload);
    expect(payloads[0]).not.toHaveProperty("choice_mode");
    expect(payloads[1]!.choice_mode).toBe("multi");
  });

  it("withholds Doesn't close from a member who couldn't close the poll", async () => {
    render(
      <PollForm
        onDone={vi.fn()}
        onDiscard={vi.fn()}
        initialDraft={emptyPollDraft()}
        onPost={vi.fn()}
        canCloseEarly={false}
      />,
    );
    await userEvent.click(
      screen.getByRole("combobox", { name: "Voting closes in" }),
    );
    const choices = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(choices).toEqual(["1 hour", "1 day", "3 days", "1 week"]);
  });

  it("opens on what was typed after /poll", () => {
    render(
      <PollForm
        canCloseEarly
        onDone={vi.fn()}
        onDiscard={vi.fn()}
        initialDraft={pollDraftFromArgs('"Who drives?" Sam')}
        onPost={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("Ask a question")).toHaveValue(
      "Who drives?",
    );
    expect(screen.getByLabelText("Option 1")).toHaveValue("Sam");
  });

  it("refuses two options that say the same thing", async () => {
    const user = userEvent.setup();
    render(
      <PollForm
        canCloseEarly
        onDone={vi.fn()}
        onDiscard={vi.fn()}
        initialDraft={pollDraftFromArgs('"Q" Yes yes')}
        onPost={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/same thing/);
    expect(screen.getByRole("button", { name: "Post poll" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Option 2"));
    await user.type(screen.getByLabelText("Option 2"), "No");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the draft and says why when the outbox refuses the card", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(
      <PollForm
        canCloseEarly
        onDone={onDone}
        onDiscard={vi.fn()}
        initialDraft={pollDraftFromArgs('"Q" A B')}
        onPost={async () => ({ ok: false as const, error: "Couldn't post that poll. Try again." })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Post poll" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't post that poll",
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Ask a question")).toHaveValue("Q");
  });
});
