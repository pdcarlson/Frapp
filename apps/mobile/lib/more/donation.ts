/**
 * Whether the "Support the Chapter" CTA should render (`spec/behavior/alumni.md`
 * § Donation Link).
 *
 * `alumni:post` is seeded on the Alumni system role alone
 * (`DEFAULT_SYSTEM_ROLES` in `apps/api/src/domain/constants/permissions.ts`),
 * so holding it is the only alumni signal this client can read — the API
 * exposes the caller's effective permissions, not role identity.
 */
import { ALUMNI_CHANNEL_PERMISSION, can } from "@repo/validation";

export function shouldShowDonationCta(
  permissions: readonly string[],
  donationUrl: string | null | undefined,
): donationUrl is string {
  return !!donationUrl && can(ALUMNI_CHANNEL_PERMISSION, permissions);
}
