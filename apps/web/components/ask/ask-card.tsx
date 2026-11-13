"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, SquarePen, X } from "lucide-react";
import {
  useActStatus,
  useAsk,
  useAskStatus,
  useAskSuggestions,
  useMyPermissions,
  type AskOptions,
} from "@repo/hooks";
import {
  ASK_COPY,
  ASK_QUESTION_MAX_LENGTH,
  askSavedLine,
  can,
  formatAiAnswerDate,
  type AskSuggestion,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import { AskTurn } from "@/components/ask/ask-answer";
import { FrappCrest } from "@/components/ask/frapp-crest";
import {
  AskCardEditsContext,
  type AskCardEditsStore,
} from "@/components/ask/ask-proposal";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Ask Frapp on web (#450, #451, #718): one conversation with Frapp, in a
 * card that opens over the chat. The member types in one field; Frapp
 * answers from the chapter's sources, each claim marked with the source it
 * came from, or shows a card for something they asked to have done.
 *
 * **Over the chat, from the composer** (#4702, Paul 2026-11-13). It was a
 * 440px panel docked to the right edge of the window, opened from a pill in
 * the top bar, and the shell moved over to make room. Paul: "I don't want it
 * to be that side card", and Ask belongs "in the channels, and that's where
 * we want everything to live anyway". So the conversation rises from the
 * chat composer, where its button is (`ask-host.tsx`), and covers the lower
 * part of the thread at the composer's own width. Nothing dims and nothing
 * moves: the channel header, the messages above the card and the composer
 * under it stay live, as they do behind the composer's + card
 * (`composer-plus-card.tsx`). Following a source opens its page beside the
 * chat and leaves the conversation where it was, with two exceptions. A
 * cited chat message is in the thread the card covers, so following one
 * closes the card (the conversation is kept, and the button reopens it). And
 * in a window too narrow for a page beside chat, the page takes chat's place
 * and the card waits with it, as below.
 *
 * **The app's own background, not a raised surface** (Paul, 2026-11-13: the
 * popover grey was "way too different from the rest of the app"). The card
 * is `bg-background`, the colour of the thread it sits over, and is told
 * from it by its border and the shadow above it.
 *
 * It is drawn into the slot chat provides (`AskSlot`) and owned by
 * `AskHost` above the whole dashboard, so the thread is the same thread in
 * every channel, and is still there after a tool page covered the chat. With
 * no slot on screen there is nothing to draw it over, and it waits.
 *
 * It closes by its X, by the composer's button, or by Escape pressed inside
 * it. It is its own small `section`, not a Radix popover or dialog: either
 * would take Escape and outside clicks from the whole document, which would
 * close the conversation (and drop an answer in flight) when a member
 * dismissed a mention list or clicked into the composer beside it.
 *
 * **One conversation, one field** (2026-11-13, owner; `spec/behavior/ai.md`
 * § One conversation). There were two sides here, Ask and Do, under a
 * switch, and each showed one exchange at a time. ChatGPT, Claude, Slack's
 * assistant and Notion AI all take a question and a request in the same
 * field and let the assistant work out which it is, and all keep the thread
 * on screen so a follow-up can lean on what came before. So the card is a
 * thread: each turn stays, the turns before a question are sent with it,
 * and a member who may have Frapp act gets a card to confirm when what they
 * typed asks for something to be done. A member who may not gets answers
 * only, from the same field. The header's New conversation button clears
 * the thread.
 *
 * The thread is this sitting's: it survives a close and reopen, and is gone
 * on reload. A question still being answered when the card closes is
 * dropped; the turns before it stay.
 *
 * **It opens on the member's own account** (#4700, owner 2026-11-13: "not
 * just be like some presets"). Before the first turn the card offers up to
 * three questions and one request the server built from what this member's
 * account holds now: their next event, their open tasks, minutes they can
 * read, their points. There is no fixed list; a member with nothing to ask
 * about sees the two lines of the opening and the field. They are read when
 * the card opens and fade in under the opening words, where nothing sits
 * below them to move. A tapped question is sent as a suggestion, never as
 * words the member typed (`useAsk`'s `suggested`).
 *
 * **Consent is asked at the first question**, not when the card opens
 * (`useAiConsentGate`; `ai.md` § Consent). The question shows in the thread
 * first, so the sheet opens over the words it is about. The server checks
 * again.
 *
 * **The saved line.** While the beta diagnostics window is on for this
 * chapter, a line above the field says questions and answers are saved and
 * until when, where the member reads it as they type, and only then does a
 * question carry `saved_notice_shown`: the server keeps nothing from a
 * client that did not show it. The status is read as soon as the entry
 * exists, and again each time the card opens, so the line is in place when
 * the card comes up and is true at the moment of asking.
 */
/**
 * The entry on screen (`AskComposerButton` carries the attribute). The
 * composer is remounted for each channel, so the button that opened the
 * conversation is often not the one there when it closes; the card looks the
 * live one up to return focus to it.
 */
const ASK_ENTRY_SELECTOR = "[data-ask-entry]";

/** Within this of the bottom, the member is reading the newest words. */
const FOLLOW_SLACK_PX = 80;

export function AskCard({
  open,
  onOpenChange,
  returnFocus,
  container,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opened it, which takes focus back when it closes. */
  returnFocus?: RefObject<HTMLElement | null>;
  /** Where it is drawn (`AskSlot`), or `null` while chat is not on screen. */
  container: HTMLElement | null;
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
  const { suggestions } = useAskSuggestions({ enabled: open });
  // What was changed on waiting cards, kept while the card is closed.
  const [cardEdits] = useState<AskCardEditsStore>(() => new Map());
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

  // A question still being answered is dropped with the card, however it
  // was closed; the turns before it are there when it reopens.
  useEffect(() => {
    if (!open && working) stop();
  }, [open, working, stop]);

  // Whether answers are being saved can change while the page sits open.
  useEffect(() => {
    if (open) void refetchStatus({ cancelRefetch: false });
  }, [open, refetchStatus]);

  // On screen only where chat gave it a place to be.
  const shown = open && container !== null;

  // Focus follows the member's own open and close, not the card coming and
  // going with chat: a card left open while a tool page covered the chat is
  // drawn again on the way back, and must not pull the cursor into its field
  // (on a phone, that raises the keyboard).
  const focusOnShow = useRef(false);
  useEffect(() => {
    if (!open) return;
    focusOnShow.current = true;
    const opener = returnFocus?.current ?? null;
    return () => {
      focusOnShow.current = false;
      // Only when focus would otherwise fall to the body: a member who
      // closed the card from the page keeps their place there.
      if (document.activeElement && document.activeElement !== document.body)
        return;
      // The button that opened it, or the one on screen now: the composer is
      // remounted for each channel, so after a change of channel the opener
      // is a detached node.
      const entry = opener?.isConnected
        ? opener
        : document.querySelector<HTMLElement>(ASK_ENTRY_SELECTOR);
      entry?.focus({ preventScroll: true });
    };
  }, [open, returnFocus]);
  useEffect(() => {
    if (!shown || !focusOnShow.current) return;
    focusOnShow.current = false;
    field.current?.focus({ preventScroll: true });
  }, [shown]);

  // The field grows with what is typed. `field-sizing: content` does that
  // where the browser has it; elsewhere the height is set from the text, or a
  // long question would be read one line at a time.
  useEffect(() => {
    const element = field.current;
    if (!shown || !element) return;
    if (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content"))
      return;
    element.style.height = "auto";
    if (element.scrollHeight > 0)
      element.style.height = `${element.scrollHeight}px`;
  }, [shown, draft]);

  // A new turn, or the card opening on a thread, shows the newest words.
  useEffect(() => {
    const element = scroller.current;
    if (!shown || !element) return;
    element.scrollTop = element.scrollHeight;
    following.current = true;
  }, [shown, last?.id]);

  // The newest turn growing keeps its last line in view, unless the member
  // scrolled up to read something else.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !following.current) return;
    element.scrollTop = element.scrollHeight;
  }, [last?.preview, last?.phase, last?.proposal, last?.resolution]);

  // A card fills in after it lands (who it covers, the event it means), so
  // the thread's own height is followed too, not only the turn changing.
  // Only once there is a turn: the opening's rows arriving in a short window
  // must not scroll the opening's own first lines out of view.
  const thread = useRef<HTMLDivElement>(null);
  const hasTurn = last !== undefined;
  useEffect(() => {
    const element = thread.current;
    if (!shown || !hasTurn || !element || typeof ResizeObserver === "undefined")
      return;
    const observer = new ResizeObserver(() => {
      const view = scroller.current;
      if (view && following.current) view.scrollTop = view.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown, hasTurn]);

  function close() {
    onOpenChange(false);
  }

  const options = (): AskOptions => ({
    savedNoticeShown: saving,
    // Asked for on the permission alone, which is already loaded. The list
    // of actions only words the opening: a request typed before it arrives,
    // or after it failed to load, must still come back as a card.
    actions: mayAct,
    gate: ensureConsent,
  });

  function submit(text: string) {
    if (!text.trim() || working) return;
    setDraft("");
    void ask(text, options());
  }

  function pick(suggestion: AskSuggestion) {
    if (working) return;
    // A question can name a record someone else wrote, so it is sent as a
    // suggestion. The one request holds none and is sent like typed words.
    void ask(suggestion.text, {
      ...options(),
      suggested: !suggestion.request,
    });
  }

  if (!shown) return consentDialog;
  return (
    <>
      {createPortal(
        <section
          aria-label={ASK_COPY.name}
          // Hung from the slot's top edge, which is the composer's: it grows
          // upward over the thread as the conversation does, to a height that
          // leaves the channel's header and the composer in view.
          className="absolute inset-x-3 bottom-2 flex max-h-[min(40rem,calc(100dvh-15rem))] min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-[0_-16px_48px_-12px_rgb(0_0_0/0.7)] animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
          onKeyDown={(event) => {
            // Escape inside the card only, and only when nothing inside
            // (the consent sheet, a menu) took it first.
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <div className="flex min-h-12 shrink-0 items-center gap-1 py-1.5 pl-4 pr-2">
            <FrappCrest className="h-[18px] w-[15px] shrink-0 text-primary" />
            <h2 className="ml-1.5 min-w-0 flex-1 text-base font-bold leading-6">
              {ASK_COPY.name}
            </h2>
            {exchanges.length > 0 ? (
              <IconButton
                label={ASK_COPY.new_conversation}
                onClick={() => {
                  reset();
                  cardEdits.clear();
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
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1"
          >
            <AskCardEditsContext.Provider value={cardEdits}>
              {/* A column for reading: the card is as wide as the chat. */}
              <div ref={thread} className="flex max-w-2xl flex-col gap-6">
                {exchanges.length > 0 ? (
                  exchanges.map((exchange) => (
                    <AskTurn
                      key={exchange.id}
                      exchange={exchange}
                      busy={working && exchange.phase !== "working"}
                      onFollowMessage={close}
                      onRetry={() => void retry(exchange.id, options())}
                      onAnswerConsent={() => void retry(exchange.id, options())}
                      onProposal={(proposal) =>
                        setProposal(exchange.id, proposal)
                      }
                      onResolved={(resolution) =>
                        resolveProposal(exchange.id, resolution)
                      }
                    />
                  ))
                ) : (
                  <AskEmpty
                    canAct={canAct}
                    suggestions={suggestions}
                    onPick={pick}
                  />
                )}
              </div>
            </AskCardEditsContext.Provider>
          </div>
          <form
            className="shrink-0 border-t border-border px-4 py-3"
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
                rows={1}
                maxLength={ASK_QUESTION_MAX_LENGTH}
                placeholder={ASK_COPY.placeholder}
                aria-label={ASK_COPY.placeholder}
                className="max-h-40 min-h-10 resize-none [field-sizing:content]"
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
        </section>,
        container,
      )}
      {consentDialog}
    </>
  );
}

/**
 * Before the first turn: what Frapp answers from, and what this member could
 * ask about their own account right now. A member Frapp can act for is told
 * so. With nothing to suggest, the two lines stand alone.
 */
function AskEmpty({
  canAct,
  suggestions,
  onPick,
}: {
  /** Frapp can take at least one action for this member. */
  canAct: boolean;
  suggestions: readonly AskSuggestion[];
  onPick: (suggestion: AskSuggestion) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {ASK_COPY.empty_title}
        </p>
        <p className="text-sm text-muted-foreground">
          {ASK_COPY.empty_body}
          {canAct ? ` ${ASK_COPY.empty_body_act}` : ""}
        </p>
      </div>
      {suggestions.length > 0 ? (
        // Fades in when it arrives. Nothing sits below it, so nothing moves.
        <ul className="space-y-1.5 animate-in fade-in duration-300 motion-reduce:animate-none">
          {suggestions.map((suggestion) => (
            <li key={suggestion.text}>
              <button
                type="button"
                onClick={() => onPick(suggestion)}
                className={cn(
                  "w-full rounded-md border border-border px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-card-hover",
                  FOCUS_RING,
                )}
              >
                {suggestion.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
