import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { selectCalendarTasks } from "@repo/hooks/calendar-tasks";
import { AgendaTaskRow, CalendarTaskChip } from "./calendar-tasks";

/*
 * A task's card (#4144), opened from its agenda row or its hour-grid chip:
 * where it stands and, for one the viewer handed to many, each assignee's
 * status, with the way to Tasks.
 */

const items = selectCalendarTasks(
  [
    {
      id: "t-mine",
      title: "Clean the kitchen",
      assignee_id: "me",
      created_by: "officer",
      due_date: "2026-11-06",
      status: "OVERDUE",
    },
    ...["m1", "m2", "m3"].map((assignee, index) => ({
      id: `t-${assignee}`,
      title: "Dues form",
      assignee_id: assignee,
      created_by: "me",
      due_date: "2026-11-06",
      status: index === 0 ? "COMPLETED" : "TODO",
    })),
  ],
  "me",
);
const [mine, assigned] = items;
const nameOf = (id: string) =>
  ({ m1: "Sam Lee", m2: "Ana Ruiz", m3: "Jo Park", officer: "Marcus" })[id] ??
  "A member";

describe("the task card", () => {
  it("lists each assignee's status for a task handed to many", async () => {
    render(<AgendaTaskRow item={assigned!} nameOf={nameOf} />);
    const row = screen.getByRole("button", {
      name: "Dues form, assigned by you, 1 of 3 done",
    });
    expect(row).toHaveTextContent("1 of 3 done");

    fireEvent.click(row);
    expect(await screen.findByText("Sam Lee")).toBeInTheDocument();
    expect(screen.getByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.getByText("Jo Park")).toBeInTheDocument();
    expect(screen.getByText("Waiting on an officer")).toBeInTheDocument();
    expect(screen.getAllByText("To do")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open Tasks" })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });

  it("says who assigned the viewer's own task, from the hour grid's chip", async () => {
    render(<CalendarTaskChip item={mine!} nameOf={nameOf} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Clean the kitchen, your task, overdue",
      }),
    );
    expect(await screen.findByText("Assigned by Marcus")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });
});
