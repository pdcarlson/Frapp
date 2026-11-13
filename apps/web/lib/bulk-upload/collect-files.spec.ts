import { describe, expect, it } from "vitest";
import {
  collectFromDrop,
  collectFromList,
  isPdfFile,
  relativePath,
} from "./collect-files";

function file(name: string, type = "") {
  return new File(["x"], name, { type });
}

function fileEntry(f: File) {
  return {
    isFile: true,
    isDirectory: false,
    name: f.name,
    file: (ok: (value: File) => void) => ok(f),
  };
}

/** A directory whose reader hands out entries in batches, like Chrome's. */
function dirEntry(name: string, children: unknown[], batchSize = 2) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (ok: (entries: unknown[]) => void) => {
          const batch = children.slice(offset, offset + batchSize);
          offset += batch.length;
          ok(batch);
        },
      };
    },
  };
}

function dropItem(entry: unknown) {
  return {
    kind: "file",
    webkitGetAsEntry: () => entry as never,
    getAsFile: () => null,
  };
}

describe("collect-files", () => {
  it("recognises PDFs by type or extension", () => {
    expect(isPdfFile(file("exam.PDF"))).toBe(true);
    expect(isPdfFile(file("scan", "application/pdf"))).toBe(true);
    expect(isPdfFile(file("notes.docx"))).toBe(false);
  });

  it("counts what it skips from a picker", () => {
    const result = collectFromList([
      file("a.pdf"),
      file("b.png", "image/png"),
      file("c.pdf"),
    ]);
    expect(result.files.map((f) => f.name)).toEqual(["a.pdf", "c.pdf"]);
    expect(result.skipped).toBe(1);
  });

  it("walks nested folders past the reader's batch size, in disk order", async () => {
    const folder = dirEntry("CSCI 1200", [
      fileEntry(file("Exam 10.pdf")),
      fileEntry(file("Exam 2.pdf")),
      fileEntry(file("cover.jpg", "image/jpeg")),
      dirEntry("Quizzes", [
        fileEntry(file("Quiz 1.pdf")),
        fileEntry(file(".DS_Store")),
      ]),
    ]);
    const result = await collectFromDrop([
      dropItem(folder),
      dropItem(fileEntry(file("loose.pdf"))),
    ]);
    expect(result.files.map((f) => f.name)).toEqual([
      "Exam 2.pdf",
      "Exam 10.pdf",
      "Quiz 1.pdf",
      "loose.pdf",
    ]);
    // The cover image is counted; Finder's .DS_Store is dropped unseen.
    expect(result.skipped).toBe(1);
  });

  it("keeps every type a `keep` allows, with each file's folder path (#2242)", async () => {
    const folder = dirEntry("Exec", [
      fileEntry(file("Budget.xlsx")),
      dirEntry("2025", [fileEntry(file("Minutes 10-12.docx"))]),
      fileEntry(file("Thumbs.db")),
      fileEntry(file("._Budget.xlsx")),
    ]);
    const result = await collectFromDrop([dropItem(folder)], () => true);
    expect(result.files.map(relativePath)).toEqual([
      "Exec/2025/Minutes 10-12.docx",
      "Exec/Budget.xlsx",
    ]);
    expect(result.skipped).toBe(0);
  });

  it("reads a picked folder's path from the browser, and a lone file's name", () => {
    const picked = file("Bylaws.pdf");
    Object.defineProperty(picked, "webkitRelativePath", {
      value: "Chapter/Governance/Bylaws.pdf",
    });
    expect(relativePath(picked)).toBe("Chapter/Governance/Bylaws.pdf");
    expect(relativePath(file("Loose.pdf"))).toBe("Loose.pdf");
  });

  it("falls back to the plain file when the browser has no entry API", async () => {
    const result = await collectFromDrop([
      { kind: "file", getAsFile: () => file("solo.pdf") },
      { kind: "string", getAsFile: () => null },
    ]);
    expect(result.files.map((f) => f.name)).toEqual(["solo.pdf"]);
  });

  it("sorts loose files by name, as browsers give them an empty folder path", async () => {
    const loose = (name: string) => {
      const f = file(name);
      Object.defineProperty(f, "webkitRelativePath", { value: "" });
      return { kind: "file", getAsFile: () => f };
    };
    const result = await collectFromDrop([loose("exam 10.pdf"), loose("exam 2.pdf")]);
    expect(result.files.map((f) => f.name)).toEqual(["exam 2.pdf", "exam 10.pdf"]);
  });

  it("counts an unreadable file and keeps the rest of the folder", async () => {
    const broken = {
      isFile: true,
      isDirectory: false,
      name: "locked.pdf",
      file: (_ok: unknown, fail: (err: unknown) => void) => fail(new Error("NotReadableError")),
    };
    const result = await collectFromDrop([
      dropItem(dirEntry("Exams", [broken, fileEntry(file("Exam 1.pdf"))])),
    ]);
    expect(result.files.map((f) => f.name)).toEqual(["Exam 1.pdf"]);
    expect(result.unreadable).toBe(1);
  });

  it("counts a folder the browser won't list and keeps the rest of the drop", async () => {
    const locked = {
      isFile: false,
      isDirectory: true,
      name: "Locked",
      createReader: () => ({
        readEntries: (_ok: unknown, fail: (err: unknown) => void) => fail(new Error("NotReadableError")),
      }),
    };
    const result = await collectFromDrop([
      dropItem(locked),
      dropItem(fileEntry(file("Exam 1.pdf"))),
    ]);
    expect(result.files.map((f) => f.name)).toEqual(["Exam 1.pdf"]);
    expect(result.unreadable).toBe(1);
  });
});
