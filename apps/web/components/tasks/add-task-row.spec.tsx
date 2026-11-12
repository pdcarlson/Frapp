// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { AddTaskRow } from "./add-task-row";

/** An open gate: the row's controls are live. */
const gate = { controlProps: () => ({}) } as unknown as SubscriptionGate;

function open(onCreate = vi.fn().mockResolvedValue(true)) {
  render(
    <AddTaskRow
      members={[{ user_id: "u-1", display_name: "Rush Chair" }]}
      gate={gate}
      pending={false}
      onCreate={onCreate}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add a task" }));
  return onCreate;
}

describe("AddTaskRow's due time (#4512)", () => {
  it("offers Add a time under the due date", () => {
    open();
    expect(
      screen.getByRole("button", { name: "Add a time" }),
    ).toBeInTheDocument();
  });

  it("refuses a time already gone by, and creates nothing", async () => {
    const onCreate = open();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Sweep" },
    });
    // A day long past with a time: refused for the time, whatever the clock.
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Jan 6 2020 9am" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Add a task" }));
    // Every problem is flagged on the one submit, the past time included.
    expect(screen.getByText("Pick an assignee.")).toBeInTheDocument();
    expect(
      await screen.findByText(/That time has already passed/),
    ).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
