"use client";

import { useId } from "react";
import { groupsOfMember, useGroups } from "@repo/hooks";
import { roleColorOrNull } from "@repo/validation";

/**
 * The groups a member is in (#4076), on their profile sheet: manual groups
 * like Third floor, then their pledge class's and class year's. Read-only
 * here, as Slack's profile lists a person's user groups: groups are edited in
 * Chapter settings → Groups. Nothing is drawn until the list loads, and a
 * failed read leaves the section out rather than claiming "No groups".
 */
export function MemberGroupsSection({
  userId,
  open,
}: {
  userId: string | null;
  open: boolean;
}) {
  const headingId = useId();
  const groupsQuery = useGroups({ enabled: open && userId !== null });
  if (!groupsQuery.data) return null;
  const groups = groupsOfMember(groupsQuery.data, userId);
  return (
    <section className="mt-6 space-y-2" aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="text-label font-semibold text-muted-foreground"
      >
        Groups
      </h3>
      {groups.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {groups.map((group) => {
            const hex = roleColorOrNull(group.color);
            return (
              <li
                key={group.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-caption text-foreground"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground"
                  // Palette literal: chapter data rendered as a raw swatch.
                  style={hex ? { backgroundColor: hex } : undefined}
                />
                {group.name}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-caption text-muted-foreground">No groups</p>
      )}
    </section>
  );
}
