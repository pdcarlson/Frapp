import { LegalDocument } from "../components/legal-document";

const sections = [
  {
    heading: "1. Purpose of This Notice",
    paragraphs: [
      "Signet supports chapter collaboration and organization. This notice clarifies Signet’s position regarding FERPA-related responsibilities.",
    ],
  },
  {
    heading: "2. Signet Is Not an Educational Institution",
    paragraphs: [
      "Signet is a software provider, not a school or university. Signet does not act as an educational institution under FERPA.",
      "Chapters and members are responsible for ensuring they have rights to share materials uploaded to Signet.",
    ],
  },
  {
    heading: "3. Backwork and Uploaded Content",
    paragraphs: [
      "Backwork files are submitted voluntarily by chapter members. Uploaders must avoid sharing restricted educational records or sensitive personal information without authorization.",
      "Signet encourages use of redaction workflows to remove identifying details before sharing academic materials.",
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
      lastUpdated="March 2026"
      sections={sections}
    />
  );
}
