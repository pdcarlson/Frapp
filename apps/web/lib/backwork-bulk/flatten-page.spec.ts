// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  burnBoxes,
  hasInk,
  inkCells,
  inkSampleRect,
  pageTextLayer,
  redactRenderedPage,
  type RenderedPage,
} from "./flatten-page";
import type { Box } from "./geometry";

/**
 * The per-page steps `flattenPdf` runs (#3499), against real pdf.js pages.
 * Rendering needs a browser canvas, so visibility is stubbed here; `hasInk`,
 * the check the browser runs on the rendered pixels, is tested on its own.
 */
const openTasks: { destroy: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(openTasks.splice(0).map((task) => task.destroy()));
});

async function firstPage(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  openTasks.push(task);
  const doc = await task.promise;
  const page = await doc.getPage(1);
  return { page, base: page.getViewport({ scale: 1 }) };
}

/** A name, an ID that an earlier tool "redacted" with a drawn black bar, and a question. */
async function examPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Jane Doe", { x: 120, y: 720, size: 12, font });
  page.drawText("RIN 661234567", { x: 300, y: 720, size: 12, font });
  page.drawRectangle({ x: 296, y: 714, width: 100, height: 18, color: rgb(0, 0, 0) });
  page.drawText("Question 1. Prove the loop invariant.", { x: 72, y: 600, size: 12, font });
  return doc.save();
}

// Top-left page units: baselines at y = 792 - 720 = 72.
const NAME_BOX: Box = { x: 116, y: 56, width: 70, height: 24 };
const DRAWN_BAR: Box = { x: 296, y: 60, width: 100, height: 18 };

describe("pageTextLayer", () => {
  it("drops text under a box and keeps the rest", async () => {
    const { page, base } = await firstPage(await examPdf());
    const kept = await pageTextLayer(page, base, [NAME_BOX]);
    expect(kept.map((t) => t.str)).not.toContain("Jane Doe");
    expect(kept.map((t) => t.str)).toContain("Question 1. Prove the loop invariant.");
  });

  it("drops text the page itself hides, even with no box over it", async () => {
    const { page, base } = await firstPage(await examPdf());
    // Stand-in for hasInk on the rendered page: the drawn bar is a flat fill.
    const covered = (rect: Box) =>
      rect.x < DRAWN_BAR.x + DRAWN_BAR.width &&
      rect.x + rect.width > DRAWN_BAR.x &&
      rect.y < DRAWN_BAR.y + DRAWN_BAR.height &&
      rect.y + rect.height > DRAWN_BAR.y;
    const kept = await pageTextLayer(page, base, [], (rect) => !covered(rect));
    expect(kept.map((t) => t.str)).not.toContain("RIN 661234567");
    expect(kept.map((t) => t.str)).toContain("Jane Doe");
  });
});

/**
 * A stand-in for the canvas `flattenPdf` renders at `scale`: striped "ink"
 * everywhere except a flat black fill where `examPdf` draws its bar. It
 * records every read and fill, so the order and the units are checked too.
 */
function renderedExam(scale: number) {
  const bar = {
    left: DRAWN_BAR.x * scale,
    top: DRAWN_BAR.y * scale,
    right: (DRAWN_BAR.x + DRAWN_BAR.width) * scale,
    bottom: (DRAWN_BAR.y + DRAWN_BAR.height) * scale,
  };
  const events: string[] = [];
  const fills: number[][] = [];
  const canvas: RenderedPage = {
    width: Math.ceil(612 * scale),
    height: Math.ceil(792 * scale),
    ctx: {
      fillStyle: "",
      fillRect: (...args: number[]) => {
        events.push("fill");
        fills.push(args);
      },
      getImageData: (x, y, w, h) => {
        events.push("read");
        const data = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row += 1) {
          for (let col = 0; col < w; col += 1) {
            const px = x + col;
            const py = y + row;
            const underBar =
              px >= bar.left && px < bar.right && py >= bar.top && py < bar.bottom;
            const v = underBar || px % 4 === 0 ? 0 : 255;
            data.set([v, v, v, 255], (row * w + col) * 4);
          }
        }
        return { data };
      },
    },
  };
  return { canvas, events, fills };
}

describe("redactRenderedPage", () => {
  it("keeps boxed text out of the text layer even while its pixels still show", async () => {
    const { page, base } = await firstPage(await examPdf());
    const { canvas } = renderedExam(2);
    const kept = await redactRenderedPage(page, base, [NAME_BOX], 2, canvas);
    expect(kept.map((t) => t.str)).not.toContain("Jane Doe");
    expect(kept.map((t) => t.str)).toContain("Question 1. Prove the loop invariant.");
  });

  it("reads the page at render scale and drops what the page itself covers", async () => {
    const { page, base } = await firstPage(await examPdf());
    const { canvas } = renderedExam(2);
    const kept = await redactRenderedPage(page, base, [], 2, canvas);
    expect(kept.map((t) => t.str)).not.toContain("RIN 661234567");
    expect(kept.map((t) => t.str)).toContain("Jane Doe");
  });

  it("reads the text before burning the boxes, then burns them at render scale", async () => {
    const { page, base } = await firstPage(await examPdf());
    const { canvas, events, fills } = renderedExam(2);
    await redactRenderedPage(page, base, [NAME_BOX], 2, canvas);
    expect(events.lastIndexOf("read")).toBeLessThan(events.indexOf("fill"));
    expect(fills).toEqual([[232, 112, 141, 49]]);
  });

  it("still burns the boxes when the text layer is off", async () => {
    const { page, base } = await firstPage(await examPdf());
    const { canvas, events } = renderedExam(2);
    expect(await redactRenderedPage(page, base, [NAME_BOX], 2, canvas, false)).toEqual([]);
    expect(events).toEqual(["fill"]);
  });
});

describe("inkCells", () => {
  it("checks an upright run one character at a time, skipping blanks", () => {
    const cells = inkCells({
      str: "ab c",
      rect: { x: 0, y: 0, width: 40, height: 16 },
      upright: { x: 0, baseline: 12, size: 12, width: 40 },
    });
    // Each 10-unit cell, inset 0.5 on each side.
    expect(cells.map((c) => c.x)).toEqual([0.5, 10.5, 30.5]);
  });

  it("drops a run when a bar hides only part of it", async () => {
    // "Student: Jane Doe" as one item; a stand-in bar over its right half.
    const item = {
      str: "Student: Jane Doe",
      rect: { x: 100, y: 50, width: 170, height: 16 },
      upright: { x: 100, baseline: 62, size: 12, width: 170 },
    };
    const bar = { x: 190, width: 80 };
    const visible = (rect: Box) => rect.x + rect.width <= bar.x || rect.x >= bar.x + bar.width;
    expect(inkCells(item).every(visible)).toBe(false);
  });

  it("checks a rotated item as one area", () => {
    const rect = { x: 0, y: 0, width: 12, height: 90 };
    expect(inkCells({ str: "RIN 661234567", rect })).toEqual([inkSampleRect(rect)]);
  });
});

describe("inkSampleRect", () => {
  it("samples the middle of the line, not the generous edges", () => {
    expect(inkSampleRect({ x: 100, y: 50, width: 80, height: 16 })).toEqual({
      x: 102,
      y: 54,
      width: 76,
      height: 8,
    });
  });
});

describe("burnBoxes", () => {
  it("fills each box at the render scale, rounded outward", () => {
    const calls: number[][] = [];
    const ctx = { fillStyle: "", fillRect: (...args: number[]) => calls.push(args) };
    burnBoxes(ctx, [{ x: 10.4, y: 20.6, width: 30.2, height: 5.1 }], 2);
    expect(ctx.fillStyle).toBe("#000");
    expect(calls).toEqual([[20, 41, 62, 12]]);
  });
});

function region(pixels: number, inked: number, paper = 255, ink = 0): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    const v = i < inked ? ink : paper;
    data.set([v, v, v, 255], i * 4);
  }
  return data;
}

describe("hasInk", () => {
  it("sees glyphs on paper", () => {
    expect(hasInk(region(1000, 150))).toBe(true);
  });

  it("sees light text on a dark bar", () => {
    expect(hasInk(region(1000, 150, 0, 255))).toBe(true);
  });

  it("finds nothing in a flat black or white fill", () => {
    expect(hasInk(region(1000, 0, 0))).toBe(false);
    expect(hasInk(region(1000, 0, 255))).toBe(false);
  });

  it("ignores faint noise like JPEG speckle", () => {
    const data = region(1000, 0, 20);
    for (let i = 0; i < 1000; i += 7) data[i * 4] = 45;
    expect(hasInk(data)).toBe(false);
  });

  it("sees light gray text, and ignores a gray cast that is only faintly off", () => {
    // #aaa text on white is 85 levels off the paper: ink.
    expect(hasInk(region(1000, 150, 255, 170))).toBe(true);
    // A cover image 30 levels off its own background: not ink, so text under
    // it stays out of the searchable layer.
    expect(hasInk(region(1000, 150, 255, 225))).toBe(false);
  });

  it("treats an empty region as nothing visible", () => {
    expect(hasInk(new Uint8ClampedArray(0))).toBe(false);
  });
});
