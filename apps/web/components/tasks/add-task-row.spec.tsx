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

describe("AddTaskRow's Repeat (#5119)", () => {
  it("creates a weekly task with no end on the due day's weekday", async () => {
    const onCreate = open();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Kitchen duty" },
    });
    fireEvent.click(screen.getByLabelText("Assignee"));
    fireEvent.click(await screen.findByRole("option", { name: /Rush Chair/ }));
    // Dec 31 2099 is a Thursday.
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Dec 31 2099" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(screen.getByRole("radio", { name: "Never" })).toBeChecked();
    expect(screen.getByText("Repeats until you stop it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]![0].recurrence_rule).toMatch(
      /^FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;TZID=/,
    );
  });

  it("sends no rule for a task that doesn't repeat", async () => {
    const onCreate = open();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Sweep" },
    });
    fireEvent.click(screen.getByLabelText("Assignee"));
    fireEvent.click(await screen.findByRole("option", { name: /Rush Chair/ }));
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Dec 31 2099" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]![0].recurrence_rule).toBeUndefined();
  });
});

describe("AddTaskRow for everyone (#4295 step 3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends Everyone as the audience, with proof but no repeat or photos", async () => {
    const onCreate = open();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Fill out the tabling form" },
    });
    fireEvent.click(screen.getByLabelText("Assignee"));
    fireEvent.click(await screen.findByRole("option", { name: "Everyone" }));
    // One active member in this list.
    expect(
      screen.getByText("1 active member gets their own copy."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("add-task-photos-input")).toBeNull();
    expect(screen.queryByLabelText(/repeat/i)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Dec 31 2099" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const draft = onCreate.mock.calls[0]![0];
    expect(draft).toEqual(
      expect.objectContaining({
        title: "Fill out the tabling form",
        audience: "everyone",
        proof_kind: "link",
      }),
    );
    expect(draft).not.toHaveProperty("assignee_id");
    expect(draft.recurrence_rule).toBeUndefined();
    expect(draft.reference_photo_paths).toBeUndefined();
  });
});
