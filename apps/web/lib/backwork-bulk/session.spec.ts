import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { stageBulkUpload, takeStagedBulkUpload } from "./handoff";
import {
  bulkDropNotice,
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
// The real hash, with a hook a test can use to hold one call back.
const hashGate = vi.hoisted(() => ({ hold: null as null | ((call: number) => Promise<void> | undefined), calls: 0 }));
vi.mock("./finish", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./finish")>();
  return {
    ...actual,
    sha256Hex: async (bytes: Uint8Array) => {
      hashGate.calls += 1;
      await hashGate.hold?.(hashGate.calls);
      return actual.sha256Hex(bytes);
    },
  };
});
vi.mock("./pdf", () => ({
  loadPdf: async () => ({ numPages: 1, loadingTask: { destroy: async () => undefined } }),
  renderPagePreview: async () => ({ url: "blob:preview", width: 10, height: 10 }),
  flattenPdf: async () => new TextEncoder().encode("%PDF flat"),
  destroyPdf: async () => undefined,
}));

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const spies: { mockRestore: () => void }[] = [];
// Hashing and the stubbed load go through real async work, which a busy
// full-suite run can slow past vitest's 1 s default.
const WAIT = { timeout: 5000 };
// A test runs up to three WAITs in a row, so its own budget has to cover
// their sum: inside vitest's 5 s default, one slow CI wait failed the test
// as a timeout before the wait itself could give up.
const TEST_TIMEOUT = 20_000;

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
  hashGate.hold = null;
  hashGate.calls = 0;
  auth.userId = "u1";
  useChapterStore.setState({ activeChapterId: "c1" });
  toast.mockClear();
});

afterEach(() => {
  endBulkSessions();
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("bulk upload session", { timeout: TEST_TIMEOUT }, () => {
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

  it("never files an upload from an ended batch, and says only what it dropped", async () => {
    const session = getBulkSession("u1", "c1");
    const confirm = bindMutations(session);
    session.queue.add([pdf("a.pdf")]);
    await vi.waitFor(() => expect(statusOf(session, "a.pdf")).toBe("ready"), WAIT);
    session.queue.submit(idOf(session, "a.pdf"), { fields, boxes: {}, flatten: false });
    endBulkSessions();
    await flush();
    expect(confirm).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Bulk upload stopped",
        description: expect.stringContaining("1 document that wasn't uploaded was dropped"),
      }),
    );
  });

  it("ends an empty or fully uploaded batch without a word", () => {
    getBulkSession("u1", "c1");
    useChapterStore.setState({ activeChapterId: "c2" });
    expect(toast).not.toHaveBeenCalled();
  });

  it("uploads in the background and toasts a failure while the page is closed", async () => {
    const session = getBulkSession("u1", "c1");
    const confirm = bindMutations(session);
    session.queue.add([pdf("a.pdf"), pdf("b.pdf")]);
    await vi.waitFor(() => expect(session.queue.getSnapshot().items.map((it) => `${it.status}:${it.error ?? ""}`)).toEqual(["ready:", "ready:"]), WAIT);
    session.queue.submit(idOf(session, "a.pdf"), { fields, boxes: {}, flatten: false });
    await vi.waitFor(() => expect(statusOf(session, "a.pdf")).toBe("done"), WAIT);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();

    confirm.mockRejectedValueOnce(new Error("Server error"));
    session.queue.submit(idOf(session, "b.pdf"), { fields, boxes: {}, flatten: false });
    await vi.waitFor(() => expect(statusOf(session, "b.pdf")).toBe("failed"), WAIT);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "A backwork upload failed" }));
  });

  it("refuses a second copy of a file while the first is in the batch", async () => {
    const session = getBulkSession("u1", "c1");
    session.queue.add([pdf("a.pdf", "same"), pdf("copy.pdf", "same")]);
    await vi.waitFor(() => expect(statusOf(session, "copy.pdf")).toBe("failed"), WAIT);
    expect(statusOf(session, "a.pdf")).toBe("ready");

    session.queue.remove(idOf(session, "a.pdf"));
    session.queue.retry(idOf(session, "copy.pdf"));
    await vi.waitFor(() => expect(statusOf(session, "copy.pdf")).toBe("ready"), WAIT);
  });

  it("refuses the later copy even when the earlier copy's hash finishes last (#3665)", async () => {
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    // Hold the first file's hash until the second file's has finished.
    hashGate.hold = (call) => (call === 1 ? firstHeld : undefined);
    const session = getBulkSession("u1", "c1");
    session.queue.add([pdf("a.pdf", "same"), pdf("copy.pdf", "same")]);
    await vi.waitFor(() => expect(hashGate.calls).toBe(2), WAIT);
    await flush();
    expect(statusOf(session, "a.pdf")).toBe("preparing");
    expect(statusOf(session, "copy.pdf")).toBe("preparing");

    releaseFirst();
    await vi.waitFor(() => expect(statusOf(session, "copy.pdf")).toBe("failed"), WAIT);
    await vi.waitFor(() => expect(statusOf(session, "a.pdf")).toBe("ready"), WAIT);
  });

  it("refuses the later copy when its hash finishes last, too (#3665)", async () => {
    let releaseSecond!: () => void;
    const secondHeld = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    hashGate.hold = (call) => (call === 2 ? secondHeld : undefined);
    const session = getBulkSession("u1", "c1");
    session.queue.add([pdf("a.pdf", "same"), pdf("copy.pdf", "same")]);
    await vi.waitFor(() => expect(statusOf(session, "a.pdf")).toBe("ready"), WAIT);
    expect(statusOf(session, "copy.pdf")).toBe("preparing");

    releaseSecond();
    await vi.waitFor(() => expect(statusOf(session, "copy.pdf")).toBe("failed"), WAIT);
    expect(statusOf(session, "a.pdf")).toBe("ready");
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
    await vi.waitFor(() => expect(statusOf(session, "a.pdf")).toBe("ready"), WAIT);
    auth.userId = "u2";
    session.queue.submit(idOf(session, "a.pdf"), { fields, boxes: {}, flatten: false });
    await vi.waitFor(() => expect(statusOf(session, "a.pdf")).toBe("failed"), WAIT);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("names what a switch, sign-out or deletion would drop, and nothing when nothing would", () => {
    expect(bulkDropNotice("switch")).toBeNull();
    getBulkSession("u1", "c1").queue.add([pdf("a.pdf"), pdf("b.pdf")]);
    expect(bulkDropNotice("switch")).toBe(
      "Bulk upload has 2 documents that aren't uploaded yet. Switching chapters drops them.",
    );
    expect(bulkDropNotice("sign-out")).toContain("Signing out drops them.");
    expect(bulkDropNotice("delete-account")).toContain("Deleting your account drops them.");
  });

  it("drops files staged for bulk upload when batches end, so the next account never gets them", () => {
    const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    stageBulkUpload({ files: [pdf], skipped: 0 });
    endBulkSessions({ except: "u2" });
    expect(takeStagedBulkUpload()).toBeNull();
  });
});
