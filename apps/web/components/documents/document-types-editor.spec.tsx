import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberFacingError, type DocumentTypeRow } from "@repo/hooks";
import {
  DOCUMENT_TYPE_NAME_MAX_LENGTH,
  DOCUMENT_TYPES_MAX,
} from "@repo/validation";
import { DocumentTypesEditor } from "@/components/documents/document-types-editor";

/*
 * Pins the documents "Edit types" popover (#3642): its copy, classes and
 * add / rename / delete behaviour, so moving it onto the shared
 * `TypeListEditor` (#4723) is provably a no-op for the screen.
 */

const { mockCreate, mockUpdate, mockDelete, mockToast, pending } = vi.hoisted(
  () => ({
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
    mockToast: vi.fn(),
    pending: { create: false, update: false, delete: false },
  }),
);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCreateDocumentType: () => ({
    mutateAsync: mockCreate,
    isPending: pending.create,
  }),
  useUpdateDocumentType: () => ({
    mutateAsync: mockUpdate,
    isPending: pending.update,
  }),
  useDeleteDocumentType: () => ({
    mutateAsync: mockDelete,
    isPending: pending.delete,
  }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const CHIP = "chip-class";

function row(id: string, name: string): DocumentTypeRow {
  return { id, chapter_id: "chap-1", name, sort_order: 1, created_at: "" };
}

/*
 * A failure whose words `getErrorMessage` shows as they are, so a toast that
 * drops the error (and falls back to "Something went wrong") fails the spec.
 * Raw API text is never shown (it goes through `SERVER_MESSAGE_COPY`), so a
 * plain `Error` can't prove the error reaches the toast.
 */
function refusal(message: string) {
  return new MemberFacingError(message);
}

const TYPES = [row("t-1", "Bylaws"), row("t-2", "Minutes")];

async function openEditor(
  types: readonly DocumentTypeRow[] = TYPES,
  onOuterSubmit = vi.fn(),
) {
  render(
    <form onSubmit={onOuterSubmit}>
      <DocumentTypesEditor
        types={types}
        disabled={false}
        chipClassName={CHIP}
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
});

describe("DocumentTypesEditor", () => {
  it("renders the trigger as a dashed chip", () => {
    render(<DocumentTypesEditor types={TYPES} disabled chipClassName={CHIP} />);
    const trigger = screen.getByRole("button", { name: "Edit types" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger.className).toBe(
      `${CHIP} gap-1 border-dashed bg-transparent text-muted-foreground hover:text-foreground`,
    );
    expect(trigger.querySelector("svg")).toHaveClass("h-3", "w-3");
  });

  it("renders the header, rows and Add type with the documents copy", async () => {
    const dialog = await openEditor();
    expect(dialog.className).toContain("w-[20rem] p-0");
    // Opens from the trigger's start edge, not Popover's centred default.
    expect(dialog).toHaveAttribute("data-align", "start");

    const title = within(dialog).getByText("Document types");
    expect(title).toHaveClass("text-sm", "font-semibold");
    expect(title.parentElement).toHaveClass(
      "border-b",
      "border-border",
      "px-3",
      "py-2.5",
    );
    expect(
      within(dialog).getByText(
        "Renaming a type renames it on its documents. Deleting one leaves its documents with no type.",
      ),
    ).toHaveClass("text-caption", "text-muted-foreground");

    const list = within(dialog).getByRole("list");
    expect(list.className).toBe("max-h-80 overflow-y-auto py-1");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Bylaws",
      "Minutes",
    ]);
    expect(items[0]!.className).toBe("flex items-center gap-2 px-3 py-1");
    // No subtitle line until a delete is being confirmed.
    expect(items[0]!.querySelectorAll("p")).toHaveLength(1);
    expect(items[0]!.querySelector("p")!.className).toBe(
      "truncate text-sm font-semibold",
    );
    expect(
      within(items[0]!).getByRole("button", { name: "Rename Bylaws" }),
    ).toBeInTheDocument();
    expect(
      within(items[0]!).getByRole("button", { name: "Delete Bylaws" }),
    ).toBeInTheDocument();

    const add = within(dialog).getByRole("button", { name: "Add type" });
    expect(add).toBeEnabled();
    expect(add).not.toHaveAttribute("title");
    expect(add).toHaveClass("-ml-2");
    expect(add.parentElement!.className).toBe(
      "border-t border-border px-3 py-2",
    );
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
    const full = Array.from({ length: DOCUMENT_TYPES_MAX }, (_, index) =>
      row(`t-${index}`, `Type ${index}`),
    );
    const dialog = await openEditor(full);
    const add = within(dialog).getByRole("button", { name: "Add type" });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute(
      "title",
      `A chapter can have at most ${DOCUMENT_TYPES_MAX} types.`,
    );
  });

  it("adds a trimmed type without submitting the form around the trigger", async () => {
    const outer = vi.fn((event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    const dialog = await openEditor(TYPES, outer);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add type" }),
    );

    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveAttribute("id", "document-type-new-name");
    expect(name).toHaveAttribute("placeholder", "Contract");
    expect(name).toHaveAttribute(
      "maxLength",
      String(DOCUMENT_TYPE_NAME_MAX_LENGTH),
    );
    expect(name).toHaveFocus();
    const form = name.closest("form")!;
    expect(form.className).toBe("grid gap-2");
    expect(name.parentElement!.className).toBe("grid gap-1");
    expect(within(form).getByRole("button", { name: "Add" })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(
      within(form).getByRole("button", { name: "Cancel" }),
    ).toHaveAttribute("type", "button");

    await userEvent.type(name, "  Contract {Enter}");
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({ name: "Contract" }),
    );
    expect(outer).not.toHaveBeenCalled();
    // Saved, the form closes back to the Add type button.
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Add type" }),
      ).toBeInTheDocument(),
    );
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

  it("renames one row at a time and keeps the form open when the save fails", async () => {
    mockUpdate.mockRejectedValueOnce(refusal("That name is taken."));
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Rename Bylaws" }),
    );
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveValue("Bylaws");
    expect(name).toHaveAttribute("id", "document-type-t-1-name");
    expect(name.closest("li")!.className).toBe("px-3 py-2");

    // Opening another row closes this one.
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Rename Minutes" }),
    );
    expect(within(dialog).getAllByLabelText("Name")).toHaveLength(1);
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Minutes");

    await userEvent.clear(within(dialog).getByLabelText("Name"));
    await userEvent.type(within(dialog).getByLabelText("Name"), "Notes");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Couldn't rename the type",
        description: "That name is taken.",
        variant: "destructive",
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith({ id: "t-2", name: "Notes" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Notes");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(within(dialog).queryByLabelText("Name")).toBeNull();
  });

  it("renames a row with the trimmed name and closes its form", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Rename Bylaws" }),
    );
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveAttribute(
      "maxLength",
      String(DOCUMENT_TYPE_NAME_MAX_LENGTH),
    );
    await userEvent.clear(name);
    await userEvent.type(name, "  Charter  ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(within(dialog).queryByLabelText("Name")).toBeNull(),
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ id: "t-1", name: "Charter" });
    expect(mockToast).not.toHaveBeenCalled();
    expect(
      within(dialog).getByRole("button", { name: "Rename Bylaws" }),
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
      within(dialog).getByRole("button", { name: "Rename Bylaws" }),
    );
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(save.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("leaves Add enabled without a spinner when nothing is in flight", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add type" }),
    );
    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(add).toBeEnabled();
    expect(add.querySelector("svg.animate-spin")).toBeNull();
  });

  it("toasts an add that fails with the add title", async () => {
    mockCreate.mockRejectedValueOnce(refusal("Nope."));
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add type" }),
    );
    await userEvent.type(within(dialog).getByLabelText("Name"), "Contract");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Couldn't add the type",
        description: "Nope.",
        variant: "destructive",
      }),
    );
  });

  it("confirms a delete with Keep or Delete", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete Bylaws" }),
    );
    const item = within(dialog).getAllByRole("listitem")[0]!;
    const note = within(item).getByText(
      "Its documents keep everything but the type.",
    );
    expect(note.className).toBe("truncate text-caption text-muted-foreground");
    expect(
      within(item).queryByRole("button", { name: "Rename Bylaws" }),
    ).toBeNull();

    await userEvent.click(within(item).getByRole("button", { name: "Keep" }));
    expect(
      within(item).queryByText("Its documents keep everything but the type."),
    ).toBeNull();

    await userEvent.click(
      within(item).getByRole("button", { name: "Delete Bylaws" }),
    );
    await userEvent.click(within(item).getByRole("button", { name: "Delete" }));
    expect(mockDelete).toHaveBeenCalledWith("t-1");
  });

  it("toasts a failed delete and drops back out of the confirm", async () => {
    mockDelete.mockRejectedValueOnce(refusal("Gone."));
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete Minutes" }),
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
      within(dialog).getByRole("button", { name: "Delete Minutes" }),
    ).toBeInTheDocument();
  });

  it("disables Delete while the delete is in flight", async () => {
    pending.delete = true;
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete Bylaws" }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Delete" }),
    ).toBeDisabled();
  });

  it("closes an open row when the popover closes", async () => {
    const dialog = await openEditor();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Rename Bylaws" }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Edit types" }));
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});
