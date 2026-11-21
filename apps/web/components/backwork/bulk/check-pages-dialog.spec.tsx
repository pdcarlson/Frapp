import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackworkDraft } from "@repo/hooks";
import { sha256Hex } from "@/lib/bulk-upload/hash";

const FLAT = new TextEncoder().encode("%PDF-1.7 flattened again");

const state = vi.hoisted(() => ({
  check: vi.fn(),
  requestUpload: vi.fn(),
  put: vi.fn(),
  fileUrl: vi.fn(),
  flatten: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCheckBackworkDraft: () => ({ mutateAsync: state.check }),
  useRequestBackworkUploadUrl: () => ({ mutateAsync: state.requestUpload }),
  useFetchBackworkDraftFileUrl: () => state.fileUrl,
  putSignedUpload: state.put,
}));
vi.mock("@/lib/backwork-bulk/pdf", () => ({
  loadPdf: vi.fn(async () => ({ numPages: 2 })),
  destroyPdf: vi.fn(async () => undefined),
  renderPagePreview: vi.fn(async () => ({ url: "blob:x", width: 612, height: 792 })),
  flattenPdf: state.flatten,
}));
vi.mock("./pdf-redactor", () => ({
  PdfRedactor: ({ onChange }: { onChange: (boxes: object) => void }) => (
    <button type="button" onClick={() => onChange({ 2: [{ x: 10, y: 10, width: 80, height: 20 }] })}>
      Draw a box
    </button>
  ),
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));

import { CheckPagesDialog } from "./check-pages-dialog";

const draft: BackworkDraft = {
  id: "d1",
  storage_path: "chapters/c/backwork/r/quiz.pdf",
  is_redacted: true,
  created_at: "2026-11-16T00:00:00Z",
  draft_fields: { title: "Quiz 3", pages_unchecked: true },
};

describe("Check pages (#5252)", () => {
  beforeEach(() => {
    state.check.mockReset().mockResolvedValue(draft);
    state.requestUpload.mockReset().mockResolvedValue({
      upload_url: "https://storage.example/upload",
      storage_path: "chapters/c/backwork/r2/Quiz-3.pdf",
    });
    state.put.mockReset().mockResolvedValue(undefined);
    state.fileUrl.mockReset().mockResolvedValue("https://storage.example/quiz.pdf");
    state.flatten.mockReset().mockResolvedValue(FLAT);
    state.toast.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70]))),
    );
  });

  it("marks the draft checked as it is when no box was added", async () => {
    const onClose = vi.fn();
    render(<CheckPagesDialog draft={draft} onClose={onClose} />);
    const done = await screen.findByRole("button", { name: "Looks right" });
    await waitFor(() => expect(done).toBeEnabled());
    fireEvent.click(done);
    await waitFor(() => expect(state.check).toHaveBeenCalledWith({ id: "d1" }));
    expect(state.flatten).not.toHaveBeenCalled();
    expect(state.requestUpload).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("flattens again with the added box and swaps in only that copy", async () => {
    render(<CheckPagesDialog draft={draft} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Draw a box" }));
    fireEvent.click(screen.getByRole("button", { name: "Save boxes" }));

    await waitFor(() => expect(state.check).toHaveBeenCalled());
    expect(state.flatten).toHaveBeenCalledWith({ numPages: 2 }, { 2: [expect.any(Object)] });
    // Named after the title, never anything else.
    expect(state.requestUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "Quiz-3.pdf", size_bytes: FLAT.byteLength }),
    );
    expect(state.check).toHaveBeenCalledWith({
      id: "d1",
      replacement: {
        storage_path: "chapters/c/backwork/r2/Quiz-3.pdf",
        file_hash: await sha256Hex(FLAT),
      },
    });
  });

  it("keeps the dialog open and says so when the check doesn't save", async () => {
    state.check.mockRejectedValue(new Error("offline"));
    const onClose = vi.fn();
    render(<CheckPagesDialog draft={draft} onClose={onClose} />);
    const done = await screen.findByRole("button", { name: "Looks right" });
    await waitFor(() => expect(done).toBeEnabled());
    fireEvent.click(done);
    await waitFor(() => expect(state.toast).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says when the file can't be opened", async () => {
    state.fileUrl.mockRejectedValue(new Error("Draft not found"));
    render(<CheckPagesDialog draft={draft} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/open this draft|Draft not found/);
    expect(screen.getByRole("button", { name: "Looks right" })).toBeDisabled();
  });
});
