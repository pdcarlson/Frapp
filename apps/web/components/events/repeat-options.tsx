"use client";

import {
  REPEAT_PRESETS,
  REPEAT_PRESET_LABELS,
  WEEKDAY_CODES,
  editRepeatDraft,
  monthlyChoices,
  pickRepeatEnd,
  pickRepeatPreset,
  repeatCaption,
  repeatDays,
  toggleRepeatDay,
  type MonthlyBy,
  type RepeatDraft,
  type WeekdayCode,
} from "@repo/validation";
import { DateField } from "@/components/ui/date-field";
import { FOCUS_RING } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import { SegmentedChoice } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

const DAY_LETTER: Record<WeekdayCode, string> = {
  SU: "S",
  MO: "M",
  TU: "T",
  WE: "W",
  TH: "T",
  FR: "F",
  SA: "S",
};
const DAY_NAME: Record<WeekdayCode, string> = {
  SU: "Sunday",
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
};

/**
 * The event editor's Repeat section (#4488, #3662): a preset row, and under a
 * cadence its options, open rather than behind Google Calendar's "Custom…"
 * step (Shawn, 2026-11-12): the weekday chips and "Every N weeks" for Weekly,
 * "Every N months" and what day for Monthly, and Ends (after N meetings, or
 * on a date) for every cadence. The state and the rule it makes are
 * `@repo/validation`'s `repeat-draft.ts`, which the phone's sheet shares.
 */
export function RepeatOptions({
  draft,
  start,
  onChange,
  disabled = false,
  showLength,
}: {
  draft: RepeatDraft;
  /** The series' first meeting, or `null` while the start isn't readable. */
  start: Date | null;
  onChange: (next: RepeatDraft) => void;
  disabled?: boolean;
  /** Whether to say how long the series runs (not for one already saved). */
  showLength: boolean;
}) {
  const unit =
    draft.preset === "DAILY"
      ? "day"
      : draft.preset === "WEEKLY"
        ? "week"
        : "month";
  const caption = start ? repeatCaption(draft, start) : null;
  const line = caption?.problem || showLength ? caption : null;
  const choices = start ? monthlyChoices(draft, start) : [];
  const days = start ? repeatDays(draft, start) : (draft.byDay ?? []);

  return (
    <section className="grid gap-2" aria-label="Repeat">
      <span className="text-sm font-semibold leading-none">Repeat</span>
      <SegmentedChoice
        label="Repeat"
        fill
        disabled={disabled}
        options={REPEAT_PRESETS.map((preset) => ({
          value: preset,
          label: REPEAT_PRESET_LABELS[preset],
        }))}
        value={draft.preset}
        onChange={(preset) => onChange(pickRepeatPreset(draft, preset))}
      />

      {draft.preset === "NONE" ? null : (
        <div className="grid gap-3 rounded-md border border-input bg-surface-1 p-3">
          {draft.preset === "WEEKLY" ? (
            <div
              role="group"
              aria-label="Repeats on"
              className="flex flex-wrap gap-1.5"
            >
              {WEEKDAY_CODES.map((code) => {
                const on = days.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_NAME[code]}
                    title={DAY_NAME[code]}
                    disabled={disabled || !start}
                    onClick={() => {
                      if (start) onChange(toggleRepeatDay(draft, code, start));
                    }}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors pointer-coarse:h-11 pointer-coarse:w-11",
                      on
                        ? "bg-accent-subtle text-accent-text"
                        : "border border-input text-muted-foreground hover:bg-card-hover hover:text-foreground",
                      FOCUS_RING,
                    )}
                  >
                    {DAY_LETTER[code]}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="event-repeat-interval">Every</label>
            <Input
              id="event-repeat-interval"
              inputMode="numeric"
              className="w-16 text-center"
              aria-label={`Repeat every how many ${unit}s`}
              value={draft.intervalInput}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  editRepeatDraft(draft, { intervalInput: event.target.value }),
                )
              }
            />
            <span>
              {draft.intervalInput.trim() === "1" ? unit : `${unit}s`}
            </span>
          </div>

          {draft.preset === "MONTHLY" && choices.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>On</span>
              <SegmentedChoice<MonthlyBy>
                label="Repeats on"
                disabled={disabled}
                options={choices.map((choice) => ({
                  value: choice.by,
                  label: choice.label,
                }))}
                value={
                  choices.some((c) => c.by === draft.monthlyBy)
                    ? draft.monthlyBy
                    : "date"
                }
                onChange={(monthlyBy) =>
                  onChange(editRepeatDraft(draft, { monthlyBy }))
                }
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Ends</span>
            <SegmentedChoice<RepeatDraft["endKind"]>
              label="Ends"
              disabled={disabled || !start}
              options={[
                { value: "count", label: "After" },
                { value: "until", label: "On date" },
              ]}
              value={draft.endKind}
              onChange={(endKind) => {
                if (start) onChange(pickRepeatEnd(draft, endKind, start));
              }}
            />
            {draft.endKind === "count" ? (
              <span className="flex items-center gap-2">
                <Input
                  id="event-repeat-count"
                  inputMode="numeric"
                  className="w-16 text-center"
                  aria-label="Ends after how many meetings"
                  value={draft.countInput}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      editRepeatDraft(draft, {
                        countInput: event.target.value,
                      }),
                    )
                  }
                />
                meetings
              </span>
            ) : (
              <DateField
                id="event-repeat-until"
                aria-label="Ends on"
                className="w-44"
                lean="ahead"
                value={draft.until}
                disabled={disabled}
                onChange={(until) =>
                  onChange(editRepeatDraft(draft, { until }))
                }
              />
            )}
          </div>
        </div>
      )}

      {line ? (
        <p
          aria-live="polite"
          className={cn(
            "text-caption",
            line.problem ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {line.text}
        </p>
      ) : null}
    </section>
  );
}
