import AsyncStorage from "@react-native-async-storage/async-storage";
import { PLUS_MENU_PERMISSIONS } from "@repo/chat-core/plus-menu";
import {
  can,
  canAll,
  EVENT_CREATE_PERMISSIONS,
  isModuleEnabled,
} from "@repo/validation";

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
  | "invite"
  | "message"
  | "hostCheckIn"
  | "logHours"
  | "study"
  | "upload";

/**
 * The panel holds at most nine, three rows of three (Paul, 2026-11-13: "cap it
 * at 9, and then you could go 3 rows of 3"). Every action fits, so an officer
 * who can use all of them may place all of them.
 */
export const QUICK_ACTION_LIMIT = 9;

/**
 * How many a member starts on before they edit: two rows. The rest wait in the
 * Add row, so a first open is a short panel, not every action at once.
 */
export const QUICK_ACTION_START = 6;

/**
 * Columns, always: rows of three, at rest and while editing, so entering edit
 * mode moves nothing (owner ask 2026-11-13, after six drew as two columns).
 */
export const QUICK_ACTION_COLUMNS = 3;

/**
 * Every action, in the order a member who never edits the panel sees them.
 * The starting set is the first six of these the member may use
 * (`QUICK_ACTION_START`), so a President starts with New event, New task,
 * Invite, Message, Host check-in and Log hours, and a member whose role logs
 * hours with Message, Log hours and Study. There is no Check in: a member
 * checks in by pointing the phone's camera at the host's code, which opens the
 * app already checking in (2026-11-13), and a saved panel that held it just
 * drops it. Invite sits third so the officer who can invite finds it on the
 * first open (owner ask 2026-11-06, "I couldn't find a way to invite new
 * members"); Study and Upload wait in the Add row for that officer.
 */
const QUICK_ACTION_ORDER: readonly QuickActionKey[] = [
  "newEvent",
  "newTask",
  "invite",
  "message",
  "hostCheckIn",
  "logHours",
  "study",
  "upload",
];

export const QUICK_ACTION_LABELS: Record<QuickActionKey, string> = {
  newEvent: "New event",
  newTask: "New task",
  invite: "Invite",
  message: "Message",
  hostCheckIn: "Host check-in",
  logHours: "Log hours",
  study: "Study",
  upload: "Upload",
};

/** What a screen reader says the action does, beyond its label. */
export const QUICK_ACTION_HINTS: Record<QuickActionKey, string> = {
  newEvent: "Opens the new event sheet.",
  newTask: "Opens the new task sheet.",
  invite: "Opens invites to email or share with new members.",
  message: "Opens the directory to pick who to message.",
  hostCheckIn: "Opens the host check-in display for the next event.",
  logHours: "Opens the log service hours sheet.",
  study: "Opens study hours.",
  upload: "Opens the upload document sheet.",
};

export type QuickActionAccess = {
  permissions: readonly string[];
  /** The chapter's `enabled_modules`, once read. Unread counts as on. */
  enabledModules: Record<string, boolean> | null | undefined;
};

/**
 * The actions this member can use in this chapter: their role grants it and
 * the module is on. The same checks the API makes on what each action does
 * (each gate names its endpoint), so the panel never offers something the
 * server would then refuse.
 */
export function availableQuickActions({
  permissions,
  enabledModules,
}: QuickActionAccess): QuickActionKey[] {
  const on = (key: string) => isModuleEnabled(enabledModules, key);
  const allowed: Record<QuickActionKey, boolean> = {
    // The event sheet's own gate: creating reads the roster, which the events
    // controller guards with members:view.
    newEvent: on("events") && canAll(EVENT_CREATE_PERMISSIONS, permissions),
    // The route's grant, from the table the chat + reads too: `tasks:manage`
    // under the controller's `members:view`.
    newTask: on("tasks") && canAll(PLUS_MENU_PERMISSIONS.task, permissions),
    // Every invite route (`POST /v1/invites`, `GET /v1/invites`) checks
    // `members:invite`. Invites have no module switch.
    invite: can("members:invite", permissions),
    // The Directory lists the roster (`GET /v1/members`, `members:view`).
    message: can("members:view", permissions),
    hostCheckIn: on("events") && can("events:update", permissions),
    // Filing an entry is `service:log` (`POST /v1/service-entries`), which the
    // seeded New Member and Alumni roles don't hold.
    logHours: on("hours") && can("service:log", permissions),
    // A session starts against the chapter's study zones, so both modules.
    // The study endpoints sit behind `members:view` too.
    study: on("hours") && on("geofences") && can("members:view", permissions),
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
  if (!saved) return available.slice(0, QUICK_ACTION_START);
  const seen = new Set<QuickActionKey>();
  for (const key of saved) {
    const action = available.find((candidate) => candidate === key);
    if (action && !seen.has(action)) seen.add(action);
  }
  return [...seen].slice(0, QUICK_ACTION_LIMIT);
}

/**
 * What an edit keeps on the phone: the new arrangement, then whatever the
 * saved one held that the member can't use right now (a module turned off, a
 * role still loading), in its saved order. An edit only changes what the
 * member could see, so an action hidden for a while comes back when its
 * module or role does, rather than being lost to an unrelated reorder.
 */
export function mergeSavedQuickActions(
  next: readonly QuickActionKey[],
  saved: readonly string[] | null,
  available: readonly QuickActionKey[],
): QuickActionKey[] {
  const hidden = (saved ?? []).filter(
    (key): key is QuickActionKey =>
      (QUICK_ACTION_ORDER as readonly string[]).includes(key) &&
      !available.includes(key as QuickActionKey) &&
      !next.includes(key as QuickActionKey),
  );
  return [...new Set([...next, ...hidden])];
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
 * One cell's width in a panel drawn `panelWidth` wide with `padX` inside each
 * edge and a `frameEdge` border (the glass surface's hairline). Floored, so
 * three cells never add up to more than the row holds: three thirds of the
 * outer width overran the border by a hairline, and the third cell wrapped,
 * which drew six actions as three rows of two (2026-11-13).
 */
export function quickActionCellWidth(
  panelWidth: number,
  padX: number,
  frameEdge: number,
): number {
  const inner = panelWidth - 2 * frameEdge - 2 * padX;
  return Math.max(Math.floor(inner / QUICK_ACTION_COLUMNS), 1);
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
