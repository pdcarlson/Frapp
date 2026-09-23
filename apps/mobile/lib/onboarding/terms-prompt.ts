import { statusOf } from "@repo/api-sdk";

/**
 * Copy for the Terms prompt (#2302). The strings are shared verbatim with the
 * web prompt (`apps/web/components/auth/terms-prompt.tsx`), and
 * `spec/ui/design-system/writing.md` § Terms prompt is the one place they are
 * written down, since neither app can import the other's module.
 */
export const TERMS_PROMPT_COPY = {
  title: "Agree to the Terms to continue",
  body: "We've updated the Terms of Service and Privacy Policy. Read them, then agree to keep using Frapp.",
  cta: "Agree and continue",
  unticked: "Agree to the Terms of Service and Privacy Policy to continue.",
} as const;

/** Copy for an acceptance the server didn't record. */
export function termsPromptErrorCopy(error: unknown): string {
  if (statusOf(error) === 410) {
    return "This account has been deleted. Sign out to continue.";
  }
  return "Couldn't save your agreement. Check your connection and try again.";
}
