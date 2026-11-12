"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";
import {
  HIDE_SETUP_CHECKLIST_LABEL,
  SETUP_CHECKLIST_TITLE,
  SETUP_CHECKLIST_WEB_PATH,
  useChapterSetupChecklist,
  type SetupChecklist,
} from "@repo/hooks";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/**
 * The officer setup checklist at the top of the channel rail
 * (`spec/product/modules.md` § Setup checklist). It sits where Discord puts
 * its server guide: above the channels, out of the conversation, so it never
 * covers what a member came to read. It reads as one more section of the
 * rail, with rows like channel rows, not a card.
 */
export function SetupChecklistSection() {
  const { checklist, hide } = useChapterSetupChecklist();
  if (!checklist) return null;
  return <SetupChecklistView checklist={checklist} onHide={hide} />;
}

/** The drawn list, without hooks, so a test can render one directly. */
function SetupChecklistView({
  checklist,
  onHide,
}: {
  checklist: SetupChecklist;
  onHide: () => void;
}) {
  const headingId = "setup-checklist-heading";
  return (
    <section aria-labelledby={headingId} className="mb-4">
      <div className="flex items-center gap-1 px-2 pb-1">
        <h3
          id={headingId}
          className={cn("min-w-0 flex-1 truncate text-foreground", EYEBROW)}
        >
          {SETUP_CHECKLIST_TITLE}
        </h3>
        <span className={cn("shrink-0 text-muted-foreground", EYEBROW)}>
          {checklist.doneCount} of {checklist.lines.length}
        </span>
        <button
          type="button"
          onClick={onHide}
          aria-label={HIDE_SETUP_CHECKLIST_LABEL}
          title={HIDE_SETUP_CHECKLIST_LABEL}
          className={cn(
            // 24 beside the rail's other row controls; the touch floor on a
            // finger (foundations.md §9).
            "inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground pointer-coarse:size-11",
            FOCUS_RING,
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <ul>
        {checklist.lines.map((line) => (
          <li key={line.key}>
            <Link
              href={SETUP_CHECKLIST_WEB_PATH[line.key]}
              className={cn(
                // The Row step (foundations.md §9): 32 with a 14px label on a
                // mouse, 44 with a 16px one on touch.
                "flex min-h-8 w-full items-center gap-2 rounded-xs px-2 text-sm transition-colors hover:bg-card pointer-coarse:min-h-11 pointer-coarse:text-base",
                line.done ? "text-muted-foreground" : "text-foreground",
                FOCUS_RING,
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                  // Done is the quietest thing on the list: a muted check,
                  // never the accent (foundations.md, accent rule).
                  line.done
                    ? "border border-border bg-card text-muted-foreground"
                    : "border border-border",
                )}
              >
                {line.done ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : null}
              </span>
              <span className={cn("truncate", line.done && "line-through")}>
                {line.label}
              </span>
              {line.done ? <span className="sr-only">, done</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
