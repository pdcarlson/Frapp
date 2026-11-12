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
    expect(button).toHaveTextContent(/3 replies\s*last reply 5m ago/);
    expect(button).toHaveAttribute("data-slot", "thread-card");
    await userEvent.setup().click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says how many replies are new to the viewer (#4297)", () => {
    render(
      <ThreadChip summary={summary} nameFor={nameFor} unread={2} onOpen={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", {
        name: "3 replies, 2 new, last reply 5m ago. Open thread",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 new")).toBeInTheDocument();
  });

  it("shows nothing new when nothing is", () => {
    const { container } = render(
      <ThreadChip summary={summary} nameFor={nameFor} onOpen={vi.fn()} />,
    );
    expect(container.querySelector('[data-slot="thread-unread"]')).toBeNull();
  });

  it("draws each replier's face apart, with their initials or photo (#4297)", () => {
    const avatarFor = vi.fn((id: string) =>
      id === "u1" ? "https://example.test/p.png" : null,
    );
    const { container } = render(
      <ThreadChip
        summary={summary}
        nameFor={nameFor}
        avatarFor={avatarFor}
      />,
    );
    // A photo is asked for each replier (jsdom never loads one, so the
    // initials below are what it draws until it does).
    expect(avatarFor).toHaveBeenCalledWith("u1");
    expect(avatarFor).toHaveBeenCalledWith("u2");
    expect(screen.getByText("PC")).toBeInTheDocument();
    expect(screen.getByText("SK")).toBeInTheDocument();
    // Side by side, never stacked over one another.
    expect(container.innerHTML).not.toMatch(/-space-x-/);
  });

  it("gives way on a narrow card in order: the time, then the faces (#4297)", () => {
    // jsdom lays nothing out, so this pins the shrink factors that decide the
    // order; the widths themselves were measured in Chrome.
    const { container } = render(
      <ThreadChip summary={summary} nameFor={nameFor} unread={2} onOpen={vi.fn()} />,
    );
    const time = screen.getByText(/last reply/).parentElement!;
    const faces = screen.getByText("PC").closest("[aria-hidden]")!;
    // The time takes the shortfall first, by far.
    expect(time.className).toContain("shrink-[10000]");
    // The faces shrink by 1: under 1, flex hands out only that fraction of
    // what is left once the time is gone, and the row overflows the card.
    expect(faces.className).toMatch(/(^|\s)shrink(\s|$)/);
    // The count, "2 new" and the chevron never shrink.
    expect(screen.getByText("3 replies").className).toContain("shrink-0");
    expect(
      container.querySelector('[data-slot="thread-unread"]')!.className,
    ).toContain("shrink-0");
    expect(container.querySelector("svg.lucide-chevron-right")!.getAttribute("class")).toContain("shrink-0");
  });

  it("previews the latest reply under the count, capped in width (#4297)", () => {
    const { container } = render(
      <ThreadChip
        summary={summary}
        nameFor={nameFor}
        preview={{
          id: "r1",
          sender_id: "u2",
          content: "",
          kind: "text",
          attachment_count: 2,
          created_at: summary.last_reply_at,
        }}
        onOpen={vi.fn()}
      />,
    );
    const line = container.querySelector('[data-slot="thread-preview"]');
    // A file-only reply reads as the timeline's quote of it does.
    expect(line).toHaveTextContent("Shawn2 attachments");
    expect(
      container.querySelector('[data-slot="thread-card"]')?.className,
    ).toContain("max-w-[min(100%,26rem)]");
  });

  it("draws no preview line without one", () => {
    const { container } = render(
      <ThreadChip summary={summary} nameFor={nameFor} onOpen={vi.fn()} />,
    );
    expect(container.querySelector('[data-slot="thread-preview"]')).toBeNull();
  });

  it("is plain text where threads can't open", () => {
    render(<ThreadChip summary={summary} nameFor={nameFor} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("3 replies")).toBeInTheDocument();
  });
});
