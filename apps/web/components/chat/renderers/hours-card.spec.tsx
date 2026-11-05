import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  live: undefined as unknown,
  entryIds: [] as string[],
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  // The real hook is disabled on an empty id, so an empty id reads nothing.
  useServiceEntry: (id: string) => {
    state.entryIds.push(id);
    return { data: id ? state.live : undefined };
  },
  useMyPermissions: () => ({ data: { permissions: state.permissions } }),
}));

import { HoursCard } from "./hours-card";

const OWNER = "user-1";
const OFFICER = "officer-1";

function makeMessage(
  payloadOverrides: Record<string, unknown> | null = {},
): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "ch-1",
    sender_id: OWNER,
    content: "Alice logged 1h of service on 2026-02-26: Community cleanup",
    kind: "hours",
    is_deleted: false,
    payload:
      payloadOverrides === null
        ? null
        : {
            entry_id: "se-1",
            user_id: OWNER,
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

beforeEach(() => {
  // Every member role carries members:view, which the entry route requires.
  state.permissions = ["members:view"];
  state.live = undefined;
  state.entryIds = [];
});

describe("HoursCard", () => {
  it("renders the member, duration, the day, and description", () => {
    render(<HoursCard message={makeMessage()} viewerId={OWNER} />);

    expect(screen.getByText("Service hours")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("1h")).toBeInTheDocument();
    // The stored day in the viewer's locale, never the raw column, spelled
    // as mobile's card spells it.
    expect(
      screen.getByText(
        new Date(2026, 1, 26, 12).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("2026-02-26")).not.toBeInTheDocument();
    expect(screen.getByText(/Community cleanup/)).toBeInTheDocument();
  });

  it("draws no badge before the entry is read, never the snapshot's Pending", () => {
    render(<HoursCard message={makeMessage()} viewerId={OWNER} />);
    expect(state.entryIds).toContain("se-1");
    expect(screen.queryByText("Pending review")).not.toBeInTheDocument();
  });

  it("draws the live review status for the member who logged it", () => {
    state.live = { id: "se-1", status: "APPROVED" };
    render(<HoursCard message={makeMessage()} viewerId={OWNER} />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("draws a rejection in the destructive badge", () => {
    state.live = { id: "se-1", status: "REJECTED" };
    render(<HoursCard message={makeMessage()} viewerId={OWNER} />);
    expect(screen.getByText("Rejected").className).toContain(
      "text-destructive-text",
    );
  });

  it("reads it for a service:approve holder too", () => {
    state.permissions = ["members:view", "service:approve"];
    state.live = { id: "se-1", status: "PENDING" };
    render(<HoursCard message={makeMessage()} viewerId={OFFICER} />);
    expect(screen.getByText("Pending review")).toBeInTheDocument();
  });

  it("asks nothing for anyone else, who would get a 403, and draws no badge", () => {
    state.live = { id: "se-1", status: "REJECTED" };
    render(<HoursCard message={makeMessage()} viewerId={OFFICER} />);
    expect(state.entryIds.every((id) => id === "")).toBe(true);
    expect(screen.queryByText("Rejected")).not.toBeInTheDocument();
  });

  it("asks nothing without members:view, which the route requires first", () => {
    state.permissions = ["service:approve"];
    state.live = { id: "se-1", status: "APPROVED" };
    render(<HoursCard message={makeMessage()} viewerId={OWNER} />);
    expect(state.entryIds.every((id) => id === "")).toBe(true);
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
  });

  it("draws no empty quotes for a blank description", () => {
    render(
      <HoursCard message={makeMessage({ description: "  " })} viewerId={OWNER} />,
    );
    expect(screen.queryByText(/\u201c/)).not.toBeInTheDocument();
  });

  it("falls back to content when the payload is missing", () => {
    render(<HoursCard message={makeMessage(null)} viewerId={OWNER} />);

    expect(screen.getByText(/Alice logged 1h of service/)).toBeInTheDocument();
    expect(state.entryIds.every((id) => id === "")).toBe(true);
  });

  it("falls back to content when duration_minutes is not a number", () => {
    render(
      <HoursCard
        message={makeMessage({ duration_minutes: "sixty" })}
        viewerId={OWNER}
      />,
    );

    expect(screen.getByText(/Alice logged 1h of service/)).toBeInTheDocument();
  });
});
