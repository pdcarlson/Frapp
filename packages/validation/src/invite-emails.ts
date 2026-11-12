import { z } from "zod";

/** The most addresses one `POST /v1/invites/email` takes. */
export const MAX_INVITE_EMAILS = 50;

const inviteEmailSchema = z.string().email();

/**
 * Whether `value` is an address `POST /v1/invites/email` accepts. The API's
 * `BulkEmailInviteDto` validates with this same function, so the web chip
 * field marks exactly the addresses the server would refuse.
 */
export function isInviteEmail(value: string): boolean {
  return inviteEmailSchema.safeParse(value.trim()).success;
}

/**
 * Splits pasted or typed text into addresses (a pasted column, a CSV row, a
 * mail client's `Name <a@b.edu>` copy loses its brackets). Web's chip field
 * and mobile's Invite by email field read a draft the same way.
 */
export function splitAddresses(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim().replace(/^<|>$/g, ""))
    .filter(Boolean);
}

/**
 * Case-insensitively de-dupes email addresses, preserving the first-seen
 * casing to send to. Shared between the API (`InviteService.createWithEmails`)
 * and the web onboarding wizard so the two runtimes' notion of "how many
 * unique addresses" can never drift apart.
 */
export function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of emails) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
