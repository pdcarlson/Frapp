import { cn } from "@/lib/utils";

/**
 * A task property drawn as a chip on a suggested task's card (#5562; Paul,
 * 2026-11-19: the who and date fields read as a form to fill in): the
 * Chip step (`spec/ui/design-system/components.md` § 5, 24px, radius 8,
 * caption / 600), taller to a finger. A value Frapp guessed is dashed, the
 * way Todoist marks what it filled in, and one still missing takes the
 * warning tone.
 */
export function propertyChipClass({
  guessed = false,
  missing = false,
  empty = false,
}: {
  guessed?: boolean;
  missing?: boolean;
  empty?: boolean;
} = {}): string {
  return cn(
    "inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md border px-2 text-caption font-semibold leading-none",
    "bg-transparent text-foreground hover:bg-card-hover pointer-coarse:h-9",
    guessed
      ? "border-dashed border-input text-muted-foreground"
      : "border-input",
    missing && "border-warning/45 bg-warning-tint text-warning",
    empty && !missing && "text-muted-foreground",
  );
}
