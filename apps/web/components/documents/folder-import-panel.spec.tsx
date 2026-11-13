import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";

const { mockMint, mockConfirm, mockInvalidate } = vi.hoisted(() => ({
  mockMint: vi.fn(),
  mockConfirm: vi.fn(),
  mockInvalidate: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRequestDocumentUploadUrls: () => ({ mutateAsync: mockMint }),
  useConfirmDocumentUploads: () => ({ mutateAsync: mockConfirm }),
  useInvalidateDocuments: () => mockInvalidate,
}));

vi.mock("@/lib/stores/chapter-store", () => {
  const state = { activeChapterId: "chap-1" };
  const useChapterStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useChapterStore.getState = () => state;
  return { useChapterStore };
});

const { FolderImportPanel } = await import("./folder-import-panel");

const GATE: SubscriptionGate = {
  allowed: true,
  isPending: false,
  isOffline: false,
  state: { allowed: true } as SubscriptionGate["state"],
  noticeId: "notice",
  controlProps: (alsoDisabled) => ({
    disabled: Boolean(alsoDisabled),
    title: undefined,
    "aria-describedby": undefined,
  }),
  noticeRef: createRef(),
};

const CONTEXT = {
  typeOptions: ["Bylaws", "Minutes", "Budget", "Policy"],
  folders: ["Governance"],
  documents: [],
};

function picked(path: string, body = path, type = "application/pdf") {
  const file = new File([body], path.slice(path.lastIndexOf("/") + 1), { type });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

async function openAndPick(files: File[]) {
  render(<FolderImportPanel gate={GATE} context={CONTEXT} />);
  await userEvent.click(screen.getByRole("button", { name: /import a folder/i }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Choose a folder"), {
    target: { files },
  });
  return dialog;
}

describe("FolderImportPanel (#2242)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMint.mockImplementation(async ({ files }: { files: { filename: string }[] }) => ({
      tickets: files.map((f, i) => ({
        upload_url: `https://put/${i}`,
        storage_path: `chapters/chap-1/documents/${i}/${f.filename}`,
        document_id: `${i}`,
      })),
    }));
    mockConfirm.mockImplementation(
      async ({ documents }: { documents: { storage_path: string }[] }) => ({
        results: documents.map((d) => ({ storage_path: d.storage_path })),
      }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
  });

  it("groups files by suggested folder, lists what's left out, and holds copies back", async () => {
    const dialog = await openAndPick([
      picked("Drop/Governance/bylaws.pdf", "a"),
      picked("Drop/Rush/flyer.pdf", "b"),
      picked("Drop/Rush/flyer copy.pdf", "b"),
      picked("Drop/Media/clip.mov", "c", "video/quicktime"),
    ]);

    await waitFor(() =>
      expect(within(dialog).getByText(/2 files to import/)).toBeInTheDocument(),
    );
    expect(within(dialog).getByText(/1 possible copy/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 left out/)).toBeInTheDocument();

    const governance = within(dialog).getByRole("region", { name: "Folder Governance" });
    expect(within(governance).getByLabelText("Title for Drop/Governance/bylaws.pdf")).toHaveValue(
      "Bylaws",
    );
    const rush = within(dialog).getByRole("region", { name: "Folder Rush" });
    expect(within(rush).getByText("New folder")).toBeInTheDocument();

    const copies = within(dialog).getByRole("region", { name: "Possible copies" });
    expect(within(copies).getByRole("checkbox")).not.toBeChecked();
  });

  it("imports what's kept with the officer's edits and refreshes Documents once", async () => {
    const dialog = await openAndPick([
      picked("Drop/Governance/bylaws.pdf", "a"),
      picked("Drop/notes.pdf", "b"),
    ]);
    await waitFor(() =>
      expect(within(dialog).getByText(/2 files to import/)).toBeInTheDocument(),
    );
    const title = within(dialog).getByLabelText("Title for Drop/notes.pdf");
    await userEvent.clear(title);
    await userEvent.type(title, "Spring notes");

    await userEvent.click(within(dialog).getByRole("button", { name: "Import 2 files" }));

    await waitFor(() =>
      expect(within(dialog).getByText("Imported 2 of 2 files")).toBeInTheDocument(),
    );
    expect(mockMint).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const documents = mockConfirm.mock.calls[0]![0].documents;
    expect(documents.map((d: { title: string }) => d.title)).toEqual([
      "Bylaws",
      "Spring notes",
    ]);
    expect(documents[0]).toMatchObject({ folder: "Governance", document_type: "Bylaws" });
    await waitFor(() => expect(mockInvalidate).toHaveBeenCalledTimes(1));
  });

  it("names a file the server refused and retries it", async () => {
    mockConfirm.mockImplementationOnce(
      async ({ documents }: { documents: { storage_path: string }[] }) => ({
        results: documents.map((d) => ({
          storage_path: d.storage_path,
          error: "This chapter already has 50 document types.",
        })),
      }),
    );
    const dialog = await openAndPick([picked("Drop/bylaws.pdf")]);
    await waitFor(() =>
      expect(within(dialog).getByText(/1 file to import/)).toBeInTheDocument(),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Import 1 file" }));
    const failed = await within(dialog).findByRole("region", { name: "Didn't import" });
    expect(within(failed).getByText(/50 document types/)).toBeInTheDocument();

    await userEvent.click(within(failed).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(within(dialog).getByText("Imported 1 of 1 file")).toBeInTheDocument(),
    );
  });
});
