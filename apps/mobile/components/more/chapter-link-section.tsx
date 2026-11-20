import { useRef, useState } from "react";
import {
  type GestureResponderEvent,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  CHAPTER_LINK_HINT,
  chapterLinkExpiryLabel,
  useChapterLinkPicker,
  useChapterLinks,
  useCreateChapterLink,
  useInviteRoleChoices,
  useRevokeInvite,
  type InviteListItem,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { OptionSheet } from "@/components/option-sheet";
import { openItemMenu, pressAt } from "@/components/item-actions-menu";
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
export const NEW_LINK = "New link";
export const JOINS_AS = "Joins as";

/**
 * Chapter links on the phone's Invite members screen (#3353, Paul 2026-11-19:
 * "One chapter link, 7 days"), web's Chapter links section with the same
 * words: links an officer posts where the chapter will see them, the way
 * Discord's server invite and WhatsApp's group link work. Since #5633
 * ("Officer picks it per link") each link joins at the role the officer
 * picked, one live link per role.
 *
 * Each link is a row named for its role, captioned with when it stops (or
 * stopped) working, whose menu shares it while it works, makes a new one
 * (that role's old link stops working) or turns it off. An expired link
 * stays listed, so the officer sees why the link they posted is dead. Under them, Joins as picks the role for the next
 * link (the chapter's default to start) and New link makes it and opens the
 * share sheet. Where web copies, the phone shares, as the Invited list's rows
 * do.
 */
export function ChapterLinkSection({
  chapterName,
}: {
  /** Named in the shared message; null until the chapter loads. */
  chapterName: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const linksQuery = useChapterLinks();
  const roles = useInviteRoleChoices();
  const create = useCreateChapterLink();
  const revoke = useRevokeInvite();
  const sheetRef = useRef<BottomSheetModal>(null);
  const running = useRef(false);
  // Which row is working: a link's id, or "new" for the New link row.
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    tone: "done" | "problem";
  } | null>(null);
  const { links, newRole, pick, label, replaces, canRemake } =
    useChapterLinkPicker(linksQuery.data, roles);

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

  async function guarded(
    row: string,
    work: () => Promise<void>,
    failure: string,
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(row);
    setMessage(null);
    try {
      await work();
    } catch (caught) {
      setMessage({ text: errorCopy(caught, failure), tone: "problem" });
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  function makeLink(row: string, role: string | null) {
    void guarded(
      row,
      async () => {
        const made = await create.mutateAsync(role ? { role } : undefined);
        // The share sheet doesn't hold the lock: iOS doesn't always say when
        // it closes.
        void share(made);
      },
      "Couldn't make a chapter link. Try again in a moment.",
    );
  }

  function turnOff(invite: InviteListItem) {
    void guarded(
      invite.id,
      async () => {
        await revoke.mutateAsync(invite.id);
        setMessage({
          text: `${label(invite.role)} link turned off. Nobody can join with it now.`,
          tone: "done",
        });
      },
      "Couldn't turn off the link. Try again in a moment.",
    );
  }

  function openMenu(invite: InviteListItem, event?: GestureResponderEvent) {
    if (running.current) return;
    openItemMenu(
      {
        title: `${label(invite.role)} link`,
        actions: [
          ...(chapterName && invite.status === "pending"
            ? [
                {
                  key: "share",
                  label: SHARE_CHAPTER_LINK,
                  run: () => void share(invite),
                },
              ]
            : []),
          ...(canRemake(invite.role)
            ? [
                {
                  key: "remake",
                  label: MAKE_NEW_LINK,
                  run: () => makeLink(invite.id, invite.role),
                },
              ]
            : []),
          {
            key: "turn-off",
            label: TURN_OFF_LINK,
            destructive: true,
            run: () => turnOff(invite),
          },
        ],
      },
      pressAt(event),
    );
  }

  return (
    <View style={styles.stack}>
      <SectionHeader>Chapter links</SectionHeader>
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
        {links.map((link) => (
          <ListRow
            key={link.id}
            label={label(link.role)}
            description={chapterLinkExpiryLabel(link)}
            action
            busy={busy === link.id}
            accessibilityHint={`Opens what you can do with the ${label(link.role)} link.`}
            onPress={(event) => openMenu(link, event)}
          />
        ))}
        {roles.choices.length > 0 && newRole ? (
          <ListRow
            label={JOINS_AS}
            value={label(newRole)}
            accessibilityHint="Picks the role the new link joins at."
            onPress={() => sheetRef.current?.present()}
          />
        ) : null}
        <ListRow
          label={replaces ? MAKE_NEW_LINK : NEW_LINK}
          action
          busy={busy === "new"}
          disabled={!chapterName}
          accessibilityHint={
            replaces
              ? "Makes a new link for this role, turns off its old one, and opens the share sheet."
              : "Makes the link and opens the share sheet."
          }
          onPress={() => makeLink("new", newRole)}
        />
      </ListSection>
      <OptionSheet
        ref={sheetRef}
        title={JOINS_AS}
        options={roles.choices.map((choice) => ({
          value: choice.name,
          label: choice.label,
        }))}
        selected={newRole}
        onSelect={(next) => {
          if (next) pick(next);
        }}
      />
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
