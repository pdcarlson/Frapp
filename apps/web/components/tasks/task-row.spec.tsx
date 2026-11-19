import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { TaskRow } from "./task-row";
import type { BoardTask } from "./board-task";

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const gate = { controlProps: () => ({}) } as unknown as SubscriptionGate;

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: "t-1",
    chapter_id: "c-1",
    title: "Clean the kitchen",
    description: null,
    assignee_id: "u-2",
    created_by: "u-1",
    due_date: "2026-11-23",
    status: "TODO",
    point_reward: null,
    points_awarded: false,
    completed_at: null,
    confirmed_at: null,
    created_at: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

function renderRow(value: BoardTask) {
  return render(
    <ul>
      <TaskRow
        task={value}
        person={{ name: "Jane Doe", avatarUrl: null, tint: null }}
        isMine={false}
        showStatus
        canConfirm={false}
        gate={gate}
        lifecycleWritePending={false}
        selected={false}
        onOpen={vi.fn()}
        onChangeStatus={vi.fn(async () => true)}
        onConfirm={vi.fn()}
      />
    </ul>,
  );
}

const subtask = (done: boolean) =>
  ({ done_at: done ? "2026-11-19T00:00:00.000Z" : null }) as NonNullable<
    BoardTask["subtasks"]
  >[number];

describe("TaskRow", () => {
  it("says how it repeats, its checklist and its photos, as the phone's row does (2026-11-19)", () => {
    renderRow(
      task({
        series: {
          recurrence_rule:
            "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=America/New_York",
          next_due_date: "2026-11-30",
          ended: false,
        },
        subtasks: [subtask(true), subtask(true), subtask(false)],
        photos: [{ kind: "reference" }] as BoardTask["photos"],
      }),
    );
    expect(screen.getByText("↻ Weekly · 2 of 3 · 1 photo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /clean the kitchen.*repeats weekly, 2 of 3, 1 photo/i,
      }),
    ).toBeInTheDocument();
  });

  it("drops them once the task is done, as the phone's row does", () => {
    renderRow(
      task({
        status: "COMPLETED",
        stored_status: "COMPLETED",
        completed_at: "2026-11-19T00:00:00.000Z",
        subtasks: [subtask(true)],
        photos: [{ kind: "reference" }] as BoardTask["photos"],
      }),
    );
    expect(screen.queryByText(/of \d|photo/)).not.toBeInTheDocument();
  });

  it("says nothing more for a task without them", () => {
    renderRow(task());
    expect(screen.queryByText(/of \d|photo|↻/)).not.toBeInTheDocument();
  });
});
