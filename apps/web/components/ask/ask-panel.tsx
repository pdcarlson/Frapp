"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, SquarePen, X } from "lucide-react";
import {
  useActStatus,
  useAsk,
  useAskStatus,
  useMyPermissions,
  type AskOptions,
} from "@repo/hooks";
import {
  ACT_COPY,
  ASK_COPY,
  ASK_QUESTION_MAX_LENGTH,
  askSavedLine,
  can,
  formatAiAnswerDate,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/ai-consent-sheet";
import { AskTurn } from "@/components/ask/ask-answer";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Ask Frapp on web (#450, #451, #718): a panel on the right edge that holds
 * one conversation with Frapp. The member types in one field; Frapp answers
 * from the chapter's sources, each claim marked with the source it came
 * from, or shows a card for something they asked to have done.
 *
 * **Beside the page, not over it.** Slack AI and Notion AI both answer in a
 * side panel that leaves the workspace usable, because the next thing a
 * member does with an answer is open what it cites. So this is not a dialog:
 * nothing dims, the page stays live, and from `lg` up the shell moves over
 * to make room (`ASK_OPEN_ATTRIBUTE`, read by `dashboard-shell.tsx`), so the
 * top bar and the page a source opens are never under the panel. Following a
 * source leaves the conversation where it was. Below `lg` there is no room
 * for both, so the panel covers the page and following a source closes it;
 * the conversation is there when the panel reopens.
 *
 * It closes by its X, by the pill, or by Escape pressed inside it. It is its
 * own small `aside`, not the Radix sheet: a Radix dialog takes Escape from
 * the whole document while it is the top layer, which would close the panel
 * (and drop an answer in flight) when a member dismissed a mention list in
 * the chat composer beside it. It is narrower than a form panel
 * (`panel.tsx`'s 576px) because it shares the screen.
 *
 * **One conversation, one field** (2026-11-13, owner; `spec/behavior/ai.md`
 * § One conversation). There were two sides here, Ask and Do, under a
 * switch, and each showed one exchange at a time. ChatGPT, Claude, Slack's
 * assistant and Notion AI all take a question and a request in the same
 * field and let the assistant work out which it is, and all keep the thread
 * on screen so a follow-up can lean on what came before. So the panel is a
 * thread: each turn stays, the turns before a question are sent with it,
 * and a member who may have Frapp act gets a card to confirm when what they
 * typed asks for something to be done. A member who may not gets answers
 * only, from the same field. The header's New conversation button clears
 * the thread.
 *
 * The thread is this sitting's: it survives a close and reopen, and is gone
 * on reload. A question still being answered when the panel closes is
 * dropped; the turns before it stay.
 *
 * **Consent is asked at the first question**, not when the panel opens
 * (`useAiConsentGate`; `ai.md` § Consent). The question shows in the thread
 * first, so the sheet opens over the words it is about. The server checks
 * again.
 *
 * **The saved line.** While the beta diagnostics window is on for this
 * chapter, a line above the field says questions and answers are saved and
 * until when, where the member reads it as they type, and only then does a
 * question carry `saved_notice_shown`: the server keeps nothing from a
 * client that did not show it. The status is read as soon as the entry
 * exists, and again each time the panel opens, so the line is in place when
 * the panel slides in and is true at the moment of asking.
 */
/** On `<html>` while the panel is open: the shell makes room from `lg` up. */
const ASK_OPEN_ATTRIBUTE = "data-ask-open";

/** Tailwind's `lg`: from here the page and the panel fit side by side. */
const BESIDE_PAGE_QUERY = "(min-width: 1024px)";

/** Within this of the bottom, the member is reading the newest words. */
const FOLLOW_SLACK_PX = 80;

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
  const {
    exchanges,
    working,
    ask,
    retry,
    setProposal,
    resolveProposal,
    stop,
    reset,
  } = useAsk();
  const status = useAskStatus();
  const refetchStatus = status.refetch;
  const { ensureConsent, consentDialog } = useAiConsentGate();
  // No request for a member without `ai:act`: the server would answer 403.
  const permissions = useMyPermissions().data?.permissions;
  const mayAct = !!permissions && can("ai:act", permissions);
  const actions = useActStatus({ enabled: open && mayAct }).data ?? null;
  const canAct = actions !== null && actions.length > 0;
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Whether the member is reading the newest words: only then does the
  // thread follow an answer as it grows.
  const following = useRef(true);

  const savedUntil = status.data?.saved_until ?? null;
  // The server sends a date only while the window is open.
  const saving = savedUntil !== null;
  const last = exchanges.at(-1);

  // A question still being answered is dropped with the panel, however it
  // was closed; the turns before it are there when it reopens.
  useEffect(() => {
    if (!open && working) stop();
  }, [open, working, stop]);

  // Whether answers are being saved can change while the page sits open.
  useEffect(() => {
    if (open) void refetchStatus({ cancelRefetch: false });
  }, [open, refetchStatus]);

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

  // A new turn, or the panel opening on a thread, shows the newest words.
  useEffect(() => {
    const element = scroller.current;
    if (!open || !element) return;
    element.scrollTop = element.scrollHeight;
    following.current = true;
  }, [open, last?.id]);

  // The newest turn growing keeps its last line in view, unless the member
  // scrolled up to read something else.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !following.current) return;
    element.scrollTop = element.scrollHeight;
  }, [last?.preview, last?.phase, last?.proposal, last?.resolution]);

  function close() {
    onOpenChange(false);
  }

  function leave() {
    if (!window.matchMedia?.(BESIDE_PAGE_QUERY).matches) close();
  }

  const options = (): AskOptions => ({
    savedNoticeShown: saving,
    actions: canAct,
    gate: ensureConsent,
  });

  function submit(text: string) {
    if (!text.trim() || working) return;
    setDraft("");
    void ask(text, options());
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
          <div className="flex min-h-14 shrink-0 items-center gap-1 py-2.5 pl-5 pr-3">
            <h2 className="min-w-0 flex-1 text-lg font-bold leading-[26px]">
              {ASK_COPY.name}
            </h2>
            {exchanges.length > 0 ? (
              <IconButton
                label={ASK_COPY.new_conversation}
                onClick={() => {
                  reset();
                  field.current?.focus({ preventScroll: true });
                }}
                className="shrink-0 text-muted-foreground"
              >
                <SquarePen className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            ) : null}
            <IconButton
              label={ASK_COPY.close}
              onClick={close}
              className="shrink-0 text-muted-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
          <div
            ref={scroller}
            onScroll={(event) => {
              const element = event.currentTarget;
              following.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                FOLLOW_SLACK_PX;
            }}
            className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pb-5 pt-3"
          >
            {exchanges.length > 0 ? (
              exchanges.map((exchange) => (
                <AskTurn
                  key={exchange.id}
                  exchange={exchange}
                  onRetry={() => void retry(exchange.id, options())}
                  onAnswerConsent={() => void retry(exchange.id, options())}
                  onFollowSource={leave}
                  onProposal={(proposal) => setProposal(exchange.id, proposal)}
                  onResolved={(resolution) =>
                    resolveProposal(exchange.id, resolution)
                  }
                />
              ))
            ) : (
              <AskEmpty
                actions={canAct ? actions : null}
                onPick={(example) => submit(example)}
              />
            )}
          </div>
          <form
            className="shrink-0 border-t border-border px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit(draft);
            }}
          >
            {saving && savedUntil ? (
              <p className="mb-2 text-caption text-muted-foreground">
                {askSavedLine(formatAiAnswerDate(savedUntil))}
              </p>
            ) : null}
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
                    submit(draft);
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
          </form>
        </aside>,
        document.body,
      )}
      {consentDialog}
    </>
  );
}

/**
 * Before the first turn: what Frapp answers from, and a few things to try.
 * A member Frapp can act for is told so, and offered one request beside the
 * questions.
 */
function AskEmpty({
  actions,
  onPick,
}: {
  /** The actions this member can ask for, or null when they cannot. */
  actions: readonly string[] | null;
  onPick: (question: string) => void;
}) {
  const request = (actions ?? []).flatMap((action) => {
    const example = (ACT_COPY.examples as Record<string, string>)[action];
    return example ? [example] : [];
  })[0];
  const examples = [...ASK_COPY.examples, ...(request ? [request] : [])];
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {ASK_COPY.empty_title}
        </p>
        <p className="text-sm text-muted-foreground">
          {ASK_COPY.empty_body}
          {actions ? ` ${ASK_COPY.empty_body_act}` : ""}
        </p>
      </div>
      <ul className="space-y-1.5">
        {examples.map((example) => (
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
