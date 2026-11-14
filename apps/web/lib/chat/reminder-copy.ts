import { formatRelativeDayTime } from "@repo/formatting";

/**
 * The toast after a reminder is set or snoozed (#4957): "I'll remind you
 * tomorrow at 9:00 AM." Slack confirms its "Remind me about this" the same
 * way, naming when rather than just "Reminder set".
 */
export function reminderSetDescription(
  remindAt: Date,
  now: Date = new Date(),
): string {
  const when = formatRelativeDayTime(remindAt.toISOString(), now);
  if (!when) return "I'll remind you about this message.";
  // "Tomorrow · 9:00 AM" → "tomorrow at 9:00 AM"; a weekday or date keeps
  // its capital.
  const [day = "", clock = ""] = when.split(" · ");
  const lowered = /^(Today|Tomorrow|Yesterday)$/.test(day)
    ? day.toLowerCase()
    : day;
  return `I'll remind you ${lowered} at ${clock}.`;
}
