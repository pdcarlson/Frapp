"use client";

import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string };

/**
 * A toolbar filter: a round chip that opens a menu of the values some row
 * actually has, applied the moment one is picked. Secondary at rest, tinted
 * while a value is set, and the chip then names the value. First drawn for
 * `/backwork` (rebuilt 2026-11-05); `/documents` uses it too (#3852).
 */
export function FilterChip({
  label,
  anyLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  anyLabel: string;
  options: readonly FilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selected = options.find((option) => option.value === value);
  const active = value !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={active ? "tinted" : "secondary"}
          size="toolbar"
          className="gap-1 rounded-full font-semibold"
          aria-label={active ? `${label}: ${selected?.label ?? value}` : label}
          disabled={options.length === 0 && !active}
        >
          <span className="max-w-[160px] truncate">
            {active ? (selected?.label.split(" · ")[0] ?? value) : label}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-[200px]">
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <Check
            className={cn("h-4 w-4", active && "invisible")}
            aria-hidden="true"
          />
          {anyLabel}
        </DropdownMenuItem>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
          >
            <Check
              className={cn("h-4 w-4", option.value !== value && "invisible")}
              aria-hidden="true"
            />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
