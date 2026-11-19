// @vitest-environment jsdom
import { TASK_AUDIENCE_COPY } from "@repo/validation";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  // The Who picker's lists: two active members, one alumnus, one role.
  useCurrentUser: () => ({ data: { id: "u-1" } }),
  useMembers: () => ({
    data: [
      { user_id: "u-1", display_name: "Rush Chair", role_ids: ["role-rush"] },
      { user_id: "u-2", display_name: "Sam Lee", role_ids: ["role-rush"] },
      { user_id: "u-3", display_name: "Old Timer", role_ids: [], is_alumni: true },
    ],
    isPending: false,
    isError: false,
  }),
  useRoles: () => ({
    data: [{ id: "role-rush", name: "Recruitment Chair", display_order: 1 }],
    isPending: false,
    isError: false,
  }),
  useRoleTiers: () => ({ data: [], isPending: false, isError: false }),
  useGroups: () => ({ data: [], isPending: false, isError: false }),
  useMemberDisplayNames: () => ({
    avatarTintFor: () => null,
    nameFor: () => null,
    avatarFor: () => null,
  }),
}));

// jsdom has no object URLs; a picked photo's preview only needs a string.
URL.createObjectURL = () => "blob:preview";
URL.revokeObjectURL = () => undefined;

/** An open gate: the row's controls are live. */
const gate = { controlProps: () => ({}) } as unknown as SubscriptionGate;

const form = () => screen.getByRole("form", { name: "Add a task" });
const add = () => within(form()).getByRole("button", { name: "Add" });
const photoInput = () =>
  form().querySelector<HTMLInputElement>('input[type="file"]');

function renderRow(onCreate = vi.fn().mockResolvedValue(true)) {
  render(<AddTaskRow gate={gate} pending={false} onCreate={onCreate} />);
  return onCreate;
}

/** Opens More, where steps, notes, repeat and photos live. */
function openMore() {
  fireEvent.click(within(form()).getByRole("button", { name: /^more$/i }));
}

/** Picks one person, which closes nothing: the picker allows any shape. */
async function pickPerson(name: RegExp) {
  await userEvent.click(within(form()).getByRole("button", { name: /^who/i }));
  await userEvent.click(await screen.findByRole("checkbox", { name }));
  await userEvent.keyboard("{Escape}");
}

describe("AddTaskRow's line", () => {
  it("is one line: title, Who, Due, Points and More; Add once there's a title", () => {
    renderRow();
    for (const name of ["Task title", "Due date", "Points (optional)"]) {
      expect(within(form()).getByLabelText(name)).toBeInTheDocument();
    }
    expect(within(form()).getByRole("button", { name: "Who" })).toBeInTheDocument();
    expect(within(form()).getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(within(form()).queryByRole("button", { name: "Add" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Sweep" },
    });
    expect(add()).toBeInTheDocument();
    // The rest waits under More.
    expect(within(form()).queryByLabelText("Notes (optional)")).toBeNull();
  });

  it("opens More when New task asks", () => {
    const { rerender } = render(
      <AddTaskRow gate={gate} pending={false} onCreate={vi.fn()} expandSignal={0} />,
    );
    expect(within(form()).queryByLabelText("Notes (optional)")).toBeNull();
    rerender(
      <AddTaskRow gate={gate} pending={false} onCreate={vi.fn()} expandSignal={1} />,
    );
    expect(within(form()).getByLabelText("Notes (optional)")).toBeInTheDocument();
    expect(within(form()).getByLabelText("Task title")).toHaveFocus();
  });

  it("leaves alumni out of Who", async () => {
    renderRow();
    await userEvent.click(within(form()).getByRole("button", { name: /^who/i }));
    expect(await screen.findByRole("checkbox", { name: /Sam Lee/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Old Timer/ })).toBeNull();
  });
});

describe("AddTaskRow's due time (#4512)", () => {
  it("refuses a time already gone by, and creates nothing", async () => {
    const onCreate = renderRow();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Sweep" },
    });
    // A day long past with a time: refused for the time, whatever the clock.
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Jan 6 2020 9am" },
    });
    fireEvent.submit(form());
    // Every problem is flagged on the one submit, the past time included.
    const alert = await within(form()).findByRole("alert");
    expect(alert).toHaveTextContent("Pick who it's for.");
    expect(alert).toHaveTextContent(/That time has already passed/);
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("AddTaskRow's photos (#4565, #4635)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads nothing while the task still lacks who and a due date", async () => {
    photo.requestUrl.mockResolvedValue({
      upload_url: "https://upload",
      storage_path: "chapters/c/tasks/p/mess.jpg",
    });
    photo.put.mockResolvedValue(undefined);
    const onCreate = renderRow();
    openMore();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Clean the kitchen" },
    });
    fireEvent.change(photoInput()!, {
      target: {
        files: [new File(["x"], "mess.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Photo" }));
    fireEvent.click(add());
    await Promise.resolve();
    expect(photo.requestUrl).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("refuses a file that isn't a photo before any upload", () => {
    renderRow();
    openMore();
    fireEvent.change(photoInput()!, {
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
    const onCreate = renderRow();
    openMore();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Clean the kitchen" },
    });
    fireEvent.change(photoInput()!, {
      target: {
        files: [
          new File(["x"], "mess.jpg", { type: "image/jpeg" }),
          new File(["y"], "sink.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Photo" }));
    await pickPerson(/Rush Chair/);
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Dec 31 2099" },
    });
    fireEvent.click(add());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(photo.requestUrl).toHaveBeenCalledTimes(2);
    expect(onCreate).toHaveBeenCalledWith({
      endpoint: "/v1/tasks",
      body: expect.objectContaining({
        title: "Clean the kitchen",
        assignee_id: "u-1",
        reference_photo_paths: [
          "chapters/c/tasks/p/mess.jpg",
          "chapters/c/tasks/p/sink.jpg",
        ],
        proof_kind: "photo",
      }),
    });
  });
});

describe("AddTaskRow's Repeat (#5119)", () => {
  it("creates a weekly task with no end on the due day's weekday", async () => {
    const onCreate = renderRow();
    openMore();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Kitchen duty" },
    });
    await pickPerson(/Rush Chair/);
    // Dec 31 2099 is a Thursday.
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Dec 31 2099" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(screen.getByRole("radio", { name: "Never" })).toBeChecked();
    expect(screen.getByText("Repeats until you stop it.")).toBeInTheDocument();
    fireEvent.click(add());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]![0].body.recurrence_rule).toMatch(
      /^FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;TZID=/,
    );
  });

  it("sends no rule for a task that doesn't repeat", async () => {
    const onCreate = renderRow();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Sweep" },
    });
    await pickPerson(/Rush Chair/);
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Dec 31 2099" },
    });
    fireEvent.click(add());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]![0].body.recurrence_rule).toBeUndefined();
  });
});

