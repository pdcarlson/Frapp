"use client";

import { forwardRef, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type SuggestFieldProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type"
> & {
  value: string;
  onChange: (value: string) => void;
  /**
   * What to offer under the field for what is typed now, worked out by the
   * caller (`majorSuggestions` for a major). An empty list closes it.
   */
  suggestions: readonly string[];
  /** The list's name for a screen reader ("Majors in your chapter"). */
  suggestionsLabel: string;
};

/**
 * A free-text field that offers what others already wrote under it (#5778),
 * the way Gmail's To field and Slack's channel-name box suggest an existing
 * entry while still taking a new one: type anything, or press a suggestion
 * (arrow keys and Enter work too) to take its exact spelling. Built on the
 * same pieces as `TimeField`: the list floats over the form and never moves
 * it, and focus stays in the field (WAI-ARIA combobox, list autocomplete).
 */
export const SuggestField = forwardRef<HTMLInputElement, SuggestFieldProps>(
  function SuggestField(
    {
      value,
      onChange,
      suggestions,
      suggestionsLabel,
      onBlur,
      onFocus,
      onKeyDown,
      className,
      disabled,
      ...inputProps
    },
    ref,
  ) {
    const listId = useId();
    const anchorRef = useRef<HTMLDivElement>(null);
    const [focused, setFocused] = useState(false);
    // Closed by Escape or a pick until the next keystroke.
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState<number | null>(null);
    const open =
      focused && !dismissed && !disabled && suggestions.length > 0;
    const highlighted =
      active !== null && active < suggestions.length ? active : null;

    const pick = (suggestion: string) => {
      onChange(suggestion);
      setActive(null);
      setDismissed(true);
    };

    const step = (by: number) => {
      if (suggestions.length === 0) return;
      setDismissed(false);
      setActive((current) =>
        current === null || current >= suggestions.length
          ? by > 0
            ? 0
            : suggestions.length - 1
          : (current + by + suggestions.length) % suggestions.length,
      );
    };

    return (
      <Popover open={open}>
        <PopoverAnchor asChild>
          <div ref={anchorRef} className="relative">
            <Input
              {...inputProps}
              ref={ref}
              type="text"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded={open}
              aria-activedescendant={
                open && highlighted !== null
                  ? `${listId}-${highlighted}`
                  : undefined
              }
              disabled={disabled}
              value={value}
              className={className}
              onFocus={(event) => {
                setFocused(true);
                onFocus?.(event);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  step(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  step(-1);
                } else if (
                  event.key === "Enter" &&
                  open &&
                  highlighted !== null
                ) {
                  event.preventDefault();
                  const suggestion = suggestions[highlighted];
                  if (suggestion !== undefined) pick(suggestion);
                } else if (event.key === "Escape" && open) {
                  event.stopPropagation();
                  setDismissed(true);
                  setActive(null);
                }
                onKeyDown?.(event);
              }}
              onChange={(event) => {
                setDismissed(false);
                setActive(null);
                onChange(event.target.value);
              }}
              onBlur={(event) => {
                setFocused(false);
                setActive(null);
                setDismissed(false);
                onBlur?.(event);
              }}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-40 p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // A press on the list keeps focus in the field, so its blur
          // doesn't close the list before the click lands.
          onMouseDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target as Node | null;
            if (target && anchorRef.current?.contains(target)) {
              event.preventDefault();
            }
          }}
        >
          <ul
            id={listId}
            role="listbox"
            aria-label={suggestionsLabel}
            className="max-h-60 overflow-y-auto"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlighted}
                onClick={() => pick(suggestion)}
                className={cn(
                  "flex min-h-8 cursor-pointer items-center rounded-md px-2 text-sm pointer-coarse:min-h-11",
                  index === highlighted ? "bg-card-hover" : "hover:bg-card-hover",
                )}
              >
                <span className="truncate">{suggestion}</span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    );
  },
);
