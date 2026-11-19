import { useRef, useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import {
  CHAPTER_LINK_HINT,
  chapterLinkExpiryLabel,
  useChapterLink,
  useCreateChapterLink,
  useRevokeInvite,
  type InviteListItem,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import { EVERYONE_ROLE_NAME } from "@repo/validation";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { showActionMenu } from "@/lib/action-menu";
import {
  inviteShareContent,
  inviteShareOptions,
  SHARE_FAILED_MESSAGE,
} from "@/lib/onboarding/chapter-wizard/use-invite-shares";
import { webJoinUrl } from "@/lib/onboarding/chapter-wizard/invite-link";
import { typeRole, useFrappTheme } from "@/lib/theme";

export const SHARE_CHAPTER_LINK = "Share link";
export const MAKE_NEW_LINK = "Make a new link";
export const TURN_OFF_LINK = "Turn off link";

/** The caption under a live link: when it stops, and the role it gives. */
export function chapterLinkCaption(
  link: Pick<InviteListItem, "status" | "expires_at" | "role">,
): string {
  return [
    chapterLinkExpiryLabel(link),
    link.role === EVERYONE_ROLE_NAME ? null : `Joins as ${link.role}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The chapter link on the phone's Invite members screen (#3353, Paul
 * 2026-11-19: "One chapter link, 7 days"), web's Chapter link section with the
 * same words: one link for the whole chapter, the way Discord's server invite
 * and WhatsApp's group link work. With none live, Make a chapter link makes
 * one and opens the share sheet with it. A live one is a row whose menu
 * shares it, makes a new one (the old one stops working) or turns it off.
 * Where web copies, the phone shares, as the Invited list's rows do.
 */
export function ChapterLinkSection({
  chapterName,
}: {
  /** Named in the shared message; null until the chapter loads. */
  chapterName: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const linkQuery = useChapterLink();
  const create = useCreateChapterLink();
  const revoke = useRevokeInvite();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    tone: "done" | "problem";
  } | null>(null);
  const link = linkQuery.data ?? null;
  const live = link?.status === "pending" ? link : null;

  async function share(invite: InviteListItem) {
    if (!chapterName) return;
    try {
      await Share.share(
        inviteShareContent(webJoinUrl(invite.token), chapterName),
        inviteShareOptions(chapterName),
      );
    } catch {
      setMessage({ text: SHARE_FAILED_MESSAGE, tone: "problem" });
    }
  }

  async function guarded(work: () => Promise<void>, failure: string) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (caught) {
      setMessage({ text: errorCopy(caught, failure), tone: "problem" });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function makeLink() {
    void guarded(async () => {
      const made = await create.mutateAsync();
      // The share sheet doesn't hold the lock: iOS doesn't always say when
      // it closes.
      void share(made);
    }, "Couldn't make a chapter link. Try again in a moment.");
  }

  function turnOff(invite: InviteListItem) {
    void guarded(async () => {
      await revoke.mutateAsync(invite.id);
      setMessage({
        text: "Chapter link turned off. Nobody can join with it now.",
        tone: "done",
      });
    }, "Couldn't turn off the link. Try again in a moment.");
  }

  function openMenu(invite: InviteListItem) {
    if (running.current) return;
    showActionMenu({
      title: "Chapter link",
      rows: [
        ...(chapterName
          ? [{ label: SHARE_CHAPTER_LINK, onPress: () => void share(invite) }]
          : []),
        { label: MAKE_NEW_LINK, onPress: makeLink },
        {
          label: TURN_OFF_LINK,
          style: "destructive" as const,
          onPress: () => turnOff(invite),
        },
      ],
      userInterfaceStyle: "dark",
    });
  }

  return (
    <View style={styles.stack}>
      <SectionHeader>Chapter link</SectionHeader>
      <Text style={styles.body}>{CHAPTER_LINK_HINT}</Text>
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={message.tone === "problem" ? styles.problem : styles.done}
        >
          {message.text}
        </Text>
      ) : null}
      <ListSection>
        {live ? (
          <ListRow
            label="Chapter link"
            description={chapterLinkCaption(live)}
            action
            busy={busy}
            accessibilityHint="Opens what you can do with the chapter link."
            onPress={() => openMenu(live)}
          />
        ) : (
          <ListRow
            label="Make a chapter link"
            description={
              link?.status === "expired"
                ? chapterLinkExpiryLabel(link)
                : undefined
            }
            action
            busy={busy}
            disabled={!chapterName}
            accessibilityHint="Makes the link and opens the share sheet."
            onPress={makeLink}
          />
        )}
      </ListSection>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    stack: {
      gap: tokens.spacing.sm,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    done: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
