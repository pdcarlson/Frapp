"use client";

import { useState } from "react";
import { usePickableRoles, useSetPickedRole } from "@repo/hooks";
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
/**
 * Under a role the member holds but can't join again: one an officer stopped
 * offering, or any picked role once they're an alum. Leaving still works.
 */
export const LEAVE_ONLY_CAPTION = "No longer open to join. You can leave it.";

export function PickRolesSection() {
  const { toast } = useToast();
  const { roles, isLoading } = usePickableRoles();
  const setPicked = useSetPickedRole();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (isLoading || roles.length === 0) return null;

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
    <ProfileSection
      id="your-roles"
      title="Your roles"
      hint="Pick what you're into. Each role adds its channels to Chat, and you can leave any time."
    >
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
                    {LEAVE_ONLY_CAPTION}
                  </span>
                )}
              </span>
            </span>
            <Switch
              aria-label={
                role.held ? `Leave ${role.name}` : `Join ${role.name}`
              }
              checked={role.held}
              disabled={pendingId !== null}
              onCheckedChange={(on) => void toggle(role.id, role.name, on)}
            />
          </li>
        ))}
      </ul>
    </ProfileSection>
  );
}
