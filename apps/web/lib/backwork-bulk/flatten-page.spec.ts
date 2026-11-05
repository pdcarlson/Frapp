// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { burnBoxes, hasInk, inkSampleRect, pageTextLayer } from "./flatten-page";
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

  it("treats an empty region as nothing visible", () => {
    expect(hasInk(new Uint8ClampedArray(0))).toBe(false);
  });
});
