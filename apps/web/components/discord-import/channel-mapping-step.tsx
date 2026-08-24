"use client";

import { useChannels } from "@repo/hooks";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { dashboardFormSelectClassName } from "@/components/shared/table-controls";
import type { StagedChannel } from "./upload-step";

export interface ChannelChoice {
  action: "create_new" | "use_existing" | "skip";
  targetChannelId?: string;
  newName?: string;
  readOnly?: boolean;
}

const ACTIONS: { key: ChannelChoice["action"]; label: string; hint: string }[] =
  [
    { key: "create_new", label: "New channel", hint: "Create it in Signet" },
    { key: "use_existing", label: "Existing channel", hint: "Merge into one" },
    { key: "skip", label: "Skip", hint: "Do not import" },
  ];

/**
 * Where each Discord channel lands — asked, never inferred.
 *
 * `chat_channels` has no unique constraint on `(chapter_id, name)`, so a
 * same-name Signet channel is not evidence of anything: merging into it is a
 * decision only the admin can make, and guessing wrong silently interleaves a
 * decade of Discord history into a live channel. Every row starts with no
 * selection and the step cannot be advanced until all of them have one.
 */
export function ChannelMappingStep({
  channels,
  choices,
  onChange,
}: {
  channels: StagedChannel[];
  choices: Record<string, ChannelChoice>;
  onChange: (next: Record<string, ChannelChoice>) => void;
}) {
  const existingChannels = useChannels();

  function setChoice(channelId: string, patch: Partial<ChannelChoice>) {
    const current = choices[channelId] ?? { action: "skip" };
    onChange({ ...choices, [channelId]: { ...current, ...patch } });
  }

  if (channels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No channels were found in that export. Check that you exported in JSON
        format.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Signet will not guess. Choose what happens to each channel — a
        same-named Signet channel is not treated as an answer.
      </p>

      <div className="space-y-3">
        {channels.map((channel) => {
          const choice = choices[channel.channelId];
          return (
            <div
              key={channel.channelId}
              className="space-y-3 rounded-lg border border-border p-3"
            >
              <div>
                <span className={cn(EYEBROW, "text-muted-foreground")}>
                  {channel.category ?? "Channels"}
                </span>
                <p className="text-sm font-semibold">#{channel.channelName}</p>
              </div>

              <div
                role="radiogroup"
                aria-label={`Where #${channel.channelName} should go`}
                className="grid grid-cols-3 gap-2"
              >
                {ACTIONS.map((action) => {
                  const isActive = choice?.action === action.key;
                  return (
                    <button
                      key={action.key}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      onClick={() =>
                        setChoice(channel.channelId, { action: action.key })
                      }
                      className={cn(
                        "flex flex-col gap-0.5 rounded-lg border p-2 text-left transition",
                        FOCUS_RING,
                        isActive
                          ? "border-accent-border bg-accent-subtle-hover text-accent-text"
                          : "border-border hover:bg-accent-subtle",
                      )}
                    >
                      <span className="text-sm font-semibold">
                        {action.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {action.hint}
                      </span>
                    </button>
                  );
                })}
              </div>

              {choice?.action === "create_new" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor={`new-name-${channel.channelId}`}>
                    New channel name
                  </Label>
                  <Input
                    id={`new-name-${channel.channelId}`}
                    value={choice.newName ?? ""}
                    placeholder={channel.channelName}
                    onChange={(event) =>
                      setChoice(channel.channelId, {
                        newName: event.target.value,
                      })
                    }
                  />
                </div>
              ) : null}

              {choice?.action === "use_existing" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor={`target-${channel.channelId}`}>
                    Merge into
                  </Label>
                  <select
                    id={`target-${channel.channelId}`}
                    className={dashboardFormSelectClassName}
                    value={choice.targetChannelId ?? ""}
                    onChange={(event) =>
                      setChoice(channel.channelId, {
                        targetChannelId: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Pick a channel…</option>
                    {(
                      (existingChannels.data ?? []) as {
                        id: string;
                        name: string;
                      }[]
                    ).map((existing) => (
                      <option key={existing.id} value={existing.id}>
                        #{existing.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
