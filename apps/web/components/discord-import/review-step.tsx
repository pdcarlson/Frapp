"use client";

import type { ChannelChoice } from "./channel-mapping-step";
import type { StagedExport } from "./upload-step";
import type { ImportSource } from "./source-step";
import { DEFAULT_SIGNET_ROLE } from "./role-mapping-step";

const ACTION_LABEL: Record<ChannelChoice["action"], string> = {
  create_new: "New channel",
  use_existing: "Merged",
  skip: "Skipped",
};

export function ReviewStep({
  staged,
  source,
  channelChoices,
  roleChoices,
}: {
  staged: StagedExport;
  source: ImportSource;
  channelChoices: Record<string, ChannelChoice>;
  roleChoices: Record<string, string>;
}) {
  const importing = staged.channels.filter(
    (channel) => channelChoices[channel.channelId]?.action !== "skip",
  );

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        The import runs in the background. You can leave this page — progress is
        on the import list when you come back.
        {source === "bot"
          ? " Attachments are copied out of Discord as it goes, so a large server takes a while."
          : ""}
      </p>

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Server</dt>
          <dd className="font-semibold">{staged.guildName ?? "Discord"}</dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">
            {source === "bot" ? "How" : "Files uploaded"}
          </dt>
          <dd className="font-semibold">
            {/* A bot import uploads nothing, so a file count there would read
                as "zero files" rather than "not applicable". */}
            {source === "bot"
              ? "Read from Discord"
              : `${staged.exportCount} export · ${staged.mediaCount} media`}
          </dd>
        </div>
      </dl>

      <div className="rounded-lg border border-border p-3">
        <p className="font-semibold">
          {importing.length} of {staged.channels.length} channels
        </p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {staged.channels.map((channel) => {
            const choice = channelChoices[channel.channelId];
            return (
              <li
                key={channel.channelId}
                className="flex justify-between gap-3"
              >
                <span>#{channel.channelName}</span>
                <span>
                  {choice ? ACTION_LABEL[choice.action] : "Skipped"}
                  {choice?.action === "create_new" && choice.newName
                    ? ` · #${choice.newName}`
                    : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        Everyone imports as {DEFAULT_SIGNET_ROLE.toLowerCase()} —{" "}
        {Object.keys(roleChoices).length > 0
          ? "your role notes are saved for promoting people afterwards."
          : "promote people from Settings → Roles once it finishes."}{" "}
        Imported messages are read-only, never notify anyone, and never count as
        unread. You can delete the whole import later.
      </p>
    </div>
  );
}
