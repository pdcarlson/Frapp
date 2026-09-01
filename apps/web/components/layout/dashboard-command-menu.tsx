"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  SEARCH_MIN_QUERY_LENGTH,
  useMyPermissions,
  useOrgConfig,
  useSearch,
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

  const groups = useMemo(
    () => (hasMinQuery ? buildSearchGroups(searchResults.data) : []),
    [hasMinQuery, searchResults.data],
  );

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
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search members, events, backwork, or jump to a route..."
      />
      <CommandList>
        <CommandEmpty>
          {searchResults.isFetching ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching...
            </span>
          ) : debouncedQuery && !hasMinQuery ? (
            `Type at least ${SEARCH_MIN_QUERY_LENGTH} characters to search.`
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
