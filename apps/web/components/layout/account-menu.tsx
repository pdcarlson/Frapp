"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, ChevronsUpDown, LogOut, User } from "lucide-react";
import { useCurrentUser } from "@repo/hooks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutCurrentSession } from "@/lib/auth/session";
import { cn, initials } from "@/lib/utils";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";

type CurrentUser = {
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

/**
 * The account menu: identity, and only identity.
 *
 * It hangs off the top-bar avatar on desktop (`topbar`) and off a full-width
 * row at the bottom of the mobile drawer (`sheet`). The greenfield shell moved
 * it out of the nav entirely — board `1t` records "sidebar account menu →
 * top-bar avatar" — which is what freed the bottom of the nav for the collapse
 * toggle and nothing else.
 *
 * Contents are exactly Profile, Notification settings, a divider, Sign out
 * (`1i`). **Chapter switching is deliberately not here**: it lives in the nav's
 * chapter header row, because identity and chapter are separate menus. Putting
 * a chapter action in the account menu is the merge that board note warns
 * against.
 *
 * (The theme control that once lived here was deleted with next-themes in the
 * #920 shell slice — Signet is dark-only.)
 */
export function AccountMenu({
  variant,
  onNavigate,
}: {
  variant: "topbar" | "sheet";
  /**
   * Closes the mobile drawer behind a navigation, exactly as `ProtectedNavItem`
   * does. Without it the drawer and its overlay stay up over the page the
   * member just navigated to — the dropdown is a modal layer above the sheet,
   * so dismissing it does not register as an outside interaction on the sheet.
   * Sign out is unaffected either way; it does a full document navigation.
   */
  onNavigate?: () => void;
}) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { data } = useCurrentUser();

  const user = (data ?? {}) as CurrentUser;
  const name = user.display_name?.trim() || "Your account";
  const email = user.email ?? null;

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOutCurrentSession();
      window.location.assign("/sign-in");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "topbar" ? (
          /*
           * In the top bar the control is the avatar alone: a 30px circle, no
           * name, no email, no chevron. The name is still the accessible name
           * via `aria-label`, so nothing is lost to a screen reader — only the
           * three lines of chrome the board deletes.
           */
          <button
            type="button"
            aria-label={`Account menu for ${name}`}
            className={cn(
              "ml-1 shrink-0 rounded-full transition",
              FOCUS_RING_SHELL,
            )}
          >
            <Avatar className="h-[30px] w-[30px] border border-border bg-popover">
              {user.avatar_url ? (
                <AvatarImage src={user.avatar_url} alt="" />
              ) : null}
              <AvatarFallback className="text-[11px] font-semibold">
                {initials(name)}
              </AvatarFallback>
            </Avatar>
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Account menu for ${name}`}
            className={cn(
              "flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left transition",
              "hover:bg-card",
              FOCUS_RING_SHELL,
            )}
          >
            <Avatar className="h-8 w-8 shrink-0">
              {user.avatar_url ? (
                <AvatarImage src={user.avatar_url} alt="" />
              ) : null}
              <AvatarFallback className="text-xs">
                {initials(name)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {name}
              </span>
              {email ? (
                <span className="block truncate text-[11px] text-muted">
                  {email}
                </span>
              ) : null}
            </span>
            <ChevronsUpDown
              className="h-4 w-4 shrink-0 text-muted"
              aria-hidden="true"
            />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === "topbar" ? "end" : "start"}
        side={variant === "topbar" ? "bottom" : "top"}
        className="w-[260px]"
      >
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{name}</span>
          {email ? (
            <span className="block truncate text-xs text-muted-foreground">
              {email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile" onClick={onNavigate}>
            <User className="h-4 w-4" aria-hidden="true" />
            <span>Profile</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          {/*
           * Notification preferences are a section of the profile screen, not a
           * route of their own, so this links to that section's anchor. A
           * `?tab=` param would have been a dead affordance: the profile screen
           * has no tabs and would ignore it (`components.md` §5).
           */}
          <Link href="/profile#notification-settings" onClick={onNavigate}>
            <Bell className="h-4 w-4" aria-hidden="true" />
            <span>Notification settings</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isSigningOut}
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
