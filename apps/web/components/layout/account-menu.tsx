"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronsUpDown, LogOut, Monitor, Moon, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { useCurrentUser } from "@repo/hooks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutCurrentSession } from "@/lib/auth/session";
import { cn, initials } from "@/lib/utils";

type CurrentUser = {
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

const THEME_OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

/**
 * The account menu that anchors the bottom of the sidebar.
 *
 * It replaces three scattered affordances: the Profile row that used to sit at
 * the top of the nav list (Profile is about the viewer, not the chapter, so it
 * does not belong among chapter surfaces), the naked "Sign out" button in the
 * header, and the standalone theme toggle beside it. All three now live here,
 * which is where a consumer app puts identity.
 *
 * Rendered inside the shared sidebar-bottom region, so the mobile drawer gets
 * it for free — `spec/ui/web-dashboard/README.md` requires the drawer and the
 * sidebar to render the same list rather than duplicating navigation.
 */
export function AccountMenu({
  variant,
  onNavigate,
}: {
  variant: "sidebar" | "sheet";
  /**
   * Closes the mobile drawer behind a navigation, exactly as `ProtectedNavItem`
   * does. Without it the drawer and its overlay stay up over the page the
   * member just navigated to — the dropdown is a modal layer above the sheet,
   * so dismissing it does not register as an outside interaction on the sheet.
   * Sign out is unaffected either way; it does a full document navigation.
   */
  onNavigate?: () => void;
}) {
  const { theme = "system", setTheme } = useTheme();
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
        <button
          type="button"
          aria-label={`Account menu for ${name}`}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition",
            "hover:bg-side-bg-hi/70",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-side-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-side-bg",
          )}
        >
          <Avatar className="h-8 w-8 shrink-0">
            {user.avatar_url ? (
              <AvatarImage src={user.avatar_url} alt="" />
            ) : null}
            <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-side-fg-hi">{name}</span>
            {email ? (
              <span className="block truncate text-[11px] text-side-muted">
                {email}
              </span>
            ) : null}
          </span>
          <ChevronsUpDown
            className="h-4 w-4 shrink-0 text-side-muted"
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={variant === "sidebar" ? "top" : "bottom"}
        className="w-56"
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
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isSigningOut}
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span>{isSigningOut ? "Signing out…" : "Sign out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
