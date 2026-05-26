"use client";

import { useMemo, useState } from "react";
import { Hash, Lock, MessagesSquare, Search, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export interface ChatChannel {
  id: string;
  name: string;
  description?: string | null;
  type: "PUBLIC" | "PRIVATE" | "ROLE_GATED" | "DM" | "GROUP_DM";
  category_id?: string | null;
  is_read_only?: boolean;
  /** Optional, populated by future unread tracking; treated as 0 when missing. */
  unread_count?: number | null;
  muted?: boolean | null;
}

type Section = { key: string; label: string; channels: ChatChannel[] };

const SYSTEM_CHANNEL_NAMES = new Set(["chapter-audit"]);

function isSystem(channel: ChatChannel): boolean {
  return SYSTEM_CHANNEL_NAMES.has(channel.name);
}

function isDm(channel: ChatChannel): boolean {
  return channel.type === "DM" || channel.type === "GROUP_DM";
}

function channelIcon(channel: ChatChannel) {
  if (isSystem(channel)) return ShieldAlert;
  if (isDm(channel)) return MessagesSquare;
  if (channel.type === "PRIVATE" || channel.type === "ROLE_GATED") return Lock;
  return Hash;
}

export interface ChannelListProps {
  channels: ChatChannel[];
  activeChannelId: string | null;
  onPick: (channel: ChatChannel) => void;
}

/**
 * Left-pane channel list. Grouped Channels / DMs / System with a search box.
 * Every row is a `<button>` (client-side open). When the channel set is
 * empty, renders an explicit empty state rather than a blank pane.
 */
export function ChannelList({
  channels,
  activeChannelId,
  onPick,
}: ChannelListProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return channels;
    return channels.filter((channel) =>
      channel.name.toLowerCase().includes(needle),
    );
  }, [channels, query]);

  const sections = useMemo<Section[]>(() => {
    const groups: Record<string, ChatChannel[]> = {
      channels: [],
      dms: [],
      system: [],
    };
    for (const channel of filtered) {
      if (isSystem(channel)) groups.system!.push(channel);
      else if (isDm(channel)) groups.dms!.push(channel);
      else groups.channels!.push(channel);
    }
    for (const list of Object.values(groups)) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return [
      { key: "channels", label: "Channels", channels: groups.channels! },
      { key: "dms", label: "Direct messages", channels: groups.dms! },
      { key: "system", label: "System", channels: groups.system! },
    ];
  }, [filtered]);

  if (channels.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        All caught up — start a channel to begin chatting.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search channels"
          placeholder="Search channels"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 pl-7 text-sm"
        />
      </div>
      {sections.every((section) => section.channels.length === 0) ? (
        <p className="px-2 text-xs text-muted-foreground">
          No matches. Try a different name.
        </p>
      ) : null}
      {sections.map((section) =>
        section.channels.length === 0 ? null : (
          <div key={section.key}>
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.channels.map((channel) => {
                const Icon = channelIcon(channel);
                const isActive = channel.id === activeChannelId;
                const unread = channel.unread_count ?? 0;
                return (
                  <li key={channel.id}>
                    <button
                      type="button"
                      onClick={() => onPick(channel)}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="truncate">{channel.name}</span>
                      {channel.muted ? (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          muted
                        </span>
                      ) : null}
                      {unread > 0 ? (
                        <Badge className="ml-auto h-5 min-w-5 justify-center px-1 text-[10px]">
                          {unread > 99 ? "99+" : unread}
                        </Badge>
                      ) : null}
                      {channel.is_read_only && !channel.muted && unread === 0 ? (
                        <Badge variant="outline" className="ml-auto">
                          Read
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}
