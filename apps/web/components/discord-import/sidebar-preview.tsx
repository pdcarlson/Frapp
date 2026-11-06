"use client";

import { LockGlyph } from "@/components/chat/chat-glyphs";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import type { PreviewSection } from "./sidebar-groups";

/** Rows a section lists before it says how many more it holds. */
export const PREVIEW_ROWS = 6;

/**
 * What chat will look like: the channels the import makes, in the sections
 * the chat sidebar will draw them under, with the same marks (a lock for a
 * channel the whole chapter can't read, `#` otherwise). It re-groups as the
 * admin keeps or drops categories, names channels, or skips them. The
 * chapter's own channels, and the ones a merge lands in, are already in chat
 * and stay where they are, so they aren't listed.
 */
export function SidebarPreview({ sections }: { sections: PreviewSection[] }) {
  if (sections.length === 0) return null;
  return (
    <section
      aria-labelledby="discord-sidebar-preview"
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <div className="space-y-0.5">
        <h3 id="discord-sidebar-preview" className="text-sm font-semibold">
          What chat will look like
        </h3>
        <p className="text-xs text-muted-foreground">
          The new channels, as the chat sidebar will list them. Merged channels
          stay where they are.
        </p>
      </div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {sections.map((section) => (
          <PreviewGroup key={section.key} section={section} />
        ))}
      </div>
    </section>
  );
}

function PreviewGroup({ section }: { section: PreviewSection }) {
  const name = section.group ?? "Channels";
  const shown = section.channels.slice(0, PREVIEW_ROWS);
  const more = section.channels.length - shown.length;
  return (
    <div className="min-w-0">
      <p className={cn(EYEBROW, "truncate text-muted-foreground")}>{name}</p>
      <ul aria-label={name} className="mt-1 space-y-0.5">
        {shown.map((channel) => (
          <li
            key={channel.name}
            className="flex h-7 items-center gap-2 text-sm text-muted-foreground"
          >
            {channel.locked ? (
              <>
                <LockGlyph className="h-4 w-4 shrink-0" />
                <span className="sr-only">Private: </span>
              </>
            ) : (
              <span
                aria-hidden="true"
                className="w-4 shrink-0 text-center font-bold"
              >
                #
              </span>
            )}
            <span className="truncate">{channel.name}</span>
          </li>
        ))}
        {more > 0 ? (
          <li className="pl-6 text-xs text-muted-foreground">
            and {more} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}
