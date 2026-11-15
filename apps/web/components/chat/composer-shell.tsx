"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DispatchResult } from "@repo/chat-core/dispatch";
import { FOCUS_RING_WITHIN } from "@/components/ui/focus";
import { noteComposerShellFocusable } from "@/lib/chat/cold-load-marks";
import type { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";

/*
 * The composer's parts that need no editor: its geometry, the shell that
 * stands in for it, and the helpers the chat shell shares with it. Kept apart
 * from `composer.tsx` so the chat shell can import them without pulling
 * Tiptap and ProseMirror into every dashboard route's first download (#5050).
 */

/**
 * The composer's geometry, in one place, so the shell and the real composer
 * cannot drift apart.
 *
 * `1s` budgets **zero CLS above the composer**, and the composer is the bottom
 * of a bottom-aligned column: chat opens at the end of the timeline, so a
 * composer that changes height on arrival pushes every row above it. These four
 * strings are the whole contract — the outer box, the framed well, the editable
 * surface's height envelope, and the toolbar row — and both `ComposerShell` and
 * `Composer` are built from them rather than from hand-copied class lists.
 *
 * They are constants rather than a shared wrapper component because the real
 * composer's well also carries a focus ring and holds a reply strip and
 * attachment chips above its editor. A wrapper that absorbed all of that would
 * be the composer; a wrapper that absorbed only the outer `<div>` would leave
 * the well — the part whose padding actually sets the height — free to drift.
 */
export const COMPOSER_BOX_CLASS = "border-t border-border p-3";
export const COMPOSER_WELL_CLASS =
  "rounded-md border border-control-edge bg-surface-1 p-2 transition-colors";
export const COMPOSER_INPUT_CLASS =
  "min-h-[40px] max-h-40 overflow-y-auto text-base leading-[25px] focus:outline-none";
/**
 * The toolbar row's reserved height, for the shell that has no controls to put
 * on it.
 *
 * `pointer-coarse:h-11` is not decoration and is not what `ComposerSkeleton`
 * reserved: `compactControlClassName` is `h-8 pointer-coarse:h-11` and the Send
 * button carries the same pair, so on a touch device the real row is 44px and
 * the old skeleton reserved 32px — a 12px shift directly above the composer on
 * exactly the devices least able to absorb it. `Composer` does not use this
 * constant; its row's height is intrinsic. See the comment at that row.
 */
export const COMPOSER_TOOLBAR_CLASS = "mt-2 h-8 pointer-coarse:h-11";

/** The accessible name the shell and the real editor share — see `ComposerShell`. */
export const COMPOSER_LABEL = "Message composer";

/**
 * Grow a `<textarea>` to its content, the way the editor that replaces it does.
 *
 * Not cosmetic, and not optional. `COMPOSER_INPUT_CLASS` gives both surfaces the
 * same *envelope* — `min-h-[40px] max-h-40` — but a textarea does not grow
 * inside it on its own, while ProseMirror's contenteditable does. Left alone,
 * the shell stays one line tall while the member types five, and then
 * `<Composer>` mounts, renders those five lines at their real height, and
 * pushes the whole bottom-aligned timeline up — the exact shift `1s` budgets at
 * zero and this component exists to remove. `max-h-40` still caps it in CSS, so
 * past ten lines both surfaces scroll instead.
 */
function fitToContent(node: HTMLTextAreaElement): void {
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
}

/**
 * The composer, before there is a channel to send to: a real `<textarea>` that
 * takes focus and takes text, and hands both to `Composer` when the channel
 * resolves.
 *
 * ## Why this exists at all
 *
 * `1s` puts **"composer shell"** in the 0ms SSR set beside the nav and the
 * channel column — "static markup in the RSC payload; no client query gates
 * it" — and budgets **composer focusable <= 400ms**. `chat-shell.tsx` gates
 * `<Composer>` on `activeChannel`, which is derived from the channel list, so
 * before #2176 nothing in the thread column could take focus until
 * `GET /v1/channels` resolved, so the budget was gated on a network round trip.
 *
 * The first-chunk read cache
 * ([`lib/chat/first-chunk-cache.ts`](../../lib/chat/first-chunk-cache.ts))
 * has since made that round trip skippable on a warm load — but it does not
 * retire this component, and the two are independent on purpose. A cold cache,
 * a first-ever visit, a wiped profile or a blocked IndexedDB all still wait on
 * the network, and the measured split says so: `composer-focusable` is the same
 * ~186ms with the cache warm or cold, because the shell never waited on the
 * channel list in the first place
 * (`spec/ui/resilience/performance-budgets.md` § Cached channel readable).
 *
 * ## Why a `<textarea>` and not an early Tiptap editor
 *
 * Because this one is focusable *before hydration*. It is ordinary markup in
 * the SSR payload, so the browser can focus it and accept keystrokes from first
 * paint — with `/chat` carrying ~830 KB of its own eager JS, that is a long way
 * ahead of the first client commit. Tiptap cannot do this: `useEditor` runs
 * `immediatelyRender: false`, so no contenteditable exists until the editor is
 * constructed on the client, and constructing one here would mean paying for
 * ProseMirror twice and then throwing the first one away.
 *
 * ## Why it is uncontrolled
 *
 * No `value` prop, deliberately. Text typed before hydration lives only in the
 * DOM node, and an uncontrolled `<textarea>` is the one shape React will not
 * reconcile against a prop it thinks is authoritative. The parent still learns
 * every keystroke through `onTextChange`, which is what survives this
 * component's own unmount — see `chat-shell.tsx`, which holds the text, not
 * this component.
 *
 * ## Why it does not submit
 *
 * There is no channel yet, so there is nothing a send could be addressed to.
 * Enter is swallowed rather than allowed through: letting it insert a newline
 * would silently convert "the member pressed send" into a stray leading blank
 * line that arrives in the editor a moment later. Shift+Enter still breaks a
 * line, which is what it does in the real composer.
 *
 * This replaces the inert `aria-hidden` `ComposerSkeleton` that #2145 added to
 * hold the box open. That component's objection to a focusable placeholder —
 * "a focusable-looking control that cannot take a message is worse than an
 * obvious placeholder" — is answered rather than overruled: this one takes the
 * message.
 */
export function ComposerShell({
  onTextChange,
  onFocusChange,
  defaultValue,
  hint = "Still opening your channels. You can keep typing.",
}: {
  /** Every keystroke, so the text outlives this component's unmount. */
  onTextChange?: (text: string) => void;
  /** Focus entering or leaving, so the upgrade knows whether to carry focus. */
  onFocusChange?: (focused: boolean) => void;
  /**
   * The channel's saved draft, when the shell stands in for a channel's
   * composer while the editor's code loads (#5050). Read once, at mount.
   */
  defaultValue?: string;
  /** Why Enter can't send yet: what the shell is waiting for. */
  hint?: string;
}) {
  const input = useRef<HTMLTextAreaElement | null>(null);
  /**
   * Whether the member has pressed Enter with nothing to send to yet.
   *
   * `connection-state.md` does not allow a control to swallow an activation
   * silently — "a control that silently ignores a click is the dead control",
   * and the reason has to be *on the control* rather than a sentence somewhere
   * near it. The `aria-describedby` below carries it for a screen reader from
   * the first render; this makes it visible once the member has actually asked
   * for something this composer cannot do yet.
   */
  const [pressedEnter, setPressedEnter] = useState(false);
  const hintId = useId();

  useEffect(() => {
    /*
      Recorded on mount rather than emitted on mount, and `cold-load-marks.ts`
      owns why: the timestamp is the honest answer to "composer focusable", but
      whether this load ever had a composer at all is not known until `can_post`
      arrives with the channel. The mark is emitted later, back-dated to here.
    */
    noteComposerShellFocusable();

    /*
      Adopt whatever happened before React was here.

      This is the half that makes "focusable at first paint" worth anything.
      The textarea is in the SSR payload, so a member can focus it and type into
      it while the chat chunk is still parsing — but `onChange` and `onFocus`
      are React's, and React is not attached yet, so those keystrokes and that
      focus exist only in the DOM. Nothing downstream would ever hear about
      them, and the text would be dropped by the upgrade it was typed to
      survive.

      Reading the node once on mount is what bridges it. It is also why this
      component is uncontrolled: React had to leave the value alone for there to
      be anything here to read.
    */
    const node = input.current;
    if (!node) return;
    if (node.value) {
      onTextChange?.(node.value);
      /*
        Pre-hydration text can be several lines, and a textarea cannot grow
        without JS — so it has been scrolling inside a 40px box since the member
        typed it, and one reflow when the bundle lands is unavoidable. Doing it
        here takes that reflow at hydration rather than deferring it to the
        Tiptap upgrade, where it would land on top of the swap. Not a
        `useLayoutEffect`: this component renders on the server, where React
        warns about one, and the reflow happens either way.
      */
      fitToContent(node);
    }
    if (document.activeElement === node) onFocusChange?.(true);
    // Mount only, deliberately: this is about the gap before hydration, and
    // re-running it on a changed callback would re-report stale keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={COMPOSER_BOX_CLASS}>
      <div className={cn(COMPOSER_WELL_CLASS, FOCUS_RING_WITHIN)}>
        <textarea
          ref={input}
          // `rows={1}` plus the shared min-height, not a rows-based height:
          // `min-h-[40px]` is what the real editor uses, and matching it is the
          // whole CLS argument above.
          rows={1}
          defaultValue={defaultValue}
          aria-label={COMPOSER_LABEL}
          placeholder="Write a message"
          // Not `composerPlaceholder(...)`: that needs a channel name, and the
          // channel is exactly what has not arrived. The text changes once on
          // upgrade, inside a box whose size does not.
          className={cn(
            COMPOSER_INPUT_CLASS,
            "block w-full resize-none border-0 bg-transparent p-0 placeholder:text-muted-foreground",
          )}
          aria-describedby={hintId}
          onChange={(event) => {
            fitToContent(event.currentTarget);
            onTextChange?.(event.target.value);
          }}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            /*
              Never during IME composition. There, Enter commits the candidate
              the member is composing — swallowing it makes Japanese, Chinese
              and Korean input impossible to complete. The real composer's
              Enter keymap (`createKeymap` in `./chat-editor`) avoids this by being a ProseMirror extension with real
              composition state; a DOM `keydown` is the "flaky" path its comment
              warns about, so it has to ask.
            */
            if (event.nativeEvent.isComposing) return;
            /*
              Shift+Enter is swallowed too, which the real composer does not do:
              the shell is a one-line stand-in for the moment before the editor
              loads, and a line break typed into it is not worth carrying over.
              (The draft path itself keeps line breaks now: `buildEditDoc` loads
              them as hard breaks, which `getText` gives back one for one.)
            */
            event.preventDefault();
            setPressedEnter(true);
          }}
        />
        {/*
          The real toolbar's controls all need a channel (attach, slash
          palette, send), so none of them can be here — a row of dead buttons is
          the dead-end control the release gate forbids. The row is reserved
          anyway, for the geometry, which leaves exactly the space this answer
          needs: showing it costs no layout shift because the height was already
          being held.
        */}
        <div className={cn(COMPOSER_TOOLBAR_CLASS, "flex items-center")}>
          <p
            id={hintId}
            className={cn(
              "truncate text-caption text-muted-foreground",
              // Present from the first render either way, so `aria-describedby`
              // always resolves and a screen reader hears why the composer
              // cannot send before trying it.
              !pressedEnter && "sr-only",
            )}
          >
            {hint}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Files one message can carry; the mobile composer's limit too. */
export const CHAT_FILE_LIMIT = 10;

/** What `onOpenCommandForm` did with a command; `null` hands it to dispatch. */
export type CommandFormOutcome = "opened" | "refused" | null;

/**
 * Toast the outcome of a slash dispatch. Shared by the two call sites (typed
 * `/command` submit and palette pick) so they cannot drift — they previously
 * held byte-identical failure branches.
 *
 * Three outcomes, not two. A `warning` on an `ok` result means the command's
 * write COMMITTED but something around it did not (a heavy command whose chat
 * card failed to post — #544). That gets a plain, non-destructive toast: styling
 * it as a failure would invite a retry, and the retry an officer actually
 * performs is re-typing the command, which mints a FRESH `client_message_id` —
 * so the server's idempotency index (#1719) does not dedupe it and a second
 * ledger row lands.
 */
export function notifyDispatchOutcome(
  toast: ReturnType<typeof useToast>["toast"],
  /**
   * What the notice is about: the typed command (`/task`), or the form's
   * thing (`Task`) for a write from the + card, which typed no command
   * (#3913).
   */
  subject: string,
  result: DispatchResult,
): void {
  if (!result.ok) {
    toast({
      title: `${subject} failed`,
      description: result.error ?? "Couldn't run that command.",
      variant: "destructive",
    });
    return;
  }
  if (result.resolved) {
    toast({
      title: `${subject} recorded`,
      description: result.resolved,
      // Sticky for the same reason as the branches below: the retry removed the
      // placeholder, and the outage that lost the original response is likely to
      // have dropped the card's Realtime echo too — so for a moment this notice
      // can be the only visible evidence of a real ledger write. Five seconds
      // later the officer would see an empty channel and re-type.
      duration: Infinity,
    });
    return;
  }
  // An UNKNOWN outcome is neither of the two above, and titling it as either is
  // a real hazard rather than a wording nit (#1733). "failed" invites the
  // re-typed command that double-grants; "partly succeeded" asserts a write
  // that may never have happened, which on a `/points deduct` reads as "the
  // fine landed" and silently loses it.
  if (result.unconfirmed) {
    toast({
      title: `${subject} not confirmed`,
      description: result.warning ?? "Couldn't confirm that command.",
      // Sticky, like the committed-write warning below and for the same reason:
      // an outcome nobody can reconstruct must not disappear on a 5s timer.
      //
      // Sticky is NOT durable. `use-toast`'s reducer is
      // `[action.toast, ...state.toasts].slice(0, TOAST_LIMIT)` with a limit
      // of 1, so the NEXT toast — any toast — evicts this one outright, with
      // no dismissal and no animation. `duration: Infinity` survives time,
      // not other toasts. The durable trace here is the `unconfirmed` row
      // (Retry under the original key), not a `recorded` row — that status
      // is the `card_posted: false` path (#1789), where the write is known.
      duration: Infinity,
    });
    return;
  }
  if (result.warning) {
    toast({
      title: `${subject} partly succeeded`,
      description: result.warning,
      // Sticky (Radix skips the close timer on `Infinity`) because the
      // committed write's durable trace is the timeline `recorded` row
      // (#1789); this toast is the secondary notice and is still evictable
      // by the next toast (`TOAST_LIMIT = 1`). At the default 5s an officer
      // who looked away would only have the row — keep the toast long enough
      // to be seen once.
      duration: Infinity,
    });
  }
}
