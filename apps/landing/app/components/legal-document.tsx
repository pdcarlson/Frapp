import Link from "next/link";
import { FrappLockup } from "../../components/frapp-lockup";

type LegalSection = {
  heading: string;
  paragraphs: string[];
};

type LegalDocumentProps = {
  title: string;
  lastUpdated: string;
  sections: LegalSection[];
};

/*
 * The legal prose layout, on the LOCKED six type roles (foundations.md §7) —
 * not on the landing's three marketing roles. Those are for the storefront:
 * `--text-hero` is "the hero H1, and nothing else" and `--text-lead` is the
 * hero and closing paragraphs. A Terms page is a document, so its title is
 * `display` and its body is `body`, the 16px paragraph floor.
 *
 * Colours were already semantic before the #2366 cutover, so they re-pointed at
 * the Signet ladder with the stylesheet swap and needed no edit here.
 */
export function LegalDocument({
  title,
  lastUpdated,
  sections,
}: LegalDocumentProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
          <FrappLockup />
          <div className="flex items-center gap-4 text-label text-muted-foreground">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/ferpa">FERPA</Link>
            <Link href="/support">Support</Link>
          </div>
        </div>
      </header>

      <article className="mx-auto w-full max-w-3xl px-6 py-14">
        <h1 className="text-display">
          {title}
        </h1>
        <p className="mt-3 text-caption text-muted-foreground">
          Last updated: {lastUpdated}
        </p>

        <div className="mt-10 space-y-9">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-title">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph, paragraphIndex) => (
                <p
                  key={`${section.heading}-${paragraphIndex}`}
                  className="text-body text-muted-foreground"
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
