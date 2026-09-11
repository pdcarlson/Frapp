import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  UploadField,
  UploadFileField,
  UploadSheetBody,
  UploadSheetContent,
  UploadSheetFooter,
  UploadSheetTitle,
  fieldErrorId,
  fieldErrorProps,
} from "@/components/shared/upload-sheet";

/*
 * The upload sheet is chrome transcribed from framework board option `1j`, and
 * it is the first piece of this lane that two screens share. Its call sites
 * (`/documents`, `/backwork`) pin what they do with it; this suite pins what it
 * is, so the next screen to adopt it inherits a contract rather than a shape.
 *
 * Three of the four cases here are regressions that already happened once
 * during the lane, in review rather than in production — they are written down
 * because each was invisible on screen.
 */

function Sheet({
  file,
  error,
  onSelect = () => {},
}: {
  file?: File | null;
  error?: string | null;
  onSelect?: (next: File | null) => void;
}) {
  return (
    <Dialog open>
      <UploadSheetContent>
        <UploadSheetTitle>Upload backwork</UploadSheetTitle>
        <UploadSheetBody id="test-form" onSubmit={(e) => e.preventDefault()}>
          <UploadFileField
            id="test-file"
            label="File"
            hint="Up to 25 MB."
            accept=".pdf"
            file={file ?? null}
            error={error}
            onSelect={onSelect}
          />
          <UploadField id="test-title" label="Title" error={error}>
            <Input id="test-title" {...fieldErrorProps("test-title", error)} />
          </UploadField>
        </UploadSheetBody>
        <UploadSheetFooter>
          <button type="submit" form="test-form">
            Upload
          </button>
        </UploadSheetFooter>
      </UploadSheetContent>
    </Dialog>
  );
}

describe("upload sheet", () => {
  it("names the file input by its field label, not by its affordance", () => {
    /*
      The picker affordance is a second `<label for>` on the same control, so
      without the `aria-hidden` on it the accessible name concatenates to "File
      Choose file" — and to "File Replace" once a file is picked, which reads
      as the control being renamed mid-form. Nothing about that is visible on
      screen; six call-site cases went red on it and none of them said why.
    */
    render(<Sheet />);

    const input = screen.getByLabelText(/^file$/i);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAccessibleName("File");
  });

  it("collapses the well to a file row once a file is chosen", async () => {
    const file = new File(["x".repeat(2048)], "midterm.pdf", {
      type: "application/pdf",
    });
    const { rerender } = render(<Sheet />);

    // Empty: the affordance offers a choice and the constraint is stated
    // beside it, as field help rather than the instructional paragraph `1j`
    // deletes.
    expect(screen.getByText("Choose file")).toBeInTheDocument();
    expect(screen.getByText(/up to 25 MB/i)).toBeInTheDocument();

    rerender(<Sheet file={file} />);

    // Chosen: name, size and type, and the affordance becomes Replace.
    expect(screen.getByText("midterm.pdf")).toBeInTheDocument();
    expect(screen.getByText(/2 KB · PDF/)).toBeInTheDocument();
    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(screen.queryByText("Choose file")).not.toBeInTheDocument();
    // The accessible name does not move with the affordance.
    expect(screen.getByLabelText(/^file$/i)).toHaveAccessibleName("File");
  });

  it("announces an inline error and points the control at it", () => {
    render(<Sheet error="Choose a file to upload." />);

    // Both fields render the error, and both wire the control to it: a red
    // border a screen reader cannot reach is half an error state.
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    for (const alert of alerts) {
      expect(alert).toHaveTextContent("Choose a file to upload.");
    }

    const title = screen.getByLabelText(/^title$/i);
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAttribute(
      "aria-describedby",
      fieldErrorId("test-title"),
    );
    expect(title).toHaveAccessibleDescription("Choose a file to upload.");

    const fileInput = screen.getByLabelText(/^file$/i);
    expect(fileInput).toHaveAttribute("aria-invalid", "true");
    expect(fileInput).toHaveAccessibleDescription("Choose a file to upload.");
  });

  it("says nothing about validity when there is no error", () => {
    /*
      `aria-invalid="false"` is a claim, not silence — it announces the field as
      explicitly valid before anyone has submitted anything. `fieldErrorProps`
      returns an empty object rather than a `false`, and this is the case that
      catches a future rewrite spelling it as a boolean.
    */
    render(<Sheet />);

    const title = screen.getByLabelText(/^title$/i);
    expect(title).not.toHaveAttribute("aria-invalid");
    expect(title).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("titles the sheet without a description Radix would warn about", () => {
    /*
      `1j` deletes the instructional paragraph, so the sheet renders no
      `DialogDescription`. `UploadSheetContent` therefore has to pass
      `aria-describedby={undefined}` explicitly — otherwise Radix logs a
      missing-description warning on every open, which is noise that trains
      reviewers to ignore console output.
    */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Sheet />);

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Upload backwork" }),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveAttribute("aria-describedby");
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Description"),
    );
    warn.mockRestore();
  });

  it("hands the chosen file back to its owner", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Sheet onSelect={onSelect} />);

    await user.upload(
      screen.getByLabelText(/^file$/i),
      new File(["x"], "notes.pdf", { type: "application/pdf" }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ name: "notes.pdf" });
  });
});
