"use client";

import { useRef, useState } from "react";
import {
  CHAT_BACKGROUND_BUILT_INS,
  CHAT_BACKGROUND_LABELS,
  isAllowedUploadMime,
  acceptAttribute,
  type ChatBackgroundKey,
} from "@repo/validation";
import { cn } from "@/lib/utils";
import { paintStyle } from "./chat-background";

/** What the picker hands back: a key, or null to follow the chapter default. */
export type ChatBackgroundPick =
  | { background: ChatBackgroundKey | null; photo?: undefined }
  | { background: "photo"; photo: File };

/**
 * The background swatches (#3973), for a channel (the channel menu) and for
 * the chapter default (Chat settings). A channel adds "Chapter default" first,
 * which clears its own choice. Swatches are drawn by the same `paintStyle` the
 * thread uses, so what is picked is what members see.
 */
export function ChatBackgroundPicker({
  value,
  allowInherit,
  inheritPreview = "plain",
  letters,
  saving,
  error,
  onPick,
}: {
  /** The stored choice; null when a channel follows the chapter default. */
  value: ChatBackgroundKey | null;
  allowInherit: boolean;
  /**
   * What "Chapter default" would draw, so its swatch shows it. A photo
   * default previews as plain with the label saying so.
   */
  inheritPreview?: ChatBackgroundKey;
  /** The chapter's mark, for the Letters swatch. */
  letters: string;
  saving: boolean;
  error: string | null;
  onPick: (pick: ChatBackgroundPick) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [typeError, setTypeError] = useState<string | null>(null);

  const swatch = (
    key: ChatBackgroundKey | null,
    label: string,
    style: React.CSSProperties,
  ) => (
    <button
      key={label}
      type="button"
      role="radio"
      aria-checked={value === key}
      disabled={saving}
      onClick={() => onPick({ background: key })}
      className={cn(
        "flex flex-col items-center gap-1 rounded-md p-1 text-caption text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        value === key && "text-foreground",
      )}
    >
      <span
        className={cn(
          "block h-12 w-full rounded-md border border-border",
          value === key && "ring-2 ring-primary",
        )}
        style={style}
      />
      {label}
    </button>
  );

  return (
    <div className="space-y-2 px-3 py-3">
      <div
        role="radiogroup"
        aria-label="Chat background"
        className="grid grid-cols-3 gap-1"
      >
        {allowInherit
          ? swatch(
              null,
              inheritPreview === "photo"
                ? "Chapter default (photo)"
                : "Chapter default",
              paintStyle(
                inheritPreview === "photo" ? "plain" : inheritPreview,
                letters,
              ),
            )
          : null}
        {CHAT_BACKGROUND_BUILT_INS.map((key) =>
          swatch(key, CHAT_BACKGROUND_LABELS[key], paintStyle(key, letters)),
        )}
        <button
          type="button"
          role="radio"
          aria-checked={value === "photo"}
          disabled={saving}
          onClick={() => fileInput.current?.click()}
          className={cn(
            "flex flex-col items-center gap-1 rounded-md p-1 text-caption text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
            value === "photo" && "text-foreground",
          )}
        >
          <span
            className={cn(
              "flex h-12 w-full items-center justify-center rounded-md border border-dashed border-border",
              value === "photo" && "ring-2 ring-primary",
            )}
          >
            {value === "photo" ? "Replace" : "Upload"}
          </span>
          Photo
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={acceptAttribute("image")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (!isAllowedUploadMime("image", file.type)) {
            setTypeError("Pick a JPEG, PNG, GIF or WebP image.");
            return;
          }
          setTypeError(null);
          onPick({ background: "photo", photo: file });
        }}
      />
      <p className="text-caption text-muted-foreground">
        Photos are dimmed and blurred so messages stay readable. Setting one
        posts a line in chat that anyone can report.
      </p>
      {saving ? (
        <p role="status" className="text-caption text-muted-foreground">
          Saving…
        </p>
      ) : null}
      {typeError || error ? (
        <p role="alert" className="text-caption text-destructive-text">
          {typeError ?? error}
        </p>
      ) : null}
    </div>
  );
}
