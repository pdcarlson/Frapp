/**
 * The chapter's Logs (Paul, 2026-11-21): the record of officer changes,
 * read from `chapter_audit_log` on a page in Chapter settings on web and the
 * phone, filterable by kind, person and time. It replaced the
 * `#chapter-audit` chat channel, which only ever held a copy of these rows.
 * `spec/behavior/settings/README.md` § Audit Rules.
 *
 * One copy of the words, the kinds and the windows so both apps say and
 * offer the same, and the API filters by the same kinds.
 */

/** The page's name, on the settings row, its header and the phone screen. */
export const CHAPTER_LOGS_TITLE = "Logs";

/** What the page says with nothing to show. */
export const CHAPTER_LOGS_COPY = {
  empty: "Nothing has been logged yet.",
  filteredEmpty: "Nothing matches these filters.",
  loadError: "Couldn't load the logs.",
  more: "Show older",
} as const;

/**
 * What each logged action did, as the words after the actor's name
 * ("Paul **updated the chapter profile**"). An action not listed here reads
 * as its key with the underscores taken out, so a new writer never draws a
 * raw key.
 */
const ACTION_PHRASES: Readonly<Record<string, string>> = {
  chapter_config_updated: "updated chapter settings",
  chapter_profile_updated: "updated the chapter profile",
  chapter_logo_updated: "updated the chapter logo",
  chapter_logo_removed: "removed the chapter logo",
  chapter_custom_field_created: "added a profile field",
  chapter_custom_field_updated: "edited a profile field",
  chapter_custom_field_deleted: "removed a profile field",
  chapter_custom_role_created: "added a role",
  chapter_custom_role_updated: "edited a role",
  chapter_custom_role_deleted: "removed a role",
  role_created: "added a role",
  role_updated: "edited a role",
  role_deleted: "removed a role",
  role_self_joined: "joined a role",
  role_self_left: "left a role",
  role_tier_created: "added a tier",
  role_tier_updated: "edited a tier",
  role_tier_deleted: "removed a tier",
  role_tiers_reordered: "reordered the tiers",
  chapter_group_created: "added a group",
  chapter_group_updated: "edited a group",
  chapter_group_members_set: "changed who is in a group",
  chapter_group_deleted: "removed a group",
  member_removed: "removed a member",
  member_profile_corrected: "edited a member's profile",
  // A member renaming themselves (#5801).
  member_renamed: "changed their name",
  presidency_transferred: "handed over the presidency",
  presidency_claimed: "claimed the presidency",
  president_orphaned: "left the chapter without a president",
  ai_settings_updated: "changed the AI settings",
  chapter_goals_updated: "changed the chapter's goals",
  ai_diagnostics_started:
    "turned on saving Ask Frapp answers for the Frapp team",
  ai_diagnostics_stopped: "turned off saving Ask Frapp answers",
};

/** `accent_color` → `accent color`: a key as words, never as a key. */
export function keyAsWords(key: string): string {
  return key.replace(/[_-]+/g, " ").trim();
}

/** What an action did, as words: "updated the chapter profile". */
export function chapterLogPhrase(action: string): string {
  return ACTION_PHRASES[action] ?? keyAsWords(action);
}

/**
 * The kinds the Filter menu offers, in its order, each with the actions it
 * holds. The API filters by these (`GET /v1/audit-log?kind=`), so a kind
 * means the same rows on both apps. An action no kind lists still shows under
 * "Any kind".
 */
export const CHAPTER_LOG_KINDS = [
  {
    value: "roles",
    label: "Roles and groups",
    actions: [
      "role_created",
      "role_updated",
      "role_deleted",
      "role_self_joined",
      "role_self_left",
      "chapter_custom_role_created",
      "chapter_custom_role_updated",
      "chapter_custom_role_deleted",
      "role_tier_created",
      "role_tier_updated",
      "role_tier_deleted",
      "role_tiers_reordered",
      "chapter_group_created",
      "chapter_group_updated",
      "chapter_group_members_set",
      "chapter_group_deleted",
    ],
  },
  {
    value: "members",
    label: "Members",
    actions: [
      "member_removed",
      "member_profile_corrected",
      "member_renamed",
      "presidency_transferred",
      "presidency_claimed",
      "president_orphaned",
    ],
  },
  {
    value: "settings",
    label: "Chapter settings",
    actions: [
      "chapter_config_updated",
      "chapter_profile_updated",
      "chapter_logo_updated",
      "chapter_logo_removed",
      "chapter_custom_field_created",
      "chapter_custom_field_updated",
      "chapter_custom_field_deleted",
      "chapter_goals_updated",
      "ai_settings_updated",
      "ai_diagnostics_started",
      "ai_diagnostics_stopped",
    ],
  },
] as const satisfies readonly {
  value: string;
  label: string;
  actions: readonly string[];
}[];

export type ChapterLogKind = (typeof CHAPTER_LOG_KINDS)[number]["value"];

export const CHAPTER_LOG_KIND_VALUES: readonly ChapterLogKind[] =
  CHAPTER_LOG_KINDS.map((kind) => kind.value);

