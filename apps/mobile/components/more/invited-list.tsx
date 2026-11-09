import { useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  INVITE_STATUS_LABEL,
  listedInvites,
  useEmailInvites,
  useRevokeInvite,
  type InviteListItem,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { formatSentLabel } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import {
  inviteShareContent,
  inviteShareOptions,
  SHARE_FAILED_MESSAGE,
} from "@/lib/onboarding/chapter-wizard/use-invite-shares";
import { webJoinUrl } from "@/lib/onboarding/chapter-wizard/invite-link";
import { typeRole, useFrappTheme } from "@/lib/theme";

export const SHARE_LINK = "Share link";
export const SEND_AGAIN = "Send again";
export const REVOKE_INVITE = "Revoke invite";

/**
 * What a row's menu offers, in web's order (`invite-member-dialog.tsx`'s
 * `entriesFor`): a pending invite's link can be shared, an emailed one that
 * hasn't joined can be sent again, and a pending one revoked. A joined invite
 * offers nothing, so its row isn't a button. Pure, for the spec.
 */
export function inviteActions(invite: InviteListItem): string[] {
  const actions: string[] = [];
  if (invite.status === "pending") actions.push(SHARE_LINK);
  if (
    invite.email &&
    (invite.status === "pending" || invite.status === "expired")
  ) {
    actions.push(SEND_AGAIN);
  }
  if (invite.status === "pending") actions.push(REVOKE_INVITE);
  return actions;
}

/**
 * The chapter's invites on the Invite members screen, as web's panel lists
 * them under Invited (#3828): every pending one, and joined or expired ones
 * from the last two weeks (`listedInvites`). An emailed invite is named by its
 * address, a shared link as Invite link; each says when it was sent and where
 * it stands.
 *
 * Tapping a row opens its menu, the platform's action sheet: Share link opens
 * the share sheet with the same message Share invite sends, Send again emails
 * the address a fresh link through the same `POST /v1/invites/email` (the
 * server retires the older invite once the new one is delivered), and Revoke
 * invite (`DELETE /v1/invites/:id`) stops it working at once, as web's does.
 */
export function InvitedList({
  invites,
  chapterName,
}: {
  invites: readonly InviteListItem[];
  /** Named in a shared link's message. */
  chapterName: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const emailInvites = useEmailInvites();
  const revokeInvite = useRevokeInvite();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    tone: "done" | "problem";
  } | null>(null);

  const rows = listedInvites(invites);
  if (rows.length === 0) return null;

  async function run(invite: InviteListItem, action: string) {
    setMessage(null);
    if (action === SHARE_LINK) {
      try {
        await Share.share(
          inviteShareContent(webJoinUrl(invite.token), chapterName),
          inviteShareOptions(chapterName),
        );
      } catch {
        setMessage({ text: SHARE_FAILED_MESSAGE, tone: "problem" });
      }
      return;
    }
    setBusyId(invite.id);
    try {
      if (action === SEND_AGAIN && invite.email) {
        const result = await emailInvites.mutateAsync({
          role: invite.role,
          emails: [invite.email],
        });
        setMessage(
          result?.failed?.length
            ? {
                text: `Couldn't email ${invite.email}. Its new invite is listed, so you can share its link.`,
                tone: "problem",
              }
            : { text: `Invite sent again to ${invite.email}`, tone: "done" },
        );
      } else if (action === REVOKE_INVITE) {
        await revokeInvite.mutateAsync(invite.id);
        setMessage({
          text: invite.email
            ? `Invite revoked. ${invite.email} can't join with it now.`
            : "Invite revoked. That link can't be used to join now.",
          tone: "done",
        });
      }
    } catch (caught) {
      setMessage({
        text: errorCopy(
          caught,
          action === REVOKE_INVITE
            ? "Couldn't revoke the invite. Try again in a moment."
            : "Couldn't send it again. Try again in a moment.",
        ),
        tone: "problem",
      });
    } finally {
      setBusyId(null);
    }
  }

  function openMenu(invite: InviteListItem) {
    const actions = inviteActions(invite);
    const title = invite.email ?? "Invite link";
    if (Platform.OS === "ios") {
      const options = [...actions, "Cancel"];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options,
          destructiveButtonIndex: options.indexOf(REVOKE_INVITE),
          cancelButtonIndex: options.length - 1,
          userInterfaceStyle: "dark",
        },
        (index) => {
          const picked = options[index];
          if (picked && picked !== "Cancel") void run(invite, picked);
        },
      );
      return;
    }
    Alert.alert(
      title,
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        ...actions.map((action) => ({
          text: action,
          style:
            action === REVOKE_INVITE
              ? ("destructive" as const)
              : ("default" as const),
          onPress: () => void run(invite, action),
        })),
      ],
      { cancelable: true },
    );
  }

  return (
    <View style={styles.stack}>
      <SectionHeader>Invited</SectionHeader>
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={message.tone === "problem" ? styles.problem : styles.done}
        >
          {message.text}
        </Text>
      ) : null}
      <ListSection>
        {rows.map((invite) => {
          const actions = inviteActions(invite);
          return (
            <ListRow
              key={invite.id}
              label={invite.email ?? "Invite link"}
              description={formatSentLabel(invite.created_at)}
              value={INVITE_STATUS_LABEL[invite.status]}
              action
              busy={busyId === invite.id}
              accessibilityHint="Opens what you can do with this invite."
              onPress={actions.length > 0 ? () => openMenu(invite) : undefined}
            />
          );
        })}
      </ListSection>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    stack: {
      gap: tokens.spacing.sm,
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
