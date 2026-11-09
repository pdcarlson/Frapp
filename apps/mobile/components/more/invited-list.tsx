import { useEffect, useRef, useState } from "react";
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
  inviteMenuActions,
  listedInvites,
  useEmailInvites,
  useRevokeInvite,
  type InviteListItem,
  type InviteMenuAction,
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

const ACTION_LABEL: Record<InviteMenuAction, string> = {
  link: SHARE_LINK,
  again: SEND_AGAIN,
  revoke: REVOKE_INVITE,
};

/**
 * What a row's menu offers, as labels: web's actions
 * (`inviteMenuActions`, shared with web's Invited menu), where the phone
 * shares a link rather than copying it. Share link waits for the chapter's
 * name, as Share invite does, so the message never goes out with a blank
 * where the name belongs. A row with nothing to offer isn't a button. Pure,
 * for the spec.
 */
export function inviteActions(
  invite: Pick<InviteListItem, "status" | "email">,
  canShare = true,
): string[] {
  return inviteMenuActions(invite)
    .filter((action) => action !== "link" || canShare)
    .map((action) => ACTION_LABEL[action]);
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
 * One action runs at a time: while one is out, the rows take no press, so
 * nothing is sent or revoked twice.
 */
export function InvitedList({
  invites,
  isError,
  isRetrying,
  onRetry,
  chapterName,
  onLinkUsed,
}: {
  /** `GET /v1/invites`, or undefined while it hasn't loaded. */
  invites: readonly InviteListItem[] | undefined;
  /** The read failed and nothing is loaded to show. */
  isError: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  /** Named in a shared link's message; null until the chapter loads. */
  chapterName: string | null;
  /** A link was revoked or shared from its row, so it is spent. */
  onLinkUsed?: (token: string) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const emailInvites = useEmailInvites();
  const revokeInvite = useRevokeInvite();
  const [busyId, setBusyId] = useState<string | null>(null);
  // The press guard: state settles a render late, a ref doesn't.
  const running = useRef(false);
  const [message, setMessage] = useState<{
    text: string;
    tone: "done" | "problem";
  } | null>(null);

  const rows = invites ? listedInvites(invites) : [];
  // A result line belongs to the list it was about. Once a new invite joins
  // the list, an old "Invite revoked" would read as news about it.
  const shown = useRef(rows.length);
  useEffect(() => {
    if (rows.length > shown.current) setMessage(null);
    shown.current = rows.length;
  }, [rows.length]);

  if (!invites) {
    if (!isError) return null;
    return (
      <View style={styles.stack}>
        <SectionHeader>Invited</SectionHeader>
        <Text accessibilityLiveRegion="polite" style={styles.problem}>
          {"Couldn't load your invites."}
        </Text>
        <ListSection>
          <ListRow
            label="Try again"
            action
            busy={isRetrying}
            onPress={onRetry}
          />
        </ListSection>
      </View>
    );
  }
  if (rows.length === 0 && !message) return null;

  async function run(invite: InviteListItem, action: string) {
    if (running.current) return;
    running.current = true;
    setMessage(null);
    setBusyId(invite.id);
    try {
      if (action === SHARE_LINK && chapterName) {
        const result = await Share.share(
          inviteShareContent(webJoinUrl(invite.token), chapterName),
          inviteShareOptions(chapterName),
        );
        if (result?.action !== "dismissedAction") onLinkUsed?.(invite.token);
      } else if (action === SEND_AGAIN && invite.email) {
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
        onLinkUsed?.(invite.token);
        setMessage({
          text: invite.email
            ? `Invite revoked. ${invite.email} can't join with it now.`
            : "Invite revoked. That link can't be used to join now.",
          tone: "done",
        });
      }
    } catch (caught) {
      setMessage({
        text:
          action === SHARE_LINK
            ? SHARE_FAILED_MESSAGE
            : errorCopy(
                caught,
                action === REVOKE_INVITE
                  ? "Couldn't revoke the invite. Try again in a moment."
                  : "Couldn't send it again. Try again in a moment.",
              ),
        tone: "problem",
      });
    } finally {
      running.current = false;
      setBusyId(null);
    }
  }

  function openMenu(invite: InviteListItem) {
    if (running.current) return;
    const actions = inviteActions(invite, !!chapterName);
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
    // Android's dialog draws at most three buttons and drops the rest, and
    // an emailed pending invite has three actions, so it has no Cancel
    // button: back or a tap outside closes it (`cancelable`).
    Alert.alert(
      title,
      undefined,
      actions.map((action) => ({
        text: action,
        style:
          action === REVOKE_INVITE
            ? ("destructive" as const)
            : ("default" as const),
        onPress: () => void run(invite, action),
      })),
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
      {rows.length > 0 ? (
        <ListSection>
          {rows.map((invite) => {
            const actions = inviteActions(invite, !!chapterName);
            return (
              <ListRow
                key={invite.id}
                label={invite.email ?? "Invite link"}
                description={formatSentLabel(invite.created_at)}
                value={INVITE_STATUS_LABEL[invite.status]}
                action
                busy={busyId === invite.id}
                accessibilityHint="Opens what you can do with this invite."
                onPress={
                  actions.length > 0 ? () => openMenu(invite) : undefined
                }
              />
            );
          })}
        </ListSection>
      ) : null}
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
