import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Capture the create/update mutation args. `vi.hoisted` runs before the hoisted
// `vi.mock` factory, so the spies exist when the factory wires them in.
const { createMutate, updateMutate, mockCurrentChapter } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  mockCurrentChapter: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useCreateEvent: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: updateMutate, isPending: false }),
  useRoles: () => ({
    data: [
      { id: "r1", name: "Exec" },
      { id: "r2", name: "Committee" },
    ],
    isError: false,
  }),
  // The event routes behind this dialog are paid-ops, so it reads the chapter's
  // subscription now (#841). Every case here predates the gate and asserts
  // editing behaviour, so they all run against an active chapter.
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["billing:view"] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { EventEditorDialog } from "./event-editor-dialog";
import { chapterSubscription } from "@/tests/chapter-subscription";

const chapter = chapterSubscription(mockCurrentChapter);

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Event name"), {
    target: { value: "Exec Sync" },
  });
  fireEvent.change(screen.getByLabelText("Start"), {
    target: { value: "2026-07-01T18:00" },
  });
  fireEvent.change(screen.getByLabelText("End"), {
    target: { value: "2026-07-01T19:00" },
  });
}

describe("EventEditorDialog role targeting", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    createMutate.mockResolvedValue(undefined);
    updateMutate.mockResolvedValue(undefined);
    chapter.active();
  });

  it("sends required_role_ids in the create payload when roles are selected", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    fillRequiredFields();
    fireEvent.click(screen.getByLabelText("Exec"));
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ required_role_ids: ["r1"] }),
    );
  });

  it("omits required_role_ids on create when no roles are selected (all members)", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate).toHaveBeenCalledWith(
      expect.not.objectContaining({ required_role_ids: expect.anything() }),
    );
  });

  it("seeds existing roles and clears them to an empty array on edit", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e1",
          name: "Exec Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          required_role_ids: ["r1"],
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    const execCheckbox = screen.getByLabelText("Exec");
    expect(execCheckbox).toBeChecked();
    fireEvent.click(execCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "e1",
        body: expect.objectContaining({ required_role_ids: [] }),
      }),
    );
  });

  it("preserves seeded roles on edit when the selection is untouched", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e2",
          name: "Committee Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          required_role_ids: ["r1", "r2"],
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Event name"), {
      target: { value: "Committee Sync (renamed)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ required_role_ids: ["r1", "r2"] }),
      }),
    );
  });

  it("renders a seeded role missing from the loaded list as removable", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e3",
          name: "Legacy Targeted",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          required_role_ids: ["r1", "legacyrole99"],
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    // The seeded id not returned by useRoles still renders as a checked,
    // removable row (stub label) so the admin can clear it instead of it
    // silently persisting into the saved payload.
    const execCheckbox = screen.getByLabelText("Exec");
    const phantomCheckbox = screen.getByLabelText("Role legacyro");
    expect(execCheckbox).toBeChecked();
    expect(phantomCheckbox).toBeChecked();

    fireEvent.click(execCheckbox);
    fireEvent.click(phantomCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ required_role_ids: [] }),
      }),
    );
  });
});
