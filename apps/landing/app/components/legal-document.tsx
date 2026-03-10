import Link from "next/link";

type LegalSection = {
  heading: string;
  paragraphs: string[];
};

type LegalDocumentProps = {
  title: string;
  lastUpdated: string;
  sections: LegalSection[];
};

export function LegalDocument({ title, lastUpdated, sections }: LegalDocumentProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-bold tracking-tight text-navy dark:text-white">
            frapp
          </Link>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/ferpa">FERPA</Link>
          </div>
        </div>
      </header>

      <article className="mx-auto w-full max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>

        <div className="mt-10 space-y-9">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-lg font-semibold sm:text-xl">{section.heading}</h2>
              {section.paragraphs.map((paragraph, paragraphIndex) => (
                <p
                  key={`${section.heading}-${paragraphIndex}`}
                  className="text-sm leading-7 text-muted-foreground sm:text-base"
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
