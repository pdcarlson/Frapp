"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Loader2, ShieldPlus, Trash2 } from "lucide-react";
import {
  useBatchCreateInvites,
  useCreateInvite,
  useInvites,
  useRevokeInvite,
  useRoles,
} from "@repo/hooks";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const fallbackRoles: RoleRow[] = [
  { id: "member-role", name: "Member" },
  { id: "new-member-role", name: "New Member" },
  { id: "exec-role", name: "Executive Board" },
];

const fallbackInvites: InviteRow[] = [
  {
    id: "preview-invite-1",
    token: "preview-token-alpha",
    role: "Member",
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
    used_at: null,
  },
  {
    id: "preview-invite-2",
    token: "preview-token-bravo",
    role: "Executive Board",
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString(),
    used_at: null,
  },
];

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return parsed.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please retry.";
}

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
  const [inviteCount, setInviteCount] = useState(1);
  const [generatedInvites, setGeneratedInvites] = useState<InviteRow[]>([]);
  const rolesQuery = useRoles();
  const invitesQuery = useInvites();
  const createInviteMutation = useCreateInvite();
  const createBatchInvitesMutation = useBatchCreateInvites();
  const revokeInviteMutation = useRevokeInvite();
  const { toast } = useToast();
  const usingPreviewData = rolesQuery.isError || invitesQuery.isError;

  const roleOptions = useMemo(() => {
    if (usingPreviewData) {
      return fallbackRoles;
    }
    const rolesData = rolesQuery.data as unknown;
    if (!Array.isArray(rolesData)) {
      return fallbackRoles;
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

    return roles.length > 0 ? roles : fallbackRoles;
  }, [rolesQuery.data, usingPreviewData]);

  const inviteRows = useMemo(() => {
    if (usingPreviewData) {
      return fallbackInvites;
    }
    return normalizeInvites(invitesQuery.data);
  }, [invitesQuery.data, usingPreviewData]);

  useEffect(() => {
    if (!roleOptions.some((role: RoleRow) => role.name === roleName)) {
      setRoleName(roleOptions[0]?.name ?? "Member");
    }
  }, [roleName, roleOptions]);

  const isSubmitting =
    createInviteMutation.isPending || createBatchInvitesMutation.isPending;

  const activeInviteRows = inviteRows.filter((invite) => invite.used_at === null);

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
        description: getErrorMessage(error),
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
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldPlus className="h-4 w-4" />
            Invite members
          </DialogTitle>
          <DialogDescription>
            Generate secure invite tokens and assign a default role before members join.
          </DialogDescription>
        </DialogHeader>

        {usingPreviewData ? (
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Showing preview invite data. Sign in with chapter permissions to generate live invites.
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Role</span>
            <select
              value={roleName}
              onChange={(event) => setRoleName(event.target.value)}
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
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isNaN(parsed)) return;
                setInviteCount(Math.min(50, Math.max(1, parsed)));
              }}
            />
          </label>
          <div className="flex items-end">
            <Button
              onClick={handleGenerateInvites}
              disabled={usingPreviewData || isSubmitting}
              className="w-full"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Generate
            </Button>
          </div>
        </div>

        {generatedInvites.length > 0 ? (
          <div className="space-y-2 rounded-md border border-primary/30 bg-primary-50/70 p-3 dark:bg-primary/10">
            <p className="text-sm font-medium">Freshly generated tokens</p>
            <div className="space-y-2">
              {generatedInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-background p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs">{invite.token}</p>
                    <p className="text-xs text-muted-foreground">
                      {invite.role} • expires {formatDate(invite.expires_at)}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleCopyInvite(invite)}>
                    <Copy className="h-3.5 w-3.5" />
                    Copy code
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm font-medium">Active invite tokens</p>
          {activeInviteRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              No active invite tokens.
            </div>
          ) : (
            activeInviteRows.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
              >
                <div className="space-y-1">
                  <p className="font-mono text-xs">{invite.token}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{invite.role}</Badge>
                    <span className="text-xs text-muted-foreground">
                      Expires {formatDate(invite.expires_at)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleCopyInvite(invite)}>
                    <Copy className="h-3.5 w-3.5" />
                    Copy code
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRevokeInvite(invite.id)}
                    disabled={revokeInviteMutation.isPending || usingPreviewData}
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
            variant="outline"
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
