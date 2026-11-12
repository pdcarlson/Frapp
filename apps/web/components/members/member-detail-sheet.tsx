"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  UserMinus,
} from "lucide-react";
import { SectionSkeleton } from "@/components/shared/page-skeletons";
import { SkeletonText } from "@/components/shared/async-states";
import {
  useGetOrCreateDm,
  useMemberByUserId,
  useMemberDisplayNames,
  useMyPermissions,
  useRemoveMember,
  useRoles,
  useUpdateMemberRoles,
} from "@repo/hooks";
import {
  can,
  CORRECTION_MENU_LABEL,
  memberAccessRoleIds,
  phoneHref,
  removesMemberAccess,
  resolveRoleChips,
  rolesAfterSave,
  type MemberRoleChip,
} from "@repo/validation";
import { formatDay } from "@repo/formatting";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useToast } from "@/lib/hooks/use-toast";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet, SheetTitle } from "@/components/ui/sheet";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import {
  PanelBody,
  PanelContent,
  PanelFooter,
} from "@/components/shared/panel";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { dashboardTableCheckboxClassName } from "@/components/shared/table-controls";
import { asArray, cn, getErrorMessage, initials } from "@/lib/utils";
import { memberLabel } from "@repo/hooks/display-names";
import {
  memberMenuButtonLabel,
  REMOVE_CONFIRM_BODY,
  REMOVE_FROM_CHAPTER_LABEL,
  removeConfirmTitle,
} from "@repo/hooks/member-removal-copy";
import { normalizeRoleOptions, roleAccessRows } from "@/lib/roles";
import {
  DETAIL_LIST,
  DetailRow,
} from "@/components/members/member-detail-rows";
import { MemberPledgeClassSection } from "@/components/members/member-pledge-class-section";
import { MemberCorrectionDialog } from "@/components/members/member-correction-dialog";

type MemberRecord = Record<string, unknown>;

type CustomFieldValue = {
  field_id: string;
  label: string;
  type: string;
  value: string | null;
};

function formatCustomValue(field: CustomFieldValue): string {
  // Not an em dash. Board `1t` lists "em dashes in UI copy" under gone, and a
  // placeholder glyph is a character a screen reader has to announce standing
  // in for nothing at all. A row is a label over a value, so the value says it
  // is unset rather than drawing a mark that means it.
  if (field.value === null || field.value === "") return "Not set";
  if (field.type === "boolean") {
    return field.value === "true" ? "Yes" : "No";
  }
  return field.value;
}

/**
 * `MemberProfileDto.custom_fields`, already filtered server-side to the tiers
 * the viewer may see (`spec/behavior/members.md` § Custom Fields), so the
 * sheet draws every entry it gets and gates none.
 */
function parseCustomFields(member: MemberRecord | null): CustomFieldValue[] {
  return asArray<Record<string, unknown>>(member?.custom_fields).flatMap(
    (entry) => {
      if (
        !entry ||
        typeof entry.field_id !== "string" ||
        typeof entry.label !== "string" ||
        typeof entry.type !== "string"
      ) {
        return [];
      }
      return [
        {
          field_id: entry.field_id,
          label: entry.label,
          type: entry.type,
          value: typeof entry.value === "string" ? entry.value : null,
        },
      ];
    },
  );
}

