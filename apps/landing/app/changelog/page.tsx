import type { Metadata } from "next";
import {
  RELEASE_NOTES,
  formatReleaseNoteDate,
  releaseNoteGroups,
} from "@repo/validation";
import { SitePage } from "../../components/site-page";
import { routeMetadata } from "../../lib/route-metadata";

export const metadata: Metadata = routeMetadata({
  title: "Changelog · Frapp",
  description:
    "What's new in Frapp: the changes that reached members, newest first, in the same words the app's What's new uses.",
  path: "/changelog",
});

/*
 * The public changelog (#3817). It renders `RELEASE_NOTES` from
 * `@repo/validation`, the one list behind mobile Settings → What's new, web's
 * account menu → What's new and `npm run release-notes`, so this page and the
 * apps cannot disagree. Entries are written there, never here; how to write
 * one is the comment at the top of `packages/validation/src/release-notes.ts`.
 * An entry split by place lists its lines for both first, then a Web and a
 * Mobile subheading, as the apps do (`releaseNoteGroups`).
 *
 * Built at deploy time like the rest of the site, so a new entry appears here
 * on the next landing deploy after it merges.
 */
export default function ChangelogPage() {
  return (
    <SitePage
      title="Changelog"
      lead="What's new in Frapp, newest first. These are the same updates members see under What's new in the app."
    >
      {RELEASE_NOTES.length === 0 ? (
        <p className="text-body text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ol className="space-y-12">
          {RELEASE_NOTES.map((note) => (
            <li
              key={`${note.date}-${note.title}`}
              className="border-t border-border pt-8"
            >
              <article aria-labelledby={`note-${note.date}`}>
                <time
                  dateTime={note.date}
                  className="text-caption text-muted-foreground"
                >
                  {formatReleaseNoteDate(note.date)}
                </time>
                <h2 id={`note-${note.date}`} className="mt-2 text-title">
                  {note.title}
                </h2>
                {releaseNoteGroups(note).map((group) => (
                  <section key={group.place} className="mt-4">
                    {group.label ? (
                      <h3 className="mb-2 text-caption font-medium text-foreground">
                        {group.label}
                      </h3>
                    ) : null}
                    <ul className="list-disc space-y-2 pl-5 text-body text-muted-foreground marker:text-border">
                      {group.lines.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </article>
            </li>
          ))}
        </ol>
      )}
    </SitePage>
  );
}
