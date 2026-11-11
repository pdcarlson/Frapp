"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRoles } from "@repo/hooks";
import { asArray } from "@/lib/utils";
import { ProfileSection } from "@/components/profile/profile-section";
import {
  InlineNote,
  inlineNoteActionClassName,
} from "@/components/shared/inline-note";
import { modulePermissions } from "@/components/settings/settings-modules";

type WhoCanRole = {
  id: string;
  name: string;
  color: string | null;
  permissions: readonly string[];
  displayOrder: number;
};

function normalizeRoles(data: unknown): WhoCanRole[] {
  return asArray<Record<string, unknown>>(data)
    .map((role) => ({
      id: String(role.id ?? ""),
      name: String(role.name ?? ""),
      color: typeof role.color === "string" ? role.color : null,
      permissions: Array.isArray(role.permissions)
        ? role.permissions.map(String)
        : [],
      displayOrder: Number(role.display_order ?? 0),
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * A module page's "Who can" block (#4073): each of the module's permissions,
 * in the registry's words, with the roles that hold it.
 *
 * Read from the same data as the Roles page (`GET /v1/roles` and the
 * permission registry), so the two can't disagree, and changed there: the
 * block links to Roles rather than editing in place, the way Discord's
 * per-integration "Roles & Members" list hands off to the server's roles.
 *
 * The President's wildcard is said once in the hint rather than drawn as a
 * chip on every row, where it would be the same chip ten times over.
 *
 * Roles only for now. Tiers (#4071) and per-role overrides (#4072) join this
 * list when the API serves them.
 */
export function ModuleWhoCan({
  moduleKey,
  moduleLabel,
}: {
  moduleKey: string;
  moduleLabel: string;
}) {
  const rolesQuery = useRoles();
  const roles = useMemo(
    () => normalizeRoles(rolesQuery.data),
    [rolesQuery.data],
  );
  const permissions = modulePermissions(moduleKey);
  if (permissions.length === 0) return null;

  const rolesLink = (
    <Link href="/settings?tab=roles" className={inlineNoteActionClassName}>
      Change in Roles
    </Link>
  );

  return (
    <ProfileSection
      id={`settings-module-${moduleKey}-who`}
      title="Who can"
      hint={
        <>
          What each role can do in {moduleLabel}. The President can do
          everything. {rolesLink}
        </>
      }
    >
      {rolesQuery.isError ? (
        <InlineNote>
          Couldn&apos;t load your chapter&apos;s roles. {rolesLink} shows them.
        </InlineNote>
      ) : (
        <ul className="divide-y divide-border rounded-[14px] border border-border">
          {permissions.map((entry) => {
            const holders = roles.filter(
              (role) =>
                !role.permissions.includes("*") &&
                role.permissions.includes(entry.permission),
            );
            return (
              <li
                key={entry.permission}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div className="min-w-0 sm:max-w-[55%]">
                  <p className="text-sm font-medium text-foreground">
                    {entry.label}
                  </p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {entry.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                  {rolesQuery.isPending ? (
                    <span className="text-caption text-muted">Loading</span>
                  ) : holders.length === 0 ? (
                    <span className="text-caption text-muted-foreground">
                      Only the President
                    </span>
                  ) : (
                    holders.map((role) => (
                      <span
                        key={role.id}
                        className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2 text-caption text-foreground"
                      >
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground"
                          style={
                            role.color
                              ? { backgroundColor: role.color }
                              : undefined
                          }
                        />
                        {role.name}
                      </span>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ProfileSection>
  );
}
