import type { Metadata } from "next";
import Link from "next/link";
import { LINK_ACCENT } from "../../components/home/styles";
import { SitePage } from "../../components/site-page";
import { routeMetadata } from "../../lib/route-metadata";

export const metadata: Metadata = routeMetadata({
  title: "About · Frapp",
  description:
    "What Frapp is, who it's for, who builds it, and why: one place where a chapter talks and gets its work done.",
  path: "/about",
});

/*
 * About (#3817): what Frapp is, who it's for, who builds it, and the mission
 * statement. The copy was drafted for Paul, Winston and Shawn to edit; the
 * draft and its open questions are on the PR that added this page.
 *
 * The homepage's copy rules hold here (`app/page.tsx`): only what ships is
 * claimed, so the product sentence names chat, events, check-in and points and
 * stops; no figure appears that is not a commitment; no em dashes.
 */
const sections = [
  {
    heading: "What Frapp is",
    paragraphs: [
      "Most chapters already run on a group chat. Frapp starts there, with channels, direct messages, mentions and reactions on your phone and on the web.",
      "When a chapter needs more, events with check-in and the points ledger land in the same conversation members already read, instead of in another app they have to remember to open. Chat is free for every chapter, with no card.",
    ],
  },
  {
    heading: "Who it's for",
    paragraphs: [
      "Fraternity and sorority chapters across Greek life: IFC, NPC, NPHC and multicultural chapters, professional, service and honor chapters, and colonies working toward a charter.",
      "Every chapter runs a little differently, so Frapp is built for the members and officers who keep a chapter going, not for one way of running it.",
    ],
  },
  {
    heading: "Who builds it",
    paragraphs: [
      "Frapp is built by a small, independent team who know chapter life firsthand. We build the app we wanted in our own chapter, and we read what members and officers tell us.",
    ],
  },
  {
    heading: "Our mission",
    paragraphs: [
      "Give every chapter one place where its members actually talk, and let the work of running the chapter happen in that same conversation, so officers spend less time chasing people and more time on the chapter itself.",
    ],
  },
];

export default function AboutPage() {
  return (
    <SitePage
      title="About Frapp"
      lead="Frapp is the chat app for fraternity and sorority chapters, with the officer tools built into the conversation."
    >
      <div className="space-y-12">
        {sections.map((section) => (
          <section key={section.heading} className="space-y-3">
            <h2 className="text-title">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-body text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <section className="space-y-3">
          <h2 className="text-title">Get in touch</h2>
          <p className="text-body text-muted-foreground">
            Want to help build Frapp, or have an idea for what it should do
            next? Write to us.
          </p>
          <Link href="mailto:team@frapp.live" className={LINK_ACCENT}>
            team@frapp.live
          </Link>
        </section>
      </div>
    </SitePage>
  );
}
