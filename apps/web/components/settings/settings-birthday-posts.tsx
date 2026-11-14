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
};

/**
 * Settings → Organization → Birthday posts (#4959). On each member's
 * birthday, for members who share theirs with the chapter, Frapp posts
 * "Happy birthday, Name!" in the channel picked here, the way a Discord
 * birthday bot posts where a server admin points it. Off until an officer
 * picks one. Only the chapter's public, live channels are offered; the API
 * refuses anything else.
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
  const channels = ((channelsQuery.data ?? []) as ChannelRow[]).filter(
    (channel): channel is ChannelRow & { id: string; name: string } =>
      !!channel.id &&
      !!channel.name &&
      !channel.archived_at &&
      channel.type === "PUBLIC",
  );
  // A picked channel the list no longer offers still shows as picked, so
  // the control never claims the posts are off when they aren't.
  const known = channelId === null || channels.some((c) => c.id === channelId);

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
          disabled={!canManage || isSaving}
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
            {known || channelId === null ? null : (
              <SelectItem value={channelId}>
                A channel you can&apos;t see
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <p
          id="birthday-channel-hint"
          className="text-caption text-muted-foreground"
        >
          {canManage
            ? "Posts go out from 9 AM in each member's own time zone, once."
            : "Your role can't change this."}
        </p>
      </div>
    </ProfileSection>
  );
}
