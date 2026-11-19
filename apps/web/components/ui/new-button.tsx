import * as React from "react";
import { Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A page's "New ..." button: a +, then "New" and the thing it makes ("New
 * event", "New minutes", "New task"). Paul, 2026-11-19: "make the new buttons
 * match across the board"; on the decision card the same day he chose the
 * outlined look Events already had (#5560) over a filled pill. The look is
 * the Button's `action` variant (`button.tsx`), which a page's main action
 * that keeps its own verb (Log service, Upload, Adjust points) draws too.
 *
 * The label is "New <thing>", not "Add", "Create" or "Start": one verb for
 * making something, so a member learns it once. On the phone the same action
 * is the floating glass + (`apps/mobile/components/floating-create-button.tsx`),
 * whose accessibility label is the same "New <thing>".
 *
 * Where it is narrow, in a page header beside chat, the words go and the +
 * stays (the name is still read out), so the page's title keeps its room.
 * That keys off the nearest `@container`: the tool page header is one.
 *
 * Forwards its ref and props, so it works as a dialog or popover trigger
 * (`asChild`) and takes a gate's `controlProps()`.
 */
export type NewButtonProps = Omit<ButtonProps, "children" | "variant"> & {
  /** What it makes, lowercase unless a name: "event", "minutes", "task". */
  thing: string;
};

export const NewButton = React.forwardRef<HTMLButtonElement, NewButtonProps>(
  function NewButton({ thing, className, size = "toolbar", ...props }, ref) {
    return (
      <Button
        ref={ref}
        size={size}
        variant="action"
        className={cn(
          "shrink-0 gap-2 @max-[26rem]:w-9 @max-[26rem]:px-0 @max-[26rem]:pointer-coarse:w-11",
          className,
        )}
        {...props}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span className="@max-[26rem]:sr-only">{newLabel(thing)}</span>
      </Button>
    );
  },
);

/** "New event": the button's words, for a test or a screen reader name. */
export function newLabel(thing: string): string {
  return `New ${thing}`;
}
