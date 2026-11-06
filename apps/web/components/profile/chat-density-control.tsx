"use client";

import {
  CHAT_DENSITY_OPTIONS,
  type ChatDensity,
} from "@repo/chat-core/density";
import { FOCUS_RING_WITHIN } from "@/components/ui/focus";
import { setChatDensity, useChatDensity } from "@/lib/chat/chat-density";
import { cn } from "@/lib/utils";

/**
 * Profile → Chat → Density: two cards, each a small drawing of the thread in
 * that density, so the choice is made by looking rather than by reading
 * (`components.md` §11 § Density). It saves on the click, with no Save button,
 * and the thread redraws at once.
 *
 * Native radios, visually hidden inside their `<label>`s: the group then gets
 * arrow-key movement and one tab stop from the browser, which a row of
 * `role="radio"` buttons would have to rebuild by hand.
 */
export function ChatDensityControl() {
  const density = useChatDensity();
  return (
    <fieldset className="grid max-w-xl grid-cols-2 gap-3">
      <legend className="sr-only">Chat density</legend>
      {CHAT_DENSITY_OPTIONS.map((option) => {
        const checked = option.value === density;
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer flex-col gap-3 rounded-lg border p-3 transition",
              FOCUS_RING_WITHIN,
              checked
                ? "border-accent-border bg-accent-subtle-hover"
                : "border-border hover:bg-card-hover",
            )}
          >
            <input
              type="radio"
              name="chat-density"
              value={option.value}
              checked={checked}
              onChange={() => setChatDensity(option.value)}
              className="sr-only"
            />
            <DensityPreview density={option.value} />
            <span className="grid gap-0.5">
              <span
                className={cn(
                  "text-sm font-semibold",
                  checked ? "text-accent-text" : "text-foreground",
                )}
              >
                {option.label}
              </span>
              <span className="text-sm text-muted-foreground">
                {option.description}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

const COZY_ROWS = [
  ["w-10", "w-3/4"],
  ["w-8", "w-1/2"],
  ["w-12", "w-2/3"],
] as const;
const COMPACT_ROWS = [
  ["w-10", "w-3/4"],
  ["w-8", "w-1/2"],
  ["w-12", "w-2/3"],
  ["w-8", "w-3/5"],
  ["w-10", "w-1/3"],
  ["w-12", "w-1/2"],
] as const;

/**
 * Three rows of the thread as shapes: an avatar and a name over a line of text
 * in cozy, a time, a name and the text on one line in compact. Shapes rather
 * than words, so the drawing never shows a made-up member or message.
 */
function DensityPreview({ density }: { density: ChatDensity }) {
  // The same box holds three cozy rows or six compact ones, which is the
  // whole difference the choice makes.
  const rows = density === "cozy" ? COZY_ROWS : COMPACT_ROWS;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-24 flex-col justify-center overflow-hidden rounded-md bg-surface-1 px-3",
        density === "cozy" ? "gap-3" : "gap-1.5",
      )}
    >
      {rows.map(([name, text], index) =>
        density === "cozy" ? (
          <span key={index} className="flex items-start gap-2">
            <span className="h-4 w-4 shrink-0 rounded-full bg-popover" />
            <span className="flex flex-1 flex-col gap-1">
              <span className={cn("h-1.5 rounded-full bg-muted", name)} />
              <span className={cn("h-1.5 rounded-full bg-input", text)} />
            </span>
          </span>
        ) : (
          <span key={index} className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 shrink-0 rounded-full bg-border" />
            <span
              className={cn("h-1.5 shrink-0 rounded-full bg-muted", name)}
            />
            <span className={cn("h-1.5 rounded-full bg-input", text)} />
          </span>
        ),
      )}
    </span>
  );
}
