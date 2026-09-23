import { LegalDocument } from "../components/legal-document";

// Owner-approved wording, 2026-09-23 (#2261, #2302, #1562). A material change
// here also bumps `LEGAL_POLICY_VERSION` in `@repo/validation`, which asks every
// user to accept again, and moves `lastUpdated` below to match.
const sections = [
  {
    heading: "1. Agreement to Terms",
    paragraphs: [
      "By creating an account, joining a chapter, or using Frapp, you agree to these Terms of Service and our Privacy Policy.",
      "If you are creating an account on behalf of a chapter, you represent that you are authorized to accept these terms for that organization.",
    ],
  },
  {
    heading: "2. Eligibility",
    paragraphs: [
      "You must be at least 18 years old to use Frapp. By accepting these terms, you confirm that you are.",
      "We may close an account that we learn belongs to someone under 18.",
    ],
  },
  {
    heading: "3. Service Scope",
    paragraphs: [
      "Frapp provides software for chapter communication, operations, attendance, points, billing workflows, and related member tools.",
      "Feature availability may evolve over time as we improve reliability, security, and product quality.",
    ],
  },
  {
    heading: "4. Account and Data Responsibility",
    paragraphs: [
      "Chapters are responsible for maintaining accurate member access, role assignments, and acceptable use inside their workspace.",
      "Chapters retain ownership of chapter-generated data. Frapp receives a limited license to host, process, and secure that data to provide the service.",
    ],
  },
  {
    heading: "5. Billing, Renewal and Inactive Chapters",
    paragraphs: [
      "Paid subscriptions renew automatically unless canceled before the next billing cycle.",
      "If a subscription enters past-due or canceled status, chapter access may be limited based on product policy, while data remains preserved according to retention terms.",
      "If a chapter's subscription has been canceled for more than two years and no member of the chapter has signed in during that time, we may delete the chapter's data. We will email the chapter's last known admin at least 30 days before we do.",
    ],
  },
  {
    heading: "6. Acceptable Use and Member Content",
    paragraphs: [
      "You may not use Frapp to violate laws, infringe intellectual property rights, distribute malicious content, or attempt unauthorized access to systems or data.",
      "Frapp has zero tolerance for objectionable content and abusive users. Do not post content that is hateful, harassing, threatening, sexually explicit or violent, and do not bully, intimidate or impersonate anyone.",
      "You are responsible for what you post. You can report a message or block a member in the Frapp app. Your chapter's officers are notified of reports, and can remove reported messages and remove members who break these terms. To raise a concern with us directly, email team@frapp.live.",
      "Frapp may remove content, and suspend or close accounts, that violate these terms or threaten security, legal compliance, or platform integrity.",
    ],
  },
  {
    heading: "7. Limitation of Liability",
    paragraphs: [
      "Frapp is provided on an as-is basis. To the maximum extent permitted by law, Frapp is not liable for indirect, incidental, or consequential damages arising from service use.",
      "Nothing in these terms excludes liability that cannot be lawfully excluded.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      lastUpdated="September 2026"
      sections={sections}
    />
  );
}
