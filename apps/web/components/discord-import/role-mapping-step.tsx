"use client";

import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import type { StagedRole } from "./upload-step";

/**
 * Signet's seeded system roles, in the order the onboarding wizard shows them.
 *
 * Keys mirror `SystemRoleKeys` in the API's permission constants.
 */
const SIGNET_ROLES: { key: string; label: string; hint: string }[] = [
  { key: "MEMBER", label: "Member", hint: "Default" },
  { key: "NEW_MEMBER", label: "New Member", hint: "Pledge / associate" },
  { key: "ALUMNI", label: "Alumni", hint: "Graduated" },
  { key: "SECRETARY", label: "Secretary", hint: "Exec" },
  { key: "TREASURER", label: "Treasurer", hint: "Exec" },
  { key: "VICE_PRESIDENT", label: "Vice President", hint: "Exec" },
  { key: "PRESIDENT", label: "President", hint: "Exec" },
];

export const DEFAULT_SIGNET_ROLE = "MEMBER";

/**
 * Discord role → Signet role, as a note to the admin's future self.
 *
 * **This grants nothing.** The importer never touches a `members` row and never
 * assigns a role; every imported author is a name on a message, not an account,
 * so there is nobody to grant anything to. What the mapping is for is the step
 * that comes after the import: an admin looking at who used to be Exec, so they
 * can promote the right people by hand. That matches how Signet's onboarding
 * already works — everyone starts as a Member and is promoted deliberately —
 * and it means a compromised or careless Discord export cannot hand anyone
 * permissions here.
 *
 * The card grid is `ArchetypeStep`'s recipe, down to the class pair, because
 * this is the same interaction: one choice from a small fixed set.
 */
export function RoleMappingStep({
  roles,
  choices,
  onChange,
}: {
  roles: StagedRole[];
  choices: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Note which Signet role each Discord role corresponds to. This does not
        grant anything — imported messages have no accounts behind them. It is a
        worksheet for promoting people yourself once the archive is in.
      </p>

      {roles.length === 0 ? (
        <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
          No Discord roles were found in the export header. Everyone imports as
          a name on a message either way, and you can promote members from
          Settings → Roles once the import finishes.
        </p>
      ) : (
        <div className="space-y-3">
          {roles.map((role) => {
            const selected = choices[role.roleId] ?? DEFAULT_SIGNET_ROLE;
            return (
              <div
                key={role.roleId}
                className="space-y-2 rounded-lg border border-border p-3"
              >
                <div>
                  <span className={cn(EYEBROW, "text-muted-foreground")}>
                    Discord role
                  </span>
                  <p className="text-sm font-semibold">{role.roleName}</p>
                </div>

                <div
                  role="radiogroup"
                  aria-label={`Signet role for ${role.roleName}`}
                  className="grid grid-cols-2 gap-2 lg:grid-cols-4"
                >
                  {SIGNET_ROLES.map((signetRole) => {
                    const isActive = signetRole.key === selected;
                    return (
                      <button
                        key={signetRole.key}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() =>
                          onChange({
                            ...choices,
                            [role.roleId]: signetRole.key,
                          })
                        }
                        className={cn(
                          "flex flex-col gap-1 rounded-lg border p-3 text-left transition",
                          FOCUS_RING,
                          isActive
                            ? "border-accent-border bg-accent-subtle-hover text-accent-text"
                            : "border-border hover:bg-accent-subtle",
                        )}
                      >
                        <span className="text-sm font-semibold">
                          {signetRole.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {signetRole.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
