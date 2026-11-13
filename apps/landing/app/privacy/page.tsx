import type { Metadata } from "next";
import { routeMetadata } from "../../lib/route-metadata";
import { LegalDocument } from "../components/legal-document";

export const metadata: Metadata = routeMetadata({
  title: "Privacy Policy · Frapp",
  description:
    "What the Frapp mobile app and web dashboard collect, how it is used, which providers process it, how long it is kept, and how to reach us.",
  path: "/privacy",
});

// A material change here moves `lastUpdated` below and bumps
// `LEGAL_POLICY_VERSION` in the API, which asks every user to accept
// again. Any change to the text updates this page's pin in
// scripts/ci/__tests__/legal-policy-version.test.mjs, which enforces both. The
// rule: spec/behavior/legal.md § Acceptance record.

const sections = [
  {
    heading: "1. Information We Collect",
    paragraphs: [
      "Frapp collects account and profile information such as name, email, role metadata, and chapter membership details.",
      "Depending on feature usage, Frapp may process chat content, uploaded files, event participation data, and location signals for study sessions and event check-in.",
      "The mobile app asks for device permissions only for the feature that needs them, and only when you use it: the camera to scan an event check-in code; your photo library to set your profile photo, add your chapter's logo, pick a photo you send in chapter chat, pick a photo to add to your chapter's documents, or attach a photo as proof of your service hours; your precise location, only while the app is open, to confirm you are inside a chapter study zone or at an event you are checking in to, and, when an officer shows an event's check-in code, to let members within about 100 yards of that officer's phone check in. The location of a phone showing a check-in code is kept only until check-in closes. Frapp never tracks location in the background. Notifications, if you turn them on, store a push token for your device so the chapter can reach you.",
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
      "Frapp uses trusted infrastructure providers such as Supabase (data/auth/storage), Render and Vercel (hosting), Stripe (billing), Expo (push delivery), Resend (sign-in and invite email delivery), Sentry (crash and error diagnostics), and PostHog (product and marketing analytics) to deliver core functionality.",
      "On the marketing site, Sentry receives anonymous crash reports and PostHog receives anonymous page views and call-to-action clicks. Session replay is not recorded in production. These providers process data only as needed to operate the service under contractual protections.",
    ],
  },
  {
    heading: "4. Frapp AI",
    paragraphs: [
      "Frapp AI features, such as asking about your chapter, channel summaries and drafting meeting minutes, work with Anthropic, Google and AssemblyAI. You turn Frapp AI on for your account when you sign up or later in Settings, and your chapter's president turns each feature on for the chapter. When a feature runs, Frapp sends it what it needs: your question; your chapter's documents, announcements, events, tasks and posted minutes; roster details (name, role, points, dues status and attendance, never your phone number, email or address); messages in chapter channels from members who have Frapp AI on, never direct messages; and, for meeting features, an officer's notes and a meeting's recording and transcript. AssemblyAI receives only meeting recordings, to transcribe them.",
      "These companies process it only to return a result to Frapp, and Frapp's agreements with them do not allow them to use it to train their models. A provider may hold a request for a short time to check for abuse, on its own terms. Frapp does not keep the text of your questions or of AI answers, except an answer you report to us, kept encrypted for 30 days, and, during the beta, the questions and answers of one chapter whose president turns on diagnostics, kept encrypted for 14 days. A meeting recording is deleted once it is transcribed. Frapp keeps a search index of your chapter's records, and of channel messages from members who have Frapp AI on, so answers can point to their sources.",
      "You can turn Frapp AI off any time in Settings. Your channel messages then stop being read and leave the index within a day, and anything an AI feature kept that quotes you is deleted. Your chapter's own records, such as documents, announcements, roster details and minutes that name you, can still be used while your president has a feature on.",
    ],
  },
  {
    heading: "5. Data Retention",
    paragraphs: [
      "If a chapter subscription is canceled, chapter data is retained and remains available in a limited access mode according to product policy.",
      "Users can delete their account in the app or dashboard (see the Support page), or by emailing team@frapp.live. Certain records may be retained in anonymized form for audit and legal compliance obligations.",
    ],
  },
  {
    heading: "6. Security and Controls",
    paragraphs: [
      "Frapp uses role-based access controls, tenant isolation patterns, and secure transport to protect chapter data.",
      "No internet service is perfectly secure, but we continuously monitor and improve controls against evolving threats.",
    ],
  },
  {
    heading: "7. Contact",
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
