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
function harness(
  opts: {
    lookahead?: number;
    maxFinishing?: number;
    trim?: (prepared: string) => string;
    sizeOf?: (prepared: string) => number;
    maxHeldBytes?: number;
  } = {},
) {
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

  it("keeps uploading what was submitted after close, and frees the rest", async () => {
    const h = harness();
    h.queue.add(["a.pdf", "b.pdf"].map(pdf));
    h.prepares.get("a.pdf")!.resolve("A");
    h.prepares.get("b.pdf")!.resolve("B");
    await flush();
    h.queue.submit(h.idOf("a.pdf"), { title: "A" });
    expect(h.status("a.pdf")).toBe("finishing");

    h.queue.close();
    // b was only in review: its document goes back, and it waits to load again.
    expect(h.release).toHaveBeenCalledWith("B");
    expect(h.status("b.pdf")).toBe("queued");
    // a was submitted: it carries on.
    h.finishes.get("a.pdf")!.resolve();
    await flush();
    expect(h.status("a.pdf")).toBe("done");
    expect(h.queue.pendingUploads()).toBe(0);
  });

  it("survives close then open, like StrictMode's double mount", async () => {
    const h = harness();
    h.queue.close();
    h.queue.open();
    h.queue.add([pdf("a.pdf")]);
    expect(h.status("a.pdf")).toBe("preparing");
    h.prepares.get("a.pdf")!.resolve("A");
    await flush();
    expect(h.status("a.pdf")).toBe("ready");
    expect(h.queue.getSnapshot().currentId).toBe(h.idOf("a.pdf"));
  });

  it("releases a document that finishes loading after close, and reloads it on open", async () => {
    const h = harness();
    h.queue.add([pdf("a.pdf")]);
    h.queue.close();
    const first = h.prepares.get("a.pdf")!;
    first.resolve("A");
    await flush();
    expect(h.release).toHaveBeenCalledWith("A");
    expect(h.status("a.pdf")).toBe("queued");
    h.queue.open();
    expect(h.status("a.pdf")).toBe("preparing");
    expect(h.prepares.get("a.pdf")).not.toBe(first);
  });

  it("counts submitted items still waiting their turn as pending uploads", async () => {
    const h = harness({ maxFinishing: 1 });
    h.queue.add(["a.pdf", "b.pdf"].map(pdf));
    h.prepares.get("a.pdf")!.resolve("A");
    h.prepares.get("b.pdf")!.resolve("B");
    await flush();
    h.queue.submit(h.idOf("a.pdf"), { title: "A" });
    h.queue.submit(h.idOf("b.pdf"), { title: "B" });
    expect(h.status("b.pdf")).toBe("waiting");
    expect(h.queue.pendingUploads()).toBe(2);
  });

  it("knows which items are still in the batch, and tells prepare which one it is", async () => {
    const ids: string[] = [];
    const queue = new BulkUploadQueue<string, { title: string }>({
      prepare: async (_file, id) => {
        ids.push(id);
        return id;
      },
      finish: async () => undefined,
      release: () => undefined,
    });
    queue.add([pdf("a.pdf")]);
    const id = queue.getSnapshot().items[0]!.id;
    expect(ids).toEqual([id]);
    expect(queue.has(id)).toBe(true);
    queue.remove(id);
    expect(queue.has(id)).toBe(false);
    expect(queue.has("nope")).toBe(false);
  });

  it("leaves a failed upload's document and submission alone on close, ready to retry", async () => {
    const h = harness();
    h.queue.add([pdf("a.pdf")]);
    h.prepares.get("a.pdf")!.resolve("A");
    await flush();
    h.queue.submit(h.idOf("a.pdf"), { title: "A" });
    h.finishes.get("a.pdf")!.reject(new Error("Storage rejected the upload (500)."));
    await flush();
    h.queue.close();
    expect(h.release).not.toHaveBeenCalled();
    h.queue.open();
    h.queue.retry(h.idOf("a.pdf"));
    expect(h.status("a.pdf")).toBe("finishing");
    expect(h.prepares.size).toBe(1);
  });

  it("counts everything not uploaded yet as unsaved, but not a file that never opened", async () => {
    const h = harness();
    h.queue.add(["a.pdf", "b.pdf", "c.pdf"].map(pdf));
    h.prepares.get("a.pdf")!.resolve("A");
    h.prepares.get("b.pdf")!.reject(new Error("damaged"));
    await flush();
    h.queue.submit(h.idOf("a.pdf"), { title: "A" });
    expect(h.queue.unsaved()).toBe(2);
    h.finishes.get("a.pdf")!.resolve();
    await flush();
    expect(h.queue.unsaved()).toBe(1);
  });

  it("discards the batch, freeing an upload's document once it settles", async () => {
    const h = harness();
    h.queue.add(["a.pdf", "b.pdf"].map(pdf));
    h.prepares.get("a.pdf")!.resolve("A");
    h.prepares.get("b.pdf")!.resolve("B");
    await flush();
    h.queue.submit(h.idOf("a.pdf"), { title: "A" });
    h.queue.discard();
    expect(h.queue.getSnapshot().items).toEqual([]);
    expect(h.release).toHaveBeenCalledWith("B");
    expect(h.release).not.toHaveBeenCalledWith("A");
    h.finishes.get("a.pdf")!.reject(new Error("You switched chapters."));
    await flush();
    expect(h.release).toHaveBeenCalledWith("A");
    expect(h.queue.getSnapshot().items).toEqual([]);
  });

  it("doesn't count a failure that leaves nothing to save as unsaved", async () => {
    const queue = new BulkUploadQueue<string, { title: string }>({
      prepare: async () => "A",
      finish: async () => {
        throw Object.assign(new Error("Conflict"), { statusCode: 409 });
      },
      isFinal: (error) => (error as { statusCode?: number }).statusCode === 409,
    });
    queue.add([pdf("a.pdf")]);
    await flush();
    queue.submit(queue.getSnapshot().items[0]!.id, { title: "A" });
    await flush();
    expect(queue.getSnapshot().items[0]!.status).toBe("failed");
    expect(queue.unsaved()).toBe(0);
  });

  it("trims what only review needed the moment an item is submitted (#3540)", async () => {
    const trim = vi.fn((prepared: string) => `${prepared}-trimmed`);
    const h = harness({ trim });
    h.queue.add([pdf("a.pdf")]);
    h.prepares.get("a.pdf")!.resolve("A+previews");
    await flush();

    h.queue.submit(h.idOf("a.pdf"), { title: "A" });

    expect(trim).toHaveBeenCalledWith("A+previews");
    const item = h.queue.getSnapshot().items[0]!;
    expect(item.prepared).toBe("A+previews-trimmed");
    // Finishing frees what the item kept, not what it had before the trim.
    h.finishes.get("a.pdf")!.resolve();
    await flush();
    expect(h.release).toHaveBeenCalledWith("A+previews-trimmed");
  });

  it("stops preparing ahead while waiting uploads hold more than the budget (#3540)", async () => {
    const h = harness({
      maxFinishing: 1,
      sizeOf: () => 60,
      maxHeldBytes: 100,
    });
    h.queue.add(["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf", "f.pdf"].map(pdf));
    for (const name of ["a.pdf", "b.pdf", "c.pdf"]) {
      h.prepares.get(name)!.resolve(name);
    }
    await flush();
    // Submitting a (60 held) leaves the lookahead on, so d is prepared.
    h.queue.submit(h.idOf("a.pdf"), { title: "a" });
    expect(h.prepares.has("d.pdf")).toBe(true);
    // a uploading and b waiting hold 120, over 100: c is current and
    // nothing past it is prepared, not even once c is submitted too.
    h.queue.submit(h.idOf("b.pdf"), { title: "b" });
    h.queue.submit(h.idOf("c.pdf"), { title: "c" });
    expect(h.prepares.has("e.pdf")).toBe(false);

    // a finishes, b starts: b and c still hold 120, so still no lookahead.
    h.finishes.get("a.pdf")!.resolve();
    await flush();
    expect(h.prepares.has("e.pdf")).toBe(false);

    // b finishes: c alone holds 60, under the budget, so lookahead resumes.
    h.finishes.get("b.pdf")!.resolve();
    await flush();
    expect(h.prepares.has("e.pdf")).toBe(true);
    expect(h.prepares.has("f.pdf")).toBe(true);
  });
});
