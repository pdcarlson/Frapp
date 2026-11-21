import { sameChannelAccessList } from "@repo/validation";

/**
 * Reading a channel's who-can-see and who-can-post lists (#3722), shared by
 * web's Chat settings and the phone's Edit channel sheet (#3702), so the two
 * say the same thing about the same list.
 */

/** One thing a list can name, as `GET /v1/channels/access-options` serves it. */
export type ChannelAccessOption = {
  entry: string;
  /** `tier`, `role` or `group` (#4076). */
  kind: string;
  id: string;
  name: string;
  color: string | null;
  tier_id: string | null;
  user_ids: readonly string[];
  /**
   * A role the chapter never assigns by hand (Everyone, #4191), or a pledge
   * class or class year nobody is in yet (#4076): kept so a list that names
   * it still reads, never offered to add.
   */
  hidden?: boolean;
};

/** The two questions a channel answers. */
export type ChannelAccessQuestion = "see" | "post";

const KIND_HEADINGS: Record<string, string> = {
  tier: "Tiers",
  role: "Roles",
  group: "Groups",
};

const KIND_ORDER = ["tier", "role", "group"];

/**
 * A kind's heading in a picker. A kind this build doesn't know (a newer
 * API's) still shows, under its own name, so a new kind needs no change here.
 */
export function channelAccessKindHeading(kind: string): string {
  return KIND_HEADINGS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Tiers first, then roles, then groups, then any kind a newer API adds. */
export function compareChannelAccessKinds(a: string, b: string): number {
  const rank = (kind: string) =>
    KIND_ORDER.indexOf(kind) + 1 || KIND_ORDER.length + 1;
  return rank(a) - rank(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

/**
 * Parses `GET /v1/channels/access-options`. A row without an entry, kind, id
 * or name is dropped; the rest keep the server's order.
 */
export function selectChannelAccessOptions(
  data: unknown,
): ChannelAccessOption[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isRecord).flatMap((row): ChannelAccessOption[] => {
    const { entry, kind, id, name } = row;
    if (
      typeof entry !== "string" ||
      typeof kind !== "string" ||
      typeof id !== "string" ||
      typeof name !== "string"
    ) {
      return [];
    }
    return [
      {
        entry,
        kind,
        id,
        name,
        color: typeof row.color === "string" ? row.color : null,
        tier_id: typeof row.tier_id === "string" ? row.tier_id : null,
        user_ids: Array.isArray(row.user_ids)
          ? row.user_ids.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
        ...(row.hidden === true ? { hidden: true } : {}),
      },
    ];
  });
}

/** Everyone a list reaches, each counted once. */
export function channelAccessReach(
  list: readonly string[],
  options: readonly ChannelAccessOption[],
): number {
  const byEntry = new Map(options.map((option) => [option.entry, option]));
  const users = new Set<string>();
  for (const entry of list) {
    for (const userId of byEntry.get(entry)?.user_ids ?? []) users.add(userId);
  }
  return users.size;
}

/**
 * How a list reads in one line, for a category row or a summary: "Everyone",
 * or the names it holds.
 */
export function describeChannelAccess(
  list: readonly string[] | null | undefined,
  question: ChannelAccessQuestion,
  options: readonly ChannelAccessOption[],
): string {
  if (list == null) {
    return question === "see" ? "Everyone" : "Everyone who can see it";
  }
  if (list.length === 0) return "Only the President";
  const byEntry = new Map(options.map((option) => [option.entry, option]));
  return list
    .map((entry) => byEntry.get(entry)?.name ?? "A removed role")
    .join(", ");
}

/** Whether a channel's two lists equal its category's (it "matches" and follows it). */
export function matchesCategoryAccess(
  see: readonly string[] | null,
  post: readonly string[] | null,
  category:
    | {
        who_can_see?: readonly string[] | null;
        who_can_post?: readonly string[] | null;
      }
    | null
    | undefined,
): boolean {
  if (!category) return false;
  return (
    sameChannelAccessList(see, category.who_can_see ?? null) &&
    sameChannelAccessList(post, category.who_can_post ?? null)
  );
}

/** A chosen list with nothing on it: the API refuses it, so a form does. */
export function isEmptyChannelAccessChoice(
  list: readonly string[] | null,
): boolean {
  return list !== null && list.length === 0;
}
