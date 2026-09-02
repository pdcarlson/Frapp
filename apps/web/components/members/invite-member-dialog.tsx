"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Loader2, Trash2 } from "lucide-react";
import { InviteGlyph } from "@/components/members/directory-glyphs";
import {
  useBatchCreateInvites,
  useCreateInvite,
  useInvites,
  useOrgConfig,
  useRevokeInvite,
  useRoles,
} from "@repo/hooks";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { dashboardFilterSelectClassName } from "@/components/shared/table-controls";
import { formatLocaleDateTime as formatDate } from "@repo/formatting";
import { getErrorMessage } from "@/lib/utils";

type RoleRow = {
  id: string;
  name: string;
};

type InviteRow = {
  id: string;
  token: string;
  role: string;
  expires_at: string;
  used_at: string | null;
};

function normalizeInvites(input: unknown): InviteRow[] {
  const source = Array.isArray(input) ? input : input ? [input] : [];
  return source.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.token !== "string" ||
      typeof candidate.role !== "string" ||
      typeof candidate.expires_at !== "string"
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        token: candidate.token,
        role: candidate.role,
        expires_at: candidate.expires_at,
        used_at: typeof candidate.used_at === "string" ? candidate.used_at : null,
      },
    ];
  });
}

function buildInviteShareMessage(invite: InviteRow): string {
  const expirationText = formatDate(invite.expires_at);
  return [
    "Frapp member invite",
    `Role: ${invite.role}`,
    `Invite code: ${invite.token}`,
    `Expires: ${expirationText}`,
    "Open the join page and enter this code to redeem.",
  ].join("\n");
}

type InviteMemberDialogProps = {
  trigger: React.ReactNode;
};

