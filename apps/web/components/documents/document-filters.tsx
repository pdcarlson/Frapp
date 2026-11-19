"use client";

import { useId } from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FILTER_CHIP_CLASS,
  FilterChip,
  SortChip,
  ToggleChip,
  type FilterOption,
} from "@/components/shared/filter-chip";
import { PinGlyph, StarGlyph } from "@/components/documents/resources-glyphs";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SORT_OPTIONS,
  dateFilterLabel,
  isActiveDateFilter,
  type DateFilter,
  type DocumentFilters,
  type DocumentSort,
  type FileKind,
} from "@repo/hooks/document-library";
import { cn } from "@/lib/utils";

const CHIP = FILTER_CHIP_CLASS;

/**
 * The Date added chip: a few presets and a custom range. A popover rather
 * than a menu, because the custom range holds two date fields, and a menu's
 * typeahead would take the keys meant for them.
 */
function DateFilterChip({
  value,
  semesterKnown,
  onChange,
}: {
  value: DateFilter | null;
  /** The chapter's semester archives have loaded; until then "This semester" waits. */
  semesterKnown: boolean;
  onChange: (value: DateFilter | null) => void;
}) {
  const id = useId();
  const active = isActiveDateFilter(value, semesterKnown);
  const presets: { key: string; label: string; next: DateFilter | null }[] = [
    { key: "any", label: "Any time", next: null },
    { key: "semester", label: "This semester", next: { preset: "semester" } },
    { key: "30d", label: "Last 30 days", next: { preset: "30d" } },
    {
      key: "custom",
      label: "Custom range",
      next:
        value?.preset === "custom"
          ? value
          : { preset: "custom", from: null, to: null },
    },
  ];
  const current = value === null ? "any" : value.preset;
  const custom = value?.preset === "custom" ? value : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={active ? "tinted" : "secondary"}
          size="toolbar"
          className={CHIP}
          aria-label={
            active ? `Date added: ${dateFilterLabel(value)}` : "Date added"
          }
        >
          <span className="max-w-[180px] truncate">
            {active ? dateFilterLabel(value) : "Date added"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <div role="radiogroup" aria-label="Date added">
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              role="radio"
              aria-checked={current === preset.key}
              disabled={preset.key === "semester" && !semesterKnown}
              title={
                preset.key === "semester" && !semesterKnown
                  ? "The chapter's semesters haven't loaded"
                  : undefined
              }
              onClick={() => onChange(preset.next)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-card-hover focus-visible:bg-card-hover focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              <Check
                className={cn("h-4 w-4", current !== preset.key && "invisible")}
                aria-hidden="true"
              />
              {preset.label}
            </button>
          ))}
        </div>
        {custom ? (
          <div className="grid grid-cols-2 gap-2 border-t border-border px-2 pb-2 pt-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-from`} className="text-caption text-muted">
                From
              </Label>
              <DateField
                id={`${id}-from`}
                lean="back"
                value={custom.from ?? ""}
                onChange={(from) => onChange({ ...custom, from: from || null })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-to`} className="text-caption text-muted">
                To
              </Label>
              <DateField
                id={`${id}-to`}
                lean="back"
                value={custom.to ?? ""}
                onChange={(to) => onChange({ ...custom, to: to || null })}
              />
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The library's one filter menu (#5576): who uploaded, when, what type,
 * Pinned and Starred, and the order, behind a single Filters control beside
 * the search, as Google Drive and Dropbox keep theirs behind one button
 * rather than a row of chips over the files. Each choice applies the moment
 * it is made, as the chips did on the toolbar. The trigger is tinted and
 * counts what is on, so a narrowed list says so with the menu closed.
 */
export function DocumentFilterMenu({
  filters,
  semesterKnown,
  setFilters,
  uploaders,
  kinds,
  sort,
  setSort,
  onClear,
}: {
  filters: DocumentFilters;
  /** The chapter's semester archives have loaded. */
  semesterKnown: boolean;
  setFilters: (filters: DocumentFilters) => void;
  uploaders: readonly FilterOption[];
  /** The File type choices: groups some document is in (`kindOptions`). */
  kinds: readonly FilterOption[];
  sort: DocumentSort;
  setSort: (sort: DocumentSort) => void;
  /** Clears every filter, leaving the search, the folder and the order. */
  onClear: () => void;
}) {
  const on = [
    filters.uploader !== null,
    isActiveDateFilter(filters.date, semesterKnown),
    filters.kind !== null,
    filters.marks.pinned,
    filters.marks.starred,
  ].filter(Boolean).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={on > 0 ? "tinted" : "secondary"}
          size="toolbar"
          className="shrink-0 gap-1.5"
          aria-label={on > 0 ? `Filters, ${on} on` : "Filters"}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filters
          {on > 0 ? <span aria-hidden="true">· {on}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(20rem,calc(100vw-2rem))] space-y-3 p-3"
      >
        <div className="flex flex-wrap gap-2">
          <FilterChip
            label="Uploaded by"
            anyLabel="Anyone"
            options={uploaders}
            value={filters.uploader}
            onChange={(uploader) => setFilters({ ...filters, uploader })}
          />
          <DateFilterChip
            semesterKnown={semesterKnown}
            value={filters.date}
            onChange={(date) => setFilters({ ...filters, date })}
          />
          <FilterChip
            label="File type"
            anyLabel="Any type"
            options={kinds}
            value={filters.kind}
            onChange={(kind) =>
              setFilters({ ...filters, kind: kind as FileKind | null })
            }
          />
          {/*
            Pinned and Starred (#4290): toggles rather than menus, each one
            click, as Google Drive's Starred chip and Gmail's are. Both on
            shows a file that is either.
          */}
          <ToggleChip
            on={filters.marks.pinned}
            onToggle={(pinned) =>
              setFilters({ ...filters, marks: { ...filters.marks, pinned } })
            }
          >
            <PinGlyph className="h-3.5 w-3.5" active={filters.marks.pinned} />
            Pinned
          </ToggleChip>
          <ToggleChip
            on={filters.marks.starred}
            onToggle={(starred) =>
              setFilters({ ...filters, marks: { ...filters.marks, starred } })
            }
          >
            <StarGlyph className="h-3.5 w-3.5" active={filters.marks.starred} />
            Starred
          </ToggleChip>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <SortChip options={SORT_OPTIONS} value={sort} onChange={setSort} />
          {on > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="toolbar"
              onClick={onClear}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
