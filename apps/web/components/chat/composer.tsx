"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import dynamic from "next/dynamic";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import { Extension } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_WITHIN } from "@/components/ui/focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AttachGlyph,
  OfflineGlyph,
  ReactionGlyph,
  SlashCommandGlyph,
} from "./chat-glyphs";
import { cn } from "@/lib/utils";
import { CHAT_CONTROL_CLASS } from "./chip";
import {
  useChapterRoster,
  useRequestChatUploadUrl,
  useUploadSignedUrl,
} from "@repo/hooks";
import * as Sentry from "@sentry/nextjs";
import type { OutboxAttachment } from "@repo/chat-core/adapters";
// Imported, never restated. A structural copy of this shape is assignable even
// when it is missing a field, so a hand-written `{ ok, error? }` silently erases
// any outcome added later — which is exactly what happened at the
// `use-chat-channel` boundary before #544 added `warning`.
import type { DispatchResult } from "@repo/chat-core/dispatch";
import { useToast } from "@/hooks/use-toast";
import { readSignedUpload } from "@/lib/signed-upload";
import {
  COLD_LOAD_MARKS,
  markColdLoad,
  markComposerFocusable,
  noteComposerShellFocusable,
} from "@/lib/chat/cold-load-marks";
import {
  MAX_UPLOAD_LABEL,
  acceptAttribute,
  inspectUploadFile,
} from "@repo/validation";
import { EmojiPicker } from "./emoji-picker";
import { QuotedMessage } from "./reply-quote";
import {
  createMentionSuggestion,
  type MentionRosterEntry,
} from "./mention-suggestion";
import {
  getSlashCommand,
  parseSlashInput,
  type SlashCommand,
} from "@repo/chat-integrations";

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
  "rounded-md border border-input bg-surface-1 p-2 transition-colors";
export const COMPOSER_INPUT_CLASS =
  "min-h-[40px] max-h-40 overflow-y-auto text-base leading-[25px] focus:outline-none";
/**
 * The toolbar row's reserved height, for the shell that has no controls to put
 * on it.
 *
 * `pointer-coarse:h-11` is not decoration and is not what `ComposerSkeleton`
 * reserved: `CHAT_CONTROL_CLASS` is `h-8 pointer-coarse:h-11` and the Send
 * button carries the same pair, so on a touch device the real row is 44px and
 * the old skeleton reserved 32px — a 12px shift directly above the composer on
 * exactly the devices least able to absorb it. `Composer` does not use this
 * constant; its row's height is intrinsic. See the comment at that row.
 */
export const COMPOSER_TOOLBAR_CLASS = "mt-2 h-8 pointer-coarse:h-11";

