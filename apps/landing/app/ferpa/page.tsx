import type { Metadata } from "next";
import { routeMetadata } from "../../lib/route-metadata";
import { LegalDocument } from "../components/legal-document";

export const metadata: Metadata = routeMetadata({
  title: "FERPA Notice · Frapp",
  description:
    "How Frapp relates to FERPA: Frapp is a software provider, not an educational institution, and chapters are responsible for what they upload.",
  path: "/ferpa",
});

// A change to the text below moves `lastUpdated` when it is material, and
// updates this page's pin in scripts/ci/__tests__/legal-policy-version.test.mjs
// either way. Nobody accepts this notice, so LEGAL_POLICY_VERSION doesn't move
// (spec/behavior/legal.md § Acceptance record).

const sections = [
  {
    heading: "1. Purpose of This Notice",
    paragraphs: [
      "Frapp supports chapter collaboration and organization. This notice clarifies Frapp’s position regarding FERPA-related responsibilities.",
    ],
  },
  {
    heading: "2. Frapp Is Not an Educational Institution",
    paragraphs: [
      "Frapp is a software provider, not a school or university. Frapp does not act as an educational institution under FERPA.",
      "Chapters and members are responsible for ensuring they have rights to share materials uploaded to Frapp.",
    ],
  },
  {
    heading: "3. Backwork and Uploaded Content",
    paragraphs: [
      "Backwork files are submitted voluntarily by chapter members. Uploaders must avoid sharing restricted educational records or sensitive personal information without authorization.",
      "Remove names, student ID numbers, grades and other identifying details from academic materials before you upload them.",
    ],
  },
  {
    heading: "4. Chapter Responsibility",
    paragraphs: [
      "Chapter leadership is responsible for establishing appropriate content policies and enforcing responsible member behavior.",
      "If prohibited content is identified, chapters should remove it immediately and contact support if assistance is needed.",
    ],
  },
  {
    heading: "5. Questions",
    paragraphs: [
      "If your chapter has FERPA-related concerns, contact team@frapp.live for guidance on handling content requests and access controls.",
    ],
  },
];

export default function FerpaPage() {
  return (
    <LegalDocument
      title="FERPA Notice"
      lastUpdated="September 2026"
      sections={sections}
    />
  );
}
