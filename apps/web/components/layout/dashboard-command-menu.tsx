"use client";

import { useRouter } from "next/navigation";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  SEARCH_COMPLETED_EVENT,
  SEARCH_MIN_QUERY_LENGTH,
  useMyPermissions,
  useOrgConfig,
  useSearch,
  type SearchSource,
} from "@repo/hooks";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { DASHBOARD_NAV_ITEMS } from "@/components/layout/nav-config";
import { isNavItemVisible } from "@/components/layout/protected-nav-item";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { asArray } from "@/lib/utils";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { AnalyticsContext } from "@/lib/providers/analytics-provider";

type DashboardCommandMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The palette's Navigation group, derived from `nav-config` rather than
 * restated.
 *
 * This used to be a hand-maintained array of thirteen commands, and it had
 * drifted exactly as you would expect: it was missing Polls, Study and Study
 * Zones entirely, and it routed Roles to `/roles` while the sidebar routed it
 * to `/settings?tab=roles` — a discrepancy the test suite had to whitelist.
 * Deriving the list makes that class of drift unrepresentable: there is one
 * nav definition, and the sidebar, the drawer and this palette all read it.
 *
 * The old entries also rendered a shortcut hint (`G C`, `G E`, …) for a
 * `g`-prefix sequence handler that was never built. Advertising a keybinding
 * that does nothing is the dead-end affordance `spec/ui/design-system/components.md`
 * §5 bans, so the hints are gone with the array that carried them. ⌘K itself
 * is real and still opens this palette.
 *
 * Exported so tests can assert the palette and the sidebar stay the same set.
 */
export const navigationCommands = DASHBOARD_NAV_ITEMS.filter(
  (item) => item.href,
).map((item) => ({
  item,
  icon: item.icon,
  label: `Go to ${item.label}`,
  href: item.href as string,
}));

type SearchGroup = {
  heading: string;
  results: Array<{ id: string; label: string; hint?: string; href: string }>;
};

const SOURCE_LABELS: Record<SearchSource, string> = {
  backwork: "Backwork",
  events: "Events",
  members: "Members",
  messages: "Chat",
};

function buildSearchGroups(payload: unknown): SearchGroup[] {
  const bag =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const groups: SearchGroup[] = [];

  type MemberRow = { user_id?: string; display_name?: string | null; email?: string | null };
  const members = asArray<MemberRow>(bag.members);
  if (members.length) {
    groups.push({
      heading: "Members",
      results: members.slice(0, 5).map((row) => ({
        id: `members-${row.user_id ?? row.display_name ?? Math.random()}`,
        label: row.display_name ?? "Unnamed member",
        hint: row.email ?? undefined,
        href: "/members",
      })),
    });
  }

  type EventRow = { id?: string; name?: string; location?: string | null; start_time?: string };
  const events = asArray<EventRow>(bag.events);
  if (events.length) {
    groups.push({
      heading: "Events",
      results: events.slice(0, 5).map((row) => ({
        id: `events-${row.id ?? row.name ?? Math.random()}`,
        label: row.name ?? "Untitled event",
        hint:
          row.start_time && !Number.isNaN(new Date(row.start_time).getTime())
            ? new Date(row.start_time).toLocaleString()
            : row.location ?? undefined,
        href: "/events",
      })),
    });
  }

  type BackworkRow = {
    id?: string;
    title?: string | null;
    course_number?: string | null;
    assignment_type?: string | null;
  };
  const backwork = asArray<BackworkRow>(bag.backwork);
  if (backwork.length) {
    groups.push({
      heading: "Backwork",
      results: backwork.slice(0, 5).map((row) => ({
        id: `backwork-${row.id ?? row.title ?? Math.random()}`,
        label: row.title ?? row.assignment_type ?? "Untitled resource",
        hint: row.course_number ?? undefined,
        href: "/backwork",
      })),
    });
  }

  type MessageRow = {
    id?: string;
    content?: string | null;
    channel_id?: string | null;
  };
  const messages = asArray<MessageRow>(bag.messages);
  if (messages.length) {
    groups.push({
      heading: "Chat",
      results: messages.slice(0, 5).map((row) => ({
        id: `messages-${row.id ?? row.content ?? Math.random()}`,
        label: row.content?.slice(0, 80) ?? "Untitled message",
        hint: row.channel_id ? `Channel ${row.channel_id}` : undefined,
        href: chatDeepLink({ channelId: row.channel_id, messageId: row.id }),
      })),
    });
  }

  return groups;
}

