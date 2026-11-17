"use client";

import { useState } from "react";
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Dot,
  FileSearch,
  FileText,
  Hash,
  ListChecks,
  MessagesSquare,
  Minus,
  NotebookText,
  Star,
  UserCheck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  ASK_COPY,
  askStepChips,
  askStepFoundLine,
  askStepKinds,
  askStepLabel,
  askStepSpoken,
  askStepsSummary,
  type AskStepKind,
  type AskWorkStep,
} from "@repo/validation";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * One icon per kind of read (#5427). Lucide outlines, as the proposal card's
 * marks are; the phone draws the same pictures (`ask-step-glyphs.tsx`).
 */
const KIND_ICONS: Record<AskStepKind, LucideIcon> = {
  chat: MessagesSquare,
  channels: Hash,
  records: FileSearch,
  document: FileText,
  minutes: NotebookText,
  events: CalendarDays,
  attendance: UserCheck,
  people: Users,
  tasks: ListChecks,
  points: Star,
  dues: Wallet,
  hours: Clock,
  backwork: BookOpen,
  other: Dot,
};

const TILE =
  "flex shrink-0 items-center justify-center rounded-[8px] border border-border bg-surface-1 text-muted-foreground";

function KindTile({
  kind,
  working = false,
  small = false,
}: {
  kind: AskStepKind;
  working?: boolean;
  small?: boolean;
}) {
  const Icon = KIND_ICONS[kind];
  return (
    <span
      aria-hidden="true"
      className={cn(
        TILE,
        small ? "size-6 ring-2 ring-background" : "size-7",
        working && "border-gold-ask-border bg-gold-ask-fill text-gold-ask-text",
      )}
    >
      <Icon className={small ? "size-3.5" : "size-[15px]"} strokeWidth={1.8} />
    </span>
  );
}

function StepState({ step }: { step: AskWorkStep }) {
  if (step.state === "working") {
    // Still, half gold, with Reduce Motion on.
    return (
      <span
        aria-hidden="true"
        className="size-[15px] rounded-full border-2 border-gold-ask-border border-t-gold-ask-text motion-safe:animate-spin motion-reduce:border-r-gold-ask-text"
      />
    );
  }
  const Icon =
    step.state === "done" ? Check : step.state === "failed" ? X : Minus;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-[15px]",
        step.state === "done" ? "text-success" : "text-muted-foreground",
      )}
      strokeWidth={2}
    />
  );
}

function StepRow({ step, last }: { step: AskWorkStep; last: boolean }) {
  const line = askStepFoundLine(step);
  const chips = askStepChips(step);
  const quiet = step.state === "nothing" || step.state === "failed";
  return (
    <li
      aria-label={askStepSpoken(step)}
      className="relative grid grid-cols-[28px_1fr_auto] gap-x-2.5 pb-2.5 last:pb-0"
    >
      {/* The rail that joins the icons, so the list reads as a path. */}
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute bottom-0.5 left-[13.5px] top-[30px] w-px bg-input"
        />
      )}
      <KindTile kind={step.kind} working={step.state === "working"} />
      <span aria-hidden="true" className="flex min-w-0 flex-col gap-1 pt-1">
        <span
          className={cn(
            "text-sm leading-snug",
            quiet
              ? "font-medium text-muted-foreground"
              : "font-semibold text-foreground",
          )}
        >
          {askStepLabel(step)}
        </span>
        {line ? (
          <span className="text-caption text-muted-foreground">{line}</span>
        ) : null}
        {chips.length > 0 ? (
          <span className="flex flex-wrap gap-1.5">
            {chips.map((name) => (
              <span
                key={name}
                className="inline-flex h-6 max-w-full items-center gap-1 truncate rounded-full border border-border bg-surface-1 px-2.5 text-caption font-semibold text-muted-foreground"
              >
                {name}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="flex pt-1.5">
        <StepState step={step} />
      </span>
    </li>
  );
}

function StepList({ steps }: { steps: readonly AskWorkStep[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => (
        <StepRow key={step.key} step={step} last={index === steps.length - 1} />
      ))}
    </ol>
  );
}

/**
 * Ask's working state as a short list of steps (#5427, `spec/ui/design-system/
 * components.md` §11): while Frapp reads, each read is a row with its icon, a
 * state and what it found. Once the answer starts the list folds into one
 * quiet row, which opens it again.
 *
 * Nothing moves under the reader: the list only grows at its bottom, which is
 * the end of the thread, and it folds when the first word arrives, before
 * there is anything under it to push.
 */
export function AskSteps({
  steps,
  folded,
}: {
  steps: readonly AskWorkStep[] | undefined;
  /** The answer has started, or the turn is over. */
  folded: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) return null;
  if (!folded) return <StepList steps={steps} />;
  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${askStepsSummary(steps)}. ${open ? ASK_COPY.steps_hide : ASK_COPY.steps_show}`}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "inline-flex h-9 max-w-full items-center gap-2.5 self-start rounded-[12px] border border-border pl-1.5 pr-3 text-caption font-semibold text-muted-foreground hover:bg-surface-1 pointer-coarse:h-11",
          FOCUS_RING,
        )}
      >
        <span aria-hidden="true" className="flex -space-x-1.5">
          {askStepKinds(steps).map((kind) => (
            <KindTile key={kind} kind={kind} small />
          ))}
        </span>
        <span className="truncate">{askStepsSummary(steps)}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-[15px] shrink-0 motion-safe:transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? <StepList steps={steps} /> : null}
    </div>
  );
}
