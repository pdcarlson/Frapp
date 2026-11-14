import { formatActedLabel } from "@repo/formatting";

/**
 * The toast after a reminder is set or snoozed (#4957): "I'll remind you
 * tomorrow at 9:00 AM." Slack confirms its "Remind me about this" the same
 * way, naming when rather than just "Reminder set".
 */
export function reminderSetDescription(
  remindAt: Date,
  now: Date = new Date(),
): string {
  const said = formatActedLabel("I'll remind you", remindAt.toISOString(), now);
  return said ? `${said}.` : "I'll remind you about this message.";
}
