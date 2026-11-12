"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  type AiConsentState,
  errorCopy,
  useAiConsent,
  useAnswerAiConsent,
} from "@repo/hooks";
import { AI_CONSENT_COPY, joinNames } from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/**
 * The member's AI sheet (`spec/behavior/ai.md` § Consent, gate 2; #4308,
 * store gate #3297). It names every provider and every kind of data the
 * server's current sheet lists, says plainly what a No does and does not
 * keep out, and has a real No beside the Yes.
 *
 * It opens where a member first reaches for an AI feature
 * ({@link useAiConsentGate}), the way iOS asks for the camera when a member
 * first taps the camera rather than at launch, and the way Notion AI and
 * Slack AI explain themselves on first use. It is not put in front of every
 * member unprompted: in the beta the only AI feature is an officer's
 * (minutes from notes), so asking every member on sign-in would ask people a
 * question about something they never see. Settings shows the same sheet and
 * changes the answer any time ({@link AiConsentDetails}).
 *
 * The rows come from the server (`GET /v1/ai/consent`), never from this
 * build, so a web build cached before a new sheet version still shows and
 * answers the current one. The framing words are `AI_CONSENT_COPY`, shared
 * with mobile.
 */

/** The sheet's body: who it goes to, what goes, and what No means. */
export function AiConsentDetails({
  sheet,
  className,
}: {
  sheet: AiConsentState["sheet"];
  className?: string;
}) {
  return (
    <div className={cn("space-y-4 text-sm", className)}>
      <DetailBlock heading={AI_CONSENT_COPY.sentToHeading}>
        <p className="text-foreground">
          {joinNames(sheet.providers.map((provider) => provider.name))}
        </p>
      </DetailBlock>
      <DetailBlock heading={AI_CONSENT_COPY.dataHeading}>
        <BulletList items={sheet.data.map((kind) => kind.label)} />
      </DetailBlock>
      <DetailBlock heading={AI_CONSENT_COPY.noHeading}>
        <BulletList items={AI_CONSENT_COPY.noMeans} />
      </DetailBlock>
    </div>
  );
}

function DetailBlock({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className={cn(EYEBROW, "text-muted-foreground")}>{heading}</p>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-foreground marker:text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

type Props = {
  open: boolean;
  /** The sheet and the member's standing on it, from `useAiConsent`. */
  consent: AiConsentState;
  /** Called with the saved answer once the server has it. */
  onAnswered: (answer: "yes" | "no") => void;
  /** Closing without answering: Escape, the X, or a click outside. */
  onDismiss: () => void;
};

/**
 * The sheet as a dialog. Closing it is not an answer: an unanswered sheet
 * counts as No on the server, and the next AI entry point asks again.
 */
function AiConsentDialog({ open, consent, onAnswered, onDismiss }: Props) {
  const answer = useAnswerAiConsent();
  const [error, setError] = useState<string | null>(null);
  // Which button was pressed, so only that one says it is saving.
  const [pending, setPending] = useState<"yes" | "no" | null>(null);
  const providers = joinNames(
    consent.sheet.providers.map((provider) => provider.name),
  );
  const changed = consent.sheet_changed;

  async function submit(choice: "yes" | "no") {
    setError(null);
    setPending(choice);
    try {
      await answer.mutateAsync({
        sheet_version: consent.sheet.version,
        answer: choice,
      });
      onAnswered(choice);
    } catch (failure) {
      // A stale sheet refetches itself (`useAnswerAiConsent`); the member
      // reads the new rows here, then answers again.
      setError(errorCopy(failure, AI_CONSENT_COPY.saveFailed));
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
          <DialogTitle>
            {changed ? AI_CONSENT_COPY.titleChanged : AI_CONSENT_COPY.title}
          </DialogTitle>
          <DialogDescription>
            {changed
              ? AI_CONSENT_COPY.introChanged(providers)
              : AI_CONSENT_COPY.intro(providers)}
          </DialogDescription>
        </DialogHeader>
        <AiConsentDetails sheet={consent.sheet} />
        {/*
          One line that says where to change the answer, and says why a save
          failed in its place, so an error never pushes the buttons down.
        */}
        <p
          aria-live="polite"
          className={cn(
            "text-caption",
            error ? "text-destructive-text" : "text-muted-foreground",
          )}
        >
          {error ?? AI_CONSENT_COPY.changeLater}
        </p>
        {/*
          Yes and No at the same size, side by side: Apple's 5.1.2(i) asks
          for explicit permission, and a No styled as a small link is not a
          real choice. Yes is the primary because it is the one that turns
          something on; No is Secondary, never a Ghost link.
        */}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="secondary"
            className="sm:min-w-28"
            disabled={pending !== null}
            onClick={() => void submit("no")}
          >
            {AI_CONSENT_COPY.no}
          </Button>
          <Button
            type="button"
            className="sm:min-w-28"
            disabled={pending !== null}
            onClick={() => void submit("yes")}
          >
            {AI_CONSENT_COPY.yes}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * For an AI entry point (minutes from notes, later Ask): `await
 * ensureConsent()` before the first call. It resolves `true` at once for a
 * member who said yes on the current sheet, opens the sheet for anyone else
 * and resolves with their answer (`false` for No or for closing it), and
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
  const consentQuery = useAiConsent();
  const [open, setOpen] = useState(false);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  const finish = useCallback((ok: boolean) => {
    setOpen(false);
    settle.current?.(ok);
    settle.current = null;
  }, []);

  const ensureConsent = useCallback(async (): Promise<boolean> => {
    let state = consentQuery.data;
    if (state === undefined) {
      const read = await consentQuery.refetch();
      // A failed read is not a No: throw, so the entry point can say it
      // couldn't check rather than silently doing nothing.
      if (read.error) throw read.error;
      state = read.data;
    }
    if (!state) return false;
    if (state.answer === "yes") return true;
    // A second press while the sheet is up answers the first one's question.
    settle.current?.(false);
    return new Promise<boolean>((resolve) => {
      settle.current = resolve;
      setOpen(true);
    });
  }, [consentQuery]);

  const consentDialog = consentQuery.data ? (
    <AiConsentDialog
      open={open}
      consent={consentQuery.data}
      onAnswered={(answer) => finish(answer === "yes")}
      onDismiss={() => finish(false)}
    />
  ) : null;

  return { ensureConsent, consentDialog };
}
