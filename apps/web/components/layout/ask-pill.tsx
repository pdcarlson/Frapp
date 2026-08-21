"use client";

import { useState } from "react";
import Link from "next/link";
import { useOrgConfig } from "@repo/hooks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The global ✦ Ask entry in the dashboard top bar — a shell, not a feature.
 *
 * Ask is the product's signature AI affordance and, per
 * `spec/ui/mobile/navigation.md`, a *global entry* rather than a navigation
 * destination: it rides the top bar beside search on every screen. This lands
 * that placement on web so later work has somewhere to plug an answer engine
 * into. No retrieval, no corpus, no model call happens here.
 *
 * **It opens a dialog rather than doing nothing.** `spec/ui/design-system/components.md`
 * §5 bans a control that silently no-ops, and the design system's writing rules
 * require a disabled affordance to name its blocker *and* the next action — so
 * the dialog says Ask cannot answer yet and points at the two surfaces that
 * can. It promises no date, because nothing here knows one.
 *
 * **House gold, never the chapter accent.** Like mobile's pill
 * (`apps/mobile/components/chat/ask-pill.tsx`), the entry paints in the fixed
 * `gold-ask-*` family because "the Ask/AI surface speaks in Signet's voice,
 * not the tenant's" (`spec/ui/design-system/components.md` §11) — it never
 * retints with the chapter accent. The 38px height and 11px radius are the
 * app-bar chip geometry from components.md §7, hence the arbitrary values.
 *
 * No feature flag ships with this. Mobile gates on `EXPO_PUBLIC_ASK_ENABLED`
 * because it has a real (if synthetic) corpus to switch on or off; web has no
 * implementation at all, so a flag would only be dead configuration that
 * implies a capability the dashboard does not have.
 */
export function AskPill({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  // Documents can be switched off per chapter, and the sidebar and ⌘K both hide
  // it when it is. Offering it from here anyway would send a member to a screen
  // whose reads the API refuses — the dead end this dialog exists to avoid,
  // reintroduced by the dialog itself. Fail-safe while the config loads, like
  // every other module gate on this surface.
  const isModuleEnabled = useOrgConfig().data?.isModuleEnabled;
  const documentsEnabled = !isModuleEnabled || isModuleEnabled("documents");

  return (
    <>
      <button
        type="button"
        aria-label="Ask a question about your chapter"
        title="Ask"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex h-[38px] items-center gap-1.5 rounded-[11px] border border-gold-ask-border bg-gold-ask-fill px-[13px] text-sm font-bold text-gold-ask-text transition hover:bg-gold-ask-border/30",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
          className,
        )}
      >
        <span aria-hidden="true">✦</span>
        <span>Ask</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask isn&apos;t ready on the dashboard yet</DialogTitle>
            <DialogDescription>
              Ask will answer questions about your chapter — bylaws, minutes,
              dues, who holds which role — in plain language. It can&apos;t
              answer anything yet, so nothing it says would be trustworthy.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            In the meantime, everything Ask would quote is already readable:
            search across members, events, backwork and chat with{" "}
            <kbd className="rounded-xs border border-border px-1 py-0.5 text-xs">
              ⌘K
            </kbd>
            {documentsEnabled ? ", and chapter files live under Documents." : "."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            {documentsEnabled ? (
              <Button asChild onClick={() => setOpen(false)}>
                <Link href="/documents">Open Documents</Link>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
