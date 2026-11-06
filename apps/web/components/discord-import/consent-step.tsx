"use client";

import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { useCopyToClipboard } from "@/lib/hooks/use-copy-to-clipboard";

/**
 * The notice an officer pastes into their Discord server.
 *
 * Written for the members who will read it, not for the officer: what is
 * happening, who will be able to read it, and what to do if they object. It
 * names no date because Frapp doesn't know when the officer will run the
 * export, and no chapter because the server already is the chapter. "The
 * same people" is what the import keeps: nothing private in Discord becomes
 * readable by the whole chapter by default (spec/behavior/chat/README.md).
 */
export const DISCORD_NOTICE =
  "Heads up: we're moving this server's message history into Frapp, our " +
  "chapter's new app. Old messages come along, and each channel stays " +
  "readable by the same people who can read it here. If there's anything " +
  "you posted that you'd rather not carry over, delete it or tell an " +
  "officer before we move it.";

/**
 * The compliance step.
 *
 * A deliberate friction point, not a technical control — Frapp cannot verify
 * that a notice was posted in someone else's Discord server, and pretending
 * otherwise would be worse than asking plainly. What makes it more than a
 * decorative checkbox is where the answer goes: the API refuses to create an
 * import without it and `discord_imports.consent_acknowledged_at` is NOT NULL,
 * so there is no import anywhere in the system that skipped this screen.
 *
 * The step used to explain all of that in two paragraphs, and nobody read
 * them (owner, 2026-11-06). It now asks for one thing and hands over the means
 * to do it: one line, the notice ready to copy, and the box. The reasons live
 * in the notice itself, where the members who need them will read them.
 */
export function ConsentStep({
  acknowledged,
  onChange,
}: {
  acknowledged: boolean;
  onChange: (next: boolean) => void;
}) {
  const { copied, copy } = useCopyToClipboard(
    "Select the message and copy it manually.",
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Post this in your Discord, then give members time to respond before you
        export.
      </p>

      <figure className="rounded-lg border border-border bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 pl-3 pr-1.5">
          <figcaption className="text-xs font-medium text-muted-foreground">
            Message for your server
          </figcaption>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => copy(DISCORD_NOTICE)}
            aria-label={copied ? "Message copied" : "Copy message"}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="select-text p-3 text-sm leading-relaxed text-foreground">
          {DISCORD_NOTICE}
        </p>
      </figure>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
        <span className={dashboardCheckboxHitAreaClassName}>
          <input
            type="checkbox"
            className={dashboardTableCheckboxClassName}
            checked={acknowledged}
            onChange={(event) => onChange(event.target.checked)}
          />
        </span>
        <span>I posted it in our Discord server.</span>
      </label>
    </div>
  );
}
