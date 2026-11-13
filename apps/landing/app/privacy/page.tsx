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
    heading: "3. AI Features",
    paragraphs: [
      "Frapp has optional AI features: answers to questions about your chapter, summaries of channels you can read, minutes drafted from an officer's notes, and short notes on your Activity page about your own tasks. They run only when your chapter has them on and you have agreed to them, and you can turn them off for yourself at any time in the app's settings.",
      "When one runs, Frapp sends the text it needs to an AI provider to produce the result: your question, chapter records you are already allowed to open, an officer's meeting notes, or the details of your own task and how long similar tasks took before. Messages you wrote in chat are read only if you agreed to that and your chapter turned it on. Our AI providers are Anthropic and Google, and AssemblyAI to transcribe a meeting recording an officer uploads. They process what they are sent only to return the result, and may hold a request briefly to check for abuse. Member data is never sent to a free tier or to a consumer AI app.",
      "Frapp does not keep the text of AI questions and answers, except for an exchange you choose to report (kept 30 days) and a time-limited diagnostics period a chapter's president can turn on during the beta (kept 14 days), both encrypted. A note shown on your Activity page is kept only while it is showing.",
    ],
  },
  {
    heading: "4. Service Providers",
    paragraphs: [
      "Frapp uses trusted infrastructure providers such as Supabase (data/auth/storage), Render and Vercel (hosting), Stripe (billing), Expo (push delivery), Resend (sign-in and invite email delivery), Sentry (crash and error diagnostics), and PostHog (product and marketing analytics) to deliver core functionality.",
      "On the marketing site, Sentry receives anonymous crash reports and PostHog receives anonymous page views and call-to-action clicks. Session replay is not recorded in production. These providers process data only as needed to operate the service under contractual protections.",
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
