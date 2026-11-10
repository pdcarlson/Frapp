import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThreadChip } from "./thread-chip";

const summary = {
  reply_count: 3,
  last_reply_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  recent_sender_ids: ["u1", "u2"],
};
const nameFor = (id: string) => (id === "u1" ? "Paul Carlson" : "Shawn Klein");

describe("ThreadChip (#3785)", () => {
  it("says how many replies and when the last one was, and opens the thread", async () => {
    const onOpen = vi.fn();
    render(<ThreadChip summary={summary} nameFor={nameFor} onOpen={onOpen} />);
    const button = screen.getByRole("button", {
      name: "3 replies, last reply 5m ago. Open thread",
    });
    expect(screen.getByText("3 replies")).toBeInTheDocument();
    expect(button).toHaveTextContent(/3 replies\s*· last reply 5m ago/);
    await userEvent.setup().click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("is plain text where threads can't open", () => {
    render(<ThreadChip summary={summary} nameFor={nameFor} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("3 replies")).toBeInTheDocument();
  });
});
