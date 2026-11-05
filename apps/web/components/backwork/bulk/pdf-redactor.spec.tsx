import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoxesByPage } from "@/lib/backwork-bulk/geometry";
import { PdfRedactor } from "./pdf-redactor";

/**
 * The redaction editor (#3499). The overlay maps pointer positions to page
 * units through its bounding box, so the spec pins that box at twice the
 * page's size, offset from the corner: two CSS pixels are one point, and a
 * box only lands right if the editor scales and offsets the pointer.
 */
const PAGE = { url: "blob:page", width: 600, height: 800 };
const SCREEN = { left: 40, top: 30, scale: 2 };

// Stable, like the page's own `useCallback`: a new function every render
// would reload the preview on every render.
const loadPreview = async () => PAGE;

let latest: BoxesByPage = {};

function Harness({ pageCount = 1 }: { pageCount?: number }) {
  const [boxes, setBoxes] = useState<BoxesByPage>({});
  return (
    <PdfRedactor
      pageCount={pageCount}
      loadPreview={loadPreview}
      boxes={boxes}
      onChange={(next) => {
        latest = next;
        setBoxes(next);
      }}
    />
  );
}

beforeAll(() => {
  Element.prototype.setPointerCapture ??= vi.fn();
  const width = PAGE.width * SCREEN.scale;
  const height = PAGE.height * SCREEN.scale;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: SCREEN.left,
    top: SCREEN.top,
    width,
    height,
    right: SCREEN.left + width,
    bottom: SCREEN.top + height,
    x: SCREEN.left,
    y: SCREEN.top,
    toJSON: () => ({}),
  } as DOMRect);
});

beforeEach(() => {
  latest = {};
});

/** Fires a pointer event at a point given in page units. */
function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", el: Element, x: number, y: number) {
  fireEvent[type](el, {
    clientX: SCREEN.left + x * SCREEN.scale,
    clientY: SCREEN.top + y * SCREEN.scale,
    button: 0,
    pointerId: 1,
  });
}

async function draw(x1: number, y1: number, x2: number, y2: number) {
  const overlay = await screen.findByTestId("redaction-overlay");
  act(() => pointer("pointerDown", overlay, x1, y1));
  act(() => pointer("pointerMove", overlay, x2, y2));
  act(() => pointer("pointerUp", overlay, x2, y2));
}

describe("PdfRedactor", () => {
  it("draws a box in page units, and undo takes it back", async () => {
    render(<Harness />);
    await draw(100, 50, 300, 90);
    expect(latest[1]).toEqual([{ x: 100, y: 50, width: 200, height: 40 }]);
    expect(screen.getAllByTestId("redaction-box")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(latest[1] ?? []).toEqual([]));
  });

  it("ignores a click that draws no real box", async () => {
    render(<Harness />);
    await draw(100, 50, 101, 51);
    expect(latest[1] ?? []).toEqual([]);
  });

  it("deletes the selected box with the Delete key", async () => {
    render(<Harness />);
    await draw(100, 50, 300, 90);
    // A new box is selected as soon as it's drawn.
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(latest[1]).toEqual([]));
  });

  it("copies this page's boxes to every page", async () => {
    render(<Harness pageCount={3} />);
    await draw(20, 20, 220, 60);
    fireEvent.click(screen.getByRole("button", { name: /same boxes on every page/i }));
    expect(Object.keys(latest)).toEqual(["1", "2", "3"]);
    expect(latest[3]).toEqual(latest[1]);

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByText("Page 2 of 3")).toBeTruthy();
    expect(await screen.findAllByTestId("redaction-box")).toHaveLength(1);
  });
});
