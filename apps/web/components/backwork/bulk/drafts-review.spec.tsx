import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackworkDraft } from "@repo/hooks";

const state = vi.hoisted(() => ({
  drafts: [] as BackworkDraft[],
  draftsError: false,
  update: vi.fn(),
  publish: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useBackworkDrafts: () => ({ data: state.drafts, isError: state.draftsError }),
  useUpdateBackworkDrafts: () => ({ mutateAsync: state.update }),
  usePublishBackworkDrafts: () => ({ mutateAsync: state.publish }),
  useDeleteBackworkDraft: () => ({ mutateAsync: state.remove, isPending: false }),
}));
vi.mock("@/components/shared/subscription-gate", () => ({
  useSubscriptionGate: () => ({
    allowed: true,
    controlProps: (disabled?: boolean) => ({ disabled: !!disabled }),
  }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { DraftsReview, DraftsWaitingNote } from "./drafts-review";

const draft = (id: string, fields: BackworkDraft["draft_fields"], is_redacted = true): BackworkDraft => ({
  id,
  storage_path: `chapters/c/backwork/${id}/file.pdf`,
  is_redacted,
  created_at: "2026-11-16T00:00:00Z",
  draft_fields: fields,
});

describe("Backwork drafts review (#5208)", () => {
  beforeEach(() => {
    state.drafts = [
      draft("a", { title: "Midterm 1", semester: "Spring" }),
      draft("b", { title: "Midterm 2" }),
      draft("c", { title: "Blank exam", document_variant: "Student Copy" }, false),
    ];
    state.update.mockReset().mockResolvedValue([]);
    state.publish.mockReset().mockResolvedValue({ published: [], failed: [] });
    state.remove.mockReset().mockResolvedValue("a");
    state.toast.mockReset();
    state.draftsError = false;
  });

  it("shows nothing when there are no drafts", () => {
    state.drafts = [];
    const { container } = render(<DraftsReview />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says who can see the drafts, and offers to publish them all", () => {
    render(<DraftsReview />);
    expect(screen.getByText(/3 drafts\. Only you can see them until you publish\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish all 3" })).toBeEnabled();
  });

  it("saves an edited cell on blur, and only when it changed", async () => {
    render(<DraftsReview />);
    const title = screen.getByRole("textbox", { name: "Title for Midterm 1" });
    fireEvent.blur(title);
    expect(state.update).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: "Midterm 1, Fall" } });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({ ids: ["a"], fields: { title: "Midterm 1, Fall" } }),
    );
  });

  it("puts back a value the column can't take instead of sending it", () => {
    render(<DraftsReview />);
    const year = screen.getByRole("textbox", { name: "Year for Midterm 2" });
    fireEvent.change(year, { target: { value: "1850" } });
    fireEvent.blur(year);
    expect(state.update).not.toHaveBeenCalled();
    expect(year).toHaveValue("");
  });

  it("sets one column for every selected row", async () => {
    render(<DraftsReview />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Midterm 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Midterm 2" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    // The picker starts on Semester with no value, which clears it on every
    // selected row (the choice lists themselves are Radix pickers).
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({ ids: ["a", "b"], fields: { semester: null } }),
    );
  });

  it("publishes only the selection, and keeps a refused row selected with its reason", async () => {
    state.publish.mockResolvedValue({
      published: [{ id: "a" }],
      failed: [{ id: "c", message: "A Student Copy has to be redacted." }],
    });
    render(<DraftsReview />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Midterm 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Blank exam" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish 2 selected" }));

    await waitFor(() => expect(state.publish).toHaveBeenCalledWith(["a", "c"]));
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Published 1 file to Backwork" }),
      ),
    );
    expect(screen.getByText("A Student Copy has to be redacted.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Blank exam" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Midterm 1" })).not.toBeChecked();
  });

  it("says before the press that an as-is upload can't be a Student Copy", () => {
    render(<DraftsReview />);
    const row = screen.getByRole("textbox", { name: "Title for Blank exam" }).closest("tr")!;
    expect(within(row).getByText("Uploaded as-is, so it can't be a Student Copy.")).toBeInTheDocument();
    expect(within(row).getByText("Uploaded as-is")).toBeInTheDocument();
  });

  it("clears a refused row's reason once the row is edited", async () => {
    state.publish.mockResolvedValue({
      published: [],
      failed: [{ id: "a", message: "Couldn't publish this one. Try again." }],
    });
    render(<DraftsReview />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Midterm 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish 1 selected" }));
    await screen.findByText("Couldn't publish this one. Try again.");

    const title = screen.getByRole("textbox", { name: "Title for Midterm 1" });
    fireEvent.change(title, { target: { value: "Midterm 1, Fall" } });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(screen.queryByText("Couldn't publish this one. Try again.")).not.toBeInTheDocument(),
    );
  });

  it("puts a cell back when its save fails", async () => {
    state.update.mockRejectedValue(new Error("offline"));
    render(<DraftsReview />);
    const title = screen.getByRole("textbox", { name: "Title for Midterm 2" });
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.blur(title);
    await waitFor(() => expect(title).toHaveValue("Midterm 2"));
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't save that change" }),
    );
  });

  it("counts only the chunks that never answered as failed", async () => {
    state.drafts = Array.from({ length: 60 }, (_, n) => draft(`d${n}`, { title: `Exam ${n}` }));
    state.publish
      .mockResolvedValueOnce({ published: Array.from({ length: 50 }, (_, n) => ({ id: `d${n}` })), failed: [] })
      .mockRejectedValueOnce(new Error("offline"));
    render(<DraftsReview />);
    fireEvent.click(screen.getByRole("button", { name: "Publish all 60" }));

    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Published 50 files to Backwork",
          description: "10 stayed drafts. The reason is on each row.",
        }),
      ),
    );
  });

  it("says so when the drafts can't load, instead of showing nothing", () => {
    state.draftsError = true;
    render(<DraftsReview />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your drafts.");
  });

  it("deletes one draft from its row", async () => {
    render(<DraftsReview />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Midterm 2" }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith("b"));
  });
});

describe("Backwork drafts waiting note", () => {
  it("links to the review table when drafts are waiting, and says nothing otherwise", () => {
    state.drafts = [draft("a", {})];
    const { rerender, container } = render(<DraftsWaitingNote />);
    expect(screen.getByRole("link", { name: "Review and publish" })).toHaveAttribute(
      "href",
      "/backwork/upload",
    );
    state.drafts = [];
    rerender(<DraftsWaitingNote />);
    expect(container).toBeEmptyDOMElement();
  });
});
