"use client";

import { LEGAL_ACCEPTANCE_LABEL } from "@repo/validation";
import { Label } from "@/components/ui/label";
import { dashboardTableCheckboxClassName } from "@/components/shared/table-controls";
import { PRIVACY_URL, TERMS_URL } from "@/lib/legal-links";
import { cn } from "@/lib/utils";

const TERMS = "Terms of Service";
const PRIVACY = "Privacy Policy";

/**
 * The owner-approved label cut around the two document names, so each can be
 * a link while the words stay exactly `LEGAL_ACCEPTANCE_LABEL`. Falls back to
 * the plain label if its wording ever stops naming both, rather than drop text.
 */
function splitLabel(): [string, string, string] | null {
  const termsAt = LEGAL_ACCEPTANCE_LABEL.indexOf(TERMS);
  const privacyAt = LEGAL_ACCEPTANCE_LABEL.indexOf(PRIVACY);
  if (termsAt < 0 || privacyAt < termsAt + TERMS.length) return null;
  return [
    LEGAL_ACCEPTANCE_LABEL.slice(0, termsAt),
    LEGAL_ACCEPTANCE_LABEL.slice(termsAt + TERMS.length, privacyAt),
    LEGAL_ACCEPTANCE_LABEL.slice(privacyAt + PRIVACY.length),
  ];
}

function DocumentLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-foreground underline underline-offset-2"
    >
      {children}
    </a>
  );
}

/**
 * The Terms checkbox every web acceptance surface shares (#2302): the
 * create-chapter wizard, the join page and the Terms prompt. One component so
 * the wording and its links can't drift between them, or from mobile's
 * `components/auth/terms-acceptance.tsx`, which reads the same constant.
 */
export function TermsAcceptance({
  id,
  accepted,
  onAcceptedChange,
  disabled = false,
  className,
}: {
  id: string;
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const parts = splitLabel();
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border p-3",
        className,
      )}
    >
      <input
        type="checkbox"
        id={id}
        checked={accepted}
        disabled={disabled}
        onChange={(event) => onAcceptedChange(event.target.checked)}
        className={cn(dashboardTableCheckboxClassName, "mt-0.5")}
      />
      {/*
        Deliberately not wrapped in `dashboardCheckboxHitAreaClassName`. That
        recipe is an implicit `<label>` for a row-select checkbox with no other
        label; this one has an explicit multi-line `<Label htmlFor>` beside it,
        so its tappable area already clears §2's 44px floor, and the wrapper
        would give one input two labels.
      */}
      <Label
        htmlFor={id}
        className="text-sm font-normal leading-snug text-muted-foreground"
      >
        {parts ? (
          <>
            {parts[0]}
            <DocumentLink href={TERMS_URL}>{TERMS}</DocumentLink>
            {parts[1]}
            <DocumentLink href={PRIVACY_URL}>{PRIVACY}</DocumentLink>
            {parts[2]}
          </>
        ) : (
          LEGAL_ACCEPTANCE_LABEL
        )}
      </Label>
    </div>
  );
}
