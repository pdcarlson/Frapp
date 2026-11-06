import AsyncStorage from "@react-native-async-storage/async-storage";
import { can, canAll, isModuleEnabled } from "@repo/validation";

/**
 * The quick-actions panel behind the tab bar's + (owner ask 2026-11-06;
 * `spec/ui/mobile/navigation.md` § Quick actions). This file is the model: which
 * actions exist, which this member may see, the starting set, the edits the
 * press-and-hold mode makes, and where the member's own arrangement is kept.
 * The panel is `components/quick-actions/quick-actions-panel.tsx`; what each
 * action opens is `components/quick-actions/quick-actions-host.tsx`.
 */
export type QuickActionKey =
  | "newEvent"
  | "newTask"
  | "message"
  | "checkIn"
  | "hostCheckIn"
  | "logHours"
  | "study"
  | "upload";

/** The panel holds at most six, two rows of three. */
export const QUICK_ACTION_LIMIT = 6;

/**
 * Every action, in the order a member who never edits the panel sees them.
 * The starting set is the first six of these the member may use, so an
 * officer starts with New event, New task, Message, Check in, Host check-in
 * and Log hours, and a member with Message, Check in, Log hours and Study.
 */
export const QUICK_ACTION_ORDER: readonly QuickActionKey[] = [
  "newEvent",
  "newTask",
  "message",
  "checkIn",
  "hostCheckIn",
  "logHours",
  "study",
  "upload",
];

export const QUICK_ACTION_LABELS: Record<QuickActionKey, string> = {
  newEvent: "New event",
  newTask: "New task",
  message: "Message",
  checkIn: "Check in",
  hostCheckIn: "Host check-in",
  logHours: "Log hours",
  study: "Study",
  upload: "Upload",
};

/** What a screen reader says the action does, beyond its label. */
export const QUICK_ACTION_HINTS: Record<QuickActionKey, string> = {
  newEvent: "Opens the new event sheet.",
  newTask: "Opens the new task sheet.",
  message: "Opens the directory to pick who to message.",
  checkIn: "Opens check-in for the event happening now.",
  hostCheckIn: "Opens the host check-in display for the next event.",
  logHours: "Opens the log service hours sheet.",
  study: "Opens study hours.",
  upload: "Opens the upload document sheet.",
};

export type QuickActionAccess = {
  permissions: readonly string[];
  /** The chapter's `enabled_modules`, once read. Unread counts as on. */
  enabledModules: Record<string, boolean> | null | undefined;
  /**
   * Whether this build can open New event. It arrives with the mobile event
   * sheet, so until then the action stays out of the panel rather than
   * leading nowhere.
   */
  canOpenNewEvent: boolean;
};

/**
 * The actions this member can use in this chapter: their role grants it and
 * the module is on. The same checks the screens behind them make, so the panel
 * never offers something the screen would then refuse.
 */
export function availableQuickActions({
  permissions,
  enabledModules,
  canOpenNewEvent,
}: QuickActionAccess): QuickActionKey[] {
  const on = (key: string) => isModuleEnabled(enabledModules, key);
  const allowed: Record<QuickActionKey, boolean> = {
    // The event sheet's own gate: creating reads the roster, which the events
    // controller guards with members:view.
    newEvent:
      canOpenNewEvent &&
      on("events") &&
      canAll(["events:create", "members:view"], permissions),
    newTask: on("tasks") && can("tasks:manage", permissions),
    message: true,
    checkIn: on("events"),
    hostCheckIn: on("events") && can("events:update", permissions),
    logHours: on("hours"),
    // A session starts against the chapter's study zones, so both modules.
    study: on("hours") && on("geofences"),
    upload: on("documents") && can("chapter_docs:upload", permissions),
  };
  return QUICK_ACTION_ORDER.filter((key) => allowed[key]);
}

/**
 * What the panel shows. With nothing saved, the starting set. With a saved
 * arrangement, that arrangement minus anything the member can no longer use,
 * so a permission lost later just hides its action.
 */
export function resolveQuickActions(
  saved: readonly string[] | null,
  available: readonly QuickActionKey[],
): QuickActionKey[] {
  if (!saved) return available.slice(0, QUICK_ACTION_LIMIT);
  const seen = new Set<QuickActionKey>();
  for (const key of saved) {
    const action = available.find((candidate) => candidate === key);
    if (action && !seen.has(action)) seen.add(action);
  }
  return [...seen].slice(0, QUICK_ACTION_LIMIT);
}

/** The edit mode's Add row: what the member can use and hasn't placed. */
export function addableQuickActions(
  shown: readonly QuickActionKey[],
  available: readonly QuickActionKey[],
): QuickActionKey[] {
  return available.filter((key) => !shown.includes(key));
}

export function removeQuickAction(
  shown: readonly QuickActionKey[],
  key: QuickActionKey,
): QuickActionKey[] {
  return shown.filter((candidate) => candidate !== key);
}

/** Adds at the end. A full panel is returned unchanged. */
export function addQuickAction(
  shown: readonly QuickActionKey[],
  key: QuickActionKey,
): QuickActionKey[] {
  if (shown.includes(key) || shown.length >= QUICK_ACTION_LIMIT) {
    return [...shown];
  }
  return [...shown, key];
}

/** A drag from one slot to another; the others close up around it. */
export function moveQuickAction(
  shown: readonly QuickActionKey[],
  from: number,
  to: number,
): QuickActionKey[] {
  const next = [...shown];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * Columns for `count` actions: four sit two by two so none is alone on a row;
 * otherwise rows of three.
 */
export function quickActionColumns(count: number): number {
  if (count === 4) return 2;
  return Math.max(1, Math.min(3, count));
}

/*
  Kept on the phone, per member and chapter: an officer's panel in one chapter
  is not their panel in another. Syncing it to the account is a later step.
*/
const STORAGE_PREFIX = "frapp:quick-actions:v1";

export function quickActionsStorageKey(
  userId: string,
  chapterId: string | null,
): string {
  return `${STORAGE_PREFIX}:${userId}:${chapterId ?? "sole"}`;
}

/** The saved arrangement, or `null` when there is none or it can't be read. */
export async function readSavedQuickActions(
  userId: string,
  chapterId: string | null,
): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(
      quickActionsStorageKey(userId, chapterId),
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : null;
  } catch {
    return null;
  }
}

export function writeSavedQuickActions(
  userId: string,
  chapterId: string | null,
  keys: readonly QuickActionKey[],
): void {
  AsyncStorage.setItem(
    quickActionsStorageKey(userId, chapterId),
    JSON.stringify(keys),
  ).catch(() => {
    /* Best effort: the panel keeps the edit until the app restarts. */
  });
}
