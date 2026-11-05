import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import type { RushPayload } from "@repo/chat-core/cards";
import { serverMessageOf } from "@repo/api-sdk";
import {
  canReadCardRushCandidate,
  readLiveRushCandidate,
  RUSH_CARD_TALLY_ERROR,
  rushCardBadgeLabel,
  rushCardControls,
  rushCardGateRefusal,
  rushCardTally,
  useBidRushCandidate,
  useCurrentChapter,
  usePermissionList,
  useRushCandidate,
  useVoteRushCandidate,
} from "@repo/hooks";
import { memberViewVocabulary, vocab } from "@repo/org-archetypes";
import { can, isModuleEnabled } from "@repo/validation";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { StatusChip } from "@/components/status-chip";
import { useConnection } from "@/lib/connection/use-connection";
import { useFrappTheme } from "@/lib/theme";
import { RushGlyph } from "./card-glyphs";
import {
  CardActions,
  CardButton,
  CardEyebrow,
  CardMeta,
  CardNote,
  CardTitle,
  ChatCardShell,
  type ChatCardFrameProps,
} from "./chat-card";

/**
 * The chat rush card on mobile (#3383), web's
 * `apps/web/components/chat/renderers/rush-card.tsx` on the phone.
 *
 * The message is a creation-time snapshot of one `/rush add` (the candidate's
 * name and who added them), read by `readRushPayload`. The bid, the vote
 * count and the viewer's own vote are the *live* candidate, read back through
 * `useRushCandidate`, so the card follows the candidate without the message
 * row ever changing. Voter names are never on the wire.
 *
 * **The rules are web's.** Who may read the candidate, the badge, the tally
 * and which controls to offer are `canReadCardRushCandidate`,
 * `rushCardBadgeLabel`, `rushCardTally` and `rushCardControls` in
 * `@repo/hooks`, the copy both cards apply. In short: nothing live until the
 * candidate is read (the snapshot has no votes and no bid), every member may
 * vote and extend a bid (the routes have no permission of their own beyond
 * `members:view`), and no control while Recruitment is off. The eyebrow is the
 * chapter's own word for recruitment (`vocab`), "Rush" or "Intake" or
 * "Recruitment", as web's is.
 *
 * Mobile has no toast, so a refusal is a line on the card, as the task card's
 * is. A gate refusal is in a member's words (`rushCardGateRefusal`) and
 * withdraws the controls until the member comes back to the thread or the
 * app: pressing again would only fetch the same refusal. Any other refusal
 * relays the server's message and leaves them to retry. Neither write has an
 * outbox, so both are disabled while a write would be lost
 * (`useConnection().writeBlockedReason`).
 */
export function RushCard({
  payload,
  ...frame
}: ChatCardFrameProps & { payload: RushPayload }) {
  const { tokens } = useFrappTheme();
  const canViewMembers = can("members:view", usePermissionList());
  const liveQuery = useRushCandidate(
    canReadCardRushCandidate({ canViewMembers })
      ? payload.candidate_id
      : undefined,
  );
  const live = readLiveRushCandidate(liveQuery.data);

  // The member view: the chapter's word for recruitment, and the module gate
  // the poll and task cards read. A missing `rush` key is on.
  const chapterQuery = useCurrentChapter();
  const label = vocab("recruitment", memberViewVocabulary(chapterQuery.data));
  const recruitmentOff =
    chapterQuery.data !== undefined &&
    !isModuleEnabled(chapterQuery.data?.enabled_modules, "rush");
  const controls = rushCardControls({ live, recruitmentOff });

  const { writeBlockedReason } = useConnection();
  const vote = useVoteRushCandidate();
  const bid = useBidRushCandidate();
  const [refusal, setRefusal] = useState<{
    text: string;
    /** A gate's: the controls stay withdrawn rather than invite a retry. */
    gate: boolean;
  } | null>(null);
  // Cleared when the member comes back, as the task card's is: an officer may
  // have sorted the gate out since. Back to the thread is a navigation focus;
  // back to the app with the thread still open is an AppState change. The
  // listener is held only while there is a refusal to clear.
  useFocusEffect(
    useCallback(() => {
      setRefusal(null);
      return undefined;
    }, []),
  );
  const hasRefusal = refusal !== null;
  useEffect(() => {
    if (!hasRefusal) return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setRefusal(null);
    });
    return () => subscription.remove();
  }, [hasRefusal]);
  const pending = vote.isPending || bid.isPending;
  // The hooks' `isPending` reaches React a tick after the press, so two taps
  // in one frame would both send; the ref is set before the first await.
  const inFlight = useRef(false);

  /** Runs one write; a refusal lands on the card. */
  const act = async (write: () => Promise<unknown>, fallback: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefusal(null);
    try {
      await write();
    } catch (error) {
      const gate = rushCardGateRefusal(error);
      setRefusal(
        gate
          ? { text: gate, gate: true }
          : { text: serverMessageOf(error) ?? fallback, gate: false },
      );
    } finally {
      inFlight.current = false;
    }
  };

  const blockedReason =
    writeBlockedReason ?? (refusal?.gate ? refusal.text : null);
  const disabled = !frame.isConfirmed || pending || blockedReason !== null;
  const hint = blockedReason ?? undefined;
  // No tally before the read, and none for a viewer who can't read it: the
  // snapshot's "0 votes" would be wrong for any candidate anyone voted for.
  const tally = live
    ? rushCardTally(live)
    : liveQuery.isError
      ? RUSH_CARD_TALLY_ERROR
      : null;

  return (
    <ChatCardShell
      {...frame}
      header={
        <>
          <CardEyebrow
            label={label}
            glyph={RushGlyph}
            trailing={
              live ? (
                <StatusChip
                  label={rushCardBadgeLabel(live)}
                  hue={
                    live.bid_extended
                      ? tokens.color.semantic.success
                      : tokens.color.text.mutedForeground
                  }
                />
              ) : null
            }
          />
          <CardTitle>{live?.display_name ?? payload.display_name}</CardTitle>
          <CardMeta items={[`Added by ${payload.added_by_name}`, tally]} />
        </>
      }
    >
      {controls.length > 0 ? (
        <CardActions>
          {controls.includes("vote") ? (
            <CardButton
              label="Vote"
              variant="primary"
              disabled={disabled}
              accessibilityHint={hint}
              onPress={() =>
                void act(
                  () => vote.mutateAsync(payload.candidate_id),
                  "Couldn't record that vote.",
                )
              }
            />
          ) : null}
          {controls.includes("voted") ? (
            // An indicator, not an action: there is no unvote.
            <CardButton
              label="Voted"
              disabled
              onPress={() => undefined}
              icon={(color) => <CheckGlyph color={color} />}
            />
          ) : null}
          {controls.includes("bid") ? (
            <CardButton
              label="Extend bid"
              disabled={disabled}
              accessibilityHint={hint}
              onPress={() =>
                void act(
                  () => bid.mutateAsync(payload.candidate_id),
                  "Couldn't extend that bid.",
                )
              }
            />
          ) : null}
        </CardActions>
      ) : null}
      {refusal ? (
        <CardNote text={refusal.text} tone={refusal.gate ? "muted" : "error"} />
      ) : null}
    </ChatCardShell>
  );
}
