// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { assembleFlatPdf } from "./assemble";
import { pageTextLayer } from "./flatten-page";

/** An 8x8 JPEG, standing in for a rendered page image. */
const JPEG = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAdEAABAgcAAAAAAAAAAAAAAAAAEhcnM1RnhJPw/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpE99rbYtLunckAAf/Z",
    "base64",
  ),
);

const PAGE = { width: 612, height: 792 };

/** A typed exam page: a student's name at the top, a question below it. */
async function examPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Midterm 2, Jane Doe");
  doc.setAuthor("Jane Doe");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  page.drawText("Name:", { x: 72, y: 720, size: 12, font });
  page.drawText("Jane Doe", { x: 120, y: 720, size: 12, font });
  page.drawText("Question 1. Prove the loop invariant.", {
    x: 72,
    y: 600,
    size: 12,
    font,
  });
  return doc.save();
}

const openTasks: { destroy: () => Promise<void> }[] = [];

async function openPdf(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  openTasks.push(task);
  return task.promise;
}

afterEach(async () => {
  await Promise.all(openTasks.splice(0).map((task) => task.destroy()));
});

async function pageText(bytes: Uint8Array): Promise<string> {
  const doc = await openPdf(bytes);
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  return text;
}

/** The text layer `flattenPdf` builds for page 1, minus the rendering. */
async function survivingText(
  bytes: Uint8Array,
  box: { x: number; y: number; width: number; height: number },
) {
  const doc = await openPdf(bytes);
  const page = await doc.getPage(1);
  return pageTextLayer(page, page.getViewport({ scale: 1 }), [box]);
}

// A box over "Jane Doe" in top-left viewport space: the text's baseline sits
// at y = 792 - 720 = 72, so the glyphs span roughly y 60 to 76.
const NAME_BOX = { x: 116, y: 56, width: 70, height: 24 };

describe("assembleFlatPdf", () => {
  it("keeps the words outside the box searchable and drops the covered name", async () => {
    const source = await examPdf();
    expect(await pageText(source)).toContain("Jane Doe");

    const text = await survivingText(source, NAME_BOX);
    const output = await assembleFlatPdf([{ ...PAGE, jpeg: JPEG, text }]);

    const flattened = await pageText(output);
    expect(flattened).toContain("Question 1");
    expect(flattened).toContain("Name:");
    expect(flattened).not.toContain("Jane");
  });

  it("carries none of the source's metadata", async () => {
    const source = await examPdf();
    const output = await assembleFlatPdf([
      { ...PAGE, jpeg: JPEG, text: await survivingText(source, NAME_BOX) },
    ]);
    const raw = Buffer.from(output).toString("latin1");
    expect(raw).not.toContain("Jane");
    expect(raw).not.toMatch(/\/Author|\/Title|\/Producer|\/CreationDate/);

    const doc = await openPdf(output);
    const meta = await doc.getMetadata();
    expect(meta.info).not.toHaveProperty("Author");
    expect(meta.info).not.toHaveProperty("Title");
    });

  it("assembles the same page images to the same bytes", async () => {
    const source = await examPdf();
    const text = await survivingText(source, NAME_BOX);
    const a = await assembleFlatPdf([{ ...PAGE, jpeg: JPEG, text }]);
    const b = await assembleFlatPdf([{ ...PAGE, jpeg: JPEG, text }]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("writes an image-only page when there is no text to keep", async () => {
    const output = await assembleFlatPdf([{ ...PAGE, jpeg: JPEG, text: [] }]);
    expect((await pageText(output)).trim()).toBe("");
  });

  it("swaps characters Helvetica can't encode for spaces instead of failing", async () => {
    const output = await assembleFlatPdf([
      {
        ...PAGE,
        jpeg: JPEG,
        text: [
          {
            str: "Σ x² ≤ 1",
            rect: { x: 72, y: 100, width: 60, height: 14 },
            upright: { x: 72, baseline: 112, size: 12, width: 60 },
          },
        ],
      },
    ]);
    expect(await pageText(output)).toContain("x²");
  });
});
