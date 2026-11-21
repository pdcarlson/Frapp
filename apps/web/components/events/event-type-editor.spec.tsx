import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberFacingError, type EventType } from "@repo/hooks";
import { EVENT_TYPE_NAME_MAX_LENGTH, EVENT_TYPES_MAX } from "@repo/validation";
import { EventTypeRow } from "@/components/events/event-type-picker";
import { markupLines } from "@/tests/stable-markup";

/*
 * Pins the events "Edit types" popover at the end of the event form's Type
 * row (`spec/behavior/events.md` § Event types): its markup, copy, classes
 * and add / edit / delete behaviour. It was written against the editor before
 * it moved onto the shared `TypeListEditor` (#4723) and passed there, with one
 * exception: "does not submit the form around the picker" pins the move's one
 * intended fix, and failed against the old editor, whose type form let its
 * submit bubble into the event form.
 */

const { mockCreate, mockUpdate, mockDelete, mockToast, pending, typesState } =
  vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
    mockToast: vi.fn(),
    pending: { create: false, update: false, delete: false },
    typesState: { data: [] as EventType[] },
  }));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useEventTypes: () => ({ data: typesState.data, isLoading: false }),
  useCreateEventType: () => ({
    mutateAsync: mockCreate,
    isPending: pending.create,
  }),
  useUpdateEventType: () => ({
    mutateAsync: mockUpdate,
    isPending: pending.update,
  }),
  useDeleteEventType: () => ({
    mutateAsync: mockDelete,
    isPending: pending.delete,
  }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

function eventType(
  id: string,
  name: string,
  point_value: number,
  is_mandatory: boolean,
): EventType {
  return {
    id,
    chapter_id: "chap-1",
    name,
    point_value,
    is_mandatory,
    position: 1,
    created_at: "",
    updated_at: "",
  };
}

/*
 * A failure whose words `getErrorMessage` shows as they are, so a toast that
 * drops the error (and falls back to "Something went wrong") fails the spec.
 */
function refusal(message: string) {
  return new MemberFacingError(message);
}

const fromForm = (name: string) => ({
  name,
  point_value: 7,
  is_mandatory: false,
});

const TYPES = [
  eventType("t-1", "Chapter meeting", 10, true),
  eventType("t-2", "Social", 1, false),
];

async function openEditor(types: EventType[] = TYPES, onOuterSubmit = vi.fn()) {
  typesState.data = types;
  render(
    <form onSubmit={onOuterSubmit}>
      <EventTypeRow
        value={null}
        onPick={vi.fn()}
        canManage
        showSets
        typeFromForm={fromForm}
      />
    </form>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Edit types" }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({});
  mockUpdate.mockReset().mockResolvedValue({});
  mockDelete.mockReset().mockResolvedValue({});
  mockToast.mockReset();
  pending.create = false;
  pending.update = false;
  pending.delete = false;
  typesState.data = TYPES;
});

describe("EventTypeRow's Edit types", () => {
  it("renders the trigger as a quiet button at the end of the Type row", () => {
    render(
      <EventTypeRow
        value={null}
        onPick={vi.fn()}
        canManage
        showSets
        typeFromForm={fromForm}
        disabled
      />,
    );
    const trigger = screen.getByRole("button", { name: "Edit types" });
    expect(trigger).toBeDisabled();
    expect(markupLines(trigger)).toMatchInlineSnapshot(`
      [
        "<button aria-expanded="false" aria-haspopup="dialog" class="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-md px-2 text-caption font-semibold text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground pointer-coarse:h-11 disabled:pointer-events-none disabled:text-disabled focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25" data-state="closed" disabled="" type="button">Edit types",
        "  <svg aria-hidden="true" class="lucide lucide-settings-2 h-3 w-3">",
      ]
    `);
  });

  it("renders the header, rows and Add type with the events copy", async () => {
    const dialog = await openEditor();
    expect(markupLines(dialog).slice(1)).toMatchInlineSnapshot(`
      [
        "  <div class="border-b border-border px-3 py-2.5">",
        "    <p class="text-sm font-semibold">Event types",
        "    <p class="text-caption text-muted-foreground">Picking a type fills in its points and attendance. Events already made keep theirs.",
        "  <ul class="max-h-80 overflow-y-auto py-1">",
        "    <li class="flex items-center gap-2 px-3 py-1">",
        "      <div class="min-w-0 flex-1">",
        "        <p class="truncate text-sm font-semibold">Chapter meeting",
        "        <p class="truncate text-caption text-muted-foreground">10 points · Required",
        "      <button aria-label="Edit Chapter meeting" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:border-border disabled:bg-card disabled:text-disabled font-semibold text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11" title="Edit Chapter meeting">",
        "        <svg aria-hidden="true" class="lucide lucide-pencil">",
        "      <button aria-label="Delete Chapter meeting" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:border-border disabled:bg-card disabled:text-disabled font-semibold text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11" title="Delete Chapter meeting">",
        "        <svg aria-hidden="true" class="lucide lucide-trash lucide-trash-2">",
        "    <li class="flex items-center gap-2 px-3 py-1">",
        "      <div class="min-w-0 flex-1">",
        "        <p class="truncate text-sm font-semibold">Social",
        "        <p class="truncate text-caption text-muted-foreground">1 point",
        "      <button aria-label="Edit Social" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:border-border disabled:bg-card disabled:text-disabled font-semibold text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11" title="Edit Social">",
        "        <svg aria-hidden="true" class="lucide lucide-pencil">",
        "      <button aria-label="Delete Social" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:border-border disabled:bg-card disabled:text-disabled font-semibold text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11" title="Delete Social">",
        "        <svg aria-hidden="true" class="lucide lucide-trash lucide-trash-2">",
        "  <div class="border-t border-border px-3 py-2">",
        "    <button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:pointer-events-none disabled:border-border disabled:bg-card disabled:text-disabled font-semibold text-muted-foreground hover:bg-card-hover hover:text-foreground h-9 px-3 text-sm pointer-coarse:h-11 -ml-2" type="button">Add type",
        "      <svg aria-hidden="true" class="lucide lucide-plus h-4 w-4">",
      ]
    `);
    expect(dialog.className).toContain("w-[22rem] p-0");
    expect(dialog).toHaveAttribute("data-align", "start");
  });

  it("says so when the chapter has no types", async () => {
    const dialog = await openEditor([]);
    const empty = within(dialog).getByText("No types yet.");
    expect(empty.tagName).toBe("LI");
    expect(empty.className).toBe(
      "px-3 py-2 text-caption text-muted-foreground",
    );
  });

  it("disables Add type at the cap and says why", async () => {
    const full = Array.from({ length: EVENT_TYPES_MAX }, (_, index) =>
      eventType(`t-${index}`, `Type ${index}`, 0, false),
    );
    const dialog = await openEditor(full);
    const add = within(dialog).getByRole("button", { name: "Add type" });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute(
      "title",
      `A chapter can have at most ${EVENT_TYPES_MAX} types.`,
    );
  });

  it("renders the add form", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add type" }),
    );
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute(
      "maxLength",
      String(EVENT_TYPE_NAME_MAX_LENGTH),
    );
    expect(markupLines(name.closest("form")!)).toMatchInlineSnapshot(`
      [
        "<form class="grid gap-2">",
        "  <div class="grid grid-cols-[1fr_5rem] gap-2">",
        "    <div class="grid gap-1">",
        "      <label class="text-sm font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:text-disabled" for="event-type-new-name">Name",
        "      <input class="flex h-10 w-full rounded-md border border-control-edge bg-surface-1 px-3 py-1 text-base pointer-coarse:h-11 text-foreground caret-primary transition-colors file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 enabled:aria-[invalid=true]:border-destructive enabled:aria-[invalid=true]:focus-visible:border-destructive enabled:aria-[invalid=true]:focus-visible:ring-destructive/25 disabled:cursor-not-allowed disabled:border-border disabled:text-disabled" id="event-type-new-name" maxlength="60" placeholder="Work party" value="">",
        "    <div class="grid gap-1">",
        "      <label class="text-sm font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:text-disabled" for="event-type-new-points">Points",
        "      <input class="flex h-10 w-full rounded-md border border-control-edge bg-surface-1 px-3 py-1 text-base pointer-coarse:h-11 text-foreground caret-primary transition-colors file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 enabled:aria-[invalid=true]:border-destructive enabled:aria-[invalid=true]:focus-visible:border-destructive enabled:aria-[invalid=true]:focus-visible:ring-destructive/25 disabled:cursor-not-allowed disabled:border-border disabled:text-disabled" id="event-type-new-points" min="0" type="number" value="5">",
        "  <div aria-label="Attendance for everyone" class="inline-flex rounded-md border border-control-edge bg-surface-1 p-0.5 w-full" role="radiogroup">",
        "    <button aria-checked="true" class="flex min-h-8 items-center justify-center whitespace-nowrap rounded-sm font-semibold transition-colors pointer-coarse:min-h-11 px-3 text-sm flex-1 bg-accent-subtle text-accent-text focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25" role="radio" type="button">Optional",
        "    <button aria-checked="false" class="flex min-h-8 items-center justify-center whitespace-nowrap rounded-sm font-semibold transition-colors pointer-coarse:min-h-11 px-3 text-sm flex-1 text-muted-foreground hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25" role="radio" type="button">Required",
        "  <div class="flex justify-end gap-2">",
        "    <button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:pointer-events-none disabled:border-border disabled:bg-card disabled:text-disabled font-semibold text-muted-foreground hover:bg-card-hover hover:text-foreground h-9 px-3 text-sm pointer-coarse:h-11" type="button">Cancel",
        "      <svg aria-hidden="true" class="lucide lucide-x h-4 w-4">",
        "    <button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:pointer-events-none disabled:border-border disabled:bg-card disabled:text-disabled bg-primary bg-clip-padding font-bold text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed h-9 px-3 text-sm pointer-coarse:h-11" type="submit">Add",
      ]
    `);
  });

  it("adds a trimmed type with its points and attendance", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add type" }),
    );
    await userEvent.type(
      within(dialog).getByLabelText("Name"),
      "  Work party ",
    );
    const points = within(dialog).getByLabelText("Points");
    await userEvent.clear(points);
    await userEvent.type(points, "3");
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Required" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: "Work party",
        point_value: 3,
        is_mandatory: true,
      }),
    );
    // Saved, the form closes back to the Add type button.
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Add type" }),
      ).toBeInTheDocument(),
    );
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("reads an empty Points field as 0", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add type" }),
    );
    await userEvent.type(within(dialog).getByLabelText("Name"), "Social");
    await userEvent.clear(within(dialog).getByLabelText("Points"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: "Social",
        point_value: 0,
        is_mandatory: false,
      }),
    );
  });

  // #4723: the popover is portalled, but React bubbles the type form's submit
  // up its own tree to the event form around the picker.
  it("does not submit the form around the picker", async () => {
    const outer = vi.fn((event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    const dialog = await openEditor(TYPES, outer);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add type" }),
    );
    await userEvent.type(
      within(dialog).getByLabelText("Name"),
      "Work party{Enter}",
    );
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(outer).not.toHaveBeenCalled();
  });

  it("refuses an empty name inline", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add type" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    const error = within(dialog).getByText("Give the type a name.");
    expect(error.className).toBe("text-caption text-destructive-text");
    expect(mockCreate).not.toHaveBeenCalled();
    // Typing clears it.
    await userEvent.type(within(dialog).getByLabelText("Name"), "x");
    expect(within(dialog).queryByText("Give the type a name.")).toBeNull();
  });

  it("edits one row at a time and keeps the form open when the save fails", async () => {
    mockUpdate.mockRejectedValueOnce(refusal("That name is taken."));
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Edit Chapter meeting" }),
    );
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveValue("Chapter meeting");
    expect(name).toHaveAttribute("id", "event-type-t-1-name");
    expect(within(dialog).getByLabelText("Points")).toHaveValue(10);
    expect(
      within(dialog).getByRole("radio", { name: "Required" }),
    ).toBeChecked();
    expect(name.closest("li")!.className).toBe("px-3 py-2");

    // Opening another row closes this one.
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Edit Social" }),
    );
    expect(within(dialog).getAllByLabelText("Name")).toHaveLength(1);
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Social");
    expect(within(dialog).getByLabelText("Points")).toHaveAttribute(
      "id",
      "event-type-t-2-points",
    );

    await userEvent.clear(within(dialog).getByLabelText("Name"));
    await userEvent.type(within(dialog).getByLabelText("Name"), "Mixer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Couldn't save the type",
        description: "That name is taken.",
        variant: "destructive",
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      id: "t-2",
      body: { name: "Mixer", point_value: 1, is_mandatory: false },
    });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Mixer");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(within(dialog).queryByLabelText("Name")).toBeNull();
  });

  it("saves an edit and closes its row", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Edit Chapter meeting" }),
    );
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Optional" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(within(dialog).queryByLabelText("Name")).toBeNull(),
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      id: "t-1",
      body: { name: "Chapter meeting", point_value: 10, is_mandatory: false },
    });
    expect(mockToast).not.toHaveBeenCalled();
    expect(
      within(dialog).getByRole("button", { name: "Edit Chapter meeting" }),
    ).toBeInTheDocument();
  });

  it("disables Add with a spinner while a create is in flight", async () => {
    pending.create = true;
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add type" }),
    );
    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    expect(add.querySelector("svg.animate-spin")).not.toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeEnabled();
  });

  it("disables Save with a spinner while an update is in flight", async () => {
    pending.update = true;
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Edit Social" }),
    );
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(save.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("toasts an add that fails with the add title", async () => {
    mockCreate.mockRejectedValueOnce(refusal("Nope."));
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add type" }),
    );
    await userEvent.type(within(dialog).getByLabelText("Name"), "Work party");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Couldn't add the type",
        description: "Nope.",
        variant: "destructive",
      }),
    );
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Work party");
  });

  it("confirms a delete with Keep or Delete in place of the row's description", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete Chapter meeting" }),
    );
    const item = within(dialog).getAllByRole("listitem")[0]!;
    expect(markupLines(item)).toMatchInlineSnapshot(`
      [
        "<li class="flex items-center gap-2 px-3 py-1">",
        "  <div class="min-w-0 flex-1">",
        "    <p class="truncate text-sm font-semibold">Chapter meeting",
        "    <p class="truncate text-caption text-muted-foreground">Its events keep their points and lose the type.",
        "  <button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:pointer-events-none disabled:border-border disabled:bg-card disabled:text-disabled font-semibold text-muted-foreground hover:bg-card-hover hover:text-foreground h-9 px-3 text-sm pointer-coarse:h-11" type="button">Keep",
        "  <button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:pointer-events-none disabled:border-border disabled:bg-card disabled:text-disabled bg-destructive-tint font-bold text-destructive-text hover:bg-destructive-tint-hover h-9 px-3 text-sm pointer-coarse:h-11" type="button">Delete",
      ]
    `);

    await userEvent.click(within(item).getByRole("button", { name: "Keep" }));
    expect(within(item).getByText("10 points · Required")).toBeInTheDocument();

    await userEvent.click(
      within(item).getByRole("button", { name: "Delete Chapter meeting" }),
    );
    await userEvent.click(within(item).getByRole("button", { name: "Delete" }));
    expect(mockDelete).toHaveBeenCalledWith("t-1");
  });

  it("toasts a failed delete and drops back out of the confirm", async () => {
    mockDelete.mockRejectedValueOnce(refusal("Gone."));
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete Social" }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Couldn't delete the type",
        description: "Gone.",
        variant: "destructive",
      }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Delete Social" }),
    ).toBeInTheDocument();
  });

  it("disables Delete with a spinner while the delete is in flight", async () => {
    pending.delete = true;
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete Social" }),
    );
    const remove = within(dialog).getByRole("button", { name: "Delete" });
    expect(remove).toBeDisabled();
    expect(remove.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("closes an open row when the popover closes", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Edit Social" }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Edit types" }));
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});

