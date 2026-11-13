"use client";

import {
  useEffect,
  useRef,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, X } from "lucide-react";
import {
  plusMenuShortcut,
  type PlusMenuCommand,
  type PlusMenuModel,
} from "@repo/chat-core/plus-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  MENU_ITEM_CLASS,
  MENU_SEPARATOR_CLASS,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  AttachGlyph,
  EventsGlyph,
  PlusGlyph,
  PointsGlyph,
  PollsGlyph,
  ServiceGlyph,
  SignupGlyph,
  FormGlyph,
  TasksGlyph,
  type ChatGlyphProps,
} from "./chat-glyphs";

/**
 * The composer's **+** (#3865, layout A) as one card (#3983): its first view
 * is the menu, Attach a file and then one row per command that has a visual
 * form, each teaching its slash shortcut. Picking a row turns the card into
 * that form, in place above the +, with the chat still readable and live
 * behind it: no dialog and no scrim (Paul, 2026-11-10). The comparable apps
 * are Google Calendar's quick create bubble and Todoist's Quick Add.
 *
 * - A back arrow returns to the menu and the X closes the card. Escape steps
 *   back once, then closes.
 * - Closing never loses a draft: the host keeps each form's draft per channel
 *   until it is posted or discarded, and the menu marks a row that has one.
 * - The card is 360px wide in both views, so turning into a form doesn't
 *   jump, and its controls are at the Small step (36 to a mouse).
 *
 * What it offers, greys and explains is `plusMenuModel` in
 * `@repo/chat-core/plus-menu`, which the phone's + sheet shares.
 */

const ROW_GLYPH: Record<PlusMenuCommand, ComponentType<ChatGlyphProps>> = {
  poll: PollsGlyph,
  signup: SignupGlyph,
  form: FormGlyph,
  event: EventsGlyph,
  task: TasksGlyph,
  hours: ServiceGlyph,
  points: PointsGlyph,
};

/** The form's title in the card's header. */
const PLUS_FORM_TITLE: Record<PlusMenuCommand, string> = {
  poll: "New poll",
  signup: "New sign-up sheet",
  form: "New form",
  event: "New event",
  task: "New task",
  hours: "Log service hours",
  points: "Adjust points",
};

export interface ComposerPlusCardProps {
  model: PlusMenuModel;
  /** Shared with the composer's other toolbar controls (32px, 44 to a finger). */
  triggerClassName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The form on show, or `null` for the menu. */
  view: PlusMenuCommand | null;
  onAttach: () => void;
  /** A row was picked. The host decides whether its form opens. */
  onPick: (command: PlusMenuCommand) => void;
  onBack: () => void;
  /** The form body for `view`. */
  form: ReactNode;
  /** Rows whose form holds a draft in this channel. */
  drafts?: ReadonlySet<PlusMenuCommand>;
}

/**
 * Always opens, even when Attach a file is all it holds, so the footer can say
 * why nothing else is there (#3865).
 */
