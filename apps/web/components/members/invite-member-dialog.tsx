"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Link2, Mail, RotateCw, Trash2 } from "lucide-react";
import {
  useActiveChapterId,
  useEmailInvites,
  useInvitableRoleIds,
  useInvites,
  useOrgConfig,
  useRevokeInvite,
  useRoles,
  INVITE_STATUS_LABEL,
  inviteMenuActions,
  listedInvites,
  type InviteListItem,
} from "@repo/hooks";
import { formatSentLabel } from "@repo/formatting";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { Slot } from "@radix-ui/react-slot";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelHeader,
} from "@/components/shared/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionLabel } from "@/components/shared/section-label";
import { RowMenu, type RowMenuEntry } from "@/components/shared/row-menu";
import {
  InviteComposer,
  copyWhenReady,
} from "@/components/members/invite-composer";
import { getErrorMessage, cn } from "@/lib/utils";
import { parseChapterRoles, toRoleOptions } from "@repo/hooks/chapter-roles";
import { EVERYONE_ROLE_NAME } from "@repo/validation";
import { buildJoinUrl } from "@/lib/invite-link";

/**
 * Seeded display name of the Member system role — the role a chapter with no
 * configured default falls back to.
 *
 * Only a fallback now. The picker finds Member by `system_key` first, as the
 * server-side fallback in `InviteService.resolveInviteRole` does, so a chapter
 * that renamed Member still lands on it. `GET /v1/roles` returns the whole
 * row, `system_key` included; it is only untyped, because the route declares
 * no response schema (#1049). (Corrected 2026-09-29, #2484: this comment used
 * to say the key was not projected, and matched by name alone because of it.)
 * The name still covers a legacy Member role that predates the key.
 */
const SEEDED_MEMBER_ROLE_NAME = "Member";

/** What the picker calls the Everyone role (#4191). */
const NO_ROLE_LABEL = "No role";

type InviteMemberDialogProps = {
  trigger: React.ReactNode;
};

/**
 * Members → Invite: send invites by email, or copy a link to share, and see
 * who was invited and who has joined. Nobody sees a token (Paul, 2026-11-06:
 * the old panel generated and listed raw UUIDs).
 */
