import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// usingPreviewData renders from the `event` prop and gates out AttendancePanel;
// stub the live hooks so the sheet renders without a query client / API.
vi.mock("@repo/hooks", () => ({
  useEvent: () => ({ data: undefined, isLoading: false, isError: false }),
  useDeleteEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoles: () => ({ data: [{ id: "r1", name: "Exec" }], isError: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/events/attendance-panel", () => ({
  AttendancePanel: () => null,
}));

import { EventDetailSheet } from "./event-detail-sheet";

const baseEvent = {
  id: "e1",
  name: "Exec Sync",
  start_time: "2026-07-01T18:00:00.000Z",
  end_time: "2026-07-01T19:00:00.000Z",
};

describe("EventDetailSheet role targeting", () => {
  it("resolves and renders required role names for a targeted event", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{ ...baseEvent, required_role_ids: ["r1"] }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    expect(screen.getByText("Required roles")).toBeInTheDocument();
    expect(screen.getByText("Exec")).toBeInTheDocument();
    expect(screen.queryByText("All members")).not.toBeInTheDocument();
  });

  it("shows 'All members' when the event targets no roles", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{ ...baseEvent, required_role_ids: [] }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    expect(screen.getByText("All members")).toBeInTheDocument();
  });
});
