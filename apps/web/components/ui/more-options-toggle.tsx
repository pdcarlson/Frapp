"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";

/**
 * The row a create form keeps its rarer fields behind
 * (`spec/ui/design-system/components.md` § More options): closed, it says what
 * those fields hold now, so nothing set there is hidden; open, it reads
 * "Fewer options". The New event panel and the Create a task dialog share it.
 */
export function MoreOptionsToggle({
  open,
  onToggle,
  summary,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  summary: string;
  /** The id of the section it shows and hides. */
  controls: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-md px-1 text-left transition-colors hover:bg-card-hover",
        FOCUS_RING,
      )}
    >
      <span className="grid min-w-0 flex-1">
        <span className="text-sm font-semibold text-muted-foreground">
          {open ? "Fewer options" : "More options"}
        </span>
        {open ? null : (
          <span className="truncate text-caption text-muted-foreground">
            {summary}
          </span>
        )}
      </span>
      <ChevronDown
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-180",
        )}
      />
    </button>
  );
}
