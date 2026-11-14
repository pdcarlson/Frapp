import { FOCUS_RING_OFFSET } from "@/components/ui/focus";

/**
 * A quiet underlined text action: the answer a screen shouldn't invite, set
 * beside the one Primary that matters (Meet Frapp AI's Not now, an event's
 * Can't make it?, #4933). Muted, underlined, small to a mouse, and back to the
 * 44px touch floor under `pointer-coarse` (`components.md` §2), the way
 * `Button`'s sizes are. Put it on a `<button>` or a `<Link>`; in a grid or a
 * flex column, the caller also places it (`justify-self-*`, `self-*`), since a
 * stretched button is a full-row target.
 */
export const QUIET_LINK = [
  "rounded-sm text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground",
  "pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:justify-center",
  "disabled:pointer-events-none disabled:opacity-50",
  FOCUS_RING_OFFSET,
].join(" ");