export function InviteMemberDialog({ trigger }: InviteMemberDialogProps) {
  const [open, setOpen] = useState(false);
  const [roleName, setRoleName] = useState(SEEDED_MEMBER_ROLE_NAME);
  // #422: whether the admin has picked a role in this dialog session. Until
  // they do, the picker follows the chapter's configured default.
  const [hasPickedRole, setHasPickedRole] = useState(false);
  const activeChapterId = useActiveChapterId();
  const rolesQuery = useRoles();
  const orgConfigQuery = useOrgConfig();
  const invitesQuery = useInvites();
  const invitableRolesQuery = useInvitableRoleIds();
  const emailInvites = useEmailInvites();
  const revokeInviteMutation = useRevokeInvite();
  // `POST /invites` and `POST /invites/email` are `@FreeTier` +
  // `@GraceBlocked`: they keep working while `incomplete`, and are blocked by
  // name only inside the `past_due` grace window, so minting gets the matching
  // writeClass rather than the default.
  //
  // The submit is gated rather than the trigger: the trigger is a
  // caller-supplied node, and the panel is also the invite list plus a revoke
  // that is plain `@FreeTier` and must stay live during grace.
  const gate = useSubscriptionGate("grace-blocked");
  // Revoke is `DELETE /invites/:id`: `@FreeTier` without `@GraceBlocked`, so
  // it has its own verdict (free-tier and grace-blocked diverge inside the
  // grace window).
  const revokeGate = useSubscriptionGate("free-tier");
  const { toast } = useToast();
  const hasLiveDataError = rolesQuery.isError || invitesQuery.isError;

  // The Everyone role (#4191) stays in the picker as "No role", first: an
  // invite into it joins with no role, as one with no default does.
  const everyoneRole = useMemo(
    () => parseChapterRoles(rolesQuery.data).find((role) => role.everyone),
    [rolesQuery.data],
  );
  const everyoneRoleId = everyoneRole?.id;
  // A role holding `*` is left out: an invite can't grant it (the API answers
  // 403); it changes hands only through Transfer presidency. So is a role
  // ranked above the sender, or carrying a permission they lack (#4546, Paul
  // 2026-11-13): a chair invites a peer or a brother, never an officer. Until
  // that list loads, or if it fails, every role is offered and the API still
  // refuses the rest.
  const invitableRoleIds = invitableRolesQuery.data;
  const roleOptions = useMemo(() => {
    const allowed = invitableRoleIds ? new Set(invitableRoleIds) : null;
    return toRoleOptions(rolesQuery.data, "keep", { dropLocked: true })
      .filter((role) => !allowed || allowed.has(role.id))
      .sort(
        (first, second) =>
          Number(second.id === everyoneRoleId) -
            Number(first.id === everyoneRoleId) ||
          first.name.localeCompare(second.name),
      );
  }, [rolesQuery.data, everyoneRoleId, invitableRoleIds]);

  // The Everyone role's current name: by `system_key` (`parseChapterRoles`),
  // then by the seeded Member name. `undefined` when neither exists.
  const memberRoleName = useMemo(() => {
    const keyedName = everyoneRole?.name;
    if (
      typeof keyedName === "string" &&
      roleOptions.some((role) => role.name === keyedName)
    ) {
      return keyedName;
    }
    return roleOptions.find((role) => role.name === SEEDED_MEMBER_ROLE_NAME)
      ?.name;
  }, [everyoneRole, roleOptions]);

  // #422: the chapter's configured default invite role, resolved id → name
  // against the live catalog. `undefined` while the config query is in flight
  // or when no default is set.
  //
  // Read from the officer-only config, deliberately: this dialog is an
  // inviter's tool (`members:invite`, which among seeded roles only President
  // holds, with `chapter-config:view`), and the member view doesn't carry
  // `default_invite_role_id` (#2957). A custom role granted `members:invite`
  // without `chapter-config:view` is refused the read and starts on Member.
  const defaultRoleName = useMemo(() => {
    const configuredId = orgConfigQuery.data?.default_invite_role_id;
    if (!configuredId) return undefined;
    return roleOptions.find((role) => role.id === configuredId)?.name;
  }, [orgConfigQuery.data?.default_invite_role_id, roleOptions]);

  /**
   * Keep the picker on the chapter's configured default until the admin picks
   * something themselves.
   *
   * The old form only corrected `roleName` when it named a role that did not
   * exist, which cannot work here: the roles query and the config query
   * resolve independently, so whenever roles land first the picker settles on
   * a valid-but-arbitrary role and the default — arriving milliseconds later —
   * is never applied. Tracking the explicit choice separately makes the
   * condition "has the admin chosen?" rather than "is the current value
   * broken?", which is the question actually being asked.
   */
  useEffect(() => {
    if (hasPickedRole) {
      // Still correct a chosen role that has since disappeared from the
      // catalog, which is what the previous form got right.
      if (
        roleOptions.length > 0 &&
        !roleOptions.some((role) => role.name === roleName)
      ) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the picker on a role that still exists after the catalog loads
        setRoleName(
          defaultRoleName ??
            memberRoleName ??
            roleOptions[0]?.name ??
            SEEDED_MEMBER_ROLE_NAME,
        );
      }
      return;
    }
    // Member — not `roleOptions[0]` — is the fallback when no default is
    // configured. `roleOptions` is sorted alphabetically, so seeding off it
    // would pre-select **Alumni** on every chapter that has not set a default
    // (which is all of them: the column ships null with no backfill). That
    // would hand new members the alumni lifecycle restrictions instead of
    // Member, and it is precisely the arbitrary default this issue exists to
    // remove — reached by a new route. Member is found by `system_key`, as the
    // server-side fallback finds it, so a renamed Member is still the one
    // pre-selected (`memberRoleName` above).
    const preferred =
      defaultRoleName ??
      memberRoleName ??
      roleOptions[0]?.name ??
      SEEDED_MEMBER_ROLE_NAME;
    // No disable directive needed here: the rule reports once per effect, and
    // the branch above already carries it.
    if (preferred !== roleName) {
      setRoleName(preferred);
    }
  }, [defaultRoleName, hasPickedRole, memberRoleName, roleName, roleOptions]);

  const rows = useMemo(
    () => listedInvites(invitesQuery.data ?? []),
    [invitesQuery.data],
  );

  /**
   * Reopening starts a fresh invite, so the chapter default applies again
   * rather than the role picked during a previous session.
   *
   * Every open and close path routes through here: the trigger, and the
   * panel's own ways out (the back arrow, Escape; the sheet's X and overlay
   * where it falls back to one), so none of them skips the reset.
   *
   * Opening re-reads invites and roles (and which roles the sender may
   * invite into): the list is mounted with the page and
   * cached for a minute, so an invite another officer revoked, or someone
   * joining, would otherwise not show here.
   */
  function refetchLiveData() {
    // `refetch()` skips the hooks' `enabled: !!chapterId`, so with no chapter
    // yet it would send both reads unscoped and show a load error.
    if (!activeChapterId) return;
    void invitesQuery.refetch();
    void rolesQuery.refetch();
    void invitableRolesQuery.refetch();
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      refetchLiveData();
    } else {
      setHasPickedRole(false);
    }
    setOpen(next);
  }

  async function copyInviteLink(invite: InviteListItem) {
    const link = buildJoinUrl(window.location.origin, invite.token);
    try {
      await copyWhenReady(Promise.resolve(link));
      toast({ title: "Link copied" });
    } catch {
      toast({
        title: "Couldn't copy the link",
        description: `Your browser blocked the clipboard. Copy it from here: ${link}`,
        variant: "destructive",
      });
    }
  }

  async function sendAgain(invite: InviteListItem) {
    if (!invite.email) return;
    try {
      // The server retires this address's older invite once the new one is
      // delivered, so a failed send leaves the old link working.
      const result = await emailInvites.mutateAsync({
        role: invite.role,
        emails: [invite.email],
      });
      if (result?.failed?.length) {
        toast({
          title: `Couldn't email ${invite.email}`,
          description: "Its new invite is listed, so you can copy its link.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: `Invite sent again to ${invite.email}` });
    } catch (error) {
      toast({
        title: "Couldn't send it again",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  async function revoke(invite: InviteListItem) {
    try {
      await revokeInviteMutation.mutateAsync(invite.id);
      toast({
        title: "Invite revoked",
        description: invite.email
          ? `${invite.email} can't join with it now.`
          : "That link can't be used to join now.",
      });
    } catch (error) {
      toast({
        title: "Couldn't revoke the invite",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  function entriesFor(invite: InviteListItem): RowMenuEntry[] {
    const entries: RowMenuEntry[] = [];
    const mintDisabled = gate.controlProps(hasLiveDataError).disabled;
    const revokeDisabled = revokeGate.controlProps(
      revokeInviteMutation.isPending || hasLiveDataError,
    ).disabled;
    // Which actions a row offers is shared with mobile (`inviteMenuActions`).
    for (const action of inviteMenuActions(invite)) {
      if (action === "link") {
        entries.push({
          type: "item",
          key: "copy",
          label: "Copy link",
          icon: Link2,
          onSelect: () => void copyInviteLink(invite),
        });
      } else if (action === "again") {
        entries.push({
          type: "item",
          key: "again",
          label: "Send again",
          icon: RotateCw,
          onSelect: () => void sendAgain(invite),
          disabled: mintDisabled || emailInvites.isPending,
        });
      } else {
        entries.push(
          { type: "separator", key: "sep" },
          {
            type: "item",
            key: "revoke",
            label: "Revoke invite",
            icon: Trash2,
            destructive: true,
            onSelect: () => void revoke(invite),
            disabled: revokeDisabled,
          },
        );
      }
    }
    return entries;
  }

  const roleControl =
    roleOptions.length > 0 ? (
      <Select
        value={roleName}
        onValueChange={(next) => {
          setHasPickedRole(true);
          setRoleName(next);
        }}
      >
        <SelectTrigger
          aria-label="Role they join as"
          // A quiet inline control, not a full-width field: the role is a
          // setting on the send, and most sends keep the default.
          className="h-9 w-auto gap-1.5 border-transparent bg-transparent px-2 text-sm hover:bg-card-hover pointer-coarse:h-11"
        >
          <span className="text-muted-foreground">Joins as</span>
          <span className="font-semibold">
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          {roleOptions.map((role) => (
            <SelectItem key={role.id} value={role.name}>
              {role.id === everyoneRoleId ? NO_ROLE_LABEL : role.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  return (
    <>
      <Slot onClick={() => handleOpenChange(true)}>{trigger}</Slot>
      {/*
        A panel, not a dialog (`components.md` § Surface size): the composer
        and the list of everyone invited grow with the chapter. No footer:
        Send sits with the addresses it sends to. Docked: it opens in place of
        the Directory, beside chat, rather than over everything (Paul,
        2026-11-12).

        `aria-describedby={undefined}`: with no `SheetDescription` rendered,
        Radix warns on every open for a `Content` pointing at a description id
        nothing renders.
      */}
      <Panel
        open={open}
        onOpenChange={handleOpenChange}
        docked
        backLabel="Back to directory"
      >
        <PanelContent aria-describedby={undefined}>
          <PanelHeader>Invite members</PanelHeader>
          <PanelBody className="gap-6">
            {hasLiveDataError ? (
              <div className="flex items-start gap-3 rounded-md border border-warning/[.28] bg-warning-tint p-3 text-caption text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {/* The only explanation for the paused controls below, so it
                  stays, with the retry beside the reason. */}
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    Invite data could not load, so inviting and revoking are
                    paused.
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-caption font-semibold text-warning"
                    onClick={refetchLiveData}
                  >
                    Try again
                  </Button>
                </div>
              </div>
            ) : null}

            <InviteComposer
              role={roleName}
              roleControl={roleControl}
              disabled={hasLiveDataError || roleOptions.length === 0}
              gate={gate}
            />
            <SubscriptionNotice gate={gate} feature="sending invites" />

            <section aria-labelledby="invite-list-label" className="space-y-2">
              <SectionLabel
                id="invite-list-label"
                count={invitesQuery.data ? rows.length : null}
              >
                Invited
              </SectionLabel>
              <SubscriptionNotice
                gate={revokeGate}
                feature="revoking invites"
              />
              {invitesQuery.data && rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nobody yet. People you invite show up here until they join.
                </p>
              ) : (
                <ul className="-mx-2">
                  {rows.map((invite) => (
                    <InviteRow
                      key={invite.id}
                      invite={invite}
                      entries={entriesFor(invite)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </PanelBody>
        </PanelContent>
      </Panel>
    </>
  );
}

function InviteRow({
  invite,
  entries,
}: {
  invite: InviteListItem;
  entries: RowMenuEntry[];
}) {
  const name = invite.email ?? "Invite link";
  const Icon = invite.email ? Mail : Link2;
  const sent = formatSentLabel(invite.created_at);
  const row = (menuButton: React.ReactNode) => (
    <li className="group flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-card-hover">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-card text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="truncate text-caption text-muted-foreground">
          {[invite.role === EVERYONE_ROLE_NAME ? null : invite.role, sent]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-caption font-semibold",
          invite.status === "joined" ? "text-success" : "text-muted-foreground",
        )}
      >
        {INVITE_STATUS_LABEL[invite.status]}
      </span>
      {/* Same width with or without a menu, so statuses line up. */}
      {menuButton ?? <span className="w-9 shrink-0" aria-hidden="true" />}
    </li>
  );
  if (entries.length === 0) return row(null);
  return (
    // Share links all read "Invite link", so their menus also name when.
    <RowMenu
      entries={entries}
      label={`More for ${name}${invite.email || !sent ? "" : `, ${sent.replace(/^Sent/, "sent")}`}`}
    >
      {row}
    </RowMenu>
  );
}
