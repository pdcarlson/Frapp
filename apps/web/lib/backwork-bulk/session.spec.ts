import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChapterStore } from "@/lib/stores/chapter-store";
import {
  confirmDropBulkUploads,
  endBulkSessions,
  getBulkSession,
  type BulkSession,
} from "./session";

/**
 * The per-chapter batch (#3499): it outlives the page, and it ends with the
 * chapter or account it was made under. pdf.js, storage and toasts are
 * stubbed; the queue and finish step are the real ones.
 */
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/use-toast", () => ({ toast }));
const auth = vi.hoisted(() => ({ userId: "u1" as string | null }));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: auth.userId ? { user: { id: auth.userId } } : null },
      }),
    },
  }),
}));
vi.mock("@repo/hooks", () => ({ putSignedUpload: async () => undefined }));
vi.mock("./pdf", () => ({
  loadPdf: async () => ({ numPages: 1, loadingTask: { destroy: async () => undefined } }),
  renderPagePreview: async () => ({ url: "blob:preview", width: 10, height: 10 }),
  flattenPdf: async () => new TextEncoder().encode("%PDF flat"),
}));

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const spies: { mockRestore: () => void }[] = [];

function pdf(name: string, body = name): File {
  return new File([`%PDF ${body}`], name, { type: "application/pdf" });
}

function bindMutations(session: BulkSession) {
  const confirm = vi.fn(async () => ({}));
  session.bind({
    requestUpload: {
      mutateAsync: vi.fn(async () => ({
        upload_url: "https://storage.example/u",
        storage_path: "chapters/c1/backwork/r/x.pdf",
      })),
    },
    confirmUpload: { mutateAsync: confirm },
  } as never);
  return confirm;
}

const statusOf = (session: BulkSession, name: string) =>
  session.queue.getSnapshot().items.find((it) => it.file.name === name)?.status;
const idOf = (session: BulkSession, name: string) =>
  session.queue.getSnapshot().items.find((it) => it.file.name === name)!.id;

const fields = {
  title: "Exam",
  department_code: "",
  course_number: "",
  professor_name: "",
  year: "",
  semester: "",
  assignment_type: "",
  assignment_number: "",
  document_variant: "Blank Copy",
  tags: "",
};

beforeEach(() => {
  auth.userId = "u1";
  useChapterStore.setState({ activeChapterId: "c1" });
  toast.mockClear();
});

afterEach(() => {
  endBulkSessions();
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("bulk upload session", () => {
  it("keeps one batch per chapter across visits", () => {
    const first = getBulkSession("u1", "c1");
    first.queue.add([pdf("a.pdf")]);
    expect(getBulkSession("u1", "c1")).toBe(first);
    expect(getBulkSession("u1", "c2")).not.toBe(first);
  });

  it("ends every batch when the chapter changes, with no leave prompt", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    spies.push(add, remove);
    const session = getBulkSession("u1", "c1");
    session.queue.add([pdf("a.pdf")]);
    expect(add).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    useChapterStore.setState({ activeChapterId: "c2" });
    expect(session.ended()).toBe(true);
    expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(session.queue.getSnapshot().items).toEqual([]);
    useChapterStore.setState({ activeChapterId: "c1" });
    expect(getBulkSession("u1", "c1")).not.toBe(session);
  });

  it("never files an upload from an ended batch, and says nothing about it", async () => {
    const session = getBulkSession("u1", "c1");
    const confirm = bindMutations(session);
    session.queue.add([pdf("a.pdf")]);
    await vi.waitFor(() => expect(statusOf(session, "a.pdf")).toBe("ready"));
    session.queue.submit(idOf(session, "a.pdf"), { fields, boxes: {}, flatten: false });
    endBulkSessions();
    await flush();
    expect(confirm).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("uploads in the background and toasts a failure while the page is closed", async () => {
    const session = getBulkSession("u1", "c1");
    const confirm = bindMutations(session);
    session.queue.add([pdf("a.pdf"), pdf("b.pdf")]);
    await vi.waitFor(() => expect(session.queue.getSnapshot().items.map((it) => `${it.status}:${it.error ?? ""}`)).toEqual(["ready:", "ready:"]));
    session.queue.submit(idOf(session, "a.pdf"), { fields, boxes: {}, flatten: false });
    await vi.waitFor(() => expect(statusOf(session, "a.pdf")).toBe("done"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();

    confirm.mockRejectedValueOnce(new Error("Server error"));
    session.queue.submit(idOf(session, "b.pdf"), { fields, boxes: {}, flatten: false });
    await vi.waitFor(() => expect(statusOf(session, "b.pdf")).toBe("failed"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "A backwork upload failed" }));
  });

  it("refuses a second copy of a file while the first is in the batch", async () => {
    const session = getBulkSession("u1", "c1");
    session.queue.add([pdf("a.pdf", "same"), pdf("copy.pdf", "same")]);
    await vi.waitFor(() => expect(statusOf(session, "copy.pdf")).toBe("failed"));
    expect(statusOf(session, "a.pdf")).toBe("ready");

    session.queue.remove(idOf(session, "a.pdf"));
    session.queue.retry(idOf(session, "copy.pdf"));
    await vi.waitFor(() => expect(statusOf(session, "copy.pdf")).toBe("ready"));
  });

  it("ends another account's batch, and keeps the new account's", () => {
    const mine = getBulkSession("u1", "c1");
    mine.queue.add([pdf("a.pdf")]);
    const theirs = getBulkSession("u2", "c1");
    expect(mine.ended()).toBe(true);
    expect(mine.queue.getSnapshot().items).toEqual([]);
    expect(theirs.queue.getSnapshot().items).toEqual([]);
    endBulkSessions({ except: "u2" });
    expect(theirs.ended()).toBe(false);
    expect(getBulkSession("u2", "c1")).toBe(theirs);
  });

  it("files nothing once another account is signed in, even before the batch ends", async () => {
    const session = getBulkSession("u1", "c1");
    const confirm = bindMutations(session);
    session.queue.add([pdf("a.pdf")]);
    await vi.waitFor(() => expect(statusOf(session, "a.pdf")).toBe("ready"));
    auth.userId = "u2";
    session.queue.submit(idOf(session, "a.pdf"), { fields, boxes: {}, flatten: false });
    await vi.waitFor(() => expect(statusOf(session, "a.pdf")).toBe("failed"));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before a switch drops documents that aren't uploaded", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    spies.push(ask);
    expect(confirmDropBulkUploads("switch")).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    getBulkSession("u1", "c1").queue.add([pdf("a.pdf"), pdf("b.pdf")]);
    expect(confirmDropBulkUploads("switch")).toBe(false);
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("2 documents"));
  });
});
