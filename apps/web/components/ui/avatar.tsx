"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import type { MemberAvatarTint } from "@repo/hooks"

import { cn } from "@/lib/utils"

/*
 * `spec/ui/design-system/components.md` §7 and §11 draw the avatar the same way
 * everywhere it appears: a circle on the elevated `--popover` step with the
 * initials in `--muted-foreground` at the caption size and 700. The scaffold
 * filled the fallback with `bg-secondary`, which under Signet is the card step
 * — one below elevated, so an avatar sitting on a card vanished into it. The
 * fill is spelled `bg-popover`, not the `bg-accent` alias that held the same
 * value (deleted, #3036): `components/shared/elevation-call-sites.spec.ts` bans
 * the name.
 *
 * A member's initials take their own color (#3860, Paul approved 2026-11-10):
 * pass `tint` from the roster's `avatarTintFor(userId)` and the fallback draws
 * style A, the hue at 14% over `--card` with the initials in the full hue.
 * Without `tint` it stays the neutral circle: a group DM's title initials and
 * the auth showcase, which stand in for no one member.
 */

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> & {
    /** The member's initials paint; omit for the neutral circle. */
    tint?: MemberAvatarTint | null
  }
>(({ className, tint, style, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    data-avatar-tint={tint ? tint.text : undefined}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-popover text-caption font-bold text-muted-foreground",
      className
    )}
    style={
      tint
        ? { backgroundColor: tint.fill, color: tint.text, ...style }
        : style
    }
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }
