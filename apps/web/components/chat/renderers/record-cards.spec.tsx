import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import { AnnouncementCard } from "./announcement-card";
import { PointsCard } from "./points-card";
import { SystemAuditCard } from "./system-audit-card";

/**
 * The read-only record cards that read nothing back: points, announcement and
 * audit (#3383). The payload readers are `@repo/chat-core/cards`, whose own
 * spec covers the malformed shapes; these cases cover what the cards say.
 */

function message(
  kind: string,
  payload: unknown,
  content = "the server's sentence",
): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "ch-1",
    sender_id: "user-1",
    content,
    kind,
    is_deleted: false,
    payload,
  } as unknown as ChatMessage;
}

const POINTS = {
  actor_name: "Alice",
  recipient_name: "Bob",
  amount: 5,
  category: "MANUAL",
  reason: "Ran the philanthropy table",
};

describe("PointsCard", () => {
  it("states a grant", () => {
    render(<PointsCard message={message("points", POINTS)} />);
    expect(screen.getByText("granted")).toBeInTheDocument();
    expect(screen.getByText("+5 points")).toHaveClass("text-success");
    expect(screen.getByText("to")).toBeInTheDocument();
    expect(screen.getByText(/Ran the philanthropy table/)).toBeInTheDocument();
  });

  it("states a deduction with the typographic minus", () => {
    render(
      <PointsCard
        message={message("points", { ...POINTS, amount: -1, category: "FINE" })}
      />,
    );
    expect(screen.getByText("deducted")).toBeInTheDocument();
    expect(screen.getByText("−1 point")).toHaveClass(
      "text-destructive-text",
    );
    expect(screen.getByText("from")).toBeInTheDocument();
  });

  it("draws no empty quotes for a blank reason", () => {
    const { container } = render(
      <PointsCard message={message("points", { ...POINTS, reason: "" })} />,
    );
    expect(container.textContent).not.toContain("“");
  });

  it("falls back to content for a payload it can't read", () => {
    render(<PointsCard message={message("points", { amount: "5" })} />);
    expect(screen.getByText("the server's sentence")).toBeInTheDocument();
  });
});

describe("AnnouncementCard", () => {
  it("draws content, the words the push showed, through the message markdown", () => {
    render(
      <AnnouncementCard
        message={message(
          "announcement",
          { body: "Something else entirely" },
          "Chapter at **8**, formal dress",
        )}
      />,
    );
    expect(screen.getByText("8").tagName).toBe("STRONG");
    expect(
      screen.queryByText("Something else entirely"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the payload body when content is empty", () => {
    render(
      <AnnouncementCard
        message={message("announcement", { body: "Dues are due" }, "")}
      />,
    );
    expect(screen.getByText("Dues are due")).toBeInTheDocument();
  });
});

describe("SystemAuditCard", () => {
  const AUDIT = {
    action: "role_updated",
    actor_user_id: "officer-1",
    diff: { permissions: {}, name: {} },
  };
  const nameFor = (id: string) => (id === "officer-1" ? "Alice" : null);

  it("names the actor from the roster, never by an id prefix", () => {
    render(
      <SystemAuditCard message={message("system_audit", AUDIT)} nameFor={nameFor} />,
    );
    expect(screen.getByText("role_updated")).toHaveClass("font-mono");
    expect(screen.getByText("by Alice")).not.toHaveClass("font-mono");
    expect(screen.queryByText(/officer/)).not.toBeInTheDocument();
    expect(screen.getByText("Changed: permissions, name")).toBeInTheDocument();
  });

  it("names the system Frapp and an unknown member by the fallback", () => {
    const { unmount } = render(
      <SystemAuditCard
        message={message("system_audit", {
          ...AUDIT,
          actor_user_id: SYSTEM_SENDER_ID,
        })}
        nameFor={nameFor}
      />,
    );
    expect(screen.getByText("by Frapp")).toBeInTheDocument();
    unmount();
    render(
      <SystemAuditCard
        message={message("system_audit", {
          ...AUDIT,
          actor_user_id: "9f8e7d6c-0000",
        })}
        nameFor={nameFor}
      />,
    );
    expect(screen.getByText("by Member 9f8e7d")).toBeInTheDocument();
  });

  it("says when nothing changed, and draws no actor for a system row", () => {
    const { container } = render(
      <SystemAuditCard
        message={message("system_audit", {
          action: "chapter_config_updated",
          diff: {},
        })}
        nameFor={nameFor}
      />,
    );
    expect(screen.getByText("No field changes recorded")).toBeInTheDocument();
    expect(container.textContent).not.toContain("by ");
  });

  it("draws a server notice with no payload as its sentence, in the body face", () => {
    render(
      <SystemAuditCard
        message={message("system_audit", null, "This poll has closed.")}
        nameFor={nameFor}
      />,
    );
    const notice = screen.getByText("This poll has closed.");
    expect(notice).not.toHaveClass("font-mono");
    expect(screen.queryByText("Audit")).not.toBeInTheDocument();
  });
});
