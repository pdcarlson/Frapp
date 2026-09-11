"use client";

import { cn } from "@/lib/utils";
import type { ChatNotificationLevel } from "@repo/hooks";

/**
 * Per-channel notification level (#296), rendered as the "Notifications" view
 * of the channel overflow menu (`channel-menu.tsx`). The menu owns the popover,
 * its trigger and the dismissal, so this file is content only.
 *
 * **Why the header and not the channel row.** The row in `channel-list.tsx` is
 * a single `<button>`; a mute control inside it would be a nested button, which
 * is invalid HTML and does not receive clicks reliably. The alternative —
 * revealing it on row hover — is exactly the defect #1193 tracks for message
 * actions: hover-only controls are unreachable on touch. The header has room,
 * is unambiguous about which channel it acts on, and is where Slack and Discord
 * both put this. The row keeps its `muted` indicator, which this finally
 * populates.
 *
 * The three levels are the schema's, not an invention
 * (`chat_notification_preferences.level`).
 *
 * **`level` is the EFFECTIVE level, resolved server-side.** It is not "the
 * stored row, else `mentions`": `defaultLevelFor` sends `#announcements` to
 * `all` and `#chapter-audit` to `off`, so a client-side `mentions` assumption
 * misreported exactly the channels members most want to turn down — and the
 * no-op guard below then swallowed the corrective click. The server resolves
 * the default so this component never has to know one.
 *
 * **The state line and the lock are behaviour, not chrome.** The trigger this
 * panel replaces named the current level in its `aria-label` ("Notifications:
 * muted"), so a screen reader user learned the channel was muted without
 * opening anything, and it was `disabled` whenever no channel was active or the
 * level was unknown. Neither could simply be dropped: the name is now a line of
 * copy at the top of the panel, and the refusal now disables the three option
 * controls, so an unknown level still cannot be read as a real one or be
 * overwritten by a stray click.
 */

const OPTIONS: {
  level: ChatNotificationLevel;
  label: string;
  description: string;
}[] = [
  {
    level: "all",
    label: "Every message",
    description: "Notify me whenever anyone posts here.",
  },
  {
    level: "mentions",
    label: "Only @mentions",
    // Not labelled "the default" any more: it is the default for ordinary
    // channels but not for #announcements (`all`) or #chapter-audit (`off`),
    // and the panel is shown on those too.
    description: "Notify me when someone addresses me.",
  },
  {
    level: "off",
    label: "Mute",
    description: "No notifications — but @mentions still reach you.",
  },
];

// The words the deleted trigger's `aria-label` used for each level. The panel
// states the same thing now that there is no trigger left to carry it.
const CURRENT_LABEL: Record<ChatNotificationLevel, string> = {
  all: "every message",
  mentions: "only @mentions",
  off: "muted",
};

export function NotificationLevelPanel({
  level,
  onChange,
  disabled,
  isSaving,
}: {
  /**
   * The channel's server-resolved EFFECTIVE level (stored row, else the
   * channel's default), or `null` when it is not known yet. `null` renders a
   * neutral, disabled panel: a `mentions` stand-in would state a level, and
   * stating the wrong one is the defect this whole change exists to remove.
   */
  level: ChatNotificationLevel | null;
  onChange: (level: ChatNotificationLevel) => void;
  disabled?: boolean;
  isSaving?: boolean;
}) {
  const unknown = level === null;
  // No channel to act on, or no level read yet: there is nothing to change, and
  // components.md §5 bans a control that silently no-ops.
  const locked = disabled || unknown;

  return (
    <>
      <div className="border-b border-border px-3 py-3">
        <p className="text-[12.5px] text-foreground">
          {unknown
            ? "Notification level unavailable"
            : `Notifications: ${CURRENT_LABEL[level]}`}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {OPTIONS.map((option) => {
          const selected = option.level === level;
          return (
            <li key={option.level}>
              <button
                type="button"
                disabled={isSaving || locked}
                aria-current={selected ? "true" : undefined}
                onClick={() => {
                  // Nothing here waits on the write. An earlier revision kept
                  // the menu open until it landed so a failure had somewhere to
                  // render; that made dismissal depend on an `isPending`
                  // transition, which never arrived while TanStack PAUSED the
                  // mutation offline — the menu froze with every option
                  // disabled and no explanation, on a surface that is
                  // explicitly offline-capable.
                  //
                  // #1707 fixed that pause provider-wide (`query-provider.tsx`
                  // now rejects offline writes rather than parking them), so
                  // that specific hang can no longer happen. The lesson still
                  // holds either way: the failure is reported in the channel
                  // header, which does not unmount, and dismissal is the
                  // overflow menu's business rather than this panel's.
                  if (!selected) onChange(option.level);
                }}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                  selected
                    ? "bg-accent-subtle text-accent-text"
                    : "text-foreground hover:bg-card",
                )}
              >
                <span className="text-[14.5px] font-semibold">
                  {option.label}
                </span>
                <span
                  className={cn(
                    "text-[12.5px]",
                    selected ? "text-accent-text" : "text-muted-foreground",
                  )}
                >
                  {option.description}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
