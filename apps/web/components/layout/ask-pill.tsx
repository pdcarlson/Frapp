"use client";

import { useState } from "react";
import Link from "next/link";
import { useHiddenUnsetFeatures, useMyPermissions } from "@repo/hooks";
import { useChapterModuleGate } from "@/lib/hooks/use-chapter-module-gate";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";

/**
 * The global ✦ Ask entry in the dashboard top bar — a shell, not a feature.
 *
 * Ask is the product's signature AI affordance and, per
 * `spec/ui/mobile/navigation.md`, a *global entry* rather than a navigation
 * destination: it rides the top bar beside search on every screen. This lands
 * that placement on web so later work has somewhere to plug an answer engine
 * into. No retrieval, no corpus, no model call happens here.
 *
 * **It opens a small popover rather than doing nothing.** `spec/ui/design-system/README.md`
 * §5 rule 2 bans a control that silently no-ops, and the design system's writing rules
 * require a disabled affordance to name its blocker *and* the next action — so
 * the popover says Ask cannot answer yet and points at the two surfaces that
 * can. It promises no date, because nothing here knows one. It was a full
 * modal (title, two paragraphs, Close and Open Documents) until 2026-11-05:
 * a screen-dimming dialog to say "not yet" is the heavy chrome
 * `components.md` § Chrome weight rules out, so the note now hangs off the
 * pill it explains, and Escape or a click away closes it.
 *
 * **House gold, never the chapter accent.** Like mobile's pill
 * (`apps/mobile/components/chat/ask-pill.tsx`), the entry paints in the fixed
 * `gold-ask-*` family because "the Ask/AI surface speaks in Signet's voice,
 * not the tenant's" (`spec/ui/design-system/components.md` §11) — it never
 * retints with the chapter accent.
 *
 * This is the trap the framework board sets, so it is worth stating plainly:
 * the board draws the Ask pill in the same values as the chapter accent tints,
 * because the board's demo tenant IS the house tenant. They coincide there and
 * nowhere else. Merging `--gold-ask-*` into `--accent-*` on the board's
 * authority would repaint Ask in the tenant's colour on every chapter that
 * picks an accent, which is exactly what the no-retint rule forbids.
 *
 * Geometry is the board's top-bar cluster: 34px tall, radius 10, to sit level
 * with the bell and the avatar beside it.
 *
 * No feature flag ships with this. Mobile gates on `EXPO_PUBLIC_ASK_ENABLED`
 * because it has a real (if synthetic) corpus to switch on or off; web has no
 * implementation at all, so a flag would only be dead configuration that
 * implies a capability the dashboard does not have.
 */
export function AskPill({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  // Documents can be switched off per chapter, and the nav hides the row when
  // it is. Offering it from here anyway would send a member to a screen
  // whose reads the API refuses — the dead end this dialog exists to avoid,
  // reintroduced by the dialog itself. Fail-safe while the chapter read loads,
  // like every other module gate on this surface, and read from the same
  // member-readable source the nav uses (#1982).
  const isModuleEnabled = useChapterModuleGate();
  // Nor while nobody has uploaded anything, for a member who can't: the nav
  // hides the row then too (`spec/product/modules.md` § Not-set-up features).
  const permissions = useMyPermissions().data?.permissions;
  const hiddenFeatures = useHiddenUnsetFeatures(permissions, isModuleEnabled);
  const documentsEnabled =
    (!isModuleEnabled || isModuleEnabled("documents")) &&
    !hiddenFeatures.has("documents");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ask a question about your chapter"
          title="Ask"
          className={cn(
            "inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-gold-ask-border bg-gold-ask-fill px-3 text-label font-bold text-gold-ask-text transition hover:bg-gold-ask-border/30",
            FOCUS_RING_SHELL,
            className,
          )}
        >
          <span aria-hidden="true">✦</span>
          <span>Ask</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Ask isn't ready yet"
        className="grid w-80 gap-2 text-sm"
      >
        <p className="font-semibold text-foreground">
          Ask isn&apos;t ready yet
        </p>
        <p className="text-muted-foreground">
          It will answer questions about your chapter in plain language. Until
          then, find channels, members, messages and more from the top bar
          {documentsEnabled ? ", and chapter files live in Documents." : "."}
        </p>
        {documentsEnabled ? (
          <Button
            asChild
            variant="link"
            className="h-auto justify-self-start p-0"
          >
            <Link href="/documents" onClick={() => setOpen(false)}>
              Open Documents
            </Link>
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
