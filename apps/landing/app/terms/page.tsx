import { LegalDocument } from "../components/legal-document";

const sections = [
  {
    heading: "1. Agreement to Terms",
    paragraphs: [
      "By creating a chapter account or using Frapp, you agree to these Terms of Service and our Privacy Policy.",
      "If you are creating an account on behalf of a chapter, you represent that you are authorized to accept these terms for that organization.",
    ],
  },
  {
    heading: "2. Service Scope",
    paragraphs: [
      "Frapp provides software for chapter communication, operations, attendance, points, billing workflows, and related member tools.",
      "Feature availability may evolve over time as we improve reliability, security, and product quality.",
    ],
  },
  {
    heading: "3. Account and Data Responsibility",
    paragraphs: [
      "Chapters are responsible for maintaining accurate member access, role assignments, and acceptable use inside their workspace.",
      "Chapters retain ownership of chapter-generated data. Frapp receives a limited license to host, process, and secure that data to provide the service.",
    ],
  },
  {
    heading: "4. Billing and Renewal",
    paragraphs: [
      "Paid subscriptions renew automatically unless canceled before the next billing cycle.",
      "If a subscription enters past-due or canceled status, chapter access may be limited based on product policy, while data remains preserved according to retention terms.",
    ],
  },
  {
    heading: "5. Acceptable Use",
    paragraphs: [
      "You may not use Frapp to violate laws, infringe intellectual property rights, distribute malicious content, or attempt unauthorized access to systems or data.",
      "Frapp may suspend access for violations that threaten security, legal compliance, or platform integrity.",
    ],
  },
  {
    heading: "6. Limitation of Liability",
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
      lastUpdated="March 2026"
      sections={sections}
    />
  );
}
