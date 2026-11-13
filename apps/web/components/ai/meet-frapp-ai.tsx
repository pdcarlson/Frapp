"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Sparkles } from "lucide-react";
import { errorCopy, useFrappAiChoice } from "@repo/hooks";
import {
  FRAPP_AI_COPY,
  joinNames,
  type FrappAiPoint,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChatGlyph, TasksGlyph } from "@/components/layout/nav-glyphs";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { PRIVACY_URL } from "@/lib/legal-links";
import { cn } from "@/lib/utils";

/**
 * Meet Frapp AI on web (#4790, Paul 2026-11-13): the one screen where a
 * member turns Frapp AI on (`spec/behavior/ai.md` § Consent). The phone draws
 * the same screen from the same words (`FRAPP_AI_COPY`).
 *
 * Three lines of what it does, one line naming the companies it works with
 * and saying that Continue turns it on, with the privacy policy a click
 * away. Continue is the primary; Not now is a quiet underlined link beside
 * it: Frapp AI is encouraged, not forced. The line above the buttons is what
 * makes Continue an explicit yes under Apple 5.1.2(i). Notion AI and Slack AI
 * introduce themselves the same way, on one card with one button.
 *
 * It opens by itself once for an account that never answered
 * (`meet-frapp-ai-host.tsx`, right after the first-run tour for a new
 * member), at an AI entry point for a member who chose Not now
 * ({@link useAiConsentGate}), and from Settings when the switch is turned on.
 */

const POINT_GLYPHS: Record<FrappAiPoint["key"], ReactNode> = {
  ask: <Sparkles className="h-5 w-5 shrink-0" aria-hidden="true" />,
  catch_up: <ChatGlyph className="h-5 w-5 shrink-0" active />,
  nudge: <TasksGlyph className="h-5 w-5 shrink-0" active />,
};

/** The screen's body: the three lines, and the one that names the companies. */
export function MeetFrappAiBody({
  providers,
  forChapter,
  error,
}: {
  providers: readonly string[];
  forChapter: boolean;
  error?: string | null;
}) {
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-[14px] border border-border">
        {FRAPP_AI_COPY.points.map((point) => (
          <li
            key={point.key}
            className="flex items-center gap-3 px-4 py-3 text-sm text-foreground"
          >
            <span className="text-gold-ask-text">
              {POINT_GLYPHS[point.key]}
            </span>
            {point.text}
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted-foreground">
        {FRAPP_AI_COPY.disclosure(joinNames(providers), forChapter)}{" "}
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline underline-offset-2"
        >
          {FRAPP_AI_COPY.privacyLink}
        </a>
      </p>
      {error ? (
        <p aria-live="polite" className="text-caption text-destructive-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type DialogProps = {
  open: boolean;
  /** Called once the server has the answer: true for Continue. */
  onAnswered: (on: boolean) => void;
  /** Closing without answering: Escape, the X, or a click outside. */
  onDismiss: () => void;
};

/**
 * Meet Frapp AI as a dialog. Closing it is not an answer: the next AI entry
 * point, or the next visit, asks again.
 */
export function MeetFrappAiDialog({ open, onAnswered, onDismiss }: DialogProps) {
  const choice = useFrappAiChoice();
  const [error, setError] = useState<string | null>(null);
  // Which answer was pressed, so only Continue says it is saving.
  const [pending, setPending] = useState<"on" | "off" | null>(null);

  async function submit(on: boolean) {
    if (pending !== null) return;
    setError(null);
    setPending(on ? "on" : "off");
    try {
      if (on) await choice.turnOn();
      else await choice.notNow();
      onAnswered(on);
    } catch (failure) {
      setError(errorCopy(failure, FRAPP_AI_COPY.saveFailed));
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending === null) onDismiss();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{FRAPP_AI_COPY.title}</DialogTitle>
          <DialogDescription className="sr-only">
            {FRAPP_AI_COPY.disclosure(
              joinNames(choice.providers),
              choice.forChapter,
            )}
          </DialogDescription>
        </DialogHeader>
        <MeetFrappAiBody
          providers={choice.providers}
          forChapter={choice.forChapter}
          error={error}
        />
        <DialogFooter className="items-center gap-3 sm:space-x-0">
          <button
            type="button"
            className={cn(
              "rounded-sm text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground",
              FOCUS_RING_OFFSET,
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            disabled={pending !== null}
            onClick={() => void submit(false)}
          >
            {FRAPP_AI_COPY.notNow}
          </button>
          <Button
            type="button"
            className="sm:min-w-28"
            disabled={pending !== null}
            onClick={() => void submit(true)}
          >
            {FRAPP_AI_COPY.continue}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * For an AI entry point (Ask, Catch me up, minutes from notes): `await
 * ensureConsent()` before the first call. It resolves `true` at once for a
 * member who has Frapp AI on, opens Meet Frapp AI for anyone else and
 * resolves `true` on Continue (`false` on Not now or closing it), and
 * resolves `false` when the server has no AI. It rejects when the answer
 * can't be read (offline, a failed request), so the entry point can say so
 * through `errorCopy`. Render `consentDialog` once, anywhere in the screen.
 *
 * The server checks again on every call (`ai.consent.required`), so a screen
 * that skips this still cannot send anything; it only gets the refusal.
 */
export function useAiConsentGate(): {
  ensureConsent: () => Promise<boolean>;
  consentDialog: ReactNode;
} {
  const choice = useFrappAiChoice();
  const { readConsent } = choice;
  const [open, setOpen] = useState(false);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  const finish = useCallback((ok: boolean) => {
    setOpen(false);
    settle.current?.(ok);
    settle.current = null;
  }, []);
  // A host that goes away with the dialog up answers No, as the phone's
  // gate does: nothing else would settle the promise for a caller that
  // outlives it.
  useEffect(
    () => () => {
      settle.current?.(false);
      settle.current = null;
    },
    [],
  );

  const ensureConsent = useCallback(async (): Promise<boolean> => {
    // A failed read is not a No: it throws, so the entry point can say it
    // couldn't check rather than silently doing nothing.
    const state = await readConsent();
    if (!state) return false;
    if (state.answer === "yes") return true;
    // A second press while the dialog is up answers the first one's question.
    settle.current?.(false);
    return new Promise<boolean>((resolve) => {
      settle.current = resolve;
      setOpen(true);
    });
  }, [readConsent]);

  const consentDialog = choice.consent ? (
    <MeetFrappAiDialog
      open={open}
      onAnswered={finish}
      onDismiss={() => finish(false)}
    />
  ) : null;

  return { ensureConsent, consentDialog };
}
