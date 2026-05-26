"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { filterSlashCommands, type SlashCommand } from "@repo/chat-integrations";

export interface SlashPaletteProps {
  open: boolean;
  initialQuery?: string;
  isModuleEnabled: (moduleKey: string) => boolean;
  onSelect: (command: SlashCommand) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Slash-command palette built on `cmdk`. Filters the catalog by the chapter's
 * enabled modules and lists the typed query results. Foundation chunk: choosing
 * a command surfaces an "Available in Chunk 05" toast via the caller — the
 * palette itself is module-aware and accessible.
 *
 * The input is controlled and re-syncs with `initialQuery` whenever the palette
 * is opened (e.g. the composer pushed a fresh partial command into it) so the
 * displayed filter never drifts from the composer's slash text.
 */
export function SlashPalette({
  open,
  initialQuery = "",
  isModuleEnabled,
  onSelect,
  onOpenChange,
}: SlashPaletteProps) {
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    // Re-seed on open and whenever the composer-driven prefix changes.
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  const commands = useMemo(
    () => filterSlashCommands(query, isModuleEnabled),
    [query, isModuleEnabled],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogTitle className="sr-only">Slash commands</DialogTitle>
        <DialogDescription className="sr-only">
          Pick a slash command. Available commands depend on which modules your
          chapter has enabled.
        </DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type a command…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No matching command.</CommandEmpty>
            <CommandGroup heading="Commands">
              {commands.map((command) => (
                <CommandItem
                  key={command.name}
                  value={`${command.name} ${command.description}`}
                  onSelect={() => onSelect(command)}
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    /{command.name}
                  </span>
                  <span className="ml-2 text-sm">{command.description}</span>
                  {command.usage ? (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {command.usage}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
