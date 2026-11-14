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
  askAccessFrom,
  useActiveChapterId,
  useAiChapterSettings,
  useAiConsent,
  useMyPermissions,
} from "@repo/hooks";
import type { AskAccess } from "@repo/validation";
import { AskCard } from "@/components/ask/ask-card";
import { AskInChannelBridge } from "@/components/ask/ask-in-channel";
import { useIsRolePreviewActive } from "@/lib/stores/role-preview-store";

/**
 * Ask Frapp's front door on web: the top bar's one field, "Search or ask
 * Frapp" (#4904; Paul's pick of 2026-11-13, option C on the options page).
 *
 * The button in the chat composer (#4702, that morning) read as out of place
 * to Paul once it shipped: the only filled, coloured, labelled control in a
 * row whose job is the message. So Ask has no control of its own any more.
 * The field every page already has takes a question as well as a search
 * (`find-bar.tsx`, `find-dialog.tsx`), and the conversation opens where
 * Find does, centered over the page, from any page. Slack's search field and
 * Linear's and Notion's command menus take a question the same way.
 * `@Frapp` typed in a channel still asks from there (`ask-in-channel.tsx`,
 * #4713).
 *
 * `AskHost` wraps the dashboard. It decides whether this member has Ask at
 * all, and it owns the conversation (`AskConversationProvider`), so the
 * thread is the same one on every page, in the dialog and in a channel a
 * member asked `@Frapp` from. `useAskEntry` is how the field reaches it.
 *
 * **Who gets it** is the server's answer: the server has AI, the president
 * has Ask on, and the member holds `ai:use`. Anyone else gets a field that
 * only searches (#2259), and so does an officer viewing the chapter as a
 * role (#4072): asking is a POST, which the preview refuses (#4504). Until
 * all of that is known the field only searches.
 */
export interface AskEntry {
  open: boolean;
  /**
   * Opens the conversation, asking `question` if one is given. `opener`
   * takes focus back when it closes.
   */
  openWith: (question?: string, opener?: HTMLElement | null) => void;
}

const AskEntryContext = createContext<AskEntry | null>(null);

/** The way into Ask, or null for a member without it (or outside a host). */
export function useAskEntry(): AskEntry | null {
  return useContext(AskEntryContext);
}

export function AskHost({ children }: { children: ReactNode }) {
  const consent = useAiConsent();
  const available = aiAvailableFrom(consent);
  const settings = useAiChapterSettings({ enabled: available === true });
  const permissions = useMyPermissions().data?.permissions;
  const previewing = useIsRolePreviewActive();
  const chapterId = useActiveChapterId();
  // Three answers, not two: until the reads are in, a channel's composer
  // must not post a message that names `@Frapp` (#4713), and no entry shows.
  const access: AskAccess = previewing
    ? "no"
    : askAccessFrom({
        available,
        ask: settings.data?.ask,
        permissions,
      });
  const has = access === "yes";

  const [open, setOpen] = useState(false);
  // A question typed into the field, waiting for the dialog to send it.
  const [asking, setAsking] = useState<string | null>(null);
  // A member who lost Ask (a role preview began, the president turned Ask
  // off) has no conversation left to come back to. Without this the dialog
  // would open itself, over the page, when Ask returned.
  if (!has && (open || asking !== null)) {
    setOpen(false);
    setAsking(null);
  }
  const opener = useRef<HTMLElement | null>(null);
  const openWith = useCallback(
    (question?: string, from?: HTMLElement | null) => {
      opener.current = from ?? null;
      const words = question?.trim();
      if (words) setAsking(words);
      setOpen(true);
    },
    [],
  );
  const taken = useCallback(() => setAsking(null), []);
  const entry = useMemo<AskEntry | null>(
    () => (has ? { open, openWith } : null),
    [has, open, openWith],
  );

  return (
    // The conversation is one chapter's: it starts over in another.
    <AskConversationProvider scope={chapterId}>
      <AskInChannelBridge access={access}>
        <AskEntryContext.Provider value={entry}>
          {children}
          {has ? (
            <AskCard
              open={open}
              onOpenChange={setOpen}
              returnFocus={opener}
              asking={asking}
              onAsked={taken}
            />
          ) : null}
        </AskEntryContext.Provider>
      </AskInChannelBridge>
    </AskConversationProvider>
  );
}
