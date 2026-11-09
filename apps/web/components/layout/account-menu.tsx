"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  Bell,
  Check,
  ChevronsUpDown,
  LogOut,
  Smile,
  Sparkles,
  User,
} from "lucide-react";
import { useCurrentUser } from "@repo/hooks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AvatarPresenceDot,
  PresenceGlyph,
} from "@/components/members/presence-dot";
import { CustomStatusDialog } from "@/components/layout/custom-status-dialog";
import { useChapterPresenceContext } from "@/lib/providers/chapter-presence-provider";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useNetwork } from "@/lib/providers/network-provider";
import {
  DND_DURATIONS,
  MEMBER_STATUS_HINT,
  clockTime,
  dndEndsAt,
  tomorrowMorning,
  untilLabel,
  type MemberStatus,
  type OwnStatus,
} from "@repo/hooks/member-status";
import { presenceLabel } from "@/lib/realtime/presence-status";
import { useOwnStatus, useSaveOwnStatus } from "@/lib/realtime/use-own-status";
import { signOutCurrentSession } from "@/lib/auth/session";
import { cn, initials } from "@/lib/utils";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";
import { useConfirmDropBulkUploads } from "@/components/backwork/bulk/use-confirm-drop-bulk-uploads";

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
 * Contents are exactly Status and the custom status line, a divider, Profile,
 * Notification settings, What's new, a divider, Sign out (`1i`, plus What's
 * new, 2026-11-07: the changelog members read, the same list as mobile
 * Settings → What's new; plus Status, 2026-11-09, #3845: the member's own
 * Online / Idle / Do Not Disturb / Invisible and custom line, first because
 * it is the row people reach for before practice, as on Discord and Slack). **Chapter switching is deliberately not here**: it lives in the nav's
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
  const [editingLine, setEditingLine] = useState(false);
  const own = useOwnStatus();
  const { data } = useCurrentUser();

  const user = (data ?? {}) as CurrentUser;
  const name = user.display_name?.trim() || "Your account";
  const email = user.email ?? null;

  const { confirmDrop, confirmDropDialog } = useConfirmDropBulkUploads();

  // Your own dot, on the avatar that opens this menu. Read from presence, so
  // it is what the chapter sees (the Idle clock included), except that
  // Invisible shows its grey ring to you alone.
  const { userId } = useFrappUser();
  const presence = useChapterPresenceContext();
  const ownDot =
    presence.isReady && userId ? presence.statusOf(userId) : null;
  // The dot is decorative (`AvatarPresenceDot`), so the control names it.
  const accountLabel = ownDot
    ? `Account menu for ${name}, ${presenceLabel(ownDot)}`
    : `Account menu for ${name}`;

  async function handleSignOut() {
    if (!(await confirmDrop("sign-out"))) return;
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
            aria-label={accountLabel}
            className={cn(
              "ml-1 shrink-0 rounded-full transition",
              FOCUS_RING_SHELL,
            )}
          >
            <span className="relative block">
              <Avatar className="h-[30px] w-[30px] border border-border bg-popover">
                {user.avatar_url ? (
                  <AvatarImage src={user.avatar_url} alt="" />
                ) : null}
                <AvatarFallback className="text-[11px] font-semibold">
                  {initials(name)}
                </AvatarFallback>
              </Avatar>
              <AvatarPresenceDot status={ownDot} />
            </span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={accountLabel}
            className={cn(
              "flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left transition",
              "hover:bg-card",
              FOCUS_RING_SHELL,
            )}
          >
            <span className="relative shrink-0">
              <Avatar className="h-8 w-8">
                {user.avatar_url ? (
                  <AvatarImage src={user.avatar_url} alt="" />
                ) : null}
                <AvatarFallback className="text-xs">
                  {initials(name)}
                </AvatarFallback>
              </Avatar>
              <AvatarPresenceDot status={ownDot} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {name}
              </span>
              {email ? (
                <span className="block truncate text-caption text-muted">
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
        <StatusRows own={own} onEditLine={() => setEditingLine(true)} />
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
           * has no tabs and would ignore it (`spec/ui/design-system/README.md`
           * §5, rule 2).
           */}
          <Link href="/profile#notification-settings" onClick={onNavigate}>
            <Bell className="h-4 w-4" aria-hidden="true" />
            <span>Notification settings</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/whats-new" onClick={onNavigate}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span>What&apos;s new</span>
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
      {confirmDropDialog}
      {editingLine ? (
        <CustomStatusDialog
          current={own?.line ?? null}
          onClose={() => setEditingLine(false)}
        />
      ) : null}
    </DropdownMenu>
  );
}

/**
 * The Status row (a submenu: Online, Idle, Do Not Disturb with its
 * durations, Invisible) and the custom status row under it (#3845).
 *
 * Writes go through the shared settings mutation, optimistically, so the dot
 * moves on the click. While the dashboard is offline both rows are disabled,
 * as the Profile notification switches are (`notifications.md` § Preference
 * sync): a status the server never heard of would show here and nowhere else.
 */
function StatusRows({
  own,
  onEditLine,
}: {
  own: OwnStatus | null;
  onEditLine: () => void;
}) {
  const { save } = useSaveOwnStatus();
  const { isOffline } = useNetwork();
  const current: MemberStatus = own?.status ?? "online";
  const disabled = isOffline || own === null;
  const now = new Date();

  function pick(status: MemberStatus, endsAt: string | null = null) {
    void save({ status, status_expires_at: endsAt });
  }

  function mark(status: MemberStatus) {
    return current === status ? (
      <Check className="ml-auto" aria-label="Current" />
    ) : null;
  }

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled}>
          <PresenceGlyph status={current} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{presenceLabel(current)}</span>
            {own?.statusEndsAt ? (
              <span className="block truncate text-caption text-muted-foreground">
                {untilLabel(own.statusEndsAt, now)}
              </span>
            ) : null}
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-[240px]">
          <StatusItem status="online" onSelect={() => pick("online")}>
            {mark("online")}
          </StatusItem>
          <StatusItem status="idle" onSelect={() => pick("idle")}>
            {mark("idle")}
          </StatusItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <PresenceGlyph status="dnd" />
              <span className="min-w-0 flex-1">
                <span className="block">{presenceLabel("dnd")}</span>
                <span className="block text-caption text-muted-foreground">
                  {MEMBER_STATUS_HINT.dnd}
                </span>
              </span>
              {current === "dnd" ? <Check aria-label="Current" /> : null}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[220px]">
              {DND_DURATIONS.map(({ duration, label }) => (
                <DropdownMenuItem
                  key={label}
                  onSelect={() => pick("dnd", dndEndsAt(duration, new Date()))}
                >
                  <span className="flex-1">{label}</span>
                  {duration === "tomorrow" ? (
                    <span className="text-caption text-muted-foreground">
                      {clockTime(tomorrowMorning(now))}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <StatusItem
            status="invisible"
            hint={MEMBER_STATUS_HINT.invisible}
            onSelect={() => pick("invisible")}
          >
            {mark("invisible")}
          </StatusItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem disabled={disabled} onSelect={onEditLine}>
        <Smile aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {own?.line ?? "Set a custom status"}
        </span>
      </DropdownMenuItem>
    </>
  );
}

function StatusItem({
  status,
  hint,
  onSelect,
  children,
}: {
  status: MemberStatus;
  hint?: string;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <PresenceGlyph status={status} />
      <span className="min-w-0 flex-1">
        <span className="block">{presenceLabel(status)}</span>
        {hint ? (
          <span className="block text-caption text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
      {children}
    </DropdownMenuItem>
  );
}
