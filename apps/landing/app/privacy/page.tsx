import { LegalDocument } from "../components/legal-document";

const sections = [
  {
    heading: "1. Information We Collect",
    paragraphs: [
      "Frapp collects account and profile information such as name, email, role metadata, and chapter membership details.",
      "Depending on feature usage, Frapp may process chat content, uploaded files, event participation data, and study session location signals.",
      "The mobile app asks for device permissions only for the feature that needs them, and only when you use it: the camera to scan an event check-in code; your photo library to choose a profile photo or attach an image; your precise location, only while the app is open, to confirm you are inside a chapter study zone or at an event you are checking in to — Frapp never tracks location in the background; and notifications, if you turn them on, in which case the app stores a push token for your device so the chapter can reach you.",
      "Frapp collects crash and error diagnostics so we can fix problems. On signed-in product surfaces, identifiers in those reports are pseudonymized before they leave our systems. On the public marketing site (frapp.live), crash reports and page or call-to-action analytics are anonymous: they are not tied to a Frapp account and are not linked to you after you sign in. Diagnostic reports contain no chat or document content. Frapp does not use advertising identifiers and does not track you across other companies' apps or websites.",
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
      "Frapp uses trusted infrastructure providers such as Supabase (data/auth/storage), Stripe (billing), Expo (push delivery), Sentry (crash and error diagnostics), and PostHog (product and marketing analytics) to deliver core functionality.",
      "On the marketing site, Sentry receives anonymous crash reports and PostHog receives anonymous page views and call-to-action clicks. Session replay is not recorded in production. These providers process data only as needed to operate the service under contractual protections.",
    ],
  },
  {
    heading: "4. Data Retention",
    paragraphs: [
      "If a chapter subscription is canceled, chapter data is retained and remains available in a limited access mode according to product policy.",
      "Users can delete their account in the app or dashboard (see the Support page), or by emailing team@frapp.live. Certain records may be retained in anonymized form for audit and legal compliance obligations.",
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
      lastUpdated="September 2026"
      sections={sections}
    />
  );
}
