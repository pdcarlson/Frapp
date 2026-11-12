import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@repo/hooks";

/*
 * The panel around chat's own cards: what it adds beside a card. The cards
 * themselves are chat's and are tested there, so they are stubbed here.
 */

vi.mock("@/components/chat/renderers/event-card", () => ({
  EventCard: () => <div data-testid="event-card" />,
}));
vi.mock("@/components/chat/renderers/hours-card", () => ({
  HoursCard: () => null,
}));
vi.mock("@/components/chat/renderers/poll-card", () => ({
  PollCard: () => null,
}));
vi.mock("@/components/chat/renderers/task-card", () => ({
  TaskCard: () => null,
}));
vi.mock("@/components/service/use-service-review", () => ({
  useServiceReview: () => ({}),
}));
vi.mock("@/components/shared/subscription-gate", () => ({
  SubscriptionNotice: () => null,
  useSubscriptionGate: () => ({ controlProps: () => ({}) }),
}));
vi.mock("./use-activity-poll", () => ({ useActivityPoll: () => ({}) }));

import { ActivityPanel } from "./activity-panel";

const eventRow = {
  kind: "event",
  key: "made:event:evt-9",
  title: "Spring formal",
  detail: "",
  badge: null,
  event: {
    id: "evt-9",
    name: "Spring formal",
    location: "Hotel",
    start_time: "2099-12-05T01:00:00.000Z",
    end_time: "2099-12-05T05:00:00.000Z",
    attendance: "optional",
    point_value: 10,
    check_in_opens_minutes: 10,
    check_in_open: false,
    checked_in: null,
  },
} as unknown as ActivityRow;

describe("ActivityPanel: an event", () => {
  it("draws chat's event card and links to the event on the Events page", () => {
    render(
      <ActivityPanel
        row={eventRow}
        viewerId="user-1"
        onClose={() => {}}
        onActed={() => {}}
      />,
    );

    expect(screen.getByTestId("event-card")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open in Events" }).getAttribute("href"),
    ).toBe("/events?event=evt-9");
  });
});

describe("ActivityPanel docked (#4593)", () => {
  it("opens in place of the Activity page beside chat, and goes back with the arrow", () => {
    const onClose = vi.fn();
    render(
      <div data-tool-column="">
        <div data-tool-page="" />
        <ActivityPanel
          row={eventRow}
          viewerId="user-1"
          onClose={onClose}
          onActed={() => {}}
        />
      </div>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const region = screen.getByRole("region", { name: "Event" });
    expect(region.parentElement).toHaveAttribute("data-tool-column");
    fireEvent.click(screen.getByRole("button", { name: "Back to activity" }));
    expect(onClose).toHaveBeenCalled();
  });
});
