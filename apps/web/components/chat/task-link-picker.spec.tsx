import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const tasksState = vi.hoisted(() => ({
  value: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: () => undefined,
  },
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    taskLinkChoices: actual.taskLinkChoices,
    useTasks: () => tasksState.value,
  };
});

import { TaskLinkPicker, TaskPlusView } from "./task-link-picker";

const TASKS = [
  {
    id: "t-door",
    title: "Fix the door",
    status: "TODO",
    due_date: "2099-01-01",
    assignee_id: "u1",
  },
  {
    id: "t-porch",
    title: "Sweep the porch",
    status: "TODO",
    due_date: "2099-01-02",
    assignee_id: "u2",
  },
];

function renderPicker(
  over: Partial<Parameters<typeof TaskLinkPicker>[0]> = {},
) {
  const props = {
    canCreate: false,
    nameOf: (id: string) => (id === "u1" ? "Moiz Khan" : "Paul Carlson"),
    onLink: vi.fn().mockResolvedValue({ ok: true }),
    onNew: vi.fn(),
    onDone: vi.fn(),
    ...over,
  };
  render(<TaskLinkPicker {...props} />);
  return props;
}

describe("TaskLinkPicker (#5772)", () => {
  it("links the picked task and closes", async () => {
    tasksState.value = { ...tasksState.value, data: TASKS };
    const props = renderPicker();
    await userEvent.click(screen.getByRole("button", { name: /Fix the door/ }));
    expect(props.onLink).toHaveBeenCalledWith({
      id: "t-door",
      title: "Fix the door",
    });
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
  });

  it("narrows on the typed words and says when nothing matches", async () => {
    tasksState.value = { ...tasksState.value, data: TASKS };
    renderPicker();
    await userEvent.type(screen.getByLabelText("Search tasks"), "porch");
    expect(screen.queryByText("Fix the door")).toBeNull();
    expect(screen.getByText("Sweep the porch")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search tasks"), "zzz");
    expect(screen.getByText('No tasks match "porchzzz"')).toBeInTheDocument();
  });

  it("keeps the card open and says why when the link is refused", async () => {
    tasksState.value = { ...tasksState.value, data: TASKS };
    const props = renderPicker({
      onLink: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "Access denied to this task" }),
    });
    await userEvent.click(screen.getByRole("button", { name: /Fix the door/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Access denied to this task",
    );
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it("offers New task only to a member who may create one", () => {
    tasksState.value = { ...tasksState.value, data: [] };
    renderPicker({ canCreate: false });
    expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
  });

  it("opens on the form when a task draft is waiting", () => {
    tasksState.value = { ...tasksState.value, data: TASKS };
    render(
      <TaskPlusView
        startNew
        canCreate
        nameOf={() => "Moiz Khan"}
        onLink={vi.fn()}
        onDone={vi.fn()}
        renderForm={() => <p>the task form</p>}
      />,
    );
    expect(screen.getByText("the task form")).toBeInTheDocument();
  });
});
