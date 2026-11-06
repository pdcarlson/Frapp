"use client";

import { useMemo, useState } from "react";
import {
  canAll,
  isModuleEnabled,
  SETUP_CHECKLIST_DISMISS_KEY,
} from "@repo/validation";
import {
  useAccessibleChapters,
  useCurrentChapter,
  type ChapterMembershipSummary,
} from "./use-chapters";
import { useChapterRoster, useDismissOpsNudge } from "./use-members";
import { useEvents } from "./use-events";
import { useGeofences } from "./use-study";
import { useDocuments } from "./use-documents";
import { useInvites } from "./use-invites";
import { useInvoices } from "./use-invoices";
import { useActiveChapterId } from "./use-frapp-client";
import { useMyPermissions } from "./use-user";

/**
 * The officer "Set up your chapter" checklist on chat home
 * (`spec/product/modules.md` § Setup checklist).
 *
 * One list instead of an officer half on every empty screen: each line opens
 * the screen where the thing gets made, and checks itself off once the real
 * thing exists, read from the same lists those screens show. An officer sees
 * only the lines their permissions let them do, and only for modules the
 * chapter has on. The list goes away while every line it shows is done (it is
 * worked out from live counts, so deleting the only event brings it back), or
 * when the officer hides it (stored per user per chapter beside the nudges).
 *
 * The data is plain counts so both clients share the rule, and each client
 * maps a line's `key` to its own route.
 */

export type SetupChecklistKey =
  "invite" | "event" | "study-zone" | "document" | "dues";

interface SetupChecklistDefinition {
  key: SetupChecklistKey;
  label: string;
  /**
   * Every permission the line needs: its action, and the read that counts it
   * (the server returns the whole chapter's invoices only to `billing:view`).
   */
  permissions: readonly string[];
  /** The module the server gates the action on, or null for always on. */
  module: string | null;
  /**
   * How many items make the line done. Invite counts the roster plus open
   * invites, so the officer alone is 1 and one sent invite finishes it.
   */
  doneAt: number;
}

/** The list's title and its hide control's label, the same on both clients. */
export const SETUP_CHECKLIST_TITLE = "Set up your chapter";
export const HIDE_SETUP_CHECKLIST_LABEL = "Hide the setup list";

/**
 * Where each line's action lives in the web app. Web links to these; mobile
 * opens them in the browser for the lines it has no screen for.
 */
export const SETUP_CHECKLIST_WEB_PATH: Readonly<
  Record<SetupChecklistKey, string>
> = {
  invite: "/members",
  event: "/events",
  "study-zone": "/geofences",
  document: "/documents",
  dues: "/billing",
};

/** In the order an officer usually does them. */
export const SETUP_CHECKLIST_LINES: readonly SetupChecklistDefinition[] = [
  {
    key: "invite",
    label: "Invite members",
    permissions: ["members:invite"],
    module: null,
    doneAt: 2,
  },
  {
    key: "event",
    label: "Schedule the first event",
    // `EventController` also requires `members:view` at class level, so
    // `events:create` alone can't save one, on the web or the phone.
    permissions: ["events:create", "members:view"],
    module: "events",
    doneAt: 1,
  },
  {
    key: "study-zone",
    label: "Add a study zone",
    permissions: ["geofences:manage"],
    // Zones are the `geofences` module (`StudyGeofenceController`), not
    // `hours`, which is the study and service pages.
    module: "geofences",
    doneAt: 1,
  },
  {
    key: "document",
    label: "Upload the bylaws",
    permissions: ["chapter_docs:upload"],
    module: "documents",
    doneAt: 1,
  },
  {
    key: "dues",
    label: "Send the first dues",
    permissions: ["billing:manage", "billing:view"],
    module: "dues",
    doneAt: 1,
  },
];

export interface SetupChecklistLine {
  key: SetupChecklistKey;
  label: string;
  done: boolean;
}

export interface SetupChecklist {
  lines: SetupChecklistLine[];
  doneCount: number;
}

export interface SetupChecklistInput {
  /** The viewer's permissions, or undefined while they load. */
  permissions: readonly string[] | undefined;
  /** `enabled_modules` from the chapter, or undefined while it loads. */
  enabledModules: Record<string, boolean> | null | undefined;
  /** The viewer's dismissals in this chapter, or undefined while they load. */
  dismissed: readonly string[] | undefined;
  /** Items per line; undefined while that line's list loads. */
  counts: Partial<Record<SetupChecklistKey, number | undefined>>;
  /** Lines this client never draws, whatever the viewer may do. */
  omit?: readonly SetupChecklistKey[];
}

export interface SetupChecklistOptions {
  /**
   * Lines this client never draws, and never reads a list for. Mobile leaves
   * out dues: its web page is where the Frapp plan is bought, which the app
   * must not link to, and counting it would cache the chapter's whole invoice
   * ledger on a treasurer's phone.
   */
  omit?: readonly SetupChecklistKey[];
}

/** The lines this viewer can act on, before any list has loaded. */
export function eligibleSetupLines(
  permissions: readonly string[] | undefined,
  enabledModules: Record<string, boolean> | null | undefined,
  omit: readonly SetupChecklistKey[] = [],
): SetupChecklistKey[] {
  if (!permissions || !enabledModules) return [];
  return SETUP_CHECKLIST_LINES.filter(
    (line) =>
      !omit.includes(line.key) &&
      canAll(line.permissions, permissions) &&
      (line.module === null || isModuleEnabled(enabledModules, line.module)),
  ).map((line) => line.key);
}

