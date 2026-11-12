"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, X } from "lucide-react";
import {
  errorCopy,
  useAsk,
  useAskStatus,
  type AskExchange,
} from "@repo/hooks";
import {
  ASK_COPY,
  ASK_QUESTION_MAX_LENGTH,
  askSavedLine,
  formatAiAnswerDate,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/ai-consent-sheet";
import { AskExchangeView } from "@/components/ask/ask-answer";
import { PanelBody } from "@/components/shared/panel";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Ask Frapp on web (#450, #451): a panel on the right edge that takes one
 * question and answers it from the chapter's sources, each claim marked with
 * the source it came from.
 *
 * **Beside the page, not over it.** Slack AI and Notion AI both answer in a
 * side panel that leaves the workspace usable, because the next thing a
 * member does with an answer is open what it cites. So this is not a dialog:
 * nothing dims, the page stays live, and from `lg` up the shell moves over
 * to make room (`ASK_OPEN_ATTRIBUTE`, read by `dashboard-shell.tsx`), so the
 * top bar and the page a source opens are never under the panel. Following a
 * source leaves the answer where it was. Below `lg` there is no room for
 * both, so the panel covers the page and following a source closes it; the
 * answer is there when the panel reopens.
 *
 * It closes by its X, by the pill, or by Escape pressed inside it. It is its
 * own small `aside`, not the Radix sheet: a Radix dialog takes Escape from
 * the whole document while it is the top layer, which would close the panel
 * (and drop an answer in flight) when a member dismissed a mention list in
 * the chat composer beside it. It is narrower than a form panel
 * (`panel.tsx`'s 576px) because it shares the screen.
 *
 * **One question at a time.** Ask answers each question on its own and keeps
 * no conversation (`spec/behavior/ai.md`), so the panel shows one exchange
 * and says so under the field, the way Slack's search answer does, not a
 * chat thread that would promise it remembers.
 *
 * **Consent is asked at the first question**, not when the panel opens
 * (`useAiConsentGate`; `ai.md` § Consent). The server checks again.
 *
 * **The saved line.** While the beta diagnostics window is on for this
 * chapter, the line under the field says questions and answers are saved and
 * until when, and only then does a question carry `saved_notice_shown`: the
 * server keeps nothing from a client that did not show it.
 */
/** On `<html>` while the panel is open: the shell makes room from `lg` up. */
export const ASK_OPEN_ATTRIBUTE = "data-ask-open";

/** Tailwind's `lg`: from here the page and the panel fit side by side. */
const BESIDE_PAGE_QUERY = "(min-width: 1024px)";

export function AskPanel({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opened it, which takes focus back when it closes. */
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const { exchange, ask, reset } = useAsk();
  const status = useAskStatus({ enabled: open });
  const { ensureConsent, consentDialog } = useAiConsentGate();
  const [draft, setDraft] = useState("");
  // A question that never reached the server: the member has not said yes.
  const [held, setHeld] = useState<AskExchange | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const savedUntil = status.data?.saved_until ?? null;
  // The server sends a date only while the window is open.
  const saving = savedUntil !== null;
  const shown = held ?? exchange;
  const working = shown?.phase === "working";

  // A question still being answered is dropped with the panel, however it
  // was closed; a finished answer is there when it reopens.
  useEffect(() => {
    if (!open && working) reset();
  }, [open, working, reset]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const opener = returnFocus?.current ?? null;
    root.setAttribute(ASK_OPEN_ATTRIBUTE, "");
    field.current?.focus({ preventScroll: true });
    return () => {
      root.removeAttribute(ASK_OPEN_ATTRIBUTE);
      // Only when focus would otherwise fall to the body: a member who
      // closed the panel from the page keeps their place there.
      if (opener?.isConnected && !document.activeElement?.closest("main")) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open, returnFocus]);

  function close() {
    onOpenChange(false);
  }

  async function submit(question: string) {
    const trimmed = question.trim();
    if (!trimmed || working) return;
    setDraft("");
    setHeld(null);
    let agreed: boolean;
    try {
      agreed = await ensureConsent();
    } catch (error) {
      setHeld({
        question: trimmed,
        phase: "failed",
        step: null,
        preview: "",
        answer: null,
        failure: { message: errorCopy(error, ASK_COPY.failed), retryable: true },
      });
      return;
    }
    if (!agreed) {
      setHeld({
        question: trimmed,
        phase: "done",
        step: null,
        preview: "",
        failure: null,
        answer: {
          status: "unavailable",
          reason: "consent_required",
          text: "",
          citations: [],
          sources: [],
          left_out_messages: 0,
          unverified_citations: 0,
          truncated: false,
          saved: false,
        },
      });
      return;
    }
    await ask(trimmed, { savedNoticeShown: saving });
  }

  if (!open) return consentDialog;
  return (
    <>
      {createPortal(
        <aside
          aria-label={ASK_COPY.name}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-border bg-popover text-popover-foreground animate-in slide-in-from-right duration-300 sm:w-[440px] sm:rounded-l-2xl sm:border-l"
          onKeyDown={(event) => {
            // Escape inside the panel only, and only when nothing inside
            // (the consent sheet, a menu) took it first.
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <div className="flex min-h-14 shrink-0 items-center gap-2 py-2.5 pl-5 pr-3">
            <h2 className="min-w-0 flex-1 text-lg font-bold leading-[26px]">
              {ASK_COPY.name}
            </h2>
            <IconButton
              label={ASK_COPY.close}
              onClick={close}
              className="shrink-0 text-muted-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
          <PanelBody>
            {shown ? (
              <AskExchangeView
                exchange={shown}
                onRetry={() => void submit(shown.question)}
                onAnswerConsent={() => void submit(shown.question)}
                onFollowSource={() => {
                  if (!window.matchMedia?.(BESIDE_PAGE_QUERY).matches) close();
                }}
              />
            ) : (
              <AskEmpty onPick={(example) => void submit(example)} />
            )}
          </PanelBody>
          <form
            className="shrink-0 space-y-2 border-t border-border px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(draft);
            }}
          >
            <div className="flex items-end gap-2">
              <Textarea
                ref={field}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void submit(draft);
                  }
                }}
                rows={2}
                maxLength={ASK_QUESTION_MAX_LENGTH}
                placeholder={ASK_COPY.placeholder}
                aria-label={ASK_COPY.placeholder}
                className="min-h-[64px] resize-none"
              />
              <Button
                type="submit"
                size="icon"
                className="shrink-0"
                aria-label={ASK_COPY.send}
                title={ASK_COPY.send}
                disabled={working || draft.trim().length === 0}
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {/*
              Two lines high whichever line it holds, so the saved notice
              arriving with the status read never moves the field.
            */}
            <p className="min-h-9 text-caption text-muted-foreground">
              {saving && savedUntil
                ? askSavedLine(formatAiAnswerDate(savedUntil))
                : ASK_COPY.single_shot}
            </p>
          </form>
        </aside>,
        document.body,
      )}
      {consentDialog}
    </>
  );
}

/** Before the first question: what Ask answers from, and three to try. */
function AskEmpty({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {ASK_COPY.empty_title}
        </p>
        <p className="text-sm text-muted-foreground">{ASK_COPY.empty_body}</p>
      </div>
      <ul className="space-y-1.5">
        {ASK_COPY.examples.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => onPick(example)}
              className={cn(
                "w-full rounded-md border border-border px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-card-hover",
                FOCUS_RING,
              )}
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
