"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronUp, Minus, Plus } from "lucide-react";
import {
  ACTIVITY_CARD_COPY,
  ACTIVITY_WEEK_CARD_COPY,
  canHideActivityCard,
  hideActivityCard,
  moveActivityCard,
  showActivityCard,
  type ActivityCardArrangement,
  type ActivityCardRole,
} from "@repo/hooks";
import type { ActivityCardKey } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Cards only the phone draws today; web keeps their place in the order. */
const PHONE_ONLY: readonly ActivityCardKey[] = ["nudge", "calendar"];

/**
 * Edit Activity on web (#5520): the phone's editor, in place of the page until
 * Done (`apps/mobile/components/activity/activity-editor.tsx`, whose comment
 * names the comparables). Remove and Add hide and bring back a card; the
 * arrows move it. Done saves to the member's account, so the phone shows the
 * same page. The rule is `spec/behavior/activity.md` § Cards.
 */
export function ActivityEditor({
  initial,
  role,
  saved,
  onDone,
  onReset,
}: {
  initial: ActivityCardArrangement;
  role: ActivityCardRole;
  saved: boolean;
  onDone: (arrangement: ActivityCardArrangement) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(initial);

  return (
    <section aria-labelledby="activity-editor-title" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="link"
          size="sm"
          className="gap-1 px-0"
          onClick={() => onDone(draft)}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Activity
        </Button>
        <Button type="button" size="sm" onClick={() => onDone(draft)}>
          Done
        </Button>
      </div>
      <div className="space-y-1">
        <h2 id="activity-editor-title" className="text-title font-semibold">
          Edit Activity
        </h2>
        <p className="text-caption text-muted-foreground">
          Choose which cards Activity shows, and their order. Your phone shows
          the same.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          Shown
        </h3>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          <li className="px-4 py-3">
            <p className="text-sm font-semibold">
              {ACTIVITY_WEEK_CARD_COPY.name}
            </p>
            <p className="text-caption text-muted-foreground">
              {ACTIVITY_WEEK_CARD_COPY.detail}
            </p>
          </li>
          {draft.shown.map((key, index) => {
            const name = ACTIVITY_CARD_COPY[key].name;
            return (
              <li key={key} className="flex items-center gap-1 px-2 py-1.5">
                {canHideActivityCard(key) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Hide ${name}`}
                    onClick={() => setDraft(hideActivityCard(draft, key))}
                  >
                    <span className="grid size-5 place-items-center rounded-full bg-destructive text-background">
                      <Minus aria-hidden="true" className="size-3.5" />
                    </span>
                  </Button>
                ) : (
                  <span aria-hidden="true" className="size-9 shrink-0" />
                )}
                <CardText cardKey={key} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${name} up`}
                  disabled={index === 0}
                  onClick={() => setDraft(moveActivityCard(draft, key, -1))}
                >
                  <ChevronUp aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${name} down`}
                  disabled={index === draft.shown.length - 1}
                  onClick={() => setDraft(moveActivityCard(draft, key, 1))}
                >
                  <ChevronDown aria-hidden="true" className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      {draft.hidden.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
            Hidden
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {draft.hidden.map((key) => (
              <li key={key} className="flex items-center gap-1 px-2 py-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Show ${ACTIVITY_CARD_COPY[key].name}`}
                  onClick={() => setDraft(showActivityCard(draft, key, role))}
                >
                  <span className="grid size-5 place-items-center rounded-full bg-success text-background">
                    <Plus aria-hidden="true" className="size-3.5" />
                  </span>
                </Button>
                <CardText cardKey={key} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {saved ? (
        <Button type="button" variant="link" size="sm" onClick={onReset}>
          Reset to the default
        </Button>
      ) : null}
    </section>
  );
}

function CardText({ cardKey }: { cardKey: ActivityCardKey }) {
  const phoneOnly = PHONE_ONLY.includes(cardKey);
  return (
    <div className={cn("min-w-0 flex-1 py-1.5")}>
      <p className="text-sm font-semibold">
        {ACTIVITY_CARD_COPY[cardKey].name}
      </p>
      <p className="text-caption text-muted-foreground">
        {ACTIVITY_CARD_COPY[cardKey].detail}
        {phoneOnly ? " · On your phone" : ""}
      </p>
    </div>
  );
}
