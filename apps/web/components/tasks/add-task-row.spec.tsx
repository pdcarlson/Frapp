// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

// jsdom has no object URLs; a picked photo's preview only needs a string.
URL.createObjectURL = () => "blob:preview";
URL.revokeObjectURL = () => undefined;

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

describe("AddTaskRow's photos (#4565, #4635)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads nothing while the task still lacks an assignee and a due date", async () => {
    photo.requestUrl.mockResolvedValue({
      upload_url: "https://upload",
      storage_path: "chapters/c/tasks/p/mess.jpg",
    });
    photo.put.mockResolvedValue(undefined);
    const onCreate = open();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Clean the kitchen" },
    });
    fireEvent.change(screen.getByTestId("add-task-photos-input"), {
      target: {
        files: [
          new File(["x"], "mess.jpg", { type: "image/jpeg" }),
          new File(["y"], "sink.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Photo" }));
    // Assignee and due date are required; without them nothing is created,
    // and nothing is uploaded.
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await Promise.resolve();
    expect(photo.requestUrl).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("refuses a file that isn't a photo before any upload", () => {
    open();
    fireEvent.change(screen.getByTestId("add-task-photos-input"), {
      target: {
        files: [new File(["x"], "slip.pdf", { type: "application/pdf" })],
      },
    });
    expect(
      screen.getByText("Use a JPEG, PNG, GIF or WebP photo."),
    ).toBeInTheDocument();
    expect(photo.requestUrl).not.toHaveBeenCalled();
  });

  it("uploads each photo and creates with their paths and the proof kind", async () => {
    photo.requestUrl
      .mockResolvedValueOnce({
        upload_url: "https://upload/1",
        storage_path: "chapters/c/tasks/p/mess.jpg",
      })
      .mockResolvedValueOnce({
        upload_url: "https://upload/2",
        storage_path: "chapters/c/tasks/p/sink.jpg",
      });
    photo.put.mockResolvedValue(undefined);
    const onCreate = open();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Clean the kitchen" },
    });
    fireEvent.change(screen.getByTestId("add-task-photos-input"), {
      target: {
        files: [
          new File(["x"], "mess.jpg", { type: "image/jpeg" }),
          new File(["y"], "sink.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Photo" }));
    // Pick the assignee and a due date, so the create goes through.
    fireEvent.click(screen.getByLabelText("Assignee"));
    fireEvent.click(await screen.findByRole("option", { name: /Rush Chair/ }));
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Dec 31 2099" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(photo.requestUrl).toHaveBeenCalledTimes(2);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Clean the kitchen",
        reference_photo_paths: [
          "chapters/c/tasks/p/mess.jpg",
          "chapters/c/tasks/p/sink.jpg",
        ],
        proof_kind: "photo",
      }),
    );
  });
});
