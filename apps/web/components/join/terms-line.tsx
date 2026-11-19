import { termsLine } from "@repo/validation";
import { PRIVACY_URL, TERMS_URL } from "@/lib/legal-links";
import { cn } from "@/lib/utils";

function DocumentLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-foreground underline underline-offset-2 hover:text-accent-text"
    >
      {children}
    </a>
  );
}

/**
 * The one line under the join screen's buttons that replaced the Terms
 * checkbox (#5625, Paul 2026-11-19), as Discord's and Slack's invite pages
 * read. Its words are `termsLine` in `@repo/validation`, shared with the
 * phone; tapping a button above it is the acceptance, so every join from a
 * screen showing it sends `accept_terms_privacy` (`joinRedeemBody`).
 */
export function TermsLine({
  action,
  className,
}: {
  action: "continuing" | "joining";
  className?: string;
}) {
  const line = termsLine(action);
  return (
    <p
      className={cn(
        "text-center text-caption leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {line.lead}
      <DocumentLink href={TERMS_URL}>{line.terms}</DocumentLink>
      {line.middle}
      <DocumentLink href={PRIVACY_URL}>{line.privacy}</DocumentLink>
      {line.tail}
    </p>
  );
}
