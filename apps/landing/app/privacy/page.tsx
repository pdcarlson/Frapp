import { LegalDocument } from "../components/legal-document";

const sections = [
  {
    heading: "1. Information We Collect",
    paragraphs: [
      "Frapp collects account and profile information such as name, email, role metadata, and chapter membership details.",
      "Depending on feature usage, Frapp may process chat content, uploaded files, event participation data, and study session location signals.",
    ],
  },
  {
    heading: "2. How We Use Information",
    paragraphs: [
      "We use data to operate chapter workflows, authenticate users, deliver notifications, and maintain platform security.",
      "We do not sell chapter or member personal information to third-party advertisers.",
    ],
  },
  {
    heading: "3. Service Providers",
    paragraphs: [
      "Frapp uses trusted infrastructure providers such as Supabase (data/auth/storage), Stripe (billing), and Expo (push delivery) to deliver core functionality.",
      "These providers process data only as needed to operate the service under contractual protections.",
    ],
  },
  {
    heading: "4. Data Retention",
    paragraphs: [
      "If a chapter subscription is canceled, chapter data is retained and remains available in a limited access mode according to product policy.",
      "Users may request account deletion. Certain records may be retained in anonymized form for audit and legal compliance obligations.",
    ],
  },
  {
    heading: "5. Security and Controls",
    paragraphs: [
      "Frapp uses role-based access controls, tenant isolation patterns, and secure transport to protect chapter data.",
      "No internet service is perfectly secure, but we continuously monitor and improve controls against evolving threats.",
    ],
  },
  {
    heading: "6. Contact",
    paragraphs: [
      "For privacy requests or questions, contact team@frapp.live.",
      "If policy terms materially change, Frapp will provide notice before those changes take effect.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      lastUpdated="March 2026"
      sections={sections}
    />
  );
}
