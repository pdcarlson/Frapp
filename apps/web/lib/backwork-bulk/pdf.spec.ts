import { describe, expect, it, vi } from "vitest";

/**
 * Every bulk upload document shares one pdf.js worker port, and pdf.js
 * refuses to open a document on it while another is being destroyed. The
 * stub below throws the way pdf.js does, so a load that doesn't wait for
 * teardown fails here.
 */
const worker = vi.hoisted(() => ({ destroying: 0, opened: 0 }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  version: "test",
  GlobalWorkerOptions: { workerPort: {} },
  getDocument: () => {
    if (worker.destroying > 0) throw new Error("the worker is being destroyed");
    worker.opened += 1;
    let release: () => void = () => undefined;
    const task = {
      promise: Promise.resolve({ numPages: 1, loadingTask: undefined as unknown }),
      destroy: () => {
        worker.destroying += 1;
        return new Promise<void>((resolve) => {
          release = () => {
            worker.destroying -= 1;
            resolve();
          };
          setTimeout(() => release(), 10);
        });
      },
    };
    void task.promise.then((doc) => {
      doc.loadingTask = task;
    });
    return task;
  },
}));

describe("pdf teardown", () => {
  it("opens the next document only after an earlier one finishes tearing down", async () => {
    const { loadPdf, destroyPdf } = await import("./pdf");
    const first = await loadPdf(new Uint8Array([1]));
    const torn = destroyPdf(first);
    const second = await loadPdf(new Uint8Array([2]));
    expect(second.numPages).toBe(1);
    expect(worker.opened).toBe(2);
    await torn;
    // Two teardowns in a row run one after the other.
    const a = await loadPdf(new Uint8Array([3]));
    const b = await loadPdf(new Uint8Array([4]));
    void destroyPdf(a);
    const last = destroyPdf(b);
    const third = await loadPdf(new Uint8Array([5]));
    expect(third.numPages).toBe(1);
    await last;
    expect(worker.destroying).toBe(0);
  });
});
