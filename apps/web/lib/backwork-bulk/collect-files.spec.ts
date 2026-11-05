import { describe, expect, it } from "vitest";
import { collectFromDrop, collectFromList, isPdfFile } from "./collect-files";

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
    expect(result.skipped).toBe(2);
  });

  it("falls back to the plain file when the browser has no entry API", async () => {
    const result = await collectFromDrop([
      { kind: "file", getAsFile: () => file("solo.pdf") },
      { kind: "string", getAsFile: () => null },
    ]);
    expect(result.files.map((f) => f.name)).toEqual(["solo.pdf"]);
  });
});
