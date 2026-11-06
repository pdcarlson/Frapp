"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MIN_BOX_SIZE,
  boxFromCorners,
  clampBox,
  countBoxes,
  type Box,
  type BoxesByPage,
} from "@/lib/backwork-bulk/geometry";
import type { PagePreview } from "@/lib/backwork-bulk/pdf";

/**
 * The redaction editor for backwork bulk upload (#3499), ported from the old
 * chapter app's `PdfRedactor` and fixed: pointer events (mouse, pen, touch),
 * select, move, resize from any corner, delete, undo, and keyboard page
 * navigation.
 *
 * It shows rendered page images and draws boxes over them in page units
 * (`geometry.ts`), so nothing here burns anything in. The flattener does that
 * when the document finishes in the background (`flattenPdf`). Page images
 * come from `loadPreview`, which the queue's prepare step has already run for
 * page 1.
 */
export type PdfRedactorProps = {
  pageCount: number;
  loadPreview: (page: number) => Promise<PagePreview>;
  boxes: BoxesByPage;
  onChange: (boxes: BoxesByPage) => void;
};

type Drag =
  | { kind: "draw"; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: "move"; index: number; offset: { x: number; y: number } }
  | { kind: "resize"; index: number; anchor: { x: number; y: number } };

const CORNERS = ["nw", "ne", "sw", "se"] as const;
type Corner = (typeof CORNERS)[number];

