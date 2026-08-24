"use client";

import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";

export type ImportSource = "bot" | "upload";

/**
 * Which way the history gets in.
 *
 * Two genuine options, not a primary and a fallback. Connecting the bot is
 * easier and is offered first when the environment supports it, but the export
 * upload is not deprecated and is not hidden: it is the path that keeps working
 * if Discord ever throttles or refuses one shared bot across every chapter, and
 * it is the only path when a chapter cannot install apps in its own server.
 *
 * Everything downstream is identical either way — the same consent step, the
 * same channel mapping, the same role worksheet, the same delete.
 */
export function SourceStep({
  value,
  onChange,
  botAvailable,
}: {
  value: ImportSource | null;
  onChange: (next: ImportSource) => void;
  botAvailable: boolean;
}) {
  const options: {
    key: ImportSource;
    title: string;
    hint: string;
    detail: string;
    disabled?: boolean;
  }[] = [
    {
      key: "bot",
      title: "Connect Discord",
      hint: "Recommended",
      detail: botAvailable
        ? "Add the Signet bot to your server and we read the history for you. Nothing to download, nothing to upload. You will need the Manage Server permission in Discord."
        : "Not available in this environment. Use the export upload instead — it does the same job.",
      disabled: !botAvailable,
    },
    {
      key: "upload",
      title: "Upload an export",
      hint: "Always works",
      detail:
        "Run DiscordChatExporter on your own machine and upload the result. More steps, but it needs nothing installed in your Discord server.",
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        There are two ways to bring your Discord history into Signet. Both end
        up in the same place, and both ask you the same questions about where
        each channel should land.
      </p>

      <div className="space-y-3">
        {options.map((option) => {
          const selected = value === option.key;
          return (
            <button
              key={option.key}
              type="button"
              disabled={option.disabled}
              aria-pressed={selected}
              onClick={() => onChange(option.key)}
              className={cn(
                "w-full rounded-lg border p-4 text-left transition-colors",
                FOCUS_RING,
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50",
                option.disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{option.title}</span>
                <span className={EYEBROW}>{option.hint}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {option.detail}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
