import * as React from "react";
import { Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Every "New ..." button in the app: a +, then "New" and the thing it makes
 * ("New event", "New minutes", "New task"). Paul, 2026-11-19: "make the new
 * buttons match across the board", and on the decision card the same day he
 * chose the outlined look Events already had (#5560) over a filled pill:
 * accent outline and accent text at the toolbar height, so it sits level with
 * the search and filter buttons beside it in a page header and the page's
 * content is what the eye lands on. The phone draws the same button
 * (`apps/mobile/components/new-button.tsx`).
 *
 * The label is always "New <thing>", never "Add", "Create" or "Start": one
 * verb for making something, so a member learns it once. A page's main action
 * that isn't making a new item (Log service, Upload, Invite member) keeps its
 * own verb but wears the same look (`PAGE_ACTION_CLASSES`), so every page's
 * one main action reads the same in its header.
 *
 * Forwards its ref and props, so it works as a dialog or popover trigger
 * (`asChild`) and takes a gate's `controlProps()`.
 */
export type NewButtonProps = Omit<ButtonProps, "children" | "variant"> & {
  /** What it makes, lowercase unless a name: "event", "minutes", "task". */
  thing: string;
};

/**
 * The look of a page's one main action: accent outline and accent text, at
 * whatever size the button is (`toolbar` in a header).
 */
export const PAGE_ACTION_CLASSES =
  "shrink-0 gap-2 border-primary/35 text-primary hover:bg-primary/10 hover:text-primary";

export const NewButton = React.forwardRef<HTMLButtonElement, NewButtonProps>(
  function NewButton({ thing, className, size = "toolbar", ...props }, ref) {
    return (
      <Button
        ref={ref}
        size={size}
        variant="ghost"
        className={cn(PAGE_ACTION_CLASSES, className)}
        {...props}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {newLabel(thing)}
      </Button>
    );
  },
);

/** "New event": the button's words, for a test or a screen reader name. */
export function newLabel(thing: string): string {
  return `New ${thing}`;
}