/** The actions a kind holds, or `null` for an unknown kind. */
export function chapterLogKindActions(kind: string): readonly string[] | null {
  return CHAPTER_LOG_KINDS.find((k) => k.value === kind)?.actions ?? null;
}

/** The Filter menu's time windows, newest first. */
export const CHAPTER_LOG_WINDOWS = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
] as const;

export type ChapterLogWindow = (typeof CHAPTER_LOG_WINDOWS)[number]["value"];

/** The ISO instant a window starts at, counted back from `now`. */
export function chapterLogWindowStart(
  window: string,
  now: Date = new Date(),
): string | undefined {
  const found = CHAPTER_LOG_WINDOWS.find((w) => w.value === window);
  if (!found) return undefined;
  return new Date(now.getTime() - found.days * 86_400_000).toISOString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VALUE_LENGTH = 60;
/** A diff key that holds ids: `user_id`, `president_member_id`, `role_ids`. */
const ID_KEY = /(^|_)ids?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A `{ from, to }` pair, the shape most writers record a field in. */
function asChange(value: unknown): { from: unknown; to: unknown } | null {
  if (!isPlainObject(value) || !("from" in value) || !("to" in value)) {
    return null;
  }
  return { from: value.from, to: value.to };
}

function nameOf(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  for (const key of ["name", "label", "title"]) {
    const v = value[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

/**
 * The thing an entry is about, when the row records its name: the role,
 * tier, group or field that was added, removed or renamed ("On Campus").
 * `null` when the row names nothing, such as a settings change.
 */
export function chapterLogSubject(
  diff: Record<string, unknown>,
): string | null {
  // A whole record added or removed: `{ role: { from: null, to: {...} } }`.
  for (const value of Object.values(diff)) {
    const change = asChange(value);
    if (!change) continue;
    const name = nameOf(change.to) ?? nameOf(change.from);
    if (name) return name;
  }
  return null;
}

/** A recorded value as words, or `null` when it can't be shown to a person. */
function valueAsWords(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // An id or a storage path means nothing to a reader.
    if (UUID.test(value) || /^[\w-]+(\/[\w.-]+){2,}$/.test(value)) return null;
    return value.length > MAX_VALUE_LENGTH
      ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…`
      : value;
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    if (value.some((v) => UUID.test(v))) return null;
    const joined = value.join(", ");
    return joined.length > MAX_VALUE_LENGTH
      ? `${joined.slice(0, MAX_VALUE_LENGTH - 1)}…`
      : joined || "none";
  }
  return null;
}

export type ChapterLogChange = {
  field: string;
  /** The words for what it was, or `null` when it can't be shown. */
  from: string | null;
  to: string | null;
};

/**
 * The fields an entry changed, each as words: "name: Non-Brothers →
 * Non-Brothers/PNMs". A field whose values are records or paths is named
 * with no values, so a reader still sees what moved. A field keyed as ids
 * (`member_id`) is left out, and so is a whole record added or removed (its
 * name is the subject).
 */
export function chapterLogChanges(
  diff: Record<string, unknown>,
): ChapterLogChange[] {
  const changes: ChapterLogChange[] = [];
  for (const [key, value] of Object.entries(diff)) {
    // A field that holds ids (`member_id`, `president_member_id`) names
    // nothing a reader knows: "member id" would read as noise.
    if (ID_KEY.test(key)) continue;
    const change = asChange(value);
    if (!change) {
      // `{ added, removed }` on a permissions change (#2599).
      if (isPlainObject(value) && ("added" in value || "removed" in value)) {
        changes.push({ field: keyAsWords(key), from: null, to: null });
      }
      continue;
    }
    if (isPlainObject(change.to) || isPlainObject(change.from)) {
      if (change.from === null || change.to === null) continue;
      changes.push({ field: keyAsWords(key), from: null, to: null });
      continue;
    }
    const from = valueAsWords(change.from);
    const to = valueAsWords(change.to);
    changes.push({
      field: keyAsWords(key),
      from: from !== null && to !== null ? from : null,
      to: from !== null && to !== null ? to : null,
    });
  }
  return changes;
}

/** One change as a line: "name: Old → New", or the field alone. */
export function chapterLogChangeText(change: ChapterLogChange): string {
  return change.from !== null && change.to !== null
    ? `${change.field}: ${change.from} → ${change.to}`
    : change.field;
}

/**
 * The member an entry is about, when its diff records their `users.id`
 * (`member_removed` does): the user id to resolve to a name. `null`
 * otherwise. A writer that records only the `chapter_members` id, such as
 * `member_profile_corrected`, names no subject (#5817).
 */
export function chapterLogTargetUserId(entry: {
  target_type: string;
  target_id: string | null;
  diff: Record<string, unknown>;
}): string | null {
  if (entry.target_type !== "member") return null;
  const fromDiff = entry.diff.user_id;
  if (typeof fromDiff === "string" && UUID.test(fromDiff)) return fromDiff;
  return null;
}
