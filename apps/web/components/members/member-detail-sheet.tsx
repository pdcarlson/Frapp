"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Trash2 } from "lucide-react";
import { SectionSkeleton } from "@/components/shared/page-skeletons";
import { SkeletonText } from "@/components/shared/async-states";
import {
  useCustomRoles,
  useGetOrCreateDm,
  useMemberByUserId,
  useMyPermissions,
  useRemoveMember,
  useRoles,
  useUpdateMemberRoles,
} from "@repo/hooks";
import {
  can,
  memberAccessRoleIds,
  removesMemberAccess,
  resolveCustomRoleNames,
  resolveRoleChips,
  type MemberRoleChip,
} from "@repo/validation";
import { formatDay } from "@repo/formatting";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useToast } from "@/lib/hooks/use-toast";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { normalizeRoleOptions, roleAccessRows } from "@/lib/roles";

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

/** One label-over-value row of a flat detail list. */
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
      <dt className="shrink-0 text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm">{children}</dd>
    </div>
  );
}

const DETAIL_LIST = "divide-y divide-border rounded-md border border-border";

/**
 * A member's profile: one sheet for every door on web (#3726). The
 * directory's Actives and Alumni rows, and in chat a sender's name or photo,
 * an `@` chip that names one member, and a row of the channel's member list
 * all open it, keyed by `users.id`, so a member sees the same card wherever
 * they click a name. Mobile's sheet
 * (`apps/mobile/components/directory/member-detail-sheet.tsx`) is the
 * reference, and this draws its order: photo, name and the class-year line,
 * Message, roles as colored chips in the chapter's rank, email, member since,
 * then the custom fields the viewer may see, and the bio.
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
 * report on #3726). **Remove member** sits in the footer for a viewer holding
 * `members:remove`, and is absent for anyone else.
 */
