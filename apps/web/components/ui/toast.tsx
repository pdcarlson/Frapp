"use client"

import * as React from "react"
import * as ToastPrimitives from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { FOCUS_RING } from "@/components/ui/focus"

/*
 * Toasts, composed from the §2 undrawn-primitive tokens: elevated fill,
 * hairline, radius 12.
 *
 * The destructive variant was the one real defect here. It shipped the stock
 * light-surface treatment — a solid `--destructive` panel with
 * `--destructive-foreground` text — plus four raw Tailwind reds
 * (`text-red-300`, `hover:text-red-50`, `ring-red-400`, `ring-offset-red-600`)
 * that belong to no token system at all. foundations.md §5 is explicit that on
 * dark surfaces semantic colour is a ~13% tint with the hue as text, so that is
 * what it takes now, and the raw reds are gone.
 */
const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-2 overflow-hidden rounded-md border p-4 pr-6 transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border-border bg-popover text-popover-foreground",
        // The §5 tint recipe, not a solid fill: "on dark surfaces, prefer the
        // tint recipe (13% alpha fill + hue text) over solid fills"
        // (foundations.md §5). A solid `#f85149` panel with near-black text is
        // the light-surface treatment and reads as an alert box, not a toast.
        destructive:
          "destructive group border-destructive/45 bg-destructive/[.13] text-destructive-text",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-input bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:border-border disabled:bg-card disabled:text-disabled",
      // `enabled:`-scoped: `group-[.destructive]:*` compiles to a descendant
      // selector carrying two ancestor classes, so it strictly outranks
      // `disabled:*` and would keep a disabled action painted as if live.
      "enabled:group-[.destructive]:border-destructive/45 enabled:group-[.destructive]:bg-transparent enabled:group-[.destructive]:text-destructive-text enabled:group-[.destructive]:hover:bg-destructive/20",
      FOCUS_RING,
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-1 top-1 rounded-xs border border-transparent p-1 text-muted opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100",
      "group-[.destructive]:text-destructive-text group-[.destructive]:hover:text-destructive-text",
      FOCUS_RING,
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    // The scaffold shrank an adjacent description to `text-xs` (12px) from
    // here. 12 is off foundations §7's scale and the hierarchy does not need
    // it: title and description are both the `label` size and separate on
    // weight and colour instead.
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn(
      "text-sm text-muted-foreground group-[.destructive]:text-destructive-text",
      className
    )}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}