describe("AddTaskRow for many people (#4295 step 3, 2026-11-18)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends Everyone in the chapter as a copy each, with proof but no repeat or photos", async () => {
    const onCreate = renderRow();
    openMore();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Fill out the tabling form" },
    });
    await userEvent.click(within(form()).getByRole("button", { name: /^who/i }));
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /Everyone in the chapter/ }),
    );
    await userEvent.keyboard("{Escape}");
    expect(photoInput()).toBeNull();
    expect(screen.getByText(TASK_AUDIENCE_COPY.noRepeat)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Dec 31 2099" },
    });
    fireEvent.click(add());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const { endpoint, body } = onCreate.mock.calls[0]![0];
    expect(endpoint).toBe("/v1/tasks");
    expect(body).toEqual(
      expect.objectContaining({
        title: "Fill out the tabling form",
        audience: "everyone",
        proof_kind: "link",
      }),
    );
    expect(body).not.toHaveProperty("assignee_id");
    expect(body.recurrence_rule).toBeUndefined();
    expect(body.reference_photo_paths).toBeUndefined();
  });

  it("puts One claims it up for grabs, through the open-tasks endpoint", async () => {
    const onCreate = renderRow();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Drive to the airport" },
    });
    await userEvent.click(within(form()).getByRole("button", { name: /^who/i }));
    await userEvent.click(await screen.findByRole("radio", { name: "Roles and groups" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /Recruitment Chair/ }));
    await userEvent.click(screen.getByRole("radio", { name: "One claims it" }));
    await userEvent.keyboard("{Escape}");
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Dec 31 2099" },
    });
    fireEvent.click(add());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]![0]).toEqual({
      endpoint: "/v1/open-tasks",
      body: expect.objectContaining({
        title: "Drive to the airport",
        role_id: "role-rush",
      }),
    });
  });
});

describe("AddTaskRow From (#5473)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Radix Select reads these, which jsdom lacks.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;
  });

  it("sends the role the officer picked under From, and nothing for Just you", async () => {
    const onCreate = renderRow();
    openMore();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Book the bus" },
    });
    await pickPerson(/Sam Lee/);
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "Dec 31 2099" },
    });
    const from = screen.getByRole("combobox", { name: "From" });
    expect(from).toHaveTextContent("Just you");

    await userEvent.click(from);
    await userEvent.click(
      await screen.findByRole("option", { name: "Recruitment Chair · 2" }),
    );
    expect(
      screen.getByText(/Everyone in Recruitment Chair can see this task/),
    ).toBeInTheDocument();
    fireEvent.click(add());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0]![0].body.followed_by).toBe("role:role-rush");
  });
});