describe("EventTypeRow's Create in place (Paul 2026-11-20)", () => {
  async function openMenu(onPick = vi.fn(), canManage = true) {
    render(
      <EventTypeRow
        value={null}
        onPick={onPick}
        canManage={canManage}
        showSets
        typeFromForm={fromForm}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Type: none" }));
    return onPick;
  }

  it("offers Create for a name no type has, and makes it from the form", async () => {
    const created = eventType("t-9", "Work party", 7, false);
    mockCreate.mockResolvedValue(created);
    const onPick = await openMenu();
    await userEvent.type(
      screen.getByPlaceholderText("Find or add a type"),
      "Work party",
    );
    await userEvent.click(
      screen.getByRole("option", { name: "Create \u201cWork party\u201d" }),
    );
    expect(mockCreate).toHaveBeenCalledWith({
      name: "Work party",
      point_value: 7,
      is_mandatory: false,
    });
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(created, true));
  });

  it("opens on an empty search after a pick", async () => {
    await openMenu();
    await userEvent.type(
      screen.getByPlaceholderText("Find or add a type"),
      "soc",
    );
    await userEvent.click(screen.getByRole("option", { name: /Social/ }));
    await userEvent.click(screen.getByRole("button", { name: "Type: none" }));
    expect(screen.getByPlaceholderText("Find or add a type")).toHaveValue("");
    expect(screen.getByRole("option", { name: "No type" })).toBeInTheDocument();
  });

  it("offers no Create for a name a type already has, in any case", async () => {
    await openMenu();
    await userEvent.type(
      screen.getByPlaceholderText("Find or add a type"),
      "social",
    );
    expect(screen.queryByRole("option", { name: /^Create/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Social/ })).toBeInTheDocument();
  });

  it("says so in the menu when the type can't be made", async () => {
    mockCreate.mockRejectedValue(refusal("That name is taken."));
    const onPick = await openMenu();
    await userEvent.type(
      screen.getByPlaceholderText("Find or add a type"),
      "Rush",
    );
    await userEvent.click(
      screen.getByRole("option", { name: "Create \u201cRush\u201d" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That name is taken.",
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it("gives a member, who can't make types, no search under the threshold", async () => {
    await openMenu(vi.fn(), false);
    expect(screen.queryByPlaceholderText(/type/)).toBeNull();
  });
});
