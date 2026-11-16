"use client";

import { useState } from "react";
import {
  usePickableRoles,
  useSetPickedRole,
  type PickableRole,
} from "@repo/hooks";
import { PICK_ROLES_COPY } from "@repo/validation";
import { Switch } from "@/components/ui/switch";
import { ProfileSection } from "@/components/profile/profile-section";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/**
 * "Your roles": the Non-chapter business roles a member adds and removes
 * themselves (#4958), like Discord's onboarding questions and Carl-bot's
 * reaction roles, as one switch per role. A role's channels appear in Chat
 * once it's on and go when it's off.
 *
 * Where it sits is provisional (Shawn, 2026-11-14: the concept now, the home
 * settled with Paul): it is one self-contained section, so moving it is a
 * matter of where it is rendered. Nothing shows in a chapter with no such
 * roles.
 */
export function PickRolesSection() {
  const { roles, isLoading } = usePickableRoles();
  if (isLoading || roles.length === 0) return null;
  return (
    <ProfileSection
      id="your-roles"
      title="Your roles"
      hint={PICK_ROLES_COPY.lede}
    >
      <PickRolesList roles={roles} />
    </ProfileSection>
  );
}

/**
 * One switch per pickable role, each saved on the flip. Profile's "Your roles"
 * and the first-run tour's `Pick your roles` stop both draw it.
 */
export function PickRolesList({ roles }: { roles: readonly PickableRole[] }) {
  const { toast } = useToast();
  const setPicked = useSetPickedRole();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function toggle(id: string, name: string, join: boolean) {
    setPendingId(id);
    try {
      await setPicked.mutateAsync({ id, join });
    } catch (error) {
      toast({
        title: join ? `Couldn't join ${name}` : `Couldn't leave ${name}`,
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
      {roles.map((role) => (
        <li
          key={role.id}
          className="flex items-center justify-between gap-4 px-4 py-3"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/40"
              style={role.color ? { backgroundColor: role.color } : undefined}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm text-foreground">
                {role.name}
              </span>
              {role.joinable ? null : (
                <span className="block text-xs text-muted-foreground">
                  {PICK_ROLES_COPY.leaveOnly}
                </span>
              )}
            </span>
          </span>
          <Switch
            aria-label={role.held ? `Leave ${role.name}` : `Join ${role.name}`}
            checked={role.held}
            disabled={pendingId !== null}
            onCheckedChange={(on) => void toggle(role.id, role.name, on)}
          />
        </li>
      ))}
    </ul>
  );
}
