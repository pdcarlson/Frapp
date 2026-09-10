import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HoursCard } from "./hours-card";
import type { ChatMessage } from "@repo/chat-core/types";

function makeMessage(
  payloadOverrides: Record<string, unknown> | null = {},
): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "ch-1",
    sender_id: "user-1",
    content: "Alice logged 1h of service on 2026-02-26: Community cleanup",
    kind: "hours",
    is_deleted: false,
    payload:
      payloadOverrides === null
        ? null
        : {
            entry_id: "se-1",
            user_id: "user-1",
            user_name: "Alice",
            duration_minutes: 60,
            description: "Community cleanup",
            date: "2026-02-26",
            status: "PENDING",
            created_at: "2026-02-26T10:00:00.000Z",
            ...payloadOverrides,
          },
  } as unknown as ChatMessage;
}

describe("HoursCard", () => {
  it("renders the member, duration, date, and description", () => {
    render(<HoursCard message={makeMessage()} />);

    expect(screen.getByText("Service hours")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("1h")).toBeInTheDocument();
    expect(screen.getByText("2026-02-26")).toBeInTheDocument();
    expect(screen.getByText(/Community cleanup/)).toBeInTheDocument();
    expect(screen.getByText("Pending review")).toBeInTheDocument();
  });

  it("falls back to content when the payload is missing", () => {
    render(<HoursCard message={makeMessage(null)} />);

    expect(screen.getByText(/Alice logged 1h of service/)).toBeInTheDocument();
    expect(screen.queryByText("Pending review")).not.toBeInTheDocument();
  });

  it("falls back to content when duration_minutes is not a number", () => {
    render(
      <HoursCard
        message={makeMessage({ duration_minutes: "sixty" })}
      />,
    );

    expect(screen.getByText(/Alice logged 1h of service/)).toBeInTheDocument();
  });
});
