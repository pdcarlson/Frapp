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
 * Ask Frapp's front door on web: the Ask bar, the phone's bar on web
 * (`ask-bar.tsx`; #5476, Paul's pick of 2026-11-18), at the sidebar's foot
 * from `lg` up and floating at the bottom of the page below it (#5560).
 *
 * The door moved twice before. A button in the chat composer (#4702) read as
 * out of place to Paul once it shipped; then the top bar's field asked as well
 * as searched ("Search or ask Frapp", #4904), which Shawn and Paul didn't want
 * in the search bar. The conversation still opens where Find does, centered
 * over the page, from any page. `@Frapp` typed in a channel asks from there
 * (`ask-in-channel.tsx`, #4713).
 *
 * `AskHost` wraps the dashboard. It decides whether this member has Ask at
 * all, and it owns the conversation (`AskConversationProvider`), so the
 * thread is the same one on every page, in the dialog and in a channel a
 * member asked `@Frapp` from. `useAskEntry` is how the bar reaches it.
 *
 * **Who gets it** is the server's answer: the server has AI, the president
 * has Ask on, and the member holds `ai:use`. Anyone else gets no bar
 * (#2259), and nor does an officer viewing the chapter as a role (#4072):
 * asking is a POST, which the preview refuses (#4504). Until all of that is
 * known there is no bar.
 */
export interface AskEntry {
  open: boolean;
  /** Opens the conversation. `opener` takes focus back when it closes. */
  openWith: (opener?: HTMLElement | null) => void;
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
  // A member who lost Ask (a role preview began, the president turned Ask
  // off) has no conversation left to come back to. Without this the dialog
  // would open itself, over the page, when Ask returned.
  if (!has && open) setOpen(false);
  const opener = useRef<HTMLElement | null>(null);
  const openWith = useCallback((from?: HTMLElement | null) => {
    opener.current = from ?? null;
    setOpen(true);
  }, []);
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
            <AskCard open={open} onOpenChange={setOpen} returnFocus={opener} />
          ) : null}
        </AskEntryContext.Provider>
      </AskInChannelBridge>
    </AskConversationProvider>
  );
}
