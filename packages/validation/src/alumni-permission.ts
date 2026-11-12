// ── Alumni permission ────────────────────────────────────────────────────────

/**
 * The permission the seeded Alumni role holds. Chat no longer reads it: since
 * #3722 an alumnus posts where a channel's who-can-post list (or, when anyone
 * who can see may post, its who-can-see list) names the Alumni role. Mobile
 * still reads it to tell an alumnus apart (`lib/more/donation.ts`).
 */
export const ALUMNI_CHANNEL_PERMISSION = "alumni:post";
