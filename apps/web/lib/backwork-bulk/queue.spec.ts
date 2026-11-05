import { describe, expect, it, vi } from "vitest";
import { BulkUploadQueue } from "./queue";

/** A promise the test resolves or rejects by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function pdf(name: string): File {
  return new File(["%PDF"], name, { type: "application/pdf" });
}

/** A queue whose prepare and finish calls the test settles one by one. */
function harness(opts: { lookahead?: number; maxFinishing?: number } = {}) {
  const prepares = new Map<string, ReturnType<typeof deferred<string>>>();
  const finishes = new Map<string, ReturnType<typeof deferred<void>>>();
  const release = vi.fn();
  const queue = new BulkUploadQueue<string, { title: string }>({
    ...opts,
    prepare: (file) => {
      const d = deferred<string>();
      prepares.set(file.name, d);
      return d.promise;
    },
    finish: ({ file }) => {
      const d = deferred<void>();
      finishes.set(file.name, d);
      return d.promise;
    },
    release,
  });
  const status = (name: string) =>
    queue.getSnapshot().items.find((it) => it.file.name === name)?.status;
  const idOf = (name: string) =>
    queue.getSnapshot().items.find((it) => it.file.name === name)!.id;
  return { queue, prepares, finishes, release, status, idOf };
}

describe("BulkUploadQueue", () => {
  it("prepares the current item and the next two before anyone asks", () => {
    const h = harness();
    h.queue.add(["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"].map(pdf));
    expect([...h.prepares.keys()]).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(h.status("d.pdf")).toBe("queued");
  });

  it("has the next document ready the moment the current one is submitted", async () => {
    const h = harness();
    h.queue.add(["a.pdf", "b.pdf", "c.pdf", "d.pdf"].map(pdf));
    h.prepares.get("a.pdf")!.resolve("A");
    h.prepares.get("b.pdf")!.resolve("B");
    await flush();

    h.queue.submit(h.idOf("a.pdf"), { title: "Exam 1" });
    // No await: the person's next view is already there.
    expect(h.queue.getSnapshot().currentId).toBe(h.idOf("b.pdf"));
    expect(h.status("b.pdf")).toBe("ready");
    // The window slid, so d starts preparing.
    expect(h.prepares.has("d.pdf")).toBe(true);
  });

  it("finishes behind the person without blocking review", async () => {
    const h = harness();
    h.queue.add(["a.pdf", "b.pdf"].map(pdf));
    h.prepares.get("a.pdf")!.resolve("A");
    h.prepares.get("b.pdf")!.resolve("B");
    await flush();

    h.queue.submit(h.idOf("a.pdf"), { title: "Exam 1" });
    expect(h.status("a.pdf")).toBe("finishing");
    h.queue.submit(h.idOf("b.pdf"), { title: "Exam 2" });
    expect(h.status("b.pdf")).toBe("finishing");
    expect(h.queue.getSnapshot().currentId).toBeNull();

    h.finishes.get("a.pdf")!.resolve();
    await flush();
    expect(h.status("a.pdf")).toBe("done");
    expect(h.release).toHaveBeenCalledWith("A");
  });

  it("caps uploads in flight and starts the next as one completes", async () => {
    const h = harness({ maxFinishing: 1 });
    h.queue.add(["a.pdf", "b.pdf"].map(pdf));
    h.prepares.get("a.pdf")!.resolve("A");
    h.prepares.get("b.pdf")!.resolve("B");
    await flush();
    h.queue.submit(h.idOf("a.pdf"), { title: "1" });
    h.queue.submit(h.idOf("b.pdf"), { title: "2" });
    expect(h.status("b.pdf")).toBe("waiting");

    h.finishes.get("a.pdf")!.resolve();
    await flush();
    expect(h.status("b.pdf")).toBe("finishing");
  });

  it("retries a failed upload with the same submission, without preparing again", async () => {
    const h = harness();
    h.queue.add([pdf("a.pdf")]);
    h.prepares.get("a.pdf")!.resolve("A");
    await flush();
    h.queue.submit(h.idOf("a.pdf"), { title: "Exam 1" });
    h.finishes.get("a.pdf")!.reject(new Error("Storage rejected upload (500)."));
    await flush();

    const failed = h.queue.getSnapshot().items[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Storage rejected upload (500).");
    expect(h.queue.getSnapshot().currentId).toBeNull();

    h.prepares.clear();
    h.queue.retry(failed.id);
    expect(h.status("a.pdf")).toBe("finishing");
    expect(h.prepares.size).toBe(0);
    expect(h.queue.getSnapshot().items[0]!.submission).toEqual({
      title: "Exam 1",
    });
  });

  it("keeps a document that failed to load in front of the person", async () => {
    const h = harness();
    h.queue.add(["a.pdf", "b.pdf"].map(pdf));
    h.prepares.get("a.pdf")!.reject(new Error("Not a readable PDF."));
    await flush();
    expect(h.queue.getSnapshot().currentId).toBe(h.idOf("a.pdf"));

    h.queue.retry(h.idOf("a.pdf"));
    expect(h.status("a.pdf")).toBe("preparing");
  });

  it("frees a removed item and never lets a late prepare resurrect it", async () => {
    const h = harness();
    h.queue.add(["a.pdf", "b.pdf"].map(pdf));
    const id = h.idOf("a.pdf");
    h.queue.remove(id);
    h.prepares.get("a.pdf")!.resolve("A");
    await flush();
    expect(h.queue.getSnapshot().items.map((it) => it.file.name)).toEqual([
      "b.pdf",
    ]);
    expect(h.release).toHaveBeenCalledWith("A");
  });

  it("only accepts a submission for a prepared item", () => {
    const h = harness();
    h.queue.add([pdf("a.pdf")]);
    h.queue.submit(h.idOf("a.pdf"), { title: "too soon" });
    expect(h.status("a.pdf")).toBe("preparing");
  });
});
