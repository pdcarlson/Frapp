import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { type SettingsTool } from "@/components/settings/settings-access";

/**
 * Officer tools as a rounded list of link rows: the tool's name, what it does,
 * and a chevron, since a row leaves Chapter settings for the tool's own
 * full-width page. A module page lists its own tools this way (#4073), and a
 * viewer whose Chapter settings holds tools and nothing else gets them as the
 * whole page.
 */
export function SettingsToolList({
  tools,
}: {
  tools: readonly SettingsTool[];
}) {
  return (
    <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
      {tools.map((tool) => (
        <li key={tool.id} className="group">
          <Link
            href={tool.href}
            className={cn(
              // A row in a card list hovers like a table row (`ui/table.tsx`):
              // `--card-hover`, the step above the whole ladder. The end rows
              // take the list's inner radius (14px less its 1px border) so the
              // tint stays inside its corners; clipping the list with
              // `overflow-hidden` instead would clip the focus ring too.
              "flex items-center gap-4 px-4 py-3 transition hover:bg-card-hover",
              "group-first:rounded-t-[13px] group-last:rounded-b-[13px]",
              FOCUS_RING,
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">
                {tool.label}
              </span>
              <span className="text-caption text-muted-foreground">
                {tool.description}
              </span>
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