export function InviteMemberDialog({ trigger }: InviteMemberDialogProps) {
  const [open, setOpen] = useState(false);
  const [roleName, setRoleName] = useState("Member");
  // #422: whether the admin has picked a role in this dialog session. Until
  // they do, the picker follows the chapter's configured default.
  const [hasPickedRole, setHasPickedRole] = useState(false);
  const [inviteCount, setInviteCount] = useState(1);
  const [generatedInvites, setGeneratedInvites] = useState<InviteRow[]>([]);
  const rolesQuery = useRoles();
  const orgConfigQuery = useOrgConfig();
  const invitesQuery = useInvites();
  const createInviteMutation = useCreateInvite();
  const createBatchInvitesMutation = useBatchCreateInvites();
  const revokeInviteMutation = useRevokeInvite();
  // `POST /invites` and `POST /invites/batch` are the repo's only two
  // `@FreeTier` + `@GraceBlocked` routes (`invite.controller.ts:46,60`): they
  // keep working while `incomplete`, and are blocked *by name* only inside the
  // `past_due` grace window. That is the one gate class the rest of this sweep
  // never exercises, so it gets the matching writeClass rather than the default.
  //
  // Deliberately gating the submit rather than the trigger, against §5 rule 1.
  // Two reasons: the trigger is a caller-supplied node (`trigger` prop), and
  // this dialog is mostly a read surface — the invite list — plus a revoke that
  // is plain `@FreeTier` and must stay live during grace. Blocking the dialog
  // from opening would take those away to gate one button inside it.
  const gate = useSubscriptionGate("grace-blocked");
  // Revoke is `DELETE /invites/:id` — the class-level `@FreeTier` WITHOUT
  // `@GraceBlocked`. That is not "always allowed": free-tier survives
  // `incomplete` and the grace window, then hits `write_locked` past it, and
  // `canceled` is checked above the carve-out entirely. So it needs its own
  // verdict rather than being left ungated.
  const revokeGate = useSubscriptionGate("free-tier");
  const { toast } = useToast();
  const hasLiveDataError = rolesQuery.isError || invitesQuery.isError;

  const roleOptions = useMemo(() => {
    const rolesData = rolesQuery.data as unknown;
    if (!Array.isArray(rolesData)) {
      return [];
    }
    const roles = rolesData
      .flatMap((role: unknown) => {
        if (!role || typeof role !== "object") return [];
        const candidate = role as Record<string, unknown>;
        if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
          return [];
        }
        return [{ id: candidate.id, name: candidate.name }];
      })
      .sort((first: RoleRow, second: RoleRow) => first.name.localeCompare(second.name));

    return roles;
  }, [rolesQuery.data]);

  const inviteRows = useMemo(() => {
    return normalizeInvites(invitesQuery.data);
  }, [invitesQuery.data]);

  // #422: the chapter's configured default invite role, resolved id → name
  // against the live catalog. `undefined` while the config query is in flight
  // or when no default is set.
  const defaultRoleName = useMemo(() => {
    const configuredId = orgConfigQuery.data?.default_invite_role_id;
    if (!configuredId) return undefined;
    return roleOptions.find((role: RoleRow) => role.id === configuredId)?.name;
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
        !roleOptions.some((role: RoleRow) => role.name === roleName)
      ) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the picker on a role that still exists after the catalog loads
        setRoleName(defaultRoleName ?? roleOptions[0]?.name ?? "Member");
      }
      return;
    }
    // Member stays the last resort, so an unconfigured chapter behaves
    // exactly as it did before this field existed.
    const preferred = defaultRoleName ?? roleOptions[0]?.name ?? "Member";
    // No disable directive needed here: the rule reports once per effect, and
    // the branch above already carries it.
    if (preferred !== roleName) {
      setRoleName(preferred);
    }
  }, [defaultRoleName, hasPickedRole, roleName, roleOptions]);

  const isSubmitting =
    createInviteMutation.isPending || createBatchInvitesMutation.isPending;

  const activeInviteRows = inviteRows.filter((invite) => invite.used_at === null);

  function handleInviteCountChange(event: React.ChangeEvent<HTMLInputElement>) {
    const parsed = Number(event.target.value);
    if (Number.isNaN(parsed)) return;
    setInviteCount(Math.min(50, Math.max(1, parsed)));
  }

  async function handleGenerateInvites() {
    if (!roleName) return;

    try {
      let created: InviteRow[] = [];
      if (inviteCount <= 1) {
        const result = await createInviteMutation.mutateAsync({ role: roleName });
        created = normalizeInvites(result);
      } else {
        const result = await createBatchInvitesMutation.mutateAsync({
          role: roleName,
          count: inviteCount,
        });
        created = normalizeInvites(result);
      }

      if (created.length === 0) {
        throw new Error("Invite generated without token data.");
      }

      setGeneratedInvites(created);
      await invitesQuery.refetch();
      toast({
        title: created.length > 1 ? "Invites generated" : "Invite generated",
        description:
          created.length > 1
            ? `${created.length} invite tokens are ready to share.`
            : "Copy the invite link and send it to a new member.",
      });
    } catch (error) {
      toast({
        title: "Could not generate invite",
        description: getErrorMessage(error, "Something went wrong. Please retry."),
        variant: "destructive",
      });
    }
  }

  async function handleCopyInvite(invite: InviteRow) {
    try {
      await navigator.clipboard.writeText(buildInviteShareMessage(invite));
      toast({
        title: "Invite code copied",
        description: "Share the code through a secure channel.",
      });
    } catch {
      toast({
        title: "Clipboard unavailable",
        description: "Copy the invite code manually from the list.",
        variant: "destructive",
      });
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    try {
      await revokeInviteMutation.mutateAsync(inviteId);
      await invitesQuery.refetch();
      toast({
        title: "Invite revoked",
        description: "The token can no longer be redeemed.",
      });
    } catch (error) {
      toast({
        title: "Could not revoke invite",
        description: getErrorMessage(error, "Something went wrong. Please retry."),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reopening starts a fresh invite, so the chapter default applies
        // again rather than the role picked during a previous session.
        if (!next) setHasPickedRole(false);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <InviteGlyph className="h-5 w-5" />
            Invite members
          </DialogTitle>
          <DialogDescription>
            Generate secure invite tokens and assign a default role before members join.
          </DialogDescription>
        </DialogHeader>

        {hasLiveDataError ? (
          <div className="flex items-start gap-3 rounded-md border border-warning/[.28] bg-warning/[.13] p-3 text-[12.5px] text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Live invite data could not load. Resolve the underlying API error before issuing
              chapter invites.
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Role</span>
            <select
              value={roleName}
              onChange={(event) => {
                setHasPickedRole(true);
                setRoleName(event.target.value);
              }}
              className={dashboardFilterSelectClassName}
            >
              {roleOptions.map((role) => (
                <option key={role.id} value={role.name}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Invite count</span>
            <Input
              type="number"
              min={1}
              max={50}
              value={inviteCount}
              onChange={handleInviteCountChange}
            />
          </label>
          <div className="flex items-end">
            <Button
              onClick={handleGenerateInvites}
              {...gate.controlProps(
                hasLiveDataError || isSubmitting || roleOptions.length === 0,
              )}
              className="w-full"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Generate
            </Button>
          </div>
        </div>

        <SubscriptionNotice gate={gate} feature="issuing invites" />

        {generatedInvites.length > 0 ? (
          <div className="space-y-2 rounded-md border border-accent-border bg-accent-subtle p-3">
            <p className="text-sm font-semibold">Freshly generated tokens</p>
            <div className="space-y-2">
              {generatedInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-accent-border bg-accent-subtle-hover p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12.5px]">{invite.token}</p>
                    <p className="text-[12.5px] text-muted-foreground">
                      {invite.role} • expires {formatDate(invite.expires_at)}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => handleCopyInvite(invite)}>
                    <Copy className="h-3.5 w-3.5" />
                    Copy code
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm font-semibold">Active invite tokens</p>
          {/*
            Revoke's verdict differs from Generate's — free-tier vs
            grace-blocked diverge exactly inside the grace window — so it needs
            its own notice for its own `aria-describedby` target.
          */}
          <SubscriptionNotice gate={revokeGate} feature="revoking invites" />
          {activeInviteRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              No active invite tokens.
            </div>
          ) : (
            activeInviteRows.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-input p-3"
              >
                <div className="space-y-1">
                  <p className="font-mono text-[12.5px]">{invite.token}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{invite.role}</Badge>
                    <span className="text-[12.5px] text-muted-foreground">
                      Expires {formatDate(invite.expires_at)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => handleCopyInvite(invite)}>
                    <Copy className="h-3.5 w-3.5" />
                    Copy code
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleRevokeInvite(invite.id)}
                    {...revokeGate.controlProps(
                      revokeInviteMutation.isPending || hasLiveDataError,
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Revoke
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              void invitesQuery.refetch();
              void rolesQuery.refetch();
            }}
          >
            Refresh
          </Button>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