function stringField(member: MemberRecord | null, key: string): string | null {
  const value = member?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

/**
 * The line under the name, as mobile's sheet draws it (`selectMemberDetail`):
 * major, company, city and the class year, e.g. `Economics · Chicago · '27`.
 */
function metaLine(member: MemberRecord | null): string | null {
  const year = member?.graduation_year;
  const parts = [
    stringField(member, "major"),
    stringField(member, "current_company"),
    stringField(member, "current_city"),
    typeof year === "number" && Number.isFinite(year)
      ? `'${String(year).slice(-2)}`
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

type MemberDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Whose profile, by `users.id`, or `null` while nobody is selected; the
   * sheet stays mounted regardless. Read through
   * `GET /v1/members/by-user/{userId}`, which also hands back the membership
   * id a role edit or removal takes, so chat can open it with only a sender
   * or mention id (#3726).
   */
  userId: string | null;
  /**
   * The directory row that opened the sheet, drawn while the profile read is
   * in flight so a row click never opens onto a skeleton. Ignored unless its
   * `user_id` is {@link userId}.
   */
  initialMember?: MemberRecord | null;
  /**
   * The name and photo the opener already holds (chat's roster), drawn in the
   * identity block until the profile read lands, so the sheet never opens
   * titled "Member 3f9a1c" for someone chat just named, and keeps their name
   * if the read fails.
   */
  identity?: { name: string | null; avatarUrl: string | null } | null;
  /**
   * The member's point balance, which only the directory has (from the
   * leaderboard it already reads). Omitted elsewhere rather than faked: the
   * per-member read needs `points:view_all`, which most viewers lack.
   */
  points?: number | null;
};

/**
 * One role the officer can tick. The row is the role's name alone: its id and
 * key are the system's words, never the chapter's (principles.md P2.2).
 */
function RoleChecklistItem({
  title,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-border p-3 transition-colors hover:bg-card-hover">
      <p className="text-sm font-semibold">{title}</p>
      <input
        type="checkbox"
        className={dashboardTableCheckboxClassName}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function toggleSelection(
  setter: React.Dispatch<React.SetStateAction<string[]>>,
  roleId: string,
  isChecked: boolean,
) {
  setter((previous) =>
    isChecked
      ? [...new Set([...previous, roleId])]
      : previous.filter((id) => id !== roleId),
  );
}

/** A role as a chip: its palette color as a dot, or a plain muted one. */
function RoleChip({ chip }: { chip: MemberRoleChip }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-caption text-foreground">
      <span
        aria-hidden="true"
        className={cn(
          "h-2.5 w-2.5 shrink-0 rounded-full",
          !chip.color && "bg-muted-foreground",
        )}
        style={chip.color ? { backgroundColor: chip.color } : undefined}
      />
      {chip.name}
    </li>
  );
}

/**
 * A member's profile: one sheet for every door on web (#3726). The
 * directory's Actives and Alumni rows, and in chat a sender's name or photo,
 * an `@` chip that names one member, and a row of the channel's member list
 * all open it, keyed by `users.id`, so a member sees the same card wherever
 * they click a name. Mobile's sheet
 * (`apps/mobile/components/directory/member-detail-sheet.tsx`) is the
 * reference, and this draws its order: photo, name and the class-year line,
 * Message, then how to reach them (phone, email) with member since, roles as
 * colored chips in the chapter's rank, pledge class, the custom fields the
 * viewer may see folded under More details, and the bio.
 *
 * **A contact card first** (#3711). A profile is opened to reach someone, so
 * their phone and email come right under Message, before roles (Evan,
 * 2026-11-10: "Contact info in the profile"). The phone is the member's own
 * (`PATCH /v1/users/me`) and is a `tel:` link. A chapter's custom fields
 * (T-shirt size, dietary, emergency contact) are logistics, not why a profile
 * is opened, so they sit behind a More details row, closed on every opening
 * (Shawn, 2026-11-09).
 *
 * **Header.** No title word and no name in the title row: the name heads the
 * body under the photo, and the row carries the close alone, as
 * `components.md` § Surface size has the member sheet do. The name is the
 * dialog's title (`SheetTitle`), so the sheet is still announced by it.
 *
 * **Roles** are read-only chips for everyone. A viewer holding `roles:manage`
 * (the gate on `PATCH /v1/members/{id}/roles`) also gets Edit, which swaps the
 * chips for the checklists and puts Save and Cancel in the footer; this is how
 * an officer changes a member's roles from chat without leaving it (tester
 * report on #3726).
 *
 * **Remove from chapter** sits behind the `⋯` beside the close, never on the
 * face of the profile (Paul, 2026-11-11: nobody opens a profile to remove
 * someone, and it was drawn as a big red button on his own). The `⋯` is drawn
 * only when the API says this viewer may remove this member
 * (`viewer_can_remove`: `members:remove`, not their own profile, and the
 * member ranks below them), so it is never on your own profile, and a chair
 * never sees it on an officer's. It still asks before removing.
 *
 * **Pledge class and order number** (#3939) sit under the roles, in the
 * chapter's own words; `MemberPledgeClassSection` owns them.
 *
 * **Edit name and graduation year** (#4367) is in the same `⋯`, for an officer
 * the API says may fix them (`viewer_can_edit_profile`: `roles:manage`, the
 * member ranks below them, and is in no other chapter). It opens
 * `MemberCorrectionDialog`. Nothing else on someone's profile is an officer's
 * to change.
 */
export function MemberDetailSheet({
  open,
  onOpenChange,
  userId,
  initialMember,
  identity,
  points,
}: MemberDetailSheetProps) {
  const memberQuery = useMemberByUserId(userId ?? "");
  const rolesQuery = useRoles();
  // The same role-color resolution chat's name uses (#3860).
  const { avatarTintFor } = useMemberDisplayNames();
  const myPermissionsQuery = useMyPermissions();
  const myPermissions = myPermissionsQuery.data?.permissions;
  const updateRolesMutation = useUpdateMemberRoles();
  const removeMemberMutation = useRemoveMember();
  const dmMutation = useGetOrCreateDm();
  const router = useRouter();
  const { userId: currentUserId, isLoading: isCurrentUserLoading } =
    useFrappUser();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const rolesHeadingId = useId();
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  // Whose roles are being edited. Keyed by member rather than a boolean, so
  // the editor never carries over to the next member the sheet opens on.
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  // Closing drops the editor and its unsaved picks, however the sheet closed
  // (Escape, the overlay, the X, or the parent). Reopening the same member
  // shows the chips again, never a checklist seeded from roles that may have
  // changed since. Adjusted during render, not in an effect, so no frame draws
  // the stale editor.
  if (!open && editingUserId !== null) setEditingUserId(null);
  const editingRoles = open && userId !== null && editingUserId === userId;
  // Whose More details are open, keyed by member like the role editor, so the
  // custom fields start folded on every member and every opening.
  const [detailsUserId, setDetailsUserId] = useState<string | null>(null);
  if (!open && detailsUserId !== null) setDetailsUserId(null);
  const detailsOpen = open && userId !== null && detailsUserId === userId;
  const detailsRegionId = useId();
  const [correcting, setCorrecting] = useState(false);
  if (!open && correcting) setCorrecting(false);

  const fetched =
    memberQuery.data && typeof memberQuery.data === "object"
      ? (memberQuery.data as MemberRecord)
      : null;
  const seed =
    initialMember && userId && initialMember.user_id === userId
      ? initialMember
      : null;
  const member: MemberRecord | null = fetched ?? seed;

  const memberId = stringField(member, "id");
  const memberRoleIds = useMemo(
    () => stringIds(member?.role_ids),
    [member?.role_ids],
  );
  const roleChips = useMemo(
    () => resolveRoleChips(rolesQuery.data, memberRoleIds),
    [rolesQuery.data, memberRoleIds],
  );
  // Distinct from "no role": while the read is in flight an empty list would
  // flash a wrong "No roles yet".
  const rolesLoading = rolesQuery.isPending;
  // A failed roles read resolves no chip, which must not read as a member
  // with no roles: say it failed and offer the read again.
  const rolesFailed =
    rolesQuery.isError &&
    rolesQuery.data === undefined &&
    memberRoleIds.length > 0;

  const roleOptions = useMemo(
    () => normalizeRoleOptions(rolesQuery.data),
    [rolesQuery.data],
  );

  // `memberLabel`, the helper the directory row uses: this sheet opens from
  // that row, so the two must not name an unnamed member two different ways.
  const seedIdentity = !member && userId ? identity : null;
  const displayName = memberLabel(
    member?.display_name ?? seedIdentity?.name,
    member?.user_id ?? userId,
  );
  const avatarUrl =
    stringField(member, "avatar_url") ?? seedIdentity?.avatarUrl ?? null;
  const meta = metaLine(member);
  const email = stringField(member, "email");
  const phone = stringField(member, "phone");
  const phoneLink = phoneHref(phone, "call");
  const textLink = phoneHref(phone, "text");
  const joined = formatDay(member?.created_at);
  const bio = stringField(member, "bio");
  const onboardingPending = member?.has_completed_onboarding === false;
  const customFields = useMemo(() => parseCustomFields(member), [member]);

  // Null rather than a placeholder, so the Message button and its handler can
  // never fire a DM request at a fallback string.
  const dmTargetUserId = stringField(member, "user_id");
  // The sheet stays mounted and swaps members as rows and names are clicked,
  // so a slow DM request started for one member can still resolve after the
  // sheet has moved to another. This ref lets that continuation notice it is
  // stale instead of navigating the viewer to the wrong conversation.
  const dmTargetUserIdRef = useRef(dmTargetUserId);
  useEffect(() => {
    dmTargetUserIdRef.current = dmTargetUserId;
  }, [dmTargetUserId]);
  // `POST /v1/channels/dm` doesn't reject a self-DM, so the button is absent
  // on the viewer's own profile. `currentUserId` is null until /v1/users/me
  // resolves; treating that as "not the viewer" would let a self-DM through,
  // so the button waits for the load.
  const canMessage =
    !!dmTargetUserId &&
    !isCurrentUserLoading &&
    dmTargetUserId !== currentUserId;

  // The writes' own gates, mirrored so a viewer who holds only
  // `members:view` isn't offered controls that can only 403. Disabled while
  // the permission read is pending, the same as a failed read. Editing waits
  // for the roles list: until it loads, the member-access check can't tell
  // which roles grant access, so a lockout would save without the question
  // (#3670).
  const canEditRoles =
    !!memberId &&
    !memberQuery.isError &&
    rolesQuery.isSuccess &&
    can("roles:manage", myPermissions);
  // The API's answer, read from the profile itself (never the directory row
  // that seeded the sheet, which carries none): it applies the rank rules the
  // removal does, which the client can't see (#4071).
  const canRemove =
    !!memberId &&
    !memberQuery.isError &&
    fetched?.viewer_can_remove === true &&
    dmTargetUserId !== currentUserId;
  // The same kind of answer for fixing their name and year (#4367), from the
  // profile read only, never the directory row that seeded the sheet.
  const canCorrect =
    !!memberId &&
    !memberQuery.isError &&
    fetched?.viewer_can_edit_profile === true &&
    dmTargetUserId !== currentUserId;
  const graduationYear =
    typeof member?.graduation_year === "number" ? member.graduation_year : null;

  function startEditingRoles() {
    setSelectedRoleIds(memberRoleIds);
    setEditingUserId(userId);
  }

  async function handleSaveRoles() {
    if (!memberId) return;
    // Taking away the last role with member access locks the member out of
    // chat, the roster and events, the way the 2026-11-07 testers were
    // (#3670). The API allows it, so ask first, as mobile's editor does.
    // Asked of the roles the save ends with, Everyone settled as the API
    // settles it (#4191): with no other role giving access they keep it.
    if (
      removesMemberAccess(
        memberRoleIds,
        rolesAfterSave(
          selectedRoleIds,
          memberRoleIds,
          roleAccessRows(rolesQuery.data),
        ),
        memberAccessRoleIds(roleAccessRows(rolesQuery.data)),
      )
    ) {
      const confirmed = await confirm({
        title: `Take away ${displayName}'s access?`,
        description: `With none of these roles, ${displayName} can't open chat, the member list or events.`,
        confirmLabel: "Take away access",
        tone: "destructive",
      });
      if (!confirmed) return;
    }
    try {
      await updateRolesMutation.mutateAsync({
        id: memberId,
        role_ids: selectedRoleIds,
      });
      toast({
        title: "Roles updated",
        description: `${displayName}'s roles were saved.`,
      });
      setEditingUserId(null);
      await memberQuery.refetch();
    } catch (error) {
      toast({
        title: "Could not update roles",
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
    }
  }

  async function handleRemoveMember() {
    if (!memberId) return;
    // `confirmLabel` names the verb and its object rather than saying
    // "Confirm" (`writing.md` §2). Browser-chrome dialogs are banned on every
    // surface (`design-system/README.md` §2).
    const confirmed = await confirm({
      title: removeConfirmTitle(displayName),
      description: REMOVE_CONFIRM_BODY,
      confirmLabel: REMOVE_FROM_CHAPTER_LABEL,
      tone: "destructive",
    });
    if (!confirmed) return;

    try {
      await removeMemberMutation.mutateAsync(memberId);
      toast({
        title: "Member removed",
        description: `${displayName} was removed from the chapter roster.`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not remove member",
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
    }
  }

  async function handleMessage() {
    if (!canMessage || !dmTargetUserId) return;
    const requestedUserId = dmTargetUserId;

    try {
      const dm = await dmMutation.mutateAsync({ member_id: requestedUserId });
      // The sheet may have moved on to a different member while this request
      // was in flight — ignore a result that's no longer for the open member.
      if (dmTargetUserIdRef.current !== requestedUserId) return;
      const channelId =
        dm &&
        typeof dm === "object" &&
        typeof (dm as { id?: unknown }).id === "string"
          ? (dm as { id: string }).id
          : null;
      if (!channelId) {
        throw new Error("No channel id returned");
      }
      onOpenChange(false);
      router.push(chatDeepLink({ channelId }));
    } catch (error) {
      if (dmTargetUserIdRef.current !== requestedUserId) return;
      toast({
        title: "Could not start conversation",
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        `aria-describedby={undefined}`: with no `SheetDescription` rendered,
        Radix warns on every open for a `Content` that points at a description
        id that does not exist.
      */}
      <PanelContent aria-describedby={undefined}>
        {/*
          The title row's band with no title in it: the name heads the body.
          The close button `SheetContent` draws sits at its end, and the `⋯`
          beside it holds what a viewer only now and then reaches for
          (components.md § Settings live a couple of taps away), never on the
          profile's face. Absent when it would hold nothing.
        */}
        <div className="flex h-14 shrink-0 items-start justify-end py-[15px] pr-14">
          {canRemove || canCorrect ? (
            <div className="flex h-[26px] items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    label={memberMenuButtonLabel(displayName)}
                    className="text-muted-foreground"
                    disabled={removeMemberMutation.isPending}
                  >
                    {removeMemberMutation.isPending ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <MoreHorizontal aria-hidden="true" />
                    )}
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[220px]">
                  {canCorrect ? (
                    <DropdownMenuItem onSelect={() => setCorrecting(true)}>
                      <Pencil aria-hidden="true" />
                      {CORRECTION_MENU_LABEL}
                    </DropdownMenuItem>
                  ) : null}
                  {canRemove ? (
                    <DropdownMenuItem
                      onSelect={() => void handleRemoveMember()}
                      className="text-destructive-text focus:bg-destructive-tint focus:text-destructive-text"
                    >
                      <UserMinus aria-hidden="true" />
                      {REMOVE_FROM_CHAPTER_LABEL}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
        {/* `gap-0`: the blocks below carry their own top margins. */}
        <PanelBody className="gap-0">
          <div className="flex flex-col items-center gap-2 text-center">
            {/*
              The initials sit on `--card` with a hairline: the fallback's
              own `--popover` is this sheet's fill, so it drew no circle. A
              member's tint (#3860) replaces the `--card` fill; the hairline
              stays, so the circle's edge reads the same either way.
            */}
            <Avatar className="h-20 w-20" aria-hidden="true">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
              <AvatarFallback
                tint={userId ? avatarTintFor(userId) : null}
                className="border border-border bg-card text-lg font-bold text-muted-foreground"
              >
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
            <SheetTitle className="break-words text-lg font-bold leading-[26px]">
              {displayName}
            </SheetTitle>
            {meta ? (
              <p className="text-caption text-muted-foreground">{meta}</p>
            ) : null}
          </div>

          {!member && memberQuery.isPending ? (
            // A skeleton, not a spinner and caption (`components.md` §10).
            <SectionSkeleton label="Loading member profile" className="mt-6">
              <SkeletonText lines={4} />
            </SectionSkeleton>
          ) : null}

          {/*
            A cached member still renders through a background-refetch failure
            (TanStack keeps `data` on an errored refetch); the error takes over
            only when there is nothing else to show.
          */}
          {!fetched && memberQuery.isError ? (
            <div
              role="alert"
              className="mt-6 flex items-center justify-between gap-3 rounded-md border border-destructive/[.28] bg-destructive-tint p-3 text-sm text-destructive-text"
            >
              <span>Couldn&apos;t load this member&apos;s profile.</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void memberQuery.refetch()}
                disabled={memberQuery.isFetching}
              >
                Retry
              </Button>
            </div>
          ) : null}

          {member ? (
            <>
              {canMessage ? (
                <Button
                  // `shrink-0`: the body is a flex column that scrolls, and a
                  // long role editor would otherwise squeeze the button.
                  className="mt-5 w-full shrink-0"
                  onClick={handleMessage}
                  disabled={dmMutation.isPending}
                >
                  {dmMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MessageSquare className="h-4 w-4" />
                  )}
                  Message
                </Button>
              ) : null}

              <dl className={cn("mt-6", DETAIL_LIST)}>
                {phone ? (
                  <DetailRow label="Phone">
                    {phoneLink ? (
                      <a
                        href={phoneLink}
                        className={cn(
                          "rounded-sm underline-offset-2 hover:underline",
                          FOCUS_RING_OFFSET,
                        )}
                      >
                        {phone}
                      </a>
                    ) : (
                      phone
                    )}
                    {textLink ? (
                      <>
                        {" · "}
                        <a
                          href={textLink}
                          aria-label={`Text ${displayName}`}
                          className={cn(
                            "rounded-sm underline-offset-2 hover:underline",
                            FOCUS_RING_OFFSET,
                          )}
                        >
                          Text
                        </a>
                      </>
                    ) : null}
                  </DetailRow>
                ) : null}
                {email ? (
                  <DetailRow label="Email">
                    <a
                      href={`mailto:${email}`}
                      className={cn(
                        "rounded-sm underline-offset-2 hover:underline",
                        FOCUS_RING_OFFSET,
                      )}
                    >
                      {email}
                    </a>
                  </DetailRow>
                ) : null}
                <DetailRow label="Member since">
                  {joined ?? "Not recorded"}
                </DetailRow>
                {typeof points === "number" ? (
                  <DetailRow label="Points">{points}</DetailRow>
                ) : null}
                {onboardingPending ? (
                  <DetailRow label="Onboarding">
                    <Badge variant="warning">Pending</Badge>
                  </DetailRow>
                ) : null}
              </dl>

              <section
                className="mt-6 space-y-2"
                aria-labelledby={rolesHeadingId}
              >
                <div className="flex items-center justify-between">
                  <h3
                    id={rolesHeadingId}
                    className="text-label font-semibold text-muted-foreground"
                  >
                    Roles
                  </h3>
                  {canEditRoles && !editingRoles ? (
                    <button
                      type="button"
                      onClick={startEditingRoles}
                      aria-label={`Edit ${displayName}'s roles`}
                      className={cn(
                        "rounded-sm text-label font-semibold text-accent-text hover:underline",
                        FOCUS_RING_OFFSET,
                      )}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
                {editingRoles ? (
                  <div className="space-y-2">
                    {roleOptions.map((role) => (
                      <RoleChecklistItem
                        key={role.id}
                        title={role.name}
                        checked={selectedRoleIds.includes(role.id)}
                        disabled={updateRolesMutation.isPending}
                        onChange={(isChecked) =>
                          toggleSelection(
                            setSelectedRoleIds,
                            role.id,
                            isChecked,
                          )
                        }
                      />
                    ))}
                  </div>
                ) : rolesLoading ? (
                  <p className="text-caption text-muted-foreground">
                    Loading roles
                  </p>
                ) : rolesFailed ? (
                  <div className="flex items-center gap-2 text-caption text-muted-foreground">
                    <span>Couldn&apos;t load roles.</span>
                    <button
                      type="button"
                      onClick={() => void rolesQuery.refetch()}
                      className={cn(
                        "rounded-sm font-semibold text-foreground underline-offset-2 hover:underline",
                        FOCUS_RING_OFFSET,
                      )}
                    >
                      Retry
                    </button>
                  </div>
                ) : roleChips.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {roleChips.map((chip) => (
                      <RoleChip key={chip.id} chip={chip} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-caption text-muted-foreground">
                    No roles yet
                  </p>
                )}
              </section>

              <MemberPledgeClassSection
                // Keyed by member, so an open editor never carries over to
                // the next member the sheet shows.
                key={memberId ?? "none"}
                open={open}
                memberId={memberId}
                displayName={displayName}
                pledgeClassId={stringField(member, "pledge_class_id")}
                orderNumber={
                  typeof member.order_number === "number"
                    ? member.order_number
                    : null
                }
                // Waits for the profile read: the write sets both fields, so
                // an edit seeded from the directory row that opened the sheet
                // could save a class or number that row no longer has.
                canEdit={
                  !!memberId &&
                  fetched !== null &&
                  !memberQuery.isError &&
                  can("roles:manage", myPermissions)
                }
              />

              {customFields.length > 0 ? (
                <section className="mt-6 space-y-2">
                  <button
                    type="button"
                    aria-expanded={detailsOpen}
                    aria-controls={detailsRegionId}
                    onClick={() =>
                      setDetailsUserId(detailsOpen ? null : userId)
                    }
                    className={cn(
                      "flex w-full items-center justify-between rounded-md border border-border px-3 py-2.5 text-left text-sm hover:bg-card-hover",
                      FOCUS_RING_OFFSET,
                    )}
                  >
                    More details
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        detailsOpen && "rotate-180",
                      )}
                    />
                  </button>
                  {detailsOpen ? (
                    <dl id={detailsRegionId} className={DETAIL_LIST}>
                      {customFields.map((field) => (
                        <DetailRow key={field.field_id} label={field.label}>
                          {formatCustomValue(field)}
                        </DetailRow>
                      ))}
                    </dl>
                  ) : null}
                </section>
              ) : null}

              {bio ? (
                <p className="mt-6 whitespace-pre-wrap break-words rounded-md border border-border p-3 text-sm text-muted-foreground">
                  {bio}
                </p>
              ) : null}
            </>
          ) : null}
        </PanelBody>

        {editingRoles ? (
          <PanelFooter>
            <Button
              variant="secondary"
              onClick={() => setEditingUserId(null)}
              disabled={updateRolesMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveRoles}
              disabled={updateRolesMutation.isPending}
            >
              {updateRolesMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Save roles
            </Button>
          </PanelFooter>
        ) : null}
        {/*
          Inside `SheetContent` so the confirmation renders above the sheet that
          opened it rather than behind its overlay. Focus on close is
          `useConfirmDialog`'s: back to the opener while it is usable, else into
          this sheet while it is still open (#2302).
        */}
        {confirmDialog}
        {memberId && canCorrect ? (
          <MemberCorrectionDialog
            open={correcting}
            onOpenChange={setCorrecting}
            memberId={memberId}
            label={displayName}
            // The stored name, not the "Member 1a2b3c4d" label an unnamed
            // member shows as: the field opens blank for them.
            displayName={(stringField(member, "display_name") ?? "").trim()}
            graduationYear={graduationYear}
          />
        ) : null}
      </PanelContent>
    </Sheet>
  );
}
