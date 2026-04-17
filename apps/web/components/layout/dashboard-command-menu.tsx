"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  CircleDollarSign,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  MessagesSquare,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import { useSearch } from "@repo/hooks";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { asArray } from "@/lib/utils";

type DashboardCommandMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const navigationCommands = [
  { icon: LayoutDashboard, label: "Go to Home", shortcut: "G H", href: "/home" },
  { icon: Sparkles, label: "Go to Profile", shortcut: "G P", href: "/profile" },
  { icon: Users, label: "Go to Members", shortcut: "G M", href: "/members" },
  {
    icon: GraduationCap,
    label: "Go to Alumni",
    shortcut: "G A",
    href: "/alumni",
  },
  {
    icon: ShieldCheck,
    label: "Go to Roles",
    shortcut: "G R",
    href: "/roles",
  },
  {
    icon: CalendarDays,
    label: "Go to Events",
    shortcut: "G E",
    href: "/events",
  },
  { icon: Star, label: "Go to Points", shortcut: "G P P", href: "/points" },
  {
    icon: CircleDollarSign,
    label: "Go to Billing",
    shortcut: "G B",
    href: "/billing",
  },
  {
    icon: FileText,
    label: "Go to Reports",
    shortcut: "G X",
    href: "/reports",
  },
  {
    icon: FolderOpen,
    label: "Go to Documents",
    shortcut: "G D",
    href: "/documents",
  },
  {
    icon: BookOpen,
    label: "Go to Service Hours",
    shortcut: "G S",
    href: "/service",
  },
  {
    icon: MessagesSquare,
    label: "Go to Tasks",
    shortcut: "G T",
    href: "/tasks",
  },
  {
    icon: SettingsIcon,
    label: "Go to Settings",
    shortcut: "G ,",
    href: "/settings",
  },
];

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
        href: "/home",
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
        href: "/home",
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
  const searchResults = useSearch(debouncedQuery);

  const groups = useMemo(
    () => (debouncedQuery ? buildSearchGroups(searchResults.data) : []),
    [debouncedQuery, searchResults.data],
  );

  const filteredNavigation = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navigationCommands;
    return navigationCommands.filter((command) =>
      command.label.toLowerCase().includes(q),
    );
  }, [query]);

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
          ) : debouncedQuery ? (
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
                <CommandShortcut>{command.shortcut}</CommandShortcut>
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