export function PdfRedactor({
  pageCount,
  loadPreview,
  boxes,
  onChange,
}: PdfRedactorProps) {
  const [page, setPage] = useState(1);
  // What the last render of a page produced, tagged with its page, so another
  // page's image (and its size, which the boxes are measured against) is never
  // shown under this page's boxes while this one loads.
  const [shown, setShown] = useState<{
    page: number;
    preview?: PagePreview;
    error?: string;
  } | null>(null);
  const preview = shown?.page === page ? (shown.preview ?? null) : null;
  const previewError = shown?.page === page ? (shown.error ?? null) : null;
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const history = useRef<BoxesByPage[]>([]);
  const overlay = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadPreview(page).then(
      (next) => live && setShown({ page, preview: next }),
      () => live && setShown({ page, error: "This page couldn't be shown." }),
    );
    return () => {
      live = false;
    };
  }, [page, loadPreview]);

  const pageBoxes = useMemo(() => boxes[page] ?? [], [boxes, page]);

  const commit = useCallback(
    (next: BoxesByPage) => {
      history.current.push(boxes);
      if (history.current.length > 100) history.current.shift();
      onChange(next);
    },
    [boxes, onChange],
  );

  const setPageBoxes = useCallback(
    (list: Box[], record = true) => {
      const next = { ...boxes, [page]: list };
      if (record) commit(next);
      else onChange(next);
    },
    [boxes, page, commit, onChange],
  );

  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (previous) {
      setSelected(null);
      onChange(previous);
    }
  }, [onChange]);

  const deleteSelected = useCallback(() => {
    if (selected === null) return;
    setPageBoxes(pageBoxes.filter((_, i) => i !== selected));
    setSelected(null);
  }, [selected, pageBoxes, setPageBoxes]);

  const goTo = useCallback(
    (next: number) => {
      setSelected(null);
      setPage(Math.min(Math.max(next, 1), pageCount));
    },
    [pageCount],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [role='combobox'], [role='listbox']")
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selected !== null
      ) {
        event.preventDefault();
        deleteSelected();
      } else if (event.key === "PageDown" || event.key === "ArrowRight") {
        goTo(page + 1);
      } else if (event.key === "PageUp" || event.key === "ArrowLeft") {
        goTo(page - 1);
      } else if (event.key === "Escape") {
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, deleteSelected, goTo, page, selected]);

  /** Pointer position in page units. */
  function toPage(event: React.PointerEvent): { x: number; y: number } {
    const rect = overlay.current!.getBoundingClientRect();
    const width = preview?.width ?? 1;
    const height = preview?.height ?? 1;
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  }

  function onBackgroundDown(event: React.PointerEvent) {
    if (!preview || event.button !== 0) return;
    overlay.current?.setPointerCapture(event.pointerId);
    const point = toPage(event);
    setSelected(null);
    setDrag({ kind: "draw", start: point, current: point });
  }

  function onBoxDown(event: React.PointerEvent, index: number) {
    event.stopPropagation();
    if (!preview || event.button !== 0) return;
    overlay.current?.setPointerCapture(event.pointerId);
    const point = toPage(event);
    const box = pageBoxes[index]!;
    setSelected(index);
    setDrag({ kind: "move", index, offset: { x: point.x - box.x, y: point.y - box.y } });
    history.current.push(boxes);
  }

  function onHandleDown(event: React.PointerEvent, index: number, corner: Corner) {
    event.stopPropagation();
    if (!preview || event.button !== 0) return;
    overlay.current?.setPointerCapture(event.pointerId);
    const box = pageBoxes[index]!;
    const anchor = {
      x: corner.endsWith("w") ? box.x + box.width : box.x,
      y: corner.startsWith("n") ? box.y + box.height : box.y,
    };
    setSelected(index);
    setDrag({ kind: "resize", index, anchor });
    history.current.push(boxes);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag || !preview) return;
    const point = toPage(event);
    if (drag.kind === "draw") {
      setDrag({ ...drag, current: point });
      return;
    }
    const list = [...pageBoxes];
    const box = list[drag.index]!;
    if (drag.kind === "move") {
      list[drag.index] = {
        ...box,
        x: Math.min(Math.max(point.x - drag.offset.x, 0), preview.width - box.width),
        y: Math.min(Math.max(point.y - drag.offset.y, 0), preview.height - box.height),
      };
    } else {
      list[drag.index] = clampBox(
        boxFromCorners(drag.anchor, point),
        preview.width,
        preview.height,
      );
    }
    setPageBoxes(list, false);
  }

  function onPointerUp() {
    if (!drag || !preview) return;
    if (drag.kind === "draw") {
      const box = clampBox(
        boxFromCorners(drag.start, drag.current),
        preview.width,
        preview.height,
      );
      if (box.width >= MIN_BOX_SIZE && box.height >= MIN_BOX_SIZE) {
        setPageBoxes([...pageBoxes, box]);
        setSelected(pageBoxes.length);
      }
    } else {
      // A move or resize that ends below the minimum is dropped.
      const box = pageBoxes[drag.index];
      if (box && (box.width < MIN_BOX_SIZE || box.height < MIN_BOX_SIZE)) {
        setPageBoxes(pageBoxes.filter((_, i) => i !== drag.index), false);
        setSelected(null);
      }
    }
    setDrag(null);
  }

  // Adds this page's boxes to every page, keeping what each page already
  // has: a box drawn on another page is a redaction too, and never dropped.
  function copyToAllPages() {
    const same = (a: Box, b: Box) =>
      a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    const next: BoxesByPage = {};
    for (let p = 1; p <= pageCount; p += 1) {
      const own = boxes[p] ?? [];
      next[p] = [...own, ...pageBoxes.filter((box) => !own.some((o) => same(o, box)))];
    }
    commit(next);
  }

  const drawing =
    drag?.kind === "draw" && preview
      ? clampBox(boxFromCorners(drag.start, drag.current), preview.width, preview.height)
      : null;
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;
  const total = countBoxes(boxes);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => goTo(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[4.5rem] text-center text-caption font-semibold tabular-nums text-foreground">
            Page {page} of {pageCount}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => goTo(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="toolbar" onClick={undo} className="gap-1.5">
            <Undo2 className="h-4 w-4" /> Undo
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="toolbar"
            disabled={selected === null}
            onClick={deleteSelected}
            className="gap-1.5"
          >
            <Trash2 className="h-4 w-4" /> Delete box
          </Button>
          {pageCount > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="toolbar"
              disabled={pageBoxes.length === 0}
              onClick={copyToAllPages}
              className="gap-1.5"
            >
              <Copy className="h-4 w-4" /> Copy boxes to every page
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-[860px] overflow-hidden rounded-lg border border-border bg-white">
        {previewError ? (
          <p className="p-6 text-caption text-destructive-text">{previewError}</p>
        ) : preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimizable asset */}
            <img
              src={preview.url}
              alt={`Page ${page}`}
              draggable={false}
              className="block h-auto w-full select-none"
            />
            <div
              ref={overlay}
              data-testid="redaction-overlay"
              aria-label="Drag to cover a name or ID. Select a box to move, resize, or delete it."
              className="absolute inset-0 cursor-crosshair touch-none"
              onPointerDown={onBackgroundDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {pageBoxes.map((box, index) => (
                <div
                  key={index}
                  data-testid="redaction-box"
                  className={cn(
                    "absolute cursor-move bg-black",
                    selected === index
                      ? "border-2 border-accent-border"
                      : "border border-white/25",
                  )}
                  style={{
                    left: pct(box.x, preview.width),
                    top: pct(box.y, preview.height),
                    width: pct(box.width, preview.width),
                    height: pct(box.height, preview.height),
                  }}
                  onPointerDown={(event) => onBoxDown(event, index)}
                >
                  {selected === index
                    ? CORNERS.map((corner) => (
                        <span
                          key={corner}
                          aria-hidden
                          onPointerDown={(event) => onHandleDown(event, index, corner)}
                          className={cn(
                            "absolute h-3 w-3 rounded-full border border-black bg-white pointer-coarse:h-5 pointer-coarse:w-5",
                            corner === "nw" && "-left-1.5 -top-1.5 cursor-nwse-resize",
                            corner === "ne" && "-right-1.5 -top-1.5 cursor-nesw-resize",
                            corner === "sw" && "-bottom-1.5 -left-1.5 cursor-nesw-resize",
                            corner === "se" && "-bottom-1.5 -right-1.5 cursor-nwse-resize",
                          )}
                        />
                      ))
                    : null}
                </div>
              ))}
              {drawing ? (
                <div
                  className="absolute border border-white/40 bg-black/80"
                  style={{
                    left: pct(drawing.x, preview.width),
                    top: pct(drawing.y, preview.height),
                    width: pct(drawing.width, preview.width),
                    height: pct(drawing.height, preview.height),
                  }}
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className="aspect-[8.5/11] w-full animate-pulse bg-surface-1" />
        )}
      </div>
      <p className="text-caption text-muted-foreground" aria-live="polite">
        {total === 0
          ? "No boxes yet. Drag over a name, student ID, or anything else to hide."
          : `${total} ${total === 1 ? "box" : "boxes"} in this document, ${pageBoxes.length} on this page.`}
      </p>
    </div>
  );
}
