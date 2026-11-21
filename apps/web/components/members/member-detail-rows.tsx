import type { ReactNode } from "react";

/** A member profile read (`GET /v1/members/by-user/{userId}`), loosely typed. */
export type MemberRecord = Record<string, unknown>;

/** One label-over-value row of a flat detail list. */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
      <dt className="shrink-0 text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm">{children}</dd>
    </div>
  );
}

/** The bordered list a member sheet's {@link DetailRow}s sit in. */
export const DETAIL_LIST =
  "divide-y divide-border rounded-md border border-border";

export function stringField(
  member: MemberRecord | null,
  key: string,
): string | null {
  const value = member?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

/**
 * The line under the name, as mobile's sheet draws it (`selectMemberDetail`):
 * major, company, city and the class year, e.g. `Economics · Chicago · '27`.
 */
export function metaLine(member: MemberRecord | null): string | null {
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