/** The accessible name the shell and the real editor share — see `ComposerShell`. */
const COMPOSER_LABEL = "Message composer";

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
 * `GET /v1/channels` resolved. The budget was therefore gated on a network
 * round trip, and with no persisted read cache
 * (`spec/ui/resilience/performance-budgets.md` § What is not measured, and why) that
 * round trip happens on every cold load.
 *
 * ## Why a `<textarea>` and not an early Tiptap editor
 *
 * Because this one is focusable *before hydration*. It is ordinary markup in
 * the SSR payload, so the browser can focus it and accept keystrokes from first
 * paint — with `/chat` carrying ~825 KB of its own eager JS, that is a long way
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
}: {
  /** Every keystroke, so the text outlives this component's unmount. */
  onTextChange?: (text: string) => void;
  /** Focus entering or leaving, so the upgrade knows whether to carry focus. */
  onFocusChange?: (focused: boolean) => void;
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
              and Korean input impossible to complete. `createSubmitKeymap`
              below avoids this by being a ProseMirror extension with real
              composition state; a DOM `keydown` is the "flaky" path its comment
              warns about, so it has to ask.
            */
            if (event.nativeEvent.isComposing) return;
            /*
              Shift+Enter is swallowed too, which the real composer does not do.
              A newline here would not survive the handoff intact:
              `buildDocFromPlainText` splits the draft into one paragraph per
              line and Tiptap's `getText` rejoins blocks with its default
              `"\n\n"`, so every line break the shell contributes comes back
              doubled — and doubles again on each save/restore cycle. That
              asymmetry is older than this component and belongs to the draft
              path generally; what is new is the shell being able to feed it, so
              the shell stays single-line rather than widening the fix.
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
              "truncate text-[12.5px] text-muted-foreground",
              // Present from the first render either way, so `aria-describedby`
              // always resolves and a screen reader hears why the composer
              // cannot send before trying it.
              !pressedEnter && "sr-only",
            )}
          >
            Still opening your channels — you can keep typing.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * `cmdk` and a Radix Dialog, fetched when the palette is first summoned.
 *
 * The palette opens from typing `/` or from the toolbar's ⌘ button, so on most
 * cold loads it is never opened at all — but the eager import put its whole
 * dependency chain in the chunk that has to parse before the composer is
 * focusable, which `1s` budgets at 400ms. It is one of the five surfaces the
 * board names as `chat-extras`.
 *
 * Kept out of `slash-palette.tsx` itself so `slash-palette.spec.tsx` still
 * renders the real component synchronously; the composer is the thing that
 * knows when it is wanted, so the boundary belongs at this call site.
 */
const SlashPalette = dynamic(
  () => import("./slash-palette").then((m) => m.SlashPalette),
  { ssr: false },
);

/**
 * The message the next send replies to, already resolved to a label and a
 * one-line preview by the shell (#489).
 *
 * Resolved rather than a `ChatMessage`, because the shell is the only place
 * that holds the viewer id and the name resolver the label needs, and because
 * the composer must not grow a second opinion about how a message is
 * summarised — `replyPreviewText` in `@repo/chat-core/reply-preview` is the
 * one definition (web re-exports it from `./reply-quote`) and the timeline's
 * quote uses it too.
 *
 * `author: null` means the target is staged but outside the loaded window. The
 * strip still renders, in `QuotedMessage`'s unavailable variant, because the
 * alternative is a staged reply the member can neither see nor dismiss while it
 * silently attaches to their next message.
 */
export interface ComposerReplyTarget {
  id: string;
  author: string | null;
  preview: string | null;
}

/**
 * The reply half of the composer's contract, as a discriminated union so a
 * caller cannot offer a strip with no way to dismiss it.
 *
 * Written as a union rather than two optional props because that pairing is
 * unenforceable: `replyTo` set with `onCancelReply` forgotten typechecks
 * cleanly and ships a × and an Escape that both silently no-op, leaving no way
 * to unstage a reply short of switching channels. The panel this file's sibling
 * documents as "the place a composer is missing" is exactly the kind of second
 * caller that would hit it.
 */
type ComposerReplyProps =
  | { replyTo?: undefined; onCancelReply?: undefined }
  | { replyTo: ComposerReplyTarget | null; onCancelReply: () => void };

interface ComposerBaseProps {
  channelId: string;
  channelName: string;
  /**
   * Direct/group DM, in which case `channelName` is a person's name rather than
   * a channel and must not take the `#` sigil.
   */
  isDirect?: boolean;
  isReadOnly: boolean;
  /**
   * Server-decided capability (#704): whether the caller may post in this
   * channel at all, from `ChatChannel.can_post` — already folds in the
   * read-only gate (a holder of `announcements:post`, or `*`, gets `true` in
   * a read-only channel), so this is the single source of truth for whether
   * the composer renders live. Undefined defaults to `!isReadOnly`, matching
   * the pre-#704 behavior for a caller that hasn't wired this yet, or a
   * channel from the brief window before `getOrCreateDm`/`createGroupDm`'s
   * response goes through the list projection.
   */
  canPost?: boolean;
  draft: string;
  onChangeDraft: (body: string) => void;
  onSend: (
    body: string,
    attachments: OutboxAttachment[],
  ) => void | Promise<void>;
  /**
   * Invoked when the user picks a slash command from the palette. Returns a
   * dispatch result so the composer can toast on failure, or on a partial
   * success (`warning`). The args string is everything after the command token
   * (already trimmed). The composer clears its own editor on success.
   */
  onSlashDispatch?: (
    command: SlashCommand,
    args: string,
  ) => Promise<DispatchResult>;
  onTyping: () => void;
  isModuleEnabled: (moduleKey: string) => boolean;
  /**
   * Chapter recruitment vocabulary. Threaded to the palette so `/intake`
   * displays when that is the chapter's term, and to `getSlashCommand` so a
   * typed alias still dispatches as `rush`.
   */
  recruitmentVocab?: string;
  /**
   * Status of the underlying chapter-config query. `"loading"` and `"error"`
   * surface explicit states inside the slash palette instead of an empty
   * filter; defaults to `"ready"` for callers that don't gate the catalog.
   */
  slashCommandsStatus?: "loading" | "error" | "ready";
  onRetrySlashCommands?: () => void;
  /**
   * Realtime is down. The composer stays **live** and says so — it does not
   * disable.
   *
   * This used to be `disabled`, and it was a defect: `sendMessage` writes the
   * row to the Dexie outbox and returns *before* it touches the network
   * (`packages/chat-core/src/chat-client.ts`, which has an explicit
   * "Offline: the row is safely queued" branch), so gating the composer defeated
   * the queue built to make composing-while-offline work. `spec/ui/resilience/connection-state.md`
   * states the rule directly — "labeled, never blocked, wherever an outbox
   * exists" — and reserves disabling for surfaces where a failed write is lost.
   * Worse than the greyed Send: `submit()` returned early on the same flag, so
   * pressing Enter offline silently discarded what you had typed.
   */
  isOffline?: boolean;
  /**
   * Ask whether this editor should take the caret the composer shell was
   * holding — and spend the answer.
   *
   * A function rather than a boolean because the answer is true at most once
   * per document, and the thing that must not happen is a later mount
   * inheriting it: `<Composer>` is keyed on channel id and name (#1014), so
   * every channel switch is a fresh editor, and one that grabbed focus would
   * fight a member who clicked a channel and then reached for the timeline.
   * `chat-shell.tsx` owns the flag and clears it on read.
   *
   * Called from `onCreate`, never during render. Without it, a member who
   * starts typing during the channel-list round trip loses focus to
   * `document.body` the instant the channel resolves — worse than the
   * unfocusable skeleton #2176 replaced, because it interrupts someone
   * mid-sentence.
   */
  claimShellFocus?: () => boolean;
}

/**
 * The composer does **not** pass the reply target back on send: the shell owns
 * the state, so it reads its own target when it calls `channel.send`. A
 * `replyToId` threaded back out through `onSend` would be a second copy of the
 * same fact, free to disagree with the strip the member can see.
 */
type ComposerProps = ComposerBaseProps & ComposerReplyProps;

/**
 * Submit on Enter; let Shift+Enter fall through to StarterKit's default
 * hard-break. Bound as a Tiptap extension so we get full ProseMirror context
 * (composition state, etc.) instead of a flaky DOM keydown. The extension
 * reads a ref that holds the latest submit handler, so the keymap always calls
 * the current one without re-binding the extension.
 */
function createSubmitKeymap(sendRef: { current: () => void }) {
  return Extension.create({
    name: "submit-on-enter",
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          sendRef.current();
          return true;
        },
      };
    },
  });
}

