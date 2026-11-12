"use client";

/**
 * The voice prototype's screens (#3866). See `lib/voice/flag.ts`.
 *
 * Three pieces, borrowed from how people already use voice:
 * - `VoiceHeaderButton`: start or join from a channel's header, as a Slack
 *   huddle starts from the conversation's header.
 * - `VoiceRowParticipants`: who is in a channel's room, listed under its row in
 *   the channel list, as Discord lists people under a voice channel.
 * - `VoiceBar`: the connected panel at the bottom of the nav that stays while
 *   you move around the app, with mute and leave, as Discord's voice panel does.
 *
 * Every piece renders nothing unless the prototype flag is on.
 */

import { Headphones, Mic, MicOff, PhoneOff } from "lucide-react";
import { useEffect } from "react";
import { useMemberDisplayNames } from "@repo/hooks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn, initials } from "@/lib/utils";
import { useVoice, type VoiceParticipant } from "@/lib/voice/voice-provider";

function VoiceAvatar({
  participant,
  speaking,
  size = "sm",
}: {
  participant: VoiceParticipant;
  speaking: boolean;
  size?: "sm" | "md";
}) {
  const { nameFor, avatarFor, avatarTintFor } = useMemberDisplayNames();
  const name = nameFor(participant.userId) ?? "Member";
  const avatar = avatarFor(participant.userId);
  return (
    <span className="relative shrink-0" title={name}>
      <Avatar
        className={cn(
          size === "sm" ? "h-6 w-6" : "h-8 w-8",
          // The talking ring: a 2px success ring with a gap, as Discord's green
          // ring sits outside the avatar.
          "ring-offset-2 ring-offset-surface-1 transition-shadow",
          speaking ? "ring-2 ring-success" : "ring-0",
        )}
        aria-hidden="true"
      >
        {avatar ? <AvatarImage src={avatar} alt="" /> : null}
        <AvatarFallback
          className="text-[10px]"
          tint={avatarTintFor(participant.userId)}
        >
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      {participant.muted ? (
        <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-1">
          <MicOff className="h-2.5 w-2.5 text-destructive-text" aria-hidden />
        </span>
      ) : null}
    </span>
  );
}

/** Start or join this channel's voice chat, from its header. */
export function VoiceHeaderButton({
  channelId,
  channelName,
}: {
  channelId: string | null;
  channelName: string;
}) {
  const voice = useVoice();
  const { setViewedChannel } = voice;
  useEffect(() => {
    setViewedChannel(channelId);
  }, [channelId, setViewedChannel]);

  if (!voice.enabled || !channelId) return null;

  const hereIsJoined = voice.joined?.channelId === channelId;
  const others =
    voice.observedChannelId === channelId ? voice.participants : [];

  if (hereIsJoined) {
    return (
      <span className="flex h-8 items-center gap-1.5 rounded-full bg-success-tint px-3 text-label text-success">
        <Headphones className="h-4 w-4" aria-hidden />
        In voice
      </span>
    );
  }
  if (others.length > 0) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="h-8 gap-2 rounded-full"
        onClick={() => void voice.join(channelId, channelName)}
        disabled={voice.status === "connecting"}
      >
        <span className="flex -space-x-1.5">
          {others.slice(0, 3).map((p) => (
            <VoiceAvatar key={p.peerId} participant={p} speaking={false} />
          ))}
        </span>
        <span>
          {others.length} in voice · <span className="font-semibold">Join</span>
        </span>
      </Button>
    );
  }
  return (
    <IconButton
      label="Start a voice chat"
      title={
        voice.joined
          ? `You'll leave voice in #${voice.joined.channelName}`
          : undefined
      }
      onClick={() => void voice.join(channelId, channelName)}
      disabled={voice.status === "connecting"}
      className="h-8 w-8"
    >
      <Headphones className="h-5 w-5" aria-hidden />
    </IconButton>
  );
}

/** Who is in a channel's voice chat, listed under its row. */
export function VoiceRowParticipants({ channelId }: { channelId: string }) {
  const voice = useVoice();
  const { nameFor } = useMemberDisplayNames();
  if (!voice.enabled || voice.observedChannelId !== channelId) return null;
  if (voice.participants.length === 0) return null;
  return (
    <ul
      className="mb-1 ml-6 flex flex-col gap-0.5"
      aria-label={`${voice.participants.length} in voice`}
    >
      {voice.participants.map((p) => (
        <li
          key={p.peerId}
          className="flex h-7 items-center gap-2 px-2 text-sm text-muted-foreground"
        >
          <VoiceAvatar
            participant={p}
            speaking={voice.speaking.has(p.peerId)}
          />
          <span
            className={cn(
              "truncate",
              voice.speaking.has(p.peerId) && "text-foreground",
            )}
          >
            {nameFor(p.userId) ?? "Member"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The connected panel at the bottom of the nav, on every route. */
export function VoiceBar({ collapsed }: { collapsed: boolean }) {
  const voice = useVoice();
  if (!voice.enabled) return null;
  if (!voice.joined) {
    return voice.error ? (
      <p
        role="alert"
        className={cn(
          "mx-2 mb-2 rounded-sm bg-destructive-tint px-3 py-2 text-caption text-destructive-text",
          collapsed && "hidden",
        )}
      >
        {voice.error}
      </p>
    ) : null;
  }

  const roster = voice.participants;
  const waitingForOthers = roster.every((p) => p.peerId === voice.selfPeerId);
  const muteLabel = voice.localMuted ? "Unmute" : "Mute";

  if (collapsed) {
    return (
      <div
        data-voice-bar=""
        className="mx-auto mb-2 flex flex-col items-center gap-1 rounded-md border border-border bg-card p-1"
      >
        <Headphones className="h-4 w-4 text-success" aria-label="In voice" />
        <IconButton label={muteLabel} onClick={voice.toggleMute}>
          {voice.localMuted ? (
            <MicOff className="h-5 w-5 text-destructive-text" aria-hidden />
          ) : (
            <Mic className="h-5 w-5" aria-hidden />
          )}
        </IconButton>
        <IconButton label="Leave voice" onClick={voice.leave}>
          <PhoneOff className="h-5 w-5 text-destructive-text" aria-hidden />
        </IconButton>
      </div>
    );
  }

  return (
    <section
      data-voice-bar=""
      aria-label="Voice chat"
      className="mx-2 mb-2 rounded-md border border-border bg-card p-2"
    >
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-label font-semibold text-success">
            Voice connected
          </span>
          <span className="truncate text-caption text-muted-foreground">
            #{voice.joined.channelName}
          </span>
        </span>
        <IconButton
          label={muteLabel}
          onClick={voice.toggleMute}
          aria-pressed={voice.localMuted}
        >
          {voice.localMuted ? (
            <MicOff className="h-5 w-5 text-destructive-text" aria-hidden />
          ) : (
            <Mic className="h-5 w-5" aria-hidden />
          )}
        </IconButton>
        <IconButton label="Leave voice" onClick={voice.leave}>
          <PhoneOff className="h-5 w-5 text-destructive-text" aria-hidden />
        </IconButton>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {roster.map((p) => (
          <VoiceAvatar
            key={p.peerId}
            participant={p}
            speaking={voice.speaking.has(p.peerId)}
          />
        ))}
        {waitingForOthers ? (
          <span className="text-caption text-muted-foreground">
            Waiting for others to join
          </span>
        ) : null}
      </div>
    </section>
  );
}
