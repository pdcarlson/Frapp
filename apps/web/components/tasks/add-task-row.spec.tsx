// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { AddTaskRow } from "./add-task-row";

const photo = vi.hoisted(() => ({
  requestUrl: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: photo.requestUrl }),
  useTaskPhotoUrl: () => ({ data: undefined }),
  putSignedUpload: photo.put,
}));

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

describe("AddTaskRow's photo (#4565)", () => {
  it("uploads the photo first and creates the task with its path and the switch", async () => {
    photo.requestUrl.mockResolvedValue({
      upload_url: "https://upload",
      storage_path: "chapters/c/tasks/p/mess.jpg",
    });
    photo.put.mockResolvedValue(undefined);
    const onCreate = open();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Clean the kitchen" },
    });
    fireEvent.change(screen.getByTestId("task-photo-input"), {
      target: {
        files: [new File(["x"], "mess.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Photo required" }));
    // Assignee and due date are required; without them nothing is created,
    // and nothing is uploaded.
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await Promise.resolve();
    expect(photo.requestUrl).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("refuses a file that isn't a photo before any upload", () => {
    open();
    fireEvent.change(screen.getByTestId("task-photo-input"), {
      target: {
        files: [new File(["x"], "slip.pdf", { type: "application/pdf" })],
      },
    });
    expect(
      screen.getByText("Use a JPEG, PNG, GIF or WebP photo."),
    ).toBeInTheDocument();
    expect(photo.requestUrl).not.toHaveBeenCalled();
  });
});
