"use client";

import { useMemo, useState } from "react";
import { can, SETUP_CHECKLIST_DISMISS_KEY } from "@repo/validation";
import {
  useAccessibleChapters,
  useCurrentChapter,
  type ChapterMembershipSummary,
} from "./use-chapters";
import { useDismissOpsNudge, useMembers } from "./use-members";
import { useEvents } from "./use-events";
import { useGeofences } from "./use-study";
import { useDocuments } from "./use-documents";
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
 * chapter has on. The list goes away when every line it shows is done, or when
 * the officer hides it (stored per user per chapter beside the ops nudges).
 *
 * The data is plain counts so both clients share the rule, and each client
 * maps a line's `key` to its own route.
 */

export type SetupChecklistKey =
  "invite" | "event" | "study-zone" | "document" | "dues";

interface SetupChecklistDefinition {
  key: SetupChecklistKey;
  label: string;
  /** The permission the line's action needs. */
  permission: string;
  /** The module the line belongs to, or null for one that is always on. */
  module: string | null;
  /** How many items make the line done. Invite counts the officer too. */
  doneAt: number;
}

/** In the order an officer usually does them. */
export const SETUP_CHECKLIST_LINES: readonly SetupChecklistDefinition[] = [
  {
    key: "invite",
    label: "Invite members",
    permission: "members:invite",
    module: null,
    doneAt: 2,
  },
  {
    key: "event",
    label: "Schedule the first event",
    permission: "events:create",
    module: "events",
    doneAt: 1,
  },
  {
    key: "study-zone",
    label: "Add a study zone",
    permission: "geofences:manage",
    module: "hours",
    doneAt: 1,
  },
  {
    key: "document",
    label: "Upload the bylaws",
    permission: "chapter_docs:upload",
    module: "documents",
    doneAt: 1,
  },
  {
    key: "dues",
    label: "Send the first dues",
    permission: "billing:manage",
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
}

/** The lines this viewer can act on, before any list has loaded. */
export function eligibleSetupLines(
  permissions: readonly string[] | undefined,
  enabledModules: Record<string, boolean> | null | undefined,
): SetupChecklistKey[] {
  if (!permissions || !enabledModules) return [];
  return SETUP_CHECKLIST_LINES.filter(
    (line) =>
      can(line.permission, permissions) &&
      // The repo-wide contract: a module is on unless it is explicitly `false`.
      (line.module === null || enabledModules[line.module] !== false),
  ).map((line) => line.key);
}

/**
 * The checklist to draw, or null for none: nothing this viewer can do, every
 * line done, hidden, or still loading (so it never flashes in half-checked).
 */
export function selectSetupChecklist(
  input: SetupChecklistInput,
): SetupChecklist | null {
  const { permissions, enabledModules, dismissed, counts } = input;
  if (!permissions || !enabledModules || !dismissed) return null;
  if (dismissed.includes(SETUP_CHECKLIST_DISMISS_KEY)) return null;
  const eligible = new Set(eligibleSetupLines(permissions, enabledModules));
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
  return Array.isArray(data) ? data.length : undefined;
}

/**
 * The checklist for the active chapter, and a way to hide it. Each list is
 * read only when its line is one this viewer can act on, so a member costs
 * the two reads every screen already makes and nothing else.
 */
export function useChapterSetupChecklist(): {
  checklist: SetupChecklist | null;
  hide: () => void;
} {
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
  const [hiddenHere, setHiddenHere] = useState(false);

  const eligible = new Set(eligibleSetupLines(permissions, enabledModules));
  const members = useMembers({ enabled: eligible.has("invite") });
  const events = useEvents({ enabled: eligible.has("event") });
  const zones = useGeofences({ enabled: eligible.has("study-zone") });
  const documents = useDocuments({ enabled: eligible.has("document") });
  // No user id: an officer who can send dues reads the whole chapter's.
  const invoices = useInvoices(undefined, { enabled: eligible.has("dues") });

  const dismissed = useMemo(() => {
    if (!activeChapterId || !Array.isArray(chaptersQuery.data))
      return undefined;
    const membership = (chaptersQuery.data as ChapterMembershipSummary[]).find(
      (m) => m.chapter_id === activeChapterId,
    );
    if (!membership) return undefined;
    return [
      ...(membership.dismissed_ops_nudges ?? []),
      ...(hiddenHere ? [SETUP_CHECKLIST_DISMISS_KEY] : []),
    ];
  }, [activeChapterId, chaptersQuery.data, hiddenHere]);

  const checklist = selectSetupChecklist({
    permissions,
    enabledModules,
    dismissed,
    counts: {
      invite: lengthOf(members.data),
      event: lengthOf(events.data),
      "study-zone": lengthOf(zones.data),
      document: lengthOf(documents.data),
      dues: lengthOf(invoices.data),
    },
  });

  function hide() {
    // Hidden for this session at once; the server write is what keeps it
    // hidden next time. A failed write is not rolled back, the same trade the
    // ops nudge makes: the list comes back next load and is hidden again.
    setHiddenHere(true);
    dismissMutation.mutate(
      { module_key: SETUP_CHECKLIST_DISMISS_KEY },
      { onError: () => {} },
    );
  }

  return { checklist, hide };
}