/**
 * Build a Tiptap doc JSON from plain text so chars like `<`, `&`, and
 * newlines round-trip safely (Tiptap's `setContent(string)` would parse the
 * value as HTML and lose escapes / mangle reserved chars). Each line becomes
 * a paragraph; consecutive newlines yield empty paragraphs.
 */
function buildDocFromPlainText(text: string): JSONContent {
  if (text.length === 0) return { type: "doc", content: [] };
  const lines = text.split("\n");
  return {
    type: "doc",
    content: lines.map((line) =>
      line.length === 0
        ? { type: "paragraph" }
        : {
            type: "paragraph",
            content: [{ type: "text", text: line }],
          },
    ),
  };
}

/** `#` only for an actual channel — a DM's name is a person's. */
export function composerPlaceholder(channelName: string, isDirect?: boolean) {
  return isDirect ? `Message ${channelName}` : `Message #${channelName}`;
}

function slashToken(command: SlashCommand): string {
  return command.displayName ?? command.name;
}

/**
 * Await a dispatch and turn a REJECTION into a normal `{ ok: false }` outcome.
 *
 * `dispatchSlashCommand` documents itself as total — every path returns a
 * `DispatchResult` — but `/poll` and `/announce` call `sendMessage` without a
 * guard, and its outbox enqueue sits outside its own try block, so a Dexie
 * failure rejects instead. Both call sites here clear the composer (and, via
 * `onUpdate`, the persisted draft) *before* dispatching, so an unhandled
 * rejection cost the user their typed command AND every scrap of feedback.
 * `void`-ing the promise at one site and returning it into a `void`-typed
 * palette handler at the other meant nothing ever observed it.
 *
 * The `captureException` is not optional. Precisely because nothing observed
 * these rejections, Sentry's `GlobalHandlers` integration was capturing them as
 * unhandled — so catching them here without reporting would trade a silent user
 * experience for a silent *monitoring* one, and make #1718's failure class
 * invisible in production exactly as we start handling it.
 *
 * It does move them, though, and that is worth stating rather than glossing:
 * once caught they report as `mechanism.handled: true`, so Sentry's `is:unhandled`
 * filter and any alert rule keyed on it stop matching this class. The
 * `slash_command` tag is what keeps them findable afterwards.
 *
 * This is the caller's own safety net; the dispatcher honouring its contract is
 * tracked separately (#1718).
 */
