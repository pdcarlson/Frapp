"use client";

import type { ComponentType } from "react";
import type { PlusMenuCommand, PlusMenuModel } from "@repo/chat-core/plus-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  AttachGlyph,
  EventsGlyph,
  PlusGlyph,
  PointsGlyph,
  PollsGlyph,
  ServiceGlyph,
  TasksGlyph,
  type ChatGlyphProps,
} from "./chat-glyphs";

/**
 * The composer's **+** (#3865, layout A): one menu for everything a message
 * can carry besides text. Attach a file, then one row per command that has a
 * visual form, each opening the same form the bare slash command opens
 * (#3773). Shawn's rule: every slash command also has a button and a form,
 * and typing `/` stays the shortcut, which each row teaches by showing it.
 *
 * What it offers, greys and explains is `plusMenuModel` in
 * `@repo/chat-core/plus-menu`, which the phone's + sheet shares.
 */

const ROW_GLYPH: Record<PlusMenuCommand, ComponentType<ChatGlyphProps>> = {
  poll: PollsGlyph,
  event: EventsGlyph,
  task: TasksGlyph,
  hours: ServiceGlyph,
  points: PointsGlyph,
};

export interface ComposerPlusMenuProps {
  model: PlusMenuModel;
  /** Shared with the composer's other toolbar controls (32px, 44 to a finger). */
  triggerClassName: string;
  onAttach: () => void;
  onOpenForm: (command: PlusMenuCommand) => void;
}

/**
 * Always opens, even when Attach a file is all it holds, so the footer can say
 * why nothing else is there (#3865).
 */
export function ComposerPlusMenu({
  model,
  triggerClassName,
  onAttach,
  onOpenForm,
}: ComposerPlusMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label="Add a file, poll, event and more"
          title="Add"
        >
          <PlusGlyph className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <DropdownMenuItem
          disabled={model.attachDisabledReason !== null}
          onSelect={onAttach}
        >
          <AttachGlyph className="h-4 w-4" />
          <span className="flex-1">Attach a file</span>
          {model.attachDisabledReason ? (
            <span className="text-xs">{model.attachDisabledReason}</span>
          ) : null}
        </DropdownMenuItem>
        {model.rows.length > 0 ? <DropdownMenuSeparator /> : null}
        {model.rows.map((row) => {
          const Glyph = ROW_GLYPH[row.command];
          return (
            <DropdownMenuItem
              key={row.command}
              disabled={row.disabledReason !== null}
              onSelect={() => onOpenForm(row.command)}
            >
              <Glyph className="h-4 w-4" />
              <span className="flex-1">{row.label}</span>
              {row.disabledReason ? (
                <span className="text-xs">{row.disabledReason}</span>
              ) : null}
              <span className="font-mono text-xs text-muted-foreground">
                /{row.command}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {model.footer.map((line) => (
          <p key={line} className="px-2 py-1 text-xs text-muted-foreground">
            {line}
          </p>
        ))}
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Tip: type <span className="font-mono">/</span> in the message box for
          shortcuts.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
