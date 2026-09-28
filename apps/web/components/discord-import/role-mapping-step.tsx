"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";
import { dashboardFormSelectClassName } from "@/components/shared/table-controls";
import type { StagedRole } from "./upload-step";
import type {
  FrappRole,
  MatchKind,
  RoleChoice,
  RoleIssue,
} from "./role-matching";

/**
 * Why every role is held on Ignore: the viewer cannot manage roles, or the
 * roles (or the viewer's permissions) could not be loaded, which a retry may
 * fix. An all-Ignore mapping is always accepted, so either way the import can
 * go on, with each private channel's readers chosen by hand.
 */
export type RoleStepLock =
  { reason: "permission" } | { reason: "unavailable"; retry: () => void };

const NEW = "__new__";
const IGNORE = "__ignore__";

/**
 * Which Frapp role each Discord role becomes (#2818), asked before the
 * channels because a private channel's default ("Same as Discord") is read
 * through it.
 *
 * Each role starts at its name match, then a close match to a seeded role,
 * then New role if it could read a private channel and Ignore if it could
 * not. A close match is labelled, since "Recording Secretary" → Secretary is
 * a guess the admin should see.
 *
 * **It never puts anyone into a role.** Imported authors are names on
 * messages, not accounts. Starting the import creates the new roles and lets
 * each mapped role read the channels gated on it; people are added to roles
 * by hand in Settings → Roles.
 */
export function RoleMappingStep({
  roles,
  choices,
  matches,
  privateReads,
  frappRoles,
  issues,
  lock,
  onChange,
}: {
  roles: StagedRole[];
  /** Every role's answer, defaults included. */
  choices: Record<string, RoleChoice>;
  /** Why an untouched answer is what it is. */
  matches: Record<string, MatchKind>;
  privateReads: ReadonlyMap<string, number>;
  frappRoles: FrappRole[];
  issues: RoleIssue[];
  /** Set when every role is held on Ignore, and why. */
  lock: RoleStepLock | null;
  onChange: (roleId: string, next: RoleChoice) => void;
}) {
  const problems = new Map<string, string[]>();
  for (const issue of issues) {
    problems.set(issue.roleId, [
      ...(problems.get(issue.roleId) ?? []),
      issue.message,
    ]);
  }
  const counts = { existing: 0, new: 0, ignore: 0 };
  for (const role of roles) {
    counts[choices[role.roleId]?.action ?? "ignore"] += 1;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose what each Discord role becomes in Frapp. A channel that was
        private in Discord is imported readable only by the Frapp roles its
        Discord roles map to. Nobody is put into a role: add people in Settings
        → Roles once the import finishes.
      </p>

      {lock?.reason === "permission" ? (
        <p className="rounded-lg border border-warning/40 bg-warning-tint p-3 text-sm">
          Mapping a role creates roles and gives them access, which needs
          permission to manage roles. Every role stays on Ignore, so you choose
          who can read each private channel yourself.
        </p>
      ) : null}
      {lock?.reason === "unavailable" ? (
        <p className="rounded-lg border border-warning/40 bg-warning-tint p-3 text-sm">
          Frapp could not load your chapter&apos;s roles, so every role stays on
          Ignore and you choose who can read each private channel yourself.{" "}
          <button
            type="button"
            onClick={lock.retry}
            className={cn(
              "text-accent-text underline-offset-2 hover:underline",
              FOCUS_RING,
            )}
          >
            Try again
          </button>
        </p>
      ) : null}

      {roles.length === 0 ? (
        <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
          Frapp found no roles to map in this server. Choose who can read each
          private channel on the next step.
        </p>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-semibold">{counts.existing}</span> mapped
            <span className="text-muted-foreground">
              {" "}
              · {counts.new} new · {counts.ignore} ignored
            </span>
          </p>
          <div className="space-y-2">
            {roles.map((role) => (
              <RoleRow
                key={role.roleId}
                role={role}
                choice={choices[role.roleId] ?? { action: "ignore" }}
                match={matches[role.roleId] ?? null}
                reads={privateReads.get(role.roleId) ?? 0}
                frappRoles={frappRoles}
                problems={problems.get(role.roleId) ?? []}
                disabled={lock !== null}
                onChange={(next) => onChange(role.roleId, next)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RoleRow({
  role,
  choice,
  match,
  reads,
  frappRoles,
  problems,
  disabled,
  onChange,
}: {
  role: StagedRole;
  choice: RoleChoice;
  match: MatchKind;
  reads: number;
  frappRoles: FrappRole[];
  problems: string[];
  disabled: boolean;
  onChange: (next: RoleChoice) => void;
}) {
  const value =
    choice.action === "existing"
      ? choice.roleId
      : choice.action === "new"
        ? NEW
        : IGNORE;
  const selectId = `role-${role.roleId}`;

  return (
    <div
      className={cn(
        "space-y-2 rounded-md border p-3",
        problems.length > 0 ? "border-warning/60" : "border-border",
      )}
    >
      <div className="grid gap-2 sm:grid-cols-2 sm:items-center">
        <div className="min-w-0">
          <span className={cn(EYEBROW, "block text-muted-foreground")}>
            Discord role
          </span>
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="truncate">{role.roleName}</span>
            {match === "close" ? (
              <Badge variant="outline">Close match</Badge>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {reads > 0
              ? `Could read ${reads} private channel${reads === 1 ? "" : "s"}`
              : "Could read no private channel"}
          </p>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={selectId} className="text-xs">
            Becomes
          </Label>
          <select
            id={selectId}
            className={dashboardFormSelectClassName}
            value={value}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              if (next === NEW) {
                onChange({ action: "new", name: role.roleName.trim() });
              } else if (next === IGNORE) {
                onChange({ action: "ignore" });
              } else {
                onChange({ action: "existing", roleId: next });
              }
            }}
          >
            <optgroup label="Frapp roles">
              {frappRoles.map((frappRole) => (
                <option key={frappRole.id} value={frappRole.id}>
                  {frappRole.name}
                </option>
              ))}
            </optgroup>
            <option value={NEW}>New role…</option>
            <option value={IGNORE}>Ignore</option>
          </select>
        </div>
      </div>

      {choice.action === "new" ? (
        <div className="grid gap-1">
          <Label htmlFor={`${selectId}-name`} className="text-xs">
            New role name
          </Label>
          <Input
            id={`${selectId}-name`}
            value={choice.name}
            disabled={disabled}
            onChange={(event) =>
              onChange({ action: "new", name: event.target.value })
            }
          />
        </div>
      ) : null}

      {problems.length > 0 ? (
        <ul className="space-y-0.5">
          {problems.map((problem) => (
            <li key={problem} className="text-xs text-warning">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
