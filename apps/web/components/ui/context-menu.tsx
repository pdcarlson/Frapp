"use client";

import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MENU_CONTENT_CLASS,
  MENU_ITEM_CLASS,
  MENU_LABEL_CLASS,
  MENU_SEPARATOR_CLASS,
} from "@/components/ui/dropdown-menu";

/*
 * The right-click twin of `dropdown-menu.tsx`, styled from the same class
 * constants so a row's right-click menu and its ⋯ menu are indistinguishable.
 * Radix opens it on right-click, on a touch long-press, and on the keyboard's
 * menu key (Shift+F10) when the trigger has focus.
 *
 * Don't call this directly from a page: `components/shared/row-menu.tsx` pairs
 * it with the ⋯ button so no action is reachable by right-click alone. The one
 * exception is the chat rail (`components/chat/channel-row-menu.tsx`), whose
 * rows carry no hover controls by the owner's call (2026-11-06): every action
 * in it is also reachable without a right-click, from the open channel's ⋯
 * menu, its channel start, or Chat settings.
 */
const ContextMenu = ContextMenuPrimitive.Root;

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        MENU_CONTENT_CLASS,
        "max-h-[var(--radix-context-menu-content-available-height)]",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 origin-[--radix-context-menu-content-transform-origin]",
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(MENU_ITEM_CLASS, className)}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(MENU_LABEL_CLASS, className)}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn(MENU_SEPARATOR_CLASS, className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

/*
 * A nested menu (Notifications ▸ in the chat rail). Same item recipe as a
 * plain row, with a chevron that says it opens rather than acts.
 */
const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    /** The state the submenu is in, in quiet type before the chevron ("Muted"). */
    detail?: React.ReactNode;
  }
>(({ className, children, detail, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      MENU_ITEM_CLASS,
      "data-[state=open]:bg-card-hover data-[state=open]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
    {detail ? (
      <span className="ml-auto text-caption text-muted-foreground">
        {detail}
      </span>
    ) : null}
    <ChevronRight
      aria-hidden="true"
      className={cn("text-muted-foreground", !detail && "ml-auto")}
    />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent
      ref={ref}
      className={cn(
        MENU_CONTENT_CLASS,
        "max-h-[var(--radix-context-menu-content-available-height)]",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 origin-[--radix-context-menu-content-transform-origin]",
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

/*
 * A pick of one. The check sits at the far end, where a plain row puts
 * nothing, so the labels stay aligned with the rows around them.
 */
const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(MENU_ITEM_CLASS, className)}
    {...props}
  >
    {children}
    <ContextMenuPrimitive.ItemIndicator className="ml-auto flex items-center">
      <Check aria-hidden="true" className="size-4" />
    </ContextMenuPrimitive.ItemIndicator>
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
};
