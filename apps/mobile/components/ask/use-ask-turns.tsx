import { useCallback, useRef, useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  useDocumentDownloadUrl,
  type AskConversation,
  type AskExchange,
  type AskOptions,
} from "@repo/hooks";
import type { AskSource } from "@repo/validation";
import {
  useAiReport,
  type AiReportTarget,
} from "@/components/ai/report-ai-sheet";
import { AskProposal, type ActLink } from "@/components/ask/ask-proposal";
import type { AskReply } from "@/components/ask/ask-turn";
import { useAskKept } from "@/lib/ask/kept-targets";
import { askSourceOpening } from "@/lib/ask/source-route";
import { asRoute, openHref } from "@/lib/href";
import { selectDownloadUrl } from "@/lib/more/documents";
import { notificationHref } from "@/lib/notifications/targets";

/** Said under a turn whose source didn't open. */
export const SOURCE_OPEN_FAILED = "That source didn't open. Try again.";

/**
 * What a turn of the Ask conversation does when the member acts on it,
 * wherever the turn is drawn: the Ask sheet's thread, or a channel the
 * member asked `@Frapp` from (#4713). One set of rules for both, so a source
 * opens the same thing, a card confirms the same change and Report sends the
 * same report from either.
 *
 * **A source opens the real thing.** A document opens in the in-app browser
 * over wherever the member is. Anything else is a screen: `leave` runs first
 * (the sheet closes itself; a channel has nothing to close), then the screen
 * opens.
 *
 * `reportSheet` is drawn once by the caller, outside any list, since a row
 * that scrolls away would take its sheet with it.
 */
export function useAskTurns({
  conversation,
  options,
  leave,
}: {
  conversation: Pick<
    AskConversation,
    "working" | "retry" | "setProposal" | "resolveProposal"
  >;
  /** What a question is asked with, read when a turn is asked again. */
  options: () => AskOptions;
  /** Runs before another screen opens over this one. */
  leave?: () => void;
}): {
  /** Everything `AskTurn` or `AskReply` takes for this turn. */
  propsFor: (exchange: AskExchange) => Parameters<typeof AskReply>[0];
  /** This turn's source didn't open: say so under it. */
  sourceFailed: (exchangeId: string) => boolean;
  /** A new question or a new conversation clears what was said under a turn. */
  clearNotice: () => void;
  /** Forgets what was changed on waiting cards, as New conversation does. */
  forget: () => void;
  reportSheet: ReactNode;
} {
  const router = useRouter();
  const reporting = useAiReport();
  const { kept, keep, forget } = useAskKept();
  const { working, retry, setProposal, resolveProposal } = conversation;

  const sources = useAskSourceOpener(leave);
  const { open: openSource, openingKey: openingSourceId } = sources;

  const openActLink = useCallback(
    (link: ActLink) => {
      leave?.();
      openHref(router, asRoute(link.href));
    },
    [leave, router],
  );

  // Opens a channel an answer names (#4904); `ask-turn.tsx` offers it only
  // for a channel the reader has.
  const openChannel = useCallback(
    (channelId: string) => {
      leave?.();
      openHref(
        router,
        asRoute(`/chat-thread?channelId=${encodeURIComponent(channelId)}`),
      );
    },
    [leave, router],
  );

  const propsFor = (exchange: AskExchange) => ({
    exchange,
    canOpen: canOpenAskSource,
    openingSourceId: openingSourceId?.startsWith(`${exchange.id}:`)
      ? openingSourceId.slice(exchange.id.length + 1)
      : null,
    onOpenSource: (source: AskSource) => void openSource(exchange.id, source),
    busy: working && exchange.phase !== "working",
    onRetry: () => void retry(exchange.id, options()),
    onAnswerConsent: () => void retry(exchange.id, options()),
    report: reportFor(exchange, reporting),
    onOpenChannel: openChannel,
    proposal: exchange.proposal ? (
      <AskProposal
        proposal={exchange.proposal}
        resolution={exchange.resolution}
        kept={kept}
        onKeep={keep}
        report={reporting}
        onProposal={(next) => setProposal(exchange.id, next)}
        onResolved={(resolution) => resolveProposal(exchange.id, resolution)}
        onOpen={openActLink}
      />
    ) : null,
  });

  return {
    propsFor,
    sourceFailed: (exchangeId) => sources.failedOwner === exchangeId,
    clearNotice: sources.clearNotice,
    forget,
    reportSheet: reporting.reportSheet,
  };
}

/**
 * Opens an Ask source, for a turn of the conversation or for an answer
 * posted to a channel (`ask-answer-card.tsx`): the same thing from either.
 * `owner` names what the source belongs to (a turn's id, a message's id), so
 * the chip that is opening and the row that failed can each say so.
 */
export function useAskSourceOpener(leave?: () => void): {
  open: (owner: string, source: AskSource) => Promise<void>;
  /** `<owner>:<source id>` while a document's link is fetched. */
  openingKey: string | null;
  /** The owner whose source didn't open. */
  failedOwner: string | null;
  clearNotice: () => void;
} {
  const router = useRouter();
  const openDocument = useDocumentDownloadUrl();
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [failedOwner, setFailedOwner] = useState<string | null>(null);
  const presenting = useRef(false);

  const open = useCallback(
    async (owner: string, source: AskSource) => {
      const opening = askSourceOpening(source);
      if (!opening) return;
      if (opening.kind === "route") {
        leave?.();
        openHref(router, asRoute(notificationHref(opening.target)));
        return;
      }
      // One browser at a time: iOS rejects a second presentation.
      if (presenting.current) return;
      presenting.current = true;
      setFailedOwner(null);
      setOpeningKey(`${owner}:${source.id}`);
      try {
        const url = selectDownloadUrl(
          await openDocument.mutateAsync(opening.documentId),
        );
        if (!url) {
          setFailedOwner(owner);
          return;
        }
        await WebBrowser.openBrowserAsync(url);
      } catch {
        setFailedOwner(owner);
      } finally {
        presenting.current = false;
        setOpeningKey(null);
      }
    },
    [leave, openDocument, router],
  );
  const clearNotice = useCallback(() => setFailedOwner(null), []);
  return { open, openingKey, failedOwner, clearNotice };
}

/** Whether this build has a screen or a document for the source. */
export const canOpenAskSource = (source: AskSource) =>
  askSourceOpening(source) !== null;

/** The answer's "Report this", for a member who may report (#4315). */
function reportFor(
  exchange: AskExchange,
  reporting: ReturnType<typeof useAiReport>,
) {
  if (!reporting.offered || !exchange.askId) return null;
  const target: AiReportTarget = {
    subject: "ask_answer",
    subjectId: exchange.askId,
    receipt: exchange.answer?.report_receipt ?? null,
  };
  return {
    reported: reporting.isReported(target),
    onPress: () => reporting.report(target),
  };
}
