"use client";

import { useChannels } from "@repo/hooks";
import { ProfileSection } from "@/components/profile/profile-section";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The Select's value for "no channel": Radix refuses an empty string. */
const OFF = "off";

type ChannelRow = {
  id?: string;
  name?: string;
  type?: string;
  archived_at?: string | null;
  is_audit_log?: boolean;
};

/**
 * Whether a channel can take the birthday posts: the chapter's public,
 * unarchived channels, never the audit feed. The API's check
 * (`isBirthdayPostChannel`) refuses anything else.
 */
export function offersBirthdayPosts(
  channel: ChannelRow,
): channel is ChannelRow & { id: string; name: string } {
  return (
    !!channel.id &&
    !!channel.name &&
    !channel.archived_at &&
    !channel.is_audit_log &&
    channel.type === "PUBLIC"
  );
}

/**
 * Settings → Chapter → Birthday posts (#4959). On each member's birthday,
 * for members who share theirs with the chapter, Frapp posts "Happy birthday,
 * Name!" in the channel picked here, the way a Discord birthday bot posts
 * where a server admin points it. Off until an officer picks one.
 */
export function SettingsBirthdayPosts({
  channelId,
  canManage,
  isSaving,
  onChange,
}: {
  channelId: string | null;
  canManage: boolean;
  isSaving: boolean;
  onChange: (channelId: string | null) => void;
}) {
  const channelsQuery = useChannels();
  const rows = (channelsQuery.data ?? []) as ChannelRow[];
  const channels = rows.filter(offersBirthdayPosts);
  const loaded = channelsQuery.data !== undefined;
  // A saved channel the list no longer offers (archived, made private, gone)
  // still shows as picked, and says the posts are paused, since the sweep
  // skips it. Only once the list has loaded: before then it isn't known.
  const paused =
    loaded && channelId !== null && !channels.some((c) => c.id === channelId);
  const pausedName = rows.find((c) => c.id === channelId)?.name;

  return (
    <ProfileSection
      id="settings-birthday-posts"
      title="Birthday posts"
      hint="Frapp wishes members a happy birthday on the day, if they share their birthday with the chapter."
    >
      <div className="grid max-w-sm gap-2">
        <Label htmlFor="birthday-channel">Post in</Label>
        <Select
          value={channelId ?? OFF}
          disabled={!canManage || isSaving || !loaded}
          onValueChange={(next) => onChange(next === OFF ? null : next)}
        >
          <SelectTrigger
            id="birthday-channel"
            aria-describedby="birthday-channel-hint"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OFF}>Off</SelectItem>
            {channels.map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                #{channel.name}
              </SelectItem>
            ))}
            {paused && channelId !== null ? (
              <SelectItem value={channelId}>
                {pausedName ? `#${pausedName}` : "A removed channel"} (paused)
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <p
          id="birthday-channel-hint"
          className="text-caption text-muted-foreground"
        >
          {channelsQuery.isError && !loaded
            ? "Couldn't load the channels. Reload the page to change this."
            : paused
              ? "Paused: that channel can't take them now. Pick another, or turn them off."
              : canManage
                ? "Posts go out from 9 AM in each member's own time zone, once."
                : "Your role can't change this."}
        </p>
      </div>
    </ProfileSection>
  );
}
