"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * The highlighted row is `--card-hover` with `--foreground` text: neutral,
 * since 2026-11-05 (`foundations.md` §6, "Where the accent goes"). It was the
 * accent tint until then, so every menu lit its hovered row gold.
 *
 * Not `--popover`, and not the deleted scaffold `--accent` (#3036), which held
 * `--popover`'s own value: a menu sits on `--popover`, the top step of the
 * ladder, so a row highlighted with it moved an invisible cursor.
 * `--card-hover` sits above every ladder step, 1.194:1 on `--popover`
 * (`shared/elevation-contrast.spec.ts`), which reads as a state where the
 * ladder's own ~1.1:1 steps do not.
 */
/*
 * Shared with `context-menu.tsx`: a right-click menu and a ⋯ menu that read
 * the same action list must also look the same, so both read these.
 */
export const MENU_CONTENT_CLASS =
  "z-50 min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground";
export const MENU_ITEM_CLASS =
  "relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-xs px-2 py-1.5 text-sm outline-none pointer-coarse:min-h-11 pointer-coarse:text-base transition-colors focus:bg-card-hover focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:text-disabled [&>svg]:size-4 [&>svg]:shrink-0";
export const MENU_LABEL_CLASS =
  "px-2 py-1.5 text-sm font-semibold text-muted-foreground";
export const MENU_SEPARATOR_CLASS = "-mx-1 my-1 h-px bg-border";

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        MENU_CONTENT_CLASS,
        "max-h-[var(--radix-dropdown-menu-content-available-height)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      MENU_ITEM_CLASS,
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      MENU_LABEL_CLASS,
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn(MENU_SEPARATOR_CLASS, className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

/*
 * A submenu: a row that opens a second menu beside the first. Added for the
 * account menu's Status row (#3845), the pattern Discord and Slack use for it.
 * The trigger is an ordinary row (`MENU_ITEM_CLASS`) with a trailing chevron,
 * highlighted while its submenu is open as well as on focus, so the row the
 * submenu belongs to stays marked while the pointer is inside the submenu.
 */
const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      MENU_ITEM_CLASS,
      "data-[state=open]:bg-card-hover data-[state=open]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto text-muted-foreground" aria-hidden="true" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      className={cn(
        MENU_CONTENT_CLASS,
        "max-h-[var(--radix-dropdown-menu-content-available-height)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;

export {
  DropdownMenu,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
