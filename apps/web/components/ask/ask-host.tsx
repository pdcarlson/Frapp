"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AskConversationProvider,
  aiAvailableFrom,
  useActiveChapterId,
  useAiChapterSettings,
  useAiConsent,
  useMyPermissions,
} from "@repo/hooks";
import { ASK_COPY, can } from "@repo/validation";
import { AskCard } from "@/components/ask/ask-card";
import { AskInChannelBridge } from "@/components/ask/ask-in-channel";
import { FrappCrest } from "@/components/ask/frapp-crest";
import { Button } from "@/components/ui/button";
import { useIsRolePreviewActive } from "@/lib/stores/role-preview-store";
import { cn } from "@/lib/utils";

/**
 * Ask Frapp's front door on web (#4702): a button in the chat composer, and
 * the conversation opening over the chat.
 *
 * Paul, 2026-11-13: no button in the corner of the top bar and no card docked
 * to the side of the window. "It's in the channels, and that's where we want
 * everything to live anyway." So the entry sits with the composer's own
 * controls, beside GIF and the help mark, and the conversation rises from
 * the composer over the thread, the way the composer's + card does
 * (`composer-plus-card.tsx`): no scrim, the chat still live around it.
 * Microsoft Teams puts Copilot in the compose box and WhatsApp puts Meta AI
 * in the chat's own field; both open over the conversation, not beside the
 * app.
 *
 * Three pieces, because the conversation has to outlive what it is drawn in:
 *
 * - `AskHost` wraps the dashboard. It decides whether this member has Ask at
 *   all, and it owns the conversation (`AskConversationProvider`), so the
 *   thread survives a change of channel, a tool page covering the chat and
 *   the chat closing, and is the same thread in the card and in a channel a
 *   member asked `@Frapp` from (`ask-in-channel.tsx`, #4713).
 * - `AskSlot` is where the card is drawn: chat puts one above its composer.
 * - `AskComposerButton` is the entry, drawn by the composer.
 *
 * **Who gets it** is the server's answer, as it was for the top-bar pill: the
 * server has AI, the president has Ask on, and the member holds `ai:use`.
 * Anyone else gets no entry anywhere (#2259), and neither does an officer
 * viewing the chapter as a role (#4072): asking is a POST, which the preview
 * refuses (#4504). Until all of that is known there is no button; it arrives
 * in a toolbar row whose height it does not change.
 *
 * **The crest is the chapter's colour here** (Paul, 2026-11-13, default 2 on
 * #4698), and the button is the accent's Tinted recipe
 * (`spec/ui/design-system/components.md` §3). Inside the conversation the
 * member's bubble, send and Confirm are the accent too; the source markers
 * keep Ask's fixed gold (§11).
 */
interface AskEntry {
  open: boolean;
  /** Open or close the conversation; `opener` takes focus back on close. */
  toggle: (opener: HTMLElement | null) => void;
}

const AskEntryContext = createContext<AskEntry | null>(null);
/** Where a slot reports its element. Null for a member without Ask. */
const AskSlotContext = createContext<
  ((element: HTMLElement | null) => void) | null
>(null);

export function AskHost({ children }: { children: ReactNode }) {
  const consent = useAiConsent();
  const available = aiAvailableFrom(consent);
  const settings = useAiChapterSettings({ enabled: available === true });
  const permissions = useMyPermissions().data?.permissions;
  const previewing = useIsRolePreviewActive();
  const chapterId = useActiveChapterId();
  const has =
    available === true &&
    settings.data?.ask === true &&
    can("ai:use", permissions ?? []) &&
    !previewing;

  const [open, setOpen] = useState(false);
  // A member who lost Ask (a role preview began, the president turned Ask
  // off) has no card left to come back to. Without this the card would open
  // itself, over the chat and with the cursor in it, when Ask returned.
  if (!has && open) setOpen(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const toggle = useCallback((from: HTMLElement | null) => {
    opener.current = from;
    setOpen((was) => !was);
  }, []);
  const entry = useMemo<AskEntry | null>(
    () => (has ? { open, toggle } : null),
    [has, open, toggle],
  );

  return (
    // The conversation is one chapter's: it starts over in another.
    <AskConversationProvider scope={chapterId}>
      <AskInChannelBridge enabled={has}>
        <AskEntryContext.Provider value={entry}>
          <AskSlotContext.Provider value={has ? setSlot : null}>
            {children}
            {has ? (
              <AskCard
                open={open}
                onOpenChange={setOpen}
                returnFocus={opener}
                container={slot}
              />
            ) : null}
          </AskSlotContext.Provider>
        </AskEntryContext.Provider>
      </AskInChannelBridge>
    </AskConversationProvider>
  );
}

/**
 * Where the conversation is drawn. It takes no room of its own: the card
 * hangs above it, over whatever is there. Chat puts it directly above the
 * composer, so the card rises from the composer and moves with it as a draft
 * grows.
 */
export function AskSlot() {
  const setSlot = useContext(AskSlotContext);
  if (!setSlot) return null;
  return (
    <div
      ref={setSlot}
      data-ask-slot=""
      // Above the thread and its sticky rows, under popovers and dialogs.
      className="relative z-30 h-0 shrink-0"
    />
  );
}

/**
 * The entry in the composer's row of controls. The words are part of the
 * control from `sm` up; below that the row has no room for them and the
 * crest stands alone, named for a screen reader either way.
 */
export function AskComposerButton({ className }: { className?: string }) {
  const entry = useContext(AskEntryContext);
  if (!entry) return null;
  return (
    <Button
      type="button"
      variant="tinted"
      aria-expanded={entry.open}
      // How the card finds the entry on screen now, to hand focus back to
      // when the one that opened it is gone (`ASK_ENTRY_SELECTOR` in
      // `ask-card.tsx`; `ask-entry.spec.tsx` holds the two together).
      data-ask-entry=""
      title={ASK_COPY.entry_label}
      onClick={(event) => entry.toggle(event.currentTarget)}
      className={cn(
        "h-8 shrink-0 gap-1.5 rounded-sm px-2.5 text-label pointer-coarse:h-11",
        "max-sm:w-8 max-sm:px-0 max-sm:pointer-coarse:w-11",
        // Held down while the conversation is open (components.md §3).
        "aria-expanded:bg-accent-subtle-hover",
        className,
      )}
    >
      <FrappCrest className="text-primary" />
      <span className="max-sm:sr-only">{ASK_COPY.name}</span>
    </Button>
  );
}
