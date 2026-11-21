"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { formatDayHeading, formatTimeOfDay } from "@repo/formatting";
import {
  CHAPTER_LOG_KINDS,
  CHAPTER_LOG_WINDOWS,
  chapterLogChanges,
  chapterLogChangeText,
  chapterLogPhrase,
  chapterLogSubject,
  chapterLogTargetUserId,
  chapterLogWindowStart,
  type ChapterLogKind,
} from "@repo/validation";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { actorLabel, type NameResolver } from "./display-names";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * The chapter's Logs (Paul, 2026-11-21), web and phone: `GET /v1/audit-log`
 * paged newest first, and one shared reading of each row so both apps draw
 * the same line. `spec/behavior/settings/README.md` § Logs.
 */
export type ChapterLogEntry = components["schemas"]["ChapterAuditLogEntryDto"];

const chapterLogKeys = createChapterQueryKeys("chapter-logs");

/** The value a filter row takes for "no filter". */
export const CHAPTER_LOG_ANY = "any";

export type ChapterLogFilters = {
  /** A Logs kind, or {@link CHAPTER_LOG_ANY}. */
  kind: string;
  /** A member's `users.id`, or {@link CHAPTER_LOG_ANY}. */
  person: string;
  /** A window from `CHAPTER_LOG_WINDOWS`, or {@link CHAPTER_LOG_ANY}. */
  when: string;
};

export const CHAPTER_LOG_NO_FILTERS: ChapterLogFilters = {
  kind: CHAPTER_LOG_ANY,
  person: CHAPTER_LOG_ANY,
  when: CHAPTER_LOG_ANY,
};

const PAGE_SIZE = 50;

/**
 * The chapter's log, newest first, a page of 50 at a time. Only for a viewer
 * who holds `chapter-config:view` and `members:view`, which the route
 * requires; pass `enabled: false` otherwise.
 */
export function useChapterLogs(
  filters: ChapterLogFilters,
  options?: { enabled?: boolean },
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useInfiniteQuery({
    queryKey: chapterLogKeys.list(chapterId ?? "", filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      // Counted back from the moment the list is read, so a page loaded later
      // keeps the window the first one used.
      const startDate =
        filters.when === CHAPTER_LOG_ANY
          ? undefined
          : chapterLogWindowStart(filters.when);
      const { data, error } = await client.GET("/v1/audit-log", {
        signal,
        params: {
          query: {
            limit: PAGE_SIZE,
            ...(pageParam ? { before: pageParam } : {}),
            ...(filters.kind !== CHAPTER_LOG_ANY
              ? { kind: filters.kind as ChapterLogKind }
              : {}),
            ...(filters.person !== CHAPTER_LOG_ANY
              ? { actor_user_id: filters.person }
              : {}),
            ...(startDate ? { start_date: startDate } : {}),
          },
        },
      });
      if (error) throw error;
      return data ?? [];
    },
    getNextPageParam: (last) =>
      last.length < PAGE_SIZE ? undefined : last[last.length - 1]?.created_at,
    staleTime: 30_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/** One entry as both apps draw it. */
export type ChapterLogRow = {
  id: string;
  /** Who did it: a member's name, "Frapp" for the system, or `null`. */
  actor: string | null;
  /** What they did: "added a role". */
  phrase: string;
  /** What it was done to, when the row names it: "On Campus", a member's name. */
  subject: string | null;
  /** The fields it changed, as lines: "name: Old → New". */
  changes: string[];
  /** The time of day it happened: "2:32 PM". */
  time: string;
  createdAt: string;
};

export function chapterLogRow(
  entry: ChapterLogEntry,
  nameFor: NameResolver,
): ChapterLogRow {
  const diff = entry.diff ?? {};
  const targetUser = chapterLogTargetUserId({ ...entry, diff });
  const subject =
    (targetUser ? actorLabel(targetUser, nameFor) : null) ??
    chapterLogSubject(diff);
  return {
    id: entry.id,
    actor: actorLabel(entry.actor_user_id, nameFor),
    phrase: chapterLogPhrase(entry.action),
    subject,
    changes: chapterLogChanges(diff).map(chapterLogChangeText),
    time: formatTimeOfDay(entry.created_at),
    createdAt: entry.created_at,
  };
}

/** Rows grouped under their day heading ("Today", "November 14"), newest first. */
export function groupChapterLogRows(
  rows: readonly ChapterLogRow[],
  now: Date = new Date(),
): { day: string; rows: ChapterLogRow[] }[] {
  const groups: { day: string; rows: ChapterLogRow[] }[] = [];
  for (const row of rows) {
    const day = formatDayHeading(row.createdAt, now) ?? "";
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
}

/** A filter row's options, the same on web's Filter menu and the phone's sheet. */
export type ChapterLogFilterRow = {
  key: keyof ChapterLogFilters;
  label: string;
  options: { value: string; label: string }[];
};

/**
 * The three filter rows in their order: Kind, Person, When. `people` is the
 * roster, sorted by name here; the person row lists every member, since an
 * officer looks for one by name (the menu searches past a handful).
 */
export function chapterLogFilterRows(
  people: readonly { user_id: string; display_name: string }[],
): ChapterLogFilterRow[] {
  return [
    {
      key: "kind",
      label: "Kind",
      options: [
        { value: CHAPTER_LOG_ANY, label: "Any kind" },
        ...CHAPTER_LOG_KINDS.map((k) => ({ value: k.value, label: k.label })),
      ],
    },
    {
      key: "person",
      label: "Person",
      options: [
        { value: CHAPTER_LOG_ANY, label: "Anyone" },
        ...[...people]
          .sort((a, b) => a.display_name.localeCompare(b.display_name))
          .map((p) => ({ value: p.user_id, label: p.display_name })),
      ],
    },
    {
      key: "when",
      label: "When",
      options: [
        { value: CHAPTER_LOG_ANY, label: "Any time" },
        ...CHAPTER_LOG_WINDOWS.map((w) => ({ value: w.value, label: w.label })),
      ],
    },
  ];
}
