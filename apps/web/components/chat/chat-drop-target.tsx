"use client";

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { MAX_UPLOAD_LABEL } from "@repo/validation";
import { AttachGlyph } from "./chat-glyphs";
import { CHAT_FILE_LIMIT } from "./composer";

/** Whether a drag carries files from outside the page (not text or a row). */
function carriesOutsideFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return !!types && Array.from(types).includes("Files");
}

/**
 * Drop files anywhere on the chat column to attach them to the composer
 * (#4143), the way Slack and Discord take a drop on the whole conversation
 * rather than only on the input.
 *
 * The files go through the composer's own attach path (`dropAttachRef`, set by
 * `Composer`), so a drop is refused or capped exactly like a pick or a paste,
 * with the same toasts. Nothing sends: the files stage as chips and the member
 * adds a message and presses Send, as after a pick.
 *
 * Listens on the column element itself, not the window, so a drag over the
 * channels list or a tool page beside chat is left alone. Only drags that
 * carry files count: dragging a channel row or selected text never shows the
 * target. An enter/leave depth count, rather than `relatedTarget`, decides
 * when the drag has left, because Safari reports no `relatedTarget` on
 * `dragleave`.
 *
 * When there is no live composer (a read-only channel, an alumnus outside
 * `#alumni`) or a thread covers the column, the drop is refused with the
 * "not allowed" cursor and no target, rather than letting the browser open
 * the file in place of the app.
 */
export function ChatDropTarget({
  containerRef,
  attachRef,
  label,
  disabled = false,
}: {
  containerRef: RefObject<HTMLElement | null>;
  attachRef: MutableRefObject<((files: File[]) => void) | null>;
  /** Where the files land: `#general`, or a person's name in a DM. */
  label: string;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const canAttach = () => !disabledRef.current && attachRef.current !== null;
    // A drag that began on this page (a photo in a message) also carries
    // "Files" in Chrome. It is not a file from the member's computer, so it
    // is left to the browser: only `dragstart` on the page itself sees it.
    let fromPage = false;
    const carriesFiles = (event: DragEvent) =>
      !fromPage && carriesOutsideFiles(event);
    function onStart() {
      fromPage = true;
    }

    function onEnter(event: DragEvent) {
      if (!carriesFiles(event)) return;
      depth.current += 1;
      if (canAttach()) setOver(true);
    }
    function onLeave(event: DragEvent) {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    }
    function onOver(event: DragEvent) {
      if (!carriesFiles(event)) return;
      // Without this the browser opens the file in place of the app.
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = canAttach() ? "copy" : "none";
      }
    }
    function onDrop(event: DragEvent) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setOver(false);
      const attach = attachRef.current;
      if (disabledRef.current || !attach) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) attach(files);
    }
    // A drag cancelled with Escape, or dropped outside the window, ends
    // without a `drop` here and can leave the depth count off by one.
    function onEnd() {
      fromPage = false;
      depth.current = 0;
      setOver(false);
    }

    node.addEventListener("dragenter", onEnter);
    node.addEventListener("dragleave", onLeave);
    node.addEventListener("dragover", onOver);
    node.addEventListener("drop", onDrop);
    window.addEventListener("dragstart", onStart);
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      node.removeEventListener("dragenter", onEnter);
      node.removeEventListener("dragleave", onLeave);
      node.removeEventListener("dragover", onOver);
      node.removeEventListener("drop", onDrop);
      window.removeEventListener("dragstart", onStart);
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
      depth.current = 0;
    };
  }, [containerRef, attachRef]);

  // A thread opened mid-drag hides the target at once; the drop is refused.
  if (!over || disabled) return null;
  return (
    /*
      Over the whole column (header, timeline and composer), so the target is
      as big as the place the member is aiming at. Inset from the edges with a
      dashed outline, the convention for "drop here" in Slack, Discord and the
      Documents page. Neutral, not the chapter accent: a drop target is not a
      primary action (foundations §6). It takes pointer events, so the drop
      lands here rather than in the editor, whose own drop handling would try
      to insert the file as content.
    */
    <div
      data-testid="chat-drop-target"
      className="absolute inset-0 z-20 p-3 bg-background/80 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
    >
      <div className="grid h-full place-items-center rounded-xl border-2 border-dashed border-muted-foreground/60">
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <span
            aria-hidden="true"
            className="grid h-12 w-12 place-items-center rounded-full bg-popover text-foreground"
          >
            <AttachGlyph className="h-6 w-6" />
          </span>
          <div>
            <p className="text-title font-semibold text-foreground">
              Attach to {label}
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              Up to {CHAT_FILE_LIMIT} files, {MAX_UPLOAD_LABEL} each
            </p>
          </div>
        </div>
      </div>
      <p role="status" className="sr-only">
        Drop to attach files to {label}
      </p>
    </div>
  );
}
