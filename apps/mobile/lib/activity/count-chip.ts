import type { Activity } from "@repo/hooks";

/** The sections `needs_you_count` is summed from. */
const COUNTED_SECTIONS: ReadonlySet<Activity["unavailable"][number]> = new Set([
  "tasks",
  "hours_approvals",
  "polls",
  "coming_up",
]);

/**
 * The More hub's Activity chip: the count of things waiting on the member,
 * or `null` for no chip (the read has not answered, or nothing waits).
 *
 * A section the server could not read is served empty and named in
 * `unavailable`, so the count then leaves it out. The chip says so with a
 * `+` ("2+", "at least 2 waiting on you") instead of stating a total it
 * does not have. With nothing counted there is still no chip: the Activity
 * screen is where a failed section is named.
 */
export function activityCountChip(
  activity: Pick<Activity, "needs_you_count" | "unavailable"> | undefined,
): { label: string; spoken: string } | null {
  const count = activity?.needs_you_count ?? 0;
  if (!activity || count <= 0) return null;
  const partial = activity.unavailable.some((section) =>
    COUNTED_SECTIONS.has(section),
  );
  return partial
    ? { label: `${count}+`, spoken: `at least ${count} waiting on you` }
    : { label: String(count), spoken: `${count} waiting on you` };
}