/**
 * The checklist to draw, or null for none: nothing this viewer can do, every
 * line done, hidden, or still loading (so it never flashes in half-checked).
 */
export function selectSetupChecklist(
  input: SetupChecklistInput,
): SetupChecklist | null {
  const { permissions, enabledModules, dismissed, counts, omit } = input;
  if (!permissions || !enabledModules || !dismissed) return null;
  if (dismissed.includes(SETUP_CHECKLIST_DISMISS_KEY)) return null;
  const eligible = new Set(
    eligibleSetupLines(permissions, enabledModules, omit),
  );
  const lines: SetupChecklistLine[] = [];
  for (const line of SETUP_CHECKLIST_LINES) {
    if (!eligible.has(line.key)) continue;
    const count = counts[line.key];
    if (count === undefined) return null;
    lines.push({
      key: line.key,
      label: line.label,
      done: count >= line.doneAt,
    });
  }
  const doneCount = lines.filter((line) => line.done).length;
  if (lines.length === 0 || doneCount === lines.length) return null;
  return { lines, doneCount };
}

function lengthOf(data: unknown): number | undefined {
  // Undefined while a list loads, and also after its read fails: either way
  // the selector draws nothing rather than a line it can't vouch for.
  return Array.isArray(data) ? data.length : undefined;
}

function sumOf(...counts: (number | undefined)[]): number | undefined {
  return counts.some((count) => count === undefined)
    ? undefined
    : counts.reduce<number>((total, count) => total + (count ?? 0), 0);
}

/**
 * The checklist for the active chapter, and a way to hide it. A list is read
 * only for a line this viewer can act on, and none once the list is hidden,
 * so a member, or an officer who hid it, costs nothing beyond the reads every
 * screen already makes.
 */
export function useChapterSetupChecklist(options: SetupChecklistOptions = {}): {
  checklist: SetupChecklist | null;
  hide: () => void;
  /**
   * Re-reads every list the checklist counts, for a screen's pull to refresh
   * and for a client that sent the officer to do a step elsewhere.
   */
  refetch: () => Promise<unknown>;
} {
  const { omit } = options;
  const activeChapterId = useActiveChapterId();
  const { data: permissionsPayload } = useMyPermissions();
  const permissions = permissionsPayload?.permissions as
    readonly string[] | undefined;
  const chapterQuery = useCurrentChapter();
  const enabledModules = (
    chapterQuery.data as
      { enabled_modules?: Record<string, boolean> | null } | undefined
  )?.enabled_modules;
  const chaptersQuery = useAccessibleChapters();
  const dismissMutation = useDismissOpsNudge();
  // The chapters hidden in this session, ahead of the server write. Keyed by
  // chapter, because switching chapters doesn't remount the rail.
  const [hiddenHere, setHiddenHere] = useState<readonly string[]>([]);

  const dismissed = useMemo(() => {
    if (!activeChapterId || !Array.isArray(chaptersQuery.data))
      return undefined;
    const membership = (chaptersQuery.data as ChapterMembershipSummary[]).find(
      (m) => m.chapter_id === activeChapterId,
    );
    if (!membership) return undefined;
    return [
      ...(membership.dismissed_ops_nudges ?? []),
      ...(hiddenHere.includes(activeChapterId)
        ? [SETUP_CHECKLIST_DISMISS_KEY]
        : []),
    ];
  }, [activeChapterId, chaptersQuery.data, hiddenHere]);

  const shown =
    dismissed !== undefined && !dismissed.includes(SETUP_CHECKLIST_DISMISS_KEY);
  const eligible = new Set(
    shown ? eligibleSetupLines(permissions, enabledModules, omit) : [],
  );
  // The display roster, which chat already holds, not the full profiles.
  const roster = useChapterRoster();
  const invites = useInvites({ enabled: eligible.has("invite") });
  const events = useEvents({ enabled: eligible.has("event") });
  const zones = useGeofences({ enabled: eligible.has("study-zone") });
  const documents = useDocuments({ enabled: eligible.has("document") });
  // No user id: an officer who can send dues reads the whole chapter's.
  const invoices = useInvoices(undefined, { enabled: eligible.has("dues") });

  const checklist = selectSetupChecklist({
    permissions,
    enabledModules,
    dismissed,
    counts: {
      invite: sumOf(lengthOf(roster.data), lengthOf(invites.data)),
      event: lengthOf(events.data),
      "study-zone": lengthOf(zones.data),
      document: lengthOf(documents.data),
      dues: lengthOf(invoices.data),
    },
    omit,
  });

  // Only the reads that are on: a disabled query's refetch would fire it.
  const reads = [
    [roster, eligible.has("invite")],
    [invites, eligible.has("invite")],
    [events, eligible.has("event")],
    [zones, eligible.has("study-zone")],
    [documents, eligible.has("document")],
    [invoices, eligible.has("dues")],
  ] as const;
  function refetch() {
    return Promise.all(
      reads.filter(([, on]) => on).map(([query]) => query.refetch()),
    );
  }

  function hide() {
    // Hidden at once; the server write is what keeps it hidden next time. A
    // failed write is not rolled back, the same trade the ops nudge makes:
    // the list comes back next load and is hidden again.
    if (activeChapterId) {
      const chapterId = activeChapterId;
      setHiddenHere((prev) => [...prev, chapterId]);
    }
    dismissMutation.mutate(
      { module_key: SETUP_CHECKLIST_DISMISS_KEY },
      { onError: () => {} },
    );
  }

  return { checklist, hide, refetch };
}
