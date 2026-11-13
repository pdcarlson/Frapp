import { describe, expect, it, vi } from "vitest";
import {
  FolderImport,
  duplicateReasons,
  isIncluded,
  type ConfirmRequest,
  type ImportDeps,
  type MintRequest,
} from "./folder-import-session";

const flush = async () => {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function file(path: string, body = path, type = "application/pdf"): File {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const f = new File([body], name, { type });
  Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}

const CONTEXT = {
  typeOptions: ["Bylaws", "Minutes", "Budget"],
  folders: ["Governance"],
  documents: [
    {
      title: "Old budget",
      storage_path: "chapters/c/documents/1/budget.pdf",
      byte_size: 6,
      document_type: "Budget",
      folder: null,
    },
  ],
};

function harness(overrides: Partial<ImportDeps> = {}) {
  let n = 0;
  const deps: ImportDeps = {
    mint: vi.fn(async (files: MintRequest[]) =>
      files.map((f) => {
        n += 1;
        return {
          upload_url: `https://put/${n}`,
          storage_path: `chapters/c/documents/${n}/${f.filename}`,
        };
      }),
    ),
    put: vi.fn(async () => undefined),
    confirm: vi.fn(async (docs: ConfirmRequest[]) =>
      docs.map((d) => ({ storage_path: d.storage_path })),
    ),
    assertChapter: vi.fn(),
    sleep: vi.fn(async () => undefined),
    confirmWaitMs: 5,
    ...overrides,
  };
  return { deps, run: new FolderImport(deps) };
}

describe("FolderImport", () => {
  it("leaves out what Documents can't take and suggests the rest", () => {
    const { run } = harness();
    run.add(
      [
        file("Chapter/Governance/bylaws.pdf"),
        file("Chapter/Media/clip.mov", "x", "video/quicktime"),
      ],
      CONTEXT,
    );
    const view = run.getSnapshot();
    expect(view.leftOut).toEqual([
      { path: "Chapter/Media/clip.mov", reason: "type" },
    ]);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({
      title: "Bylaws",
      documentType: "Bylaws",
      folder: "Governance",
    });
    expect(view.rows[0]!.id).not.toBe("");
  });

  it("flags the same bytes twice and a likely copy in Documents, and leaves both out by default", async () => {
    const { run } = harness();
    run.add(
      [
        file("A/minutes.pdf", "same"),
        file("A/minutes copy.pdf", "same"),
        file("A/budget.pdf", "123456"),
      ],
      CONTEXT,
    );
    await flush();
    const view = run.getSnapshot();
    const reasons = duplicateReasons(view.rows, view.queue);
    const [first, copy, budget] = view.rows;
    expect(reasons.get(first!.id)).toBeUndefined();
    expect(reasons.get(copy!.id)).toBe("in-import");
    expect(reasons.get(budget!.id)).toBe("in-library");
    expect(isIncluded(copy!, reasons.get(copy!.id))).toBe(false);
    expect(isIncluded({ ...copy!, include: true }, "in-import")).toBe(true);
  });

  it("uploads and files what's kept on Import, in shared batches", async () => {
    const { run, deps } = harness();
    run.add(
      [
        file("Drop/Governance/bylaws.pdf", "b"),
        file("Drop/Governance/policy.pdf", "p"),
        file("Drop/budget.pdf", "123456"),
      ],
      CONTEXT,
    );
    await flush();
    const policy = run.getSnapshot().rows[1]!;
    run.update(policy.id, { title: "Risk policy", documentType: "" });

    expect(run.apply()).toBe(2);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await flush();

    // One mint and one confirm for both; the likely copy was left out.
    expect(deps.mint).toHaveBeenCalledTimes(1);
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    const filed = vi.mocked(deps.confirm).mock.calls[0]![0];
    expect(filed.map((d) => [d.title, d.folder, d.document_type])).toEqual([
      ["Bylaws", "Governance", "Bylaws"],
      ["Risk policy", "Governance", undefined],
    ]);
    const statuses = run.getSnapshot().queue.items.map((it) => it.status);
    expect(statuses).toEqual(["done", "done"]);
  });

  it("marks a file the server refused, with its reason, and retries it", async () => {
    let refuse = true;
    const { run } = harness({
      confirm: vi.fn(async (docs: ConfirmRequest[]) =>
        docs.map((d) =>
          refuse
            ? { storage_path: d.storage_path, error: "Type list is full" }
            : { storage_path: d.storage_path },
        ),
      ),
    });
    run.add([file("Drop/bylaws.pdf")], CONTEXT);
    await flush();
    run.apply();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await flush();
    const item = run.getSnapshot().queue.items[0]!;
    expect(item.status).toBe("failed");
    expect(item.error).toBe("Type list is full");

    refuse = false;
    run.retry(item.id);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await flush();
    expect(run.getSnapshot().queue.items[0]!.status).toBe("done");
  });

  it("waits and retries a batch the API rate-limits", async () => {
    let calls = 0;
    const { run, deps } = harness({
      mint: vi.fn(async (files: MintRequest[]) => {
        calls += 1;
        if (calls === 1) throw { statusCode: 429 };
        return files.map((f, i) => ({
          upload_url: `https://put/${i}`,
          storage_path: `chapters/c/documents/${i}/${f.filename}`,
        }));
      }),
    });
    run.add([file("Drop/bylaws.pdf")], CONTEXT);
    await flush();
    run.apply();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await flush();
    expect(deps.sleep).toHaveBeenCalledWith(15_000);
    expect(run.getSnapshot().queue.items[0]!.status).toBe("done");
  });

  it("moves a whole group to another folder", () => {
    const { run } = harness();
    run.add(
      [file("Drop/Rush/a.pdf"), file("Drop/Rush/b.pdf"), file("Drop/x.pdf")],
      CONTEXT,
    );
    run.moveGroup("Rush", "Recruitment");
    expect(run.getSnapshot().rows.map((r) => r.folder)).toEqual([
      "Recruitment",
      "Recruitment",
      "Drop",
    ]);
  });

  it("re-files the same stored file after a failed filing call, never a second copy", async () => {
    let failOnce = true;
    const { run, deps } = harness({
      confirm: vi.fn(async (docs: ConfirmRequest[]) => {
        if (failOnce) {
          failOnce = false;
          throw { statusCode: 500 };
        }
        return docs.map((d) => ({ storage_path: d.storage_path }));
      }),
    });
    run.add([file("Drop/bylaws.pdf")], CONTEXT);
    await flush();
    run.apply();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await flush();
    const item = run.getSnapshot().queue.items[0]!;
    expect(item.status).toBe("failed");

    run.retry(item.id);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await flush();

    expect(run.getSnapshot().queue.items[0]!.status).toBe("done");
    expect(deps.mint).toHaveBeenCalledTimes(1);
    expect(deps.put).toHaveBeenCalledTimes(1);
    const paths = vi
      .mocked(deps.confirm)
      .mock.calls.map(([docs]) => docs[0]!.storage_path);
    expect(paths).toHaveLength(2);
    expect(paths[1]).toBe(paths[0]);
  });

  it("mints links ahead in full batches of 25 at Import", async () => {
    const { run, deps } = harness();
    run.add(
      Array.from({ length: 30 }, (_, i) => file(`Drop/f${i}.pdf`, `body ${i}`)),
      CONTEXT,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flush();
    expect(run.apply()).toBe(30);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await flush();
    expect(vi.mocked(deps.mint).mock.calls.map(([files]) => files.length)).toEqual([
      25, 5,
    ]);
  });

  it("drops a file that couldn't be read at Import, so progress can finish", async () => {
    const { run } = harness();
    const broken = file("Drop/broken.pdf");
    Object.defineProperty(broken, "arrayBuffer", {
      value: () => Promise.reject(new Error("moved")),
    });
    run.add([file("Drop/bylaws.pdf"), broken], CONTEXT);
    await flush();
    expect(run.apply()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await flush();
    expect(run.getSnapshot().queue.items.map((it) => it.status)).toEqual(["done"]);
  });

  it("files nothing once the chapter or account has changed", async () => {
    const { run, deps } = harness({
      assertChapter: vi.fn(() => {
        throw new Error("You switched chapters or accounts");
      }),
    });
    run.add([file("Drop/bylaws.pdf")], CONTEXT);
    await flush();
    run.apply();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await flush();
    expect(deps.put).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(run.getSnapshot().queue.items[0]!.status).toBe("failed");
  });
});