export function ComposerPlusCard({
  model,
  triggerClassName,
  open,
  onOpenChange,
  view,
  onAttach,
  onPick,
  onBack,
  form,
  drafts,
}: ComposerPlusCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // The row a form was opened from, so Back lands on it.
  const lastPicked = useRef<PlusMenuCommand | null>(null);

  // Focus follows the view: a form's first field, or the menu's row the
  // member came back from (its first row on open). Radix's own open focus is
  // turned off below, since it would land on the header's back arrow.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const card = cardRef.current;
      if (!card) return;
      if (view) {
        card
          .querySelector<HTMLElement>("[data-plus-autofocus]")
          ?.focus();
        return;
      }
      const back = lastPicked.current
        ? card.querySelector<HTMLElement>(
            `[data-plus-row="${lastPicked.current}"]:not(:disabled)`,
          )
        : null;
      (back ?? menuItems(card)[0])?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, view]);

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverTrigger asChild>
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
      </PopoverTrigger>
      <PopoverContent
        ref={cardRef}
        side="top"
        align="start"
        // A safety net only: every form fits at its usual length, and a
        // ten-option poll on a short window scrolls rather than clip.
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[22.5rem] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (!view) return;
          event.preventDefault();
          onBack();
        }}
        aria-label={view ? PLUS_FORM_TITLE[view] : "Add to the message"}
      >
        {view ? (
          <>
            <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-1.5">
              <IconButton label="Back" onClick={onBack} className="shrink-0">
                <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
              </IconButton>
              <h2 className="min-w-0 flex-1 truncate text-body font-semibold">
                {PLUS_FORM_TITLE[view]}
              </h2>
              <IconButton
                label="Close"
                onClick={() => onOpenChange(false)}
                className="shrink-0"
              >
                <X className="h-[18px] w-[18px]" aria-hidden="true" />
              </IconButton>
            </div>
            <div className="p-4">{form}</div>
          </>
        ) : (
          <PlusMenu
            model={model}
            drafts={drafts}
            onAttach={() => {
              onOpenChange(false);
              onAttach();
            }}
            onPick={(command) => {
              lastPicked.current = command;
              onPick(command);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function menuItems(card: HTMLElement): HTMLElement[] {
  return Array.from(
    card.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'),
  );
}

/** Up and Down move between rows, Home and End to the ends, as a menu does. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const items = menuItems(event.currentTarget);
  if (items.length === 0) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (at + 1) % items.length
          : (at - 1 + items.length) % items.length;
  items[next]?.focus();
}

function PlusMenu({
  model,
  drafts,
  onAttach,
  onPick,
}: {
  model: PlusMenuModel;
  drafts?: ReadonlySet<PlusMenuCommand>;
  onAttach: () => void;
  onPick: (command: PlusMenuCommand) => void;
}) {
  return (
    <div className="p-1">
      <div role="menu" aria-orientation="vertical" onKeyDown={moveFocus}>
        <MenuRow
          disabledReason={model.attachDisabledReason}
          onSelect={onAttach}
        >
          <AttachGlyph className="h-4 w-4" />
          <span className="flex-1">Attach a file</span>
          {model.attachDisabledReason ? (
            <span className="text-xs">{model.attachDisabledReason}</span>
          ) : null}
        </MenuRow>
        {model.rows.length > 0 ? (
          <div role="separator" className={MENU_SEPARATOR_CLASS} />
        ) : null}
        {model.rows.map((row) => {
          const Glyph = ROW_GLYPH[row.command];
          const hasDraft = row.disabledReason === null && drafts?.has(row.command);
          return (
            <MenuRow
              key={row.command}
              command={row.command}
              disabledReason={row.disabledReason}
              onSelect={() => onPick(row.command)}
            >
              <Glyph className="h-4 w-4" />
              <span className="flex-1">{row.label}</span>
              {row.disabledReason ? (
                <span className="text-xs">{row.disabledReason}</span>
              ) : null}
              {hasDraft ? (
                <span className="text-xs font-semibold text-accent-text">
                  Draft
                </span>
              ) : null}
              {plusMenuShortcut(row.command) ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {plusMenuShortcut(row.command)}
                </span>
              ) : null}
            </MenuRow>
          );
        })}
      </div>
      <div role="separator" className={MENU_SEPARATOR_CLASS} />
      {model.footer.map((line) => (
        <p key={line} className="px-2 py-1 text-xs text-muted-foreground">
          {line}
        </p>
      ))}
      <p className="px-2 py-1 text-xs text-muted-foreground">
        Tip: type <span className="font-mono">/</span> in the message box for
        shortcuts.
      </p>
    </div>
  );
}

function MenuRow({
  command,
  disabledReason,
  onSelect,
  children,
}: {
  command?: PlusMenuCommand;
  disabledReason: string | null;
  onSelect: () => void;
  children: ReactNode;
}) {
  const disabled = disabledReason !== null;
  return (
    <button
      type="button"
      role="menuitem"
      data-plus-row={command}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? "" : undefined}
      onClick={onSelect}
      className={cn(MENU_ITEM_CLASS, "w-full text-left hover:bg-card-hover")}
    >
      {children}
    </button>
  );
}
