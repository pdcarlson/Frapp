"use client";

import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";

/**
 * The compliance step.
 *
 * A deliberate friction point, not a technical control — Signet cannot verify
 * that a notice was posted in someone else's Discord server, and pretending
 * otherwise would be worse than asking plainly. What makes it more than a
 * decorative checkbox is where the answer goes: the API refuses to create an
 * import without it and `discord_imports.consent_acknowledged_at` is NOT NULL,
 * so there is no import anywhere in the system that skipped this screen.
 */
export function ConsentStep({
  acknowledged,
  onChange,
}: {
  acknowledged: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Importing brings your Discord history into Signet, where every member of
        your chapter can read and search it. Some of those messages were written
        years ago by people who are no longer around, and none of them were
        written with this in mind.
      </p>
      <p className="text-sm text-muted-foreground">
        Before you export, post a notice in your Discord server saying the
        history is being archived into Signet, and give people a chance to
        object. Signet cannot check that you did — this is on you.
      </p>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
        <span className={dashboardCheckboxHitAreaClassName}>
          <input
            type="checkbox"
            className={dashboardTableCheckboxClassName}
            checked={acknowledged}
            onChange={(event) => onChange(event.target.checked)}
          />
        </span>
        <span>
          I have posted a notice in our Discord server telling members their
          message history is being archived into Signet.
        </span>
      </label>
    </div>
  );
}
