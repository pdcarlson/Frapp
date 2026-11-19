import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/shared/subscription-gate", () => ({
  SubscriptionNotice: () => null,
  useSubscriptionGate: () => ({
    controlProps: () => ({ disabled: false }),
    noticeRef: { current: null },
  }),
}));

import { EventQuickForm } from "./event-quick-form";

function renderForm() {
  const onPost = vi.fn().mockResolvedValue({ ok: true });
  render(
    <EventQuickForm
      initialDraft={{
        name: "Chapter",
        date: "2026-11-20",
        startTime: "19:00",
        endTime: "20:30",
      }}
      onPost={onPost}
      onMoreOptions={vi.fn()}
      onDone={vi.fn()}
      onDiscard={vi.fn()}
    />,
  );
  return onPost;
}

/** The + card's Event form picks times the way the full editor does. */
describe("EventQuickForm times", () => {
  it("uses the typed time fields, not the browser's spinner", () => {
    renderForm();
    expect(screen.getByLabelText("Starts")).not.toHaveAttribute("type", "time");
    expect(screen.getByLabelText("Ends")).toHaveValue("8:30 PM");
  });

  it("keeps the event's length when the start moves", () => {
    renderForm();
    const start = screen.getByLabelText("Starts");
    fireEvent.pointerDown(start);
    fireEvent.click(screen.getByRole("option", { name: "6 PM" }));
    expect(screen.getByLabelText("Ends")).toHaveValue("7:30 PM");
  });

  it("leaves the end alone when keeping the length would pass midnight", () => {
    renderForm();
    const start = screen.getByLabelText("Starts");
    fireEvent.pointerDown(start);
    fireEvent.click(screen.getByRole("option", { name: "11 PM" }));
    expect(screen.getByLabelText("Ends")).toHaveValue("8:30 PM");
  });
});
