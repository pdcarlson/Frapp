import type { Metadata } from "next";
import { LegalDocument } from "../components/legal-document";

export const metadata: Metadata = {
  title: "Support — Frapp",
  description:
    "How to get help with the Frapp mobile app and web dashboard, report a problem, or request account deletion.",
};

// Both app stores require a public support URL on the listing, and Apple's
// review checks that it answers the questions a member would actually have:
// how to reach a human, how to report a problem, and how to delete an account.
// Reuses the legal-document shell so it stays on the same header/footer as
// Terms, Privacy and FERPA rather than becoming a fourth visual style.
const sections = [
  {
    heading: "1. Contact",
    paragraphs: [
      "Email team@frapp.live for anything about the Frapp mobile app or the web dashboard: sign-in trouble, a chapter that is not appearing, a billing question, or a bug. Include the email address on your Frapp account and, for a bug, what you were doing when it happened and which device you were using.",
      "We aim to respond within two business days. Chapter officers with an active subscription can also reach us from the dashboard's Billing page.",
    ],
  },
  {
    heading: "2. Signing in and joining a chapter",
    paragraphs: [
      "Members join a chapter through an invite link or code issued by a chapter officer. Invites expire 24 hours after they are created; if yours has expired or was already used, ask an officer for a new one.",
      "If an invite says the chapter is not accepting new members, the chapter's subscription is inactive. Only a chapter officer can restore it; the same invite works again once they do.",
    ],
  },
  {
    heading: "3. Notifications",
    paragraphs: [
      "Push notifications are optional and can be turned on or off at any time from the app's Notifications settings, or from your device's system settings for Frapp. Quiet hours and per-channel muting are available inside the app.",
    ],
  },
  {
    heading: "4. Deleting your account",
    paragraphs: [
      "You can request deletion of your Frapp account by emailing team@frapp.live from the address on the account. We remove your profile and personal information; records a chapter is required to keep for its own compliance obligations (for example dues ledgers and audit history) are retained in anonymized form, as described in the Privacy Policy.",
    ],
  },
  {
    heading: "5. Reporting a security issue",
    paragraphs: [
      "If you believe you have found a security vulnerability, email team@frapp.live with the details rather than posting publicly. We will acknowledge the report and keep you informed as we investigate.",
    ],
  },
];

export default function SupportPage() {
  return (
    <LegalDocument
      title="Support"
      lastUpdated="September 2026"
      sections={sections}
    />
  );
}