export function MemberDetailSheet({
  open,
  onOpenChange,
  userId,
  initialMember,
  points,
}: MemberDetailSheetProps) {
  const memberQuery = useMemberByUserId(userId ?? "");
  const rolesQuery = useRoles();
  // Custom roles are enforced (bridge model): assignment happens here
  // alongside live roles. The list read needs `chapter-config:view`, so only
  // fire it for viewers who hold that permission, rather than a guaranteed
  // 403 on every open. When the list is unavailable their names are not drawn
  // and saves omit `custom_role_ids` (the server treats omission as "leave
  // unchanged"), so custom-role assignments are never silently stripped.
  const myPermissionsQuery = useMyPermissions();
  const myPermissions = myPermissionsQuery.data?.permissions;
  const canViewCustomRoles = can("chapter-config:view", myPermissions);
  const customRolesQuery = useCustomRoles({ enabled: canViewCustomRoles });
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
  const [selectedCustomRoleIds, setSelectedCustomRoleIds] = useState<string[]>(
    [],
  );
  // Whose roles are being edited. Keyed by member rather than a boolean, so
  // the editor never carries over to the next member the sheet opens on, or
  // reopens on the same one after a close.
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const editingRoles = open && userId !== null && editingUserId === userId;

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
  const memberCustomRoleIds = useMemo(
    () => stringIds(member?.custom_role_ids),
    [member?.custom_role_ids],
  );

  const roleChips = useMemo(() => {
    const ranked = resolveRoleChips(rolesQuery.data, memberRoleIds);
    // Custom titles carry no color or rank in this read, so they follow the
    // ranked roles as plain chips, as on mobile.
    const custom = resolveCustomRoleNames(
      canViewCustomRoles ? customRolesQuery.data : undefined,
      memberCustomRoleIds,
    ).map((name) => ({ id: `custom:${name}`, name, color: null }));
    return [...ranked, ...custom];
  }, [
    rolesQuery.data,
    memberRoleIds,
    canViewCustomRoles,
    customRolesQuery.data,
    memberCustomRoleIds,
  ]);
  // Distinct from "no role": while either read is in flight an empty list
  // would flash a wrong "No roles yet".
  const rolesLoading =
    rolesQuery.isPending || (canViewCustomRoles && customRolesQuery.isPending);

  const roleOptions = useMemo(
    () => normalizeRoleOptions(rolesQuery.data),
    [rolesQuery.data],
  );
  const customRoleOptions = useMemo(() => {
    const data = customRolesQuery.data;
    if (!Array.isArray(data)) return [];
    return data.map((role) => ({ id: role.id, label: role.label }));
  }, [customRolesQuery.data]);

  // `memberLabel`, the helper the directory row uses: this sheet opens from
  // that row, so the two must not name an unnamed member two different ways.
  const displayName = memberLabel(
    member?.display_name,
    member?.user_id ?? userId,
  );
  const avatarUrl = stringField(member, "avatar_url");
  const meta = metaLine(member);
  const email = stringField(member, "email");
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
  const canRemove =
    !!memberId && !memberQuery.isError && can("members:remove", myPermissions);

  function startEditingRoles() {
    setSelectedRoleIds(memberRoleIds);
    setSelectedCustomRoleIds(memberCustomRoleIds);
    setEditingUserId(userId);
  }

  async function handleSaveRoles() {
    if (!memberId) return;
    // Taking away the last role with member access locks the member out of
    // chat, the roster and events, the way the 2026-11-07 testers were
    // (#3670). The API allows it, so ask first, as mobile's editor does.
    // Custom roles count only when their list loaded. Otherwise the save
    // leaves them unchanged, and a custom role that does carry
    // `members:view` can't be seen, so the officer may be asked even though
    // the member keeps access through it: a harmless extra question, where
    // skipping it could let a real lockout through.
    const customAfter = customRolesQuery.isSuccess
      ? selectedCustomRoleIds
      : memberCustomRoleIds;
    if (
      removesMemberAccess(
        [...memberRoleIds, ...memberCustomRoleIds],
        [...selectedRoleIds, ...customAfter],
        memberAccessRoleIds(
          roleAccessRows(rolesQuery.data),
          customRolesQuery.data ?? [],
        ),
      )
    ) {
      const confirmed = await confirm({
        title: `Take away ${displayName}'s access?`,
        description: `Without a role like Member, ${displayName} can't open chat, the member list or events.`,
        confirmLabel: "Take away access",
        tone: "destructive",
      });
      if (!confirmed) return;
    }
    try {
      await updateRolesMutation.mutateAsync({
        id: memberId,
        role_ids: selectedRoleIds,
        // Only send the custom-role assignment when the list actually loaded;
        // omission tells the server to leave it unchanged. The selection is
        // sent as-is — NOT filtered against the loaded catalog, which can be
        // up to a minute stale and would silently strip a freshly assigned
        // role. Leftover ids of since-deleted roles are harmless: the server
        // exempts ids the member already holds, and they resolve to nothing.
        ...(customRolesQuery.isSuccess
          ? { custom_role_ids: selectedCustomRoleIds }
          : {}),
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
    // "Confirm" (`writing.md` §2), which also keeps it unambiguous next to the
    // footer's "Remove member" trigger. Browser-chrome dialogs are banned on
    // every surface (`design-system/README.md` §2).
    const confirmed = await confirm({
      title: `Remove ${displayName}?`,
      description: "They can rejoin only with a new invite.",
      confirmLabel: "Remove from chapter",
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

  const showFooter = editingRoles || canRemove;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        `aria-describedby={undefined}`: with no `SheetDescription` rendered,
        Radix warns on every open for a `Content` that points at a description
        id that does not exist.
      */}
      <PanelContent aria-describedby={undefined}>
        {/*
          The title row's band with no title in it: the close button
          `SheetContent` draws sits here alone, and the name heads the body.
        */}
        <div aria-hidden="true" className="h-14 shrink-0" />
        {/* `gap-0`: the blocks below carry their own top margins. */}
        <PanelBody className="gap-0">
          <div className="flex flex-col items-center gap-2 text-center">
            {/*
              The initials sit on `--card` with a hairline: the fallback's
              own `--popover` is this sheet's fill, so it drew no circle.
            */}
            <Avatar className="h-20 w-20" aria-hidden="true">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
              <AvatarFallback className="border border-border bg-card text-lg font-bold text-muted-foreground">
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
                    {customRoleOptions.length > 0 ? (
                      <>
                        <h4 className="pt-2 text-label font-semibold text-muted-foreground">
                          Custom roles
                        </h4>
                        {customRoleOptions.map((role) => (
                          <RoleChecklistItem
                            key={role.id}
                            title={role.label}
                            checked={selectedCustomRoleIds.includes(role.id)}
                            disabled={updateRolesMutation.isPending}
                            onChange={(isChecked) =>
                              toggleSelection(
                                setSelectedCustomRoleIds,
                                role.id,
                                isChecked,
                              )
                            }
                          />
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : rolesLoading ? (
                  <p className="text-caption text-muted-foreground">
                    Loading roles
                  </p>
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

              <dl className={cn("mt-6", DETAIL_LIST)}>
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

              {customFields.length > 0 ? (
                <section className="mt-6 space-y-2">
                  <h3 className="text-label font-semibold text-muted-foreground">
                    Custom fields
                  </h3>
                  <dl className={DETAIL_LIST}>
                    {customFields.map((field) => (
                      <DetailRow key={field.field_id} label={field.label}>
                        {formatCustomValue(field)}
                      </DetailRow>
                    ))}
                  </dl>
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

        {showFooter ? (
          <PanelFooter>
            {editingRoles ? (
              <>
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
              </>
            ) : (
              <Button
                variant="destructive"
                onClick={handleRemoveMember}
                disabled={removeMemberMutation.isPending}
              >
                {removeMemberMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Remove member
              </Button>
            )}
          </PanelFooter>
        ) : null}
        {/*
          Inside `SheetContent` so the confirmation renders above the sheet that
          opened it rather than behind its overlay. Focus on close is
          `useConfirmDialog`'s: back to the opener while it is usable, else into
          this sheet while it is still open (#2302).
        */}
        {confirmDialog}
      </PanelContent>
    </Sheet>
  );
}
