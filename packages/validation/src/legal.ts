// ── Legal / compliance ───────────────────────────────────────────────────────
// The policy version itself is the API's (`apps/api/src/domain/constants/
// legal.ts`, #3268): clients never compare against it.

/**
 * The checkbox every acceptance surface shows: the create-chapter wizard, the
 * join screens and the Terms prompt, on web and mobile. The owner approved this
 * wording with the Terms of 2026-09 (#2261), so change it only with them, and
 * with the Terms.
 */
export const LEGAL_ACCEPTANCE_LABEL =
  "I'm 18 or older and agree to the Terms of Service and Privacy Policy.";

/**
 * The youngest a member may be (#2261). Paul chose 17 on 2026-11-19, with
 * Frapp AI asking anyone who opens it to confirm they're 18 (Google Cloud's
 * terms bar generative AI in services for people under 18, ADR-28). The two
 * ship together in #5627, so this stays 18 until that check exists.
 */
export const MINIMUM_AGE = 18;

/**
 * The one line under the join screens' buttons that replaced the checkbox
 * (#5625, Paul 2026-11-19: "one line under the sign-in buttons, no
 * checkbox"), the way Discord's and Slack's invite pages read. In pieces, so
 * each app can make "Terms" and "Privacy Policy" links while the words stay
 * these. Tapping a button under it is the acceptance, so every join from a
 * screen showing it sends `accept_terms_privacy`.
 */
export function termsLine(action: "continuing" | "joining") {
  return {
    lead: `By ${action} you agree to the `,
    terms: "Terms",
    middle: " and ",
    privacy: "Privacy Policy",
    tail: ` and confirm you're ${MINIMUM_AGE} or older.`,
  } as const;
}

/** The line as plain text, for an accessibility label or a test. */
export function termsLineText(action: "continuing" | "joining"): string {
  const line = termsLine(action);
  return `${line.lead}${line.terms}${line.middle}${line.privacy}${line.tail}`;
}

/**
 * The 403 the API answers with when a caller who hasn't accepted the current
 * Terms tries to join or create a chapter without the checkbox (#2302). It
 * throws both; `isTermsRequiredError` in `@repo/hooks` recognises either.
 *
 * The message matters as much as the code. Clients read the code first, but
 * an API older than #1020 sent none, so the message is the fallback, and it
 * is shared from here so the server and both apps can't drift apart on it.
 */
export const LEGAL_ACCEPTANCE_REQUIRED_CODE = "legal.acceptance_required";
export const LEGAL_ACCEPTANCE_REQUIRED_MESSAGE =
  "Agree to the Terms of Service and Privacy Policy to continue.";

/**
 * The join screens' copy when the box isn't ticked, or when the server refused
 * a join for want of it (#2302). Web `/join` and mobile s02 both render it;
 * `spec/ui/design-system/writing.md` § 7, Join chapter, is its spec.
 */
export const JOIN_TERMS_REQUIRED_COPY =
  "Agree to the Terms of Service and Privacy Policy to join.";

/**
 * The Terms prompt's copy (#2302), rendered by mobile `(auth)/terms.tsx` and
 * web's `TermsPrompt`. `spec/ui/design-system/writing.md` § 7, Terms prompt,
 * is its spec.
 */
export const TERMS_PROMPT_COPY = {
  title: "Agree to the Terms to continue",
  body: "We've updated the Terms of Service and Privacy Policy. Read them, then agree to keep using Frapp.",
  cta: "Agree and continue",
  unticked: "Agree to the Terms of Service and Privacy Policy to continue.",
  deleted: "This account has been deleted. Sign out to continue.",
  failed: "Couldn't save your agreement. Check your connection and try again.",
} as const;
