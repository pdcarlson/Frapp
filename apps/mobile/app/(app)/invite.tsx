import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import {
  useActiveChapterId,
  useCurrentChapter,
  useInvites,
  useMyPermissions,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { can } from "@repo/validation";
import {
  BACK_TO_CHAT,
  BACK_TO_DIRECTORY,
  BACK_TO_MORE,
  type BackTarget,
} from "@/components/back-row";
import { ShareGlyph } from "@/components/control-glyphs";
import { InviteByEmail } from "@/components/more/invite-by-email";
import { InvitedList } from "@/components/more/invited-list";
import { InviteLinksCard } from "@/components/onboarding/invite-links-card";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import { ScreenShell } from "@/components/screen-shell";
import {
  ErrorState,
  NoChapterState,
  SkeletonBlock,
  SkeletonRegion,
} from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  INVITE_WATCH_INTERVAL_MS,
  useInviteShares,
} from "@/lib/onboarding/chapter-wizard/use-invite-shares";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { InlineNote } from "@/components/inline-note";

/**
 * Invite members, inside a chapter (owner ask 2026-11-06: "I couldn't find a
 * way to invite new members or get my invite link from mobile";
 * `spec/ui/mobile/navigation.md` § Inviting members).
 *
 * Web's panel, on the phone (Paul, 2026-11-09: "that's the way it should be
 * for mobile as well", #3828): Invite by email first, which sends web's email
 * through the same `POST /v1/invites/email`; then Share invite, setup's
 * share-first link (`useInviteShares`), which mints a fresh single-use link
 * and opens the share sheet with it, Mail and Gmail among its targets; then
 * the chapter's invites under Invited, each with web's Share link, Send again
 * and Revoke. No token is ever drawn. Inside a chapter the Send button, the
 * field's focus border and the link tile take the chapter accent, where
 * setup's take house gold (`spec/behavior/branding.md`).
 *
 * Neither path names a role, so the server applies the chapter's
 * `default_invite_role_id` (#422), as web's dialog does without a pick.
 *
 * Reached from four doors, each drawn only for a member who holds
 * `members:invite` (the permission every invite route checks; by default the
 * President's alone): the More hub's Admin row, the Directory's floating +,
 * the tab bar's quick action, and Chat home's setup checklist line. `from`
 * says which one opened it, so the back capsule names where it goes.
 */
export default function InviteScreen() {
  const chapterId = useActiveChapterId();
  const focused = useIsFocused();
  // The screen stays mounted through a chapter switch, and under any screen
  // pushed over it, so the body is keyed on both: a link kept from a sheet
  // backed out of in chapter A never goes out under chapter B's name, and a
  // half-typed address or a sent notice doesn't outlive the visit. A visit
  // ends when the screen loses focus; popping it unmounts it outright.
  const [visit, setVisit] = useState(0);
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (wasFocused.current && !focused) setVisit((n) => n + 1);
    wasFocused.current = focused;
  }, [focused]);
  return (
    <InviteBody
      key={`${chapterId ?? "no-chapter"}:${visit}`}
      focused={focused}
    />
  );
}

function InviteBody({ focused }: { focused: boolean }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { from } = useLocalSearchParams<{ from?: string }>();
  const back = backTargetFor(from);
  const chapterId = useActiveChapterId();
  const branding = useChapterBranding();
  // The share line names the chapter. Share waits for its name rather than
  // sending a placeholder to someone who doesn't know the chapter yet.
  const shareName = useCurrentChapter().data?.name?.trim() || null;

  const permissionsQuery = useMyPermissions();
  const permissionsKnown = permissionsQuery.data !== undefined;
  const permissions = Array.isArray(permissionsQuery.data?.permissions)
    ? permissionsQuery.data.permissions
    : [];
  const canInvite = can("members:invite", permissions);

  const [error, setError] = useState<string | null>(null);
  const invite = useInviteShares({
    // The Invited list below watches the chapter's invites itself.
    active: false,
    chapterName: shareName ?? "",
    onError: setError,
  });
  // Every invite, re-read while the screen is in front, so a link someone
  // redeems reads Joined and one another officer revoked drops off.
  const invites = useInvites({
    enabled: focused && canInvite,
    refetchInterval: focused ? INVITE_WATCH_INTERVAL_MS : false,
  });

  if (!chapterId) {
    return (
      <ScreenShell back={back} title="Invite members">
        <NoChapterState noun="invites" />
      </ScreenShell>
    );
  }

  if (!permissionsKnown) {
    return (
      <ScreenShell back={back} title="Invite members">
        {permissionsQuery.isError ? (
          <ErrorState
            title="Couldn't load your role"
            body="Whether you can send invites depends on it, so it has to load first."
            onRetry={() => {
              void permissionsQuery.refetch();
            }}
            isRetrying={permissionsQuery.isFetching}
          />
        ) : (
          <SkeletonRegion label="Loading invites">
            <SkeletonBlock
              width="100%"
              height={72}
              radius={tokens.radius.cardLarge}
            />
          </SkeletonRegion>
        )}
      </ScreenShell>
    );
  }

  if (!canInvite) {
    return (
      <ScreenShell back={back} title="Invite members">
        <InlineNote>
          {
            "Your role can't send invites. Ask an officer to send each person their own link."
          }
        </InlineNote>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell back={back} title="Invite members">
      <View style={styles.stack}>
        <InviteByEmail
          accent={branding.accentPrimary}
          onAccent={branding.accentOnPrimary}
          onSent={() => {
            void invites.refetch();
          }}
        />
        <View style={styles.section}>
          <Text style={styles.label}>Or share a link</Text>
          <Text style={styles.body}>
            Paste it in a group chat, or send it from your mail app. A link lets
            one person in and lasts 24 hours.
          </Text>
          <InviteLinksCard
            tile={{
              fill: branding.accentSubtle,
              border: branding.accentBorder,
              ink: branding.accent,
            }}
            action={
              <View>
                <OnboardingSecondaryButton
                  fill
                  label="Share invite"
                  leading={<ShareGlyph color={tokens.color.text.foreground} />}
                  accessibilityHint="Makes a new link and opens the share sheet."
                  disabled={invite.busy || !shareName}
                  busy={invite.busy}
                  onPress={() => {
                    void invite.share().then(() => invites.refetch());
                  }}
                />
                {error ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={styles.errorText}
                  >
                    {error}
                  </Text>
                ) : null}
              </View>
            }
          />
        </View>
        {invites.data ? (
          <InvitedList invites={invites.data} chapterName={shareName ?? ""} />
        ) : null}
      </View>
    </ScreenShell>
  );
}

/** The back capsule for the door that opened the screen. */
export function backTargetFor(from: string | undefined): BackTarget {
  if (from === "directory") return BACK_TO_DIRECTORY;
  if (from === "chat") return BACK_TO_CHAT;
  return BACK_TO_MORE;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    stack: {
      gap: tokens.spacing.xl,
    },
    section: {
      gap: tokens.spacing.sm,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    errorText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      marginTop: tokens.spacing.sm,
    },
  });
}