export async function runDispatch(
  dispatch: NonNullable<ComposerProps["onSlashDispatch"]>,
  command: SlashCommand,
  args: string,
): Promise<DispatchResult> {
  try {
    return await dispatch(command, args);
  } catch (error) {
    Sentry.captureException(error, { tags: { slash_command: command.name } });
    return { ok: false };
  }
}

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
  commandName: string,
  result: DispatchResult,
): void {
  if (!result.ok) {
    toast({
      title: `/${commandName} failed`,
      description: result.error ?? "Couldn't run that command.",
      variant: "destructive",
    });
    return;
  }
  if (result.resolved) {
    toast({
      title: `/${commandName} recorded`,
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
      title: `/${commandName} not confirmed`,
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
      title: `/${commandName} partly succeeded`,
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

/**
 * Composer: Tiptap WYSIWYG editor + slash palette + emoji insert + pre-signed
 * file upload. Drafts persist as serialized text (Tiptap → plain text) so the
 * Dexie schema stays stable across editor upgrades.
 */
/**
 * Composing help, behind a `?` and nowhere else.
 *
 * This replaces the line that used to sit in the toolbar reading "Shift+Enter
 * for a new line · Cmd+/ for slash commands" (`1t`: "Composer hint → ? tooltip
 * moved"). The board's rule is narrower than "shorten it": `3b` says help is
 * only ever behind `?`, so a permanent line teaching two shortcuts is chrome a
 * member reads once and then looks past forever, in a row that is otherwise all
 * controls.
 *
 * The content is `3b`'s verbatim, and it says one thing the deleted line did
 * not: `@` mentions. The deleted line also advertised `Cmd+/`, which is not the
 * only way in — typing `/` opens the same palette — so the `/` spelling is both
 * shorter and truer.
 *
 * A Popover rather than a `title=` tooltip: `title` is unreachable by keyboard
 * and unreliable for screen readers, and this is the only place the shortcuts
 * are stated now.
 */
function ComposerHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={CHAT_CONTROL_CLASS}
          aria-label="Composing help"
        >
          <span aria-hidden="true" className="text-sm font-bold">
            ?
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <p className="text-[12.5px] text-muted-foreground">
          Shift+Enter for a new line.
          <br />/ for commands. @ to mention.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function Composer({
  channelId,
  channelName,
  isDirect,
  isReadOnly,
  canPost,
  draft,
  onChangeDraft,
  onSend,
  onSlashDispatch,
  onTyping,
  isModuleEnabled,
  recruitmentVocab,
  slashCommandsStatus = "ready",
  onRetrySlashCommands,
  isOffline,
  replyTo,
  onCancelReply,
  claimShellFocus,
}: ComposerProps) {
  const { toast } = useToast();
  const requestUploadUrl = useRequestChatUploadUrl();
  const uploadSignedUrl = useUploadSignedUrl();
  const chapterRoster = useChapterRoster();
  const fileInput = useRef<HTMLInputElement | null>(null);
  /**
   * Live roster for `@`-mention autocomplete, read through a ref rather than
   * closed over directly. `useEditor`'s extensions array is only evaluated
   * once (this composer passes no deps array), so a plain closure would see
   * whichever roster page had loaded — usually none — at first render and
   * never again. The `suggestion.items()` callback inside
   * `createMentionSuggestion` reads `rosterRef.current` on every keystroke
   * instead, so it always sees the latest fetched roster.
   */
  const rosterRef = useRef<MentionRosterEntry[]>([]);
  useEffect(() => {
    rosterRef.current = chapterRoster.data ?? [];
  }, [chapterRoster.data]);
  /**
   * Files uploaded and waiting to be claimed by the next send.
   *
   * Held here rather than in the editor document because an attachment is not
   * text. The bytes are already in the bucket by the time a chip appears — the
   * upload happens on pick — so removing a chip drops the claim, not the object;
   * an unclaimed object is swept by the storage retention pass, and that is a
   * far better failure than the old one, where the only record of the file was a
   * string the sender could edit away.
   */
  const [pending, setPending] = useState<OutboxAttachment[]>([]);

  const [palette, setPalette] = useState<{ open: boolean; query: string }>({
    open: false,
    query: "",
  });

  // Hoisted above `useEditor` so `onCreate` can honour it — the early return
  // that reads it next is ~400 lines down, but Tiptap builds the editor from
  // here regardless of whether anything ever renders it. See `onCreate`.
  const resolvedCanPost = canPost ?? !isReadOnly;
  const sendRef = useRef<() => void>(() => {});
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Hard break stays on Shift+Enter via StarterKit defaults.
      }),
      Placeholder.configure({
        placeholder: composerPlaceholder(channelName, isDirect),
      }),
      Mention.configure({
        HTMLAttributes: {
          class: "rounded bg-accent-subtle px-1 text-accent-text",
        },
        // Same shape as the submit keymap below: `createMentionSuggestion`
        // only reads `rosterRef.current` later, inside `items()` callbacks
        // invoked from keystroke events — never synchronously during render.
        // eslint-disable-next-line react-hooks/refs -- suggestion.items() reads the ref from a keystroke callback, not render
        suggestion: createMentionSuggestion(rosterRef),
      }),
      // Tiptap registers this shortcut while constructing the editor. The
      // closure reads `sendRef.current` only on Enter, not during render.
      // eslint-disable-next-line react-hooks/refs -- Enter keymap; latest submit lives in a ref
      createSubmitKeymap(sendRef),
    ],
    content: buildDocFromPlainText(draft),
    editorProps: {
      attributes: {
        // `prose prose-sm` used to lead this list and did nothing at all —
        // `@tailwindcss/typography` is not installed in this app or in the
        // shared preset, so both classes compiled to no rules.
        class: COMPOSER_INPUT_CLASS,
        "aria-label": COMPOSER_LABEL,
      },
    },
    onUpdate({ editor }) {
      const text = editor.getText();
      onChangeDraft(text);
      onTyping();
      const parsed = parseSlashInput(text);
      const opensPalette =
        parsed.isSlash &&
        (parsed.command == null || parsed.command.length <= 24);
      if (opensPalette) {
        setPalette((prev) =>
          prev.open && prev.query === (parsed.command ?? "")
            ? prev
            : { open: true, query: parsed.command ?? "" },
        );
      } else {
        // Composer text is no longer a slash invocation (user backspaced the
        // leading `/`, or typed a too-long token). Close the palette so it
        // doesn't trap the user behind a stale list.
        setPalette((prev) => (prev.open ? { open: false, query: "" } : prev));
      }
    },
    onCreate({ editor }) {
      /*
        Two milestones, one guard, and they are no longer the same number.

        `composer-editor-ready` is this moment: `immediatelyRender: false` means
        the editor is null through the first render, so rich text, mentions and
        send do not exist until ProseMirror has mounted its contenteditable.
        `onCreate` rather than an effect on `editor`, because an effect fires on
        the render *after* the editor exists — a frame later, on the wrong side
        of the thing being measured.

        `composer-focusable` is no longer this moment. `1s` budgets "composer
        focusable <= 400ms" and puts "composer shell" in its 0ms set, and since
        #2176 `ComposerShell` satisfies both without waiting for a channel.
        `markComposerFocusable` back-dates the mark to when that shell mounted;
        it is called from here only because *here* is where `can_post` is known.

        That `resolvedCanPost` guard is not belt-and-braces, and it is why the
        two calls sit together. `useEditor` builds an Editor from its own effect
        whether or not `<EditorContent>` is ever rendered, so without it this
        fires in every channel the member cannot post in — and the early return
        ~400 lines down means no composer exists in the document at all there.
        An alumnus, for whom ordinary channels come back `can_post: false`, would
        record both milestones on a load that ended with an explanatory
        paragraph where the composer should be; and because the marks are
        once-per-document, the real ones in `#alumni` a moment later would then
        never be recorded. The budget would report success on exactly the loads
        that never met it.
      */
      if (!resolvedCanPost) {
        /*
          Nothing to record and nothing to focus — and, critically, the claim
          below must not be *spent* here either. `useEditor` builds an Editor
          whether or not `<EditorContent>` is ever rendered, so this `onCreate`
          runs for the alumnus whose `#general` came back `can_post: false`,
          where the early return further down renders an explanatory paragraph
          and no contenteditable at all. Claiming there would call `.focus()` on
          a node that is not in the document (a no-op, so the caret lands on
          `document.body`) and leave the claim false, so the real composer in
          `#alumni` a moment later could not take it. That is the same failure
          the marks are guarded against, one `if` further down.
        */
        return;
      }
      markComposerFocusable();
      markColdLoad(COLD_LOAD_MARKS.composerEditorReady);
      /*
        Take the caret the shell was holding, if it was holding it.

        `"end"` and not the default: this editor was built from `draft`, which
        on the upgrade path is whatever the member typed into the shell, so the
        caret belongs after their words rather than at position zero in the
        middle of them. Here rather than `useEditor`'s `autofocus` option
        because the answer is only correct once and reading it during render
        would spend it on every re-render that happens to come first.
      */
      if (claimShellFocus?.()) {
        editor.commands.focus("end");
      }
    },
    immediatelyRender: false,
  });

  // Keep the editor in sync if the draft is restored from Dexie after mount.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getText();
    if (current === draft) return;
    editor.commands.setContent(buildDocFromPlainText(draft), {
      emitUpdate: false,
    });
  }, [draft, editor]);

  /*
    Mount-once latch for the lazily-fetched palette above.

    A bare `{palette.open ? <SlashPalette/> : null}` would fetch on first open
    just the same, but it would also unmount on close — and `ui/dialog.tsx`
    animates its exit (`data-[state=closed]:animate-out`), so every close would
    be cut off mid-fade. Latching means only the very first open differs from
    today, and that one is already waiting on a network fetch.

    Adjusted during render rather than in an effect: React re-runs the component
    before the browser paints, so the palette mounts in the same frame the state
    flips. In an effect it would cost an extra committed frame, on the one open
    that is already the slowest.
  */
  const [paletteMounted, setPaletteMounted] = useState(false);
  if (palette.open && !paletteMounted) {
    setPaletteMounted(true);
  }

  // Radix's default `onCloseAutoFocus` returns focus to whatever rendered
  // `<DialogTrigger>` — this palette has none, since it opens from typing "/"
  // as often as from clicking the toolbar button, so that handler is a no-op
  // here and focus was landing nowhere (effectively `document.body`) on every
  // close. The composer editor is the one place a member always means to end
  // up, whichever of open/select/Escape/backspace-the-slash closed it.
  const paletteWasOpen = useRef(palette.open);
  useEffect(() => {
    if (paletteWasOpen.current && !palette.open) {
      editor?.commands.focus();
    }
    paletteWasOpen.current = palette.open;
  }, [palette.open, editor]);

  // Staged attachments are per-channel and need no separate reset: `pending`
  // (above) already starts `[]` via `useState`, and `chat-shell.tsx` keys
  // `<Composer>` on the channel (id + resolved name, per #1014), so a channel
  // switch always unmounts this instance rather than changing `channelId` on
  // a live one. `channelId` is therefore effectively immutable for the
  // lifetime of one Composer instance — nothing here needs to react to it
  // changing, because it never does.

  /**
   * Why a slash command cannot be dispatched right now, or `null` when it can.
   *
   * One definition for **both** invocation paths — typing `/poll …` and hitting
   * Enter (`submit`), and picking the command out of the palette
   * (`onPaletteSelect`). They were separate code, and the palette path silently
   * skipped every one of these checks: it dispatched with a staged reply, which
   * `dispatchSlash` takes no `replyToId` for, so the reply was dropped AND left
   * standing to attach itself to the member's next message.
   *
   * Every branch refuses *before* anything is cleared, which is the load-bearing
   * half — the member's text and their staged context all survive to be re-sent.
   */
  const slashRefusal = useCallback(
    (command: SlashCommand): { title: string; description: string } | null => {
      // A slash command is NOT a queued write. `/points`, `/task` and `/event`
      // POST straight to their controllers from
      // `packages/chat-core/src/dispatch.ts` with no outbox behind them, so
      // spec/ui/resilience/connection-state.md's split applies within this one control: the text path
      // is labelled and stays live because it queues, and the queueless path
      // refuses and says why.
      if (isOffline) {
        return {
          title: `/${slashToken(command)} needs a connection`,
          description:
            "Slash commands aren't queued. Your text is still here. Send it when you're back online.",
        };
      }
      // A slash command posts a card, which has nowhere to hang a file.
      if (pending.length > 0) {
        return {
          title: `/${slashToken(command)} can't carry attachments`,
          description:
            "Remove the attached file, or send it as its own message first.",
        };
      }
      // Same shape, same reason, for a staged reply (#489).
      if (replyTo) {
        return {
          title: `/${slashToken(command)} can't reply to a message`,
          description:
            "Dismiss the reply first, or send your reply as an ordinary message.",
        };
      }
      return null;
    },
    [isOffline, pending.length, replyTo],
  );

  const submit = useCallback(() => {
    if (!editor) return;
    const text = editor.getText().trim();
    // An attachment-only message is a real message. Returning early on empty
    // text would have been correct while the filename WAS the text; now that a
    // file travels beside the body it would silently swallow the send.
    if (text.length === 0 && pending.length === 0) return;
    // If the message begins with an implemented slash command and a dispatch
    // is wired, route through dispatch instead of sending as plain text — so
    // Enter on `/poll "Q?" A B` posts a poll card, not a text bubble.
    const parsed = parseSlashInput(text);
    if (parsed.isSlash && parsed.command && onSlashDispatch) {
      const command = getSlashCommand(parsed.command, {
        recruitment: recruitmentVocab,
      });
      if (command?.implemented) {
        const refusal = slashRefusal(command);
        if (refusal) {
          toast({ ...refusal, variant: "destructive" });
          return;
        }
        editor.commands.clearContent(true);
        void (async () => {
          notifyDispatchOutcome(
            toast,
            slashToken(command),
            await runDispatch(onSlashDispatch, command, parsed.args),
          );
        })();
        return;
      }
    }
    void onSend(text, pending);
    // Only clear when a send was actually issued.
    editor.commands.clearContent(true);
    setPending([]);
  }, [
    editor,
    onSend,
    onSlashDispatch,
    pending,
    recruitmentVocab,
    slashRefusal,
    toast,
  ]);
  useLayoutEffect(() => {
    sendRef.current = submit;
  }, [submit]);

  const insertEmoji = useCallback(
    (emoji: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(emoji).run();
    },
    [editor],
  );

  const handleAttach = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const inspected = inspectUploadFile("document", file);
      if (!inspected.ok) {
        toast({
          title:
            inspected.reason === "size"
              ? "File too large"
              : "File type not allowed",
          description:
            inspected.reason === "size"
              ? `Attachments can be up to ${MAX_UPLOAD_LABEL}.`
              : "Chat accepts PDFs, Office files, text, CSV, and common images (no SVG).",
          variant: "destructive",
        });
        return;
      }
      try {
        const signed = await requestUploadUrl.mutateAsync({
          id: channelId,
          body: { filename: file.name, content_type: inspected.contentType },
        });
        const { signedUrl, storagePath } = readSignedUpload(signed);
        await uploadSignedUrl.mutateAsync({
          signedUrl,
          file,
        });
        // A pending chip, not text spliced into the body. The old behaviour
        // appended `📎 <name> (<storagePath>)` into the Tiptap document, which
        // made the message body the ONLY record that the object existed: nothing
        // linked it to the message, so it could not be rendered, listed, or
        // cleaned up on delete, and a member could edit the sigil out and orphan
        // the file. The path now travels beside the body and becomes a
        // `chat_message_attachments` row server-side.
        setPending((current) => [
          ...current,
          {
            storagePath,
            filename: file.name,
            contentType: inspected.contentType,
            byteSize: file.size,
          },
        ]);
      } catch (err) {
        toast({
          title: "Couldn't upload file",
          description:
            err instanceof Error ? err.message : "Retry in a moment.",
          variant: "destructive",
        });
      }
    },
    [channelId, requestUploadUrl, toast, uploadSignedUrl],
  );

  /*
   * Staging a reply moves focus to the editor, so the member can type
   * immediately after clicking Reply on a row several screens up — the control
   * they used is in the timeline, and leaving focus there would mean a second
   * deliberate move to reach the input the strip just appeared above.
   *
   * Keyed on the target's **id**, not on the object: the shell derives
   * `replyTo` from `channel.messages`, so an unrelated edit or reaction lands a
   * fresh object on every render of an already-staged reply, and re-focusing on
   * each of those would fight a member who has clicked away — the same hazard
   * the deleted `thread-panel.tsx` documented for its own focus effect.
   */
  const replyTargetId = replyTo?.id ?? null;
  useEffect(() => {
    if (replyTargetId) editor?.commands.focus();
  }, [replyTargetId, editor]);

  /**
   * Dismissing the strip unmounts the × the member is standing on, so focus
   * would fall to `<body>` and their next Tab would restart from the top of the
   * page. Hand it back to the editor, the same thing the palette-close effect
   * above does for the same reason.
   *
   * Escape reaches this too, harmlessly: focus is already in the editor there,
   * so the call is a no-op rather than a jump.
   */
  const cancelReply = useCallback(() => {
    onCancelReply?.();
    editor?.commands.focus();
  }, [editor, onCancelReply]);

  // Cmd+/ opens the palette; Escape drops a staged reply.
  const handleHostKey = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "/" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPalette({ open: true, query: "" });
        return;
      }
      // `defaultPrevented` for the same reason the deleted `thread-panel.tsx`
      // checked it:
      // a Radix `DismissableLayer` (the emoji popover mounted from this
      // toolbar) closes itself on Escape by calling `preventDefault()` without
      // `stopPropagation()`, so that keydown still arrives here. Without the
      // guard, dismissing the emoji picker would also silently discard the
      // reply the member had staged.
      if (event.key === "Escape" && !event.defaultPrevented && replyTo) {
        event.preventDefault();
        cancelReply();
      }
    },
    [cancelReply, replyTo],
  );

  const onPaletteSelect = useCallback(
    async (command: SlashCommand) => {
      setPalette({ open: false, query: "" });
      // Implemented commands route through dispatch; unimplemented ones keep
      // the "coming soon" toast so the Chunk 10 stubs still surface intent.
      if (!command.implemented || !onSlashDispatch) {
        toast({
          title: `/${slashToken(command)}`,
          description:
            "This command will ship in a later chunk. The catalog is gated by your chapter's enabled modules.",
        });
        if (editor) editor.commands.clearContent(true);
        return;
      }
      // The same refusals the typed path applies. Without this the palette was
      // a way around all three: picking `/poll` while offline, with a file
      // staged, or with a reply staged dispatched anyway and dropped whichever
      // context could not ride along.
      const refusal = slashRefusal(command);
      if (refusal) {
        toast({ ...refusal, variant: "destructive" });
        return;
      }
      const text = editor?.getText() ?? "";
      const parsed = parseSlashInput(text);
      const typed = parsed.command
        ? getSlashCommand(parsed.command, { recruitment: recruitmentVocab })
        : undefined;
      const args = typed?.name === command.name ? parsed.args : "";
      // Clear the composer optimistically — the dispatch enqueues the message
      // through the same hot path as `onSend`, so the optimistic card appears
      // immediately and a toast surfaces any parse / authz failure.
      if (editor) editor.commands.clearContent(true);
      notifyDispatchOutcome(
        toast,
        slashToken(command),
        await runDispatch(onSlashDispatch, command, args),
      );
    },
    [editor, onSlashDispatch, recruitmentVocab, slashRefusal, toast],
  );

  // `canPost` is the single source of truth for whether *this caller* may
  // post here right now — it already folds in the read-only gate (a holder
  // of `announcements:post`, or `*`, gets `canPost: true` in a read-only
  // channel). `isReadOnly` on its own used to gate the whole composer
  // unconditionally, which meant nobody — not even the President — could
  // ever get a live composer in `#announcements`, regardless of permission.
  // `isReadOnly` is read here only to pick which explanation applies: the
  // read-only case (no `announcements:post`) and the alumni lifecycle
  // restriction (`spec/behavior/alumni.md`) are the only two ways `can_post`
  // comes back false — read access to reach this channel at all is a
  // precondition of it appearing in the caller's channel list, so there is
  // no third case to distinguish.
  //
  // `canPost` defaults to `!isReadOnly`, not to `true` unconditionally: a
  // caller that only passes `isReadOnly` (predating this prop, or a channel
  // row that hasn't gone through the server's capability projection yet)
  // must still get the old read-only-blocks-everyone behavior rather than a
  // falsely-live composer. (`resolvedCanPost` is computed near `useEditor`
  // above, which needs it too.)
  if (!resolvedCanPost) {
    return (
      <p className="border-t border-border px-4 py-3 text-[12.5px] text-muted-foreground">
        {isReadOnly ? (
          <>
            This channel is read-only. Posting requires the{" "}
            <code className="font-mono">announcements:post</code> permission.
          </>
        ) : (
          <>
            Alumni can read this channel but not post. Alumni may post in{" "}
            <code className="font-mono">#alumni</code> and direct messages.
          </>
        )}
      </p>
    );
  }

  const attachPending = requestUploadUrl.isPending || uploadSignedUrl.isPending;

  return (
    <div className={COMPOSER_BOX_CLASS} onKeyDown={handleHostKey}>
      {/*
        The well is `--surface-1` on the thread's `--background`, per the s05
        composer — one step up from the floor it sits on, which is how elevation
        reads on a shadowless surface. It used to be `bg-background` inside a
        `--card` pane, i.e. a step *down* from its own container.

        The ring lives here rather than on the editor: ProseMirror's node sets
        `focus:outline-none` and, before this, nothing replaced it, so the
        composer had no visible focus indicator at all.
      */}
      <div
        className={cn(COMPOSER_WELL_CLASS, FOCUS_RING_WITHIN)}
      >
        {/*
          The staged reply, above the input and above the attachment chips —
          it is context for everything below it, not another attachment. Same
          `QuotedMessage` the timeline uses, so what a member stages looks like
          what they are about to send.
        */}
        {replyTo ? (
          <div className="mb-2 flex items-center gap-1.5">
            <span className="shrink-0 text-[12.5px] text-muted-foreground">
              Replying to
            </span>
            <QuotedMessage
              className="flex-1"
              author={replyTo.author}
              preview={replyTo.preview}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0"
              aria-label="Cancel reply"
              onClick={cancelReply}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </div>
        ) : null}
        {pending.length > 0 ? (
          <ul
            className="mb-2 flex flex-wrap gap-1.5"
            aria-label={`${pending.length} file${pending.length === 1 ? "" : "s"} attached`}
          >
            {pending.map((attachment) => (
              <li
                key={attachment.storagePath}
                className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-2 py-1 pl-2 pr-1 text-[12.5px]"
              >
                <AttachGlyph className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{attachment.filename}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  aria-label={`Remove ${attachment.filename}`}
                  onClick={() =>
                    setPending((current) =>
                      current.filter(
                        (row) => row.storagePath !== attachment.storagePath,
                      ),
                    )
                  }
                >
                  <span aria-hidden="true">×</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <EditorContent editor={editor} />
        {/*
          No `COMPOSER_TOOLBAR_CLASS` here, and that is deliberate: this row's
          height is intrinsic — `CHAT_CONTROL_CLASS` is `h-8` and
          `pointer-coarse:h-11`, and the Send button matches. Pinning it to the
          shell's reserved height would cap the coarse-pointer row at 32px and
          overflow every touch target on it. The constant reserves what this row
          *comes out as*; it does not set it.
        */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={CHAT_CONTROL_CLASS}
                  aria-label="Open emoji picker"
                >
                  <ReactionGlyph className="h-5 w-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <EmojiPicker onPick={insertEmoji} />
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={CHAT_CONTROL_CLASS}
              aria-label="Attach file"
              onClick={() => fileInput.current?.click()}
              disabled={attachPending}
            >
              <AttachGlyph className="h-5 w-5" />
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept={acceptAttribute("document")}
              className="sr-only"
              onChange={(event) => void handleAttach(event)}
              aria-hidden="true"
            />
            {/*
              Not a ✦. The four-pointed sparkle is the Ask/AI mark and
              components.md §11 says it "MUST NOT mark anything that is not an
              Ask/AI entry point or answer" — a slash palette is a command
              launcher, not an answer surface.
            */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={CHAT_CONTROL_CLASS}
              aria-label="Open slash commands (Command Slash)"
              aria-haspopup="dialog"
              aria-expanded={palette.open}
              onClick={() => setPalette({ open: true, query: "" })}
            >
              <SlashCommandGlyph className="h-5 w-5" />
            </Button>
            <ComposerHelp />
          </div>
          {/*
            32px and text-only (`1b` pin 13, `1t`: "Composer 48px Send with icon
            → 32px text button shrunk"). The glyph is dropped rather than
            shrunk: at 32px the icon and the word competed for a button whose
            word already says everything the icon did.
          */}
          <Button
            type="button"
            size="sm"
            className="h-8 pointer-coarse:h-11"
            onClick={submit}
            /* An attached file is enough to send: an empty editor with a staged
               attachment is a real message, and `submit` accepts it. */
            disabled={!editor || (editor.isEmpty && pending.length === 0)}
          >
            Send
          </Button>
        </div>
      </div>
      {/*
        The offline label is deliberately NOT a live region. `ReconnectPill` in
        the same header already announces the connection change from the same
        `channel.connection` source, and `OfflineBanner` announces it again from
        the root layout — three polite regions would read one event three times.
        This is the label beside the control, which is what spec/ui/resilience/connection-state.md asks
        the queued surface to carry.
      */}
      {isOffline ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <OfflineGlyph className="h-4 w-4 shrink-0" />
          You&rsquo;re offline — messages send when you reconnect.
        </p>
      ) : null}
      {paletteMounted ? (
        <SlashPalette
          open={palette.open}
          initialQuery={palette.query}
          onQueryChange={(query) => setPalette((prev) => ({ ...prev, query }))}
          isModuleEnabled={isModuleEnabled}
          recruitmentVocab={recruitmentVocab}
          status={slashCommandsStatus}
          onRetry={onRetrySlashCommands}
          onSelect={onPaletteSelect}
          onOpenChange={(open) =>
            setPalette((prev) => ({
              ...prev,
              open,
              query: open ? prev.query : "",
            }))
          }
        />
      ) : null}
    </div>
  );
}