/**
 * Per-domain result counts for search telemetry — the true counts, not the
 * `buildSearchGroups` display slice (capped to 5 per domain for rendering).
 * A separate small function rather than folding into `buildSearchGroups`:
 * that one builds label/href UI structures, this one only needs lengths.
 */
function countSearchResults(payload: unknown): {
  backwork: number;
  events: number;
  members: number;
  messages: number;
  total: number;
} {
  const bag =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const backwork = asArray(bag.backwork).length;
  const events = asArray(bag.events).length;
  const members = asArray(bag.members).length;
  const messages = asArray(bag.messages).length;
  return {
    backwork,
    events,
    members,
    messages,
    total: backwork + events + members + messages,
  };
}

function describeTimeoutNotice(sources: SearchSource[]): string {
  const labels = sources.map((source) => SOURCE_LABELS[source]);
  const list =
    labels.length <= 1
      ? (labels[0] ?? "")
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
  const verb = labels.length > 1 ? "were" : "was";
  return `${list} search ${verb} incomplete — results may be missing.`;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function DashboardCommandMenu({
  open,
  onOpenChange,
}: DashboardCommandMenuProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 200);
  const hasMinQuery = debouncedQuery.length >= SEARCH_MIN_QUERY_LENGTH;
  const searchResults = useSearch(debouncedQuery);

  // Search telemetry (spec/behavior/observability.md § Search Telemetry).
  // `track` is `null` outside `AnalyticsProvider` (tests, or an opted-out
  // chapter) — the call below is a no-op then, same contract as every other
  // `AnalyticsContext` consumer.
  const track = useContext(AnalyticsContext);
  // The debounce settling is when a search attempt actually starts from the
  // member's perspective, so latency is measured from there — arguably more
  // relevant than raw fetch time, since it is what the member experienced as
  // "how long until results appeared."
  const searchStartRef = useRef(0);
  useEffect(() => {
    searchStartRef.current = Date.now();
  }, [debouncedQuery]);
  // `dataUpdatedAt` (not the query string) dedupes: `useSearch` sets
  // `staleTime: 0`, so re-running the identical query in a later session
  // still refetches and must still be tracked — comparing query strings
  // would silently skip that repeat.
  const trackedAtRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!hasMinQuery) return;
    if (searchResults.isFetching) return;
    if (!searchResults.data) return;
    if (searchResults.dataUpdatedAt === trackedAtRef.current) return;
    trackedAtRef.current = searchResults.dataUpdatedAt;

    const counts = countSearchResults(searchResults.data.payload);
    track?.(SEARCH_COMPLETED_EVENT, {
      surface: "command-menu",
      query_length: debouncedQuery.length,
      query_word_count: debouncedQuery.split(/\s+/).filter(Boolean).length,
      backwork_count: counts.backwork,
      events_count: counts.events,
      members_count: counts.members,
      messages_count: counts.messages,
      total_count: counts.total,
      zero_result: counts.total === 0,
      timed_out: searchResults.data.timedOut,
      latency_ms: Date.now() - searchStartRef.current,
    });
  }, [
    hasMinQuery,
    searchResults.isFetching,
    searchResults.data,
    searchResults.dataUpdatedAt,
    debouncedQuery,
    track,
  ]);

  const groups = useMemo(
    () => (hasMinQuery ? buildSearchGroups(searchResults.data?.payload) : []),
    [hasMinQuery, searchResults.data],
  );
  const timedOutSources = searchResults.data?.timedOutSources ?? [];

  // Gating for the command palette (#264). The sidebar hides nav items the
  // caller cannot reach; without this the Cmd+K menu stayed a way around it.
  // Both gates run through the same `isNavItemVisible` the sidebar uses —
  // including its fail-open-while-loading behaviour — so the palette can never
  // offer a route the sidebar is hiding.
  const orgConfig = useOrgConfig();
  const isModuleEnabled = orgConfig.data?.isModuleEnabled;
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data: permissionsPayload } = useMyPermissions({
    enabled: Boolean(activeChapterId),
  });
  const permissions = permissionsPayload?.permissions;

  const filteredNavigation = useMemo(() => {
    const q = query.trim().toLowerCase();
    return navigationCommands.filter((command) => {
      if (!isNavItemVisible(command.item, permissions, isModuleEnabled)) {
        return false;
      }
      if (!q) return true;
      return command.label.toLowerCase().includes(q);
    });
  }, [query, isModuleEnabled, permissions]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) setQuery("");
      }}
      // Every item here is already filtered by its own source — navigation
      // by `filteredNavigation`'s own substring match, search results by the
      // server (which matches via Postgres full-text stemming, not a literal
      // substring). cmdk's own client-side re-filter has no visibility into
      // either and would only risk hiding an item that matched for a reason
      // it can't see.
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search members, events, backwork, or jump to a route..."
      />
      {/*
        Timeout notices (spec/behavior/search.md: the 500ms budget applies per
        source, so a slow chat scan can time out while members, events and
        backwork still return real hits). Two cases need a banner here rather
        than relying on CommandEmpty below:
          - Partial degradation: search groups render, so CommandEmpty never
            mounts to carry the notice itself.
          - Full timeout with a Navigation match: with shouldFilter={false},
            cmdk mounts CommandEmpty only when the *total* item count (nav +
            search groups) is zero — a query that happens to substring-match
            a nav command (e.g. "eve" -> "Go to Events") keeps that count
            above zero even when every search source timed out, so
            CommandEmpty's own timeout copy would silently never render.
        A query that reaches neither case (no nav match, no search groups)
        still gets its timeout copy from CommandEmpty, unchanged below.
      */}
      {hasMinQuery && !searchResults.isFetching && groups.length > 0 && timedOutSources.length > 0 ? (
        <div className="border-b border-border px-3 py-2 text-[12.5px] text-muted-foreground">
          {describeTimeoutNotice(timedOutSources)}
        </div>
      ) : hasMinQuery &&
        !searchResults.isFetching &&
        groups.length === 0 &&
        filteredNavigation.length > 0 &&
        searchResults.data?.timedOut ? (
        <div className="border-b border-border px-3 py-2 text-[12.5px] text-muted-foreground">
          {timedOutSources.length > 0
            ? describeTimeoutNotice(timedOutSources)
            : "Search timed out — try a shorter query or try again."}
        </div>
      ) : null}
      <CommandList>
        <CommandEmpty>
          {searchResults.isFetching ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching...
            </span>
          ) : debouncedQuery && !hasMinQuery ? (
            `Type at least ${SEARCH_MIN_QUERY_LENGTH} characters to search.`
          ) : hasMinQuery && searchResults.data?.timedOut ? (
            "Search timed out — try a shorter query or try again."
          ) : hasMinQuery ? (
            "No matches across chapter data."
          ) : (
            "No matching commands."
          )}
        </CommandEmpty>
        {filteredNavigation.length ? (
          <CommandGroup heading="Navigation">
            {filteredNavigation.map((command) => (
              <CommandItem
                key={command.href}
                onSelect={() => {
                  router.push(command.href);
                  onOpenChange(false);
                  setQuery("");
                }}
              >
                <command.icon className="h-4 w-4" />
                <span>{command.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.results.map((result) => (
              <CommandItem
                key={result.id}
                onSelect={() => {
                  router.push(result.href);
                  onOpenChange(false);
                  setQuery("");
                }}
              >
                <span>{result.label}</span>
                {result.hint ? (
                  <CommandShortcut>{result.hint}</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
