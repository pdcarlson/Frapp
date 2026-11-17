import { useRef, useState } from "react";
import { Alert, Linking, StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import {
  discordLinkedState,
  googleCalendarLinkedState,
  linkedStatusLabel,
  loadSignInMethods,
  signInMethodsQueryKey,
  useDiscordAuthorLink,
  type LinkedAppState,
  type LinkedAppTone,
  type SignInMethodKey,
} from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { AppleMark, GoogleMark } from "@/components/auth/oauth-brand-icons";
import { CalendarSubscribeSheet } from "@/components/events/calendar-subscribe-sheet";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import {
  GOOGLE_CALENDAR_WEB,
  useGoogleCalendarConnection,
} from "@/lib/events/google-calendar-connect";
import { getSupabaseClient } from "@/lib/supabase";
import { useFrappTheme } from "@/lib/theme";

/** Settings' own address: Google's sign-in comes back here. */
const GOOGLE_RETURN_PATH = "preferences";
/** Discord's blurple: a trademark color, never a theme token. */
const DISCORD_BLURPLE = "#5865F2";
const MARK_SIZE = 18;

/**
 * Settings → Linked apps on the phone (#5407): the same rows as web's Linked
 * apps page, with the state drawn at each row's end (a green check, a hollow
 * grey circle, or red once it expired), the way iOS Settings' Passwords and
 * Accounts, Discord's Connections and Slack's connected apps mark theirs.
 *
 * - Google Calendar: a tap connects (or reconnects); once connected, a tap
 *   offers Open Google Calendar and Disconnect. Google's sign-in comes back to
 *   Settings, and the row turns green.
 * - Calendar apps: the Subscribe sheet the Events tab opens, for Apple
 *   Calendar and the rest, so Settings is a second way to it.
 * - Discord: linking happens on the web (Discord's sign-in returns to the web
 *   app), so the phone shows the state and says where.
 * - Sign in: email and password, Google, Apple, as the account has them.
 */
export function LinkedAppsSection() {
  const { tokens } = useFrappTheme();
  const google = useGoogleCalendarConnection({
    returnPath: GOOGLE_RETURN_PATH,
  });
  const googleState = googleCalendarLinkedState(google.status.data);
  const discord = useDiscordAuthorLink();
  const discordState = discordLinkedState(discord.data);
  const signIn = useQuery({
    queryKey: signInMethodsQueryKey,
    queryFn: async () => {
      // No client is a build without Supabase settings: no account to read.
      const supabase = getSupabaseClient();
      return supabase ? loadSignInMethods(supabase.auth) : [];
    },
    staleTime: 60_000,
  });
  const calendarSheetRef = useRef<BottomSheetModal>(null);
  const [calendarSheetOpen, setCalendarSheetOpen] = useState(false);

  function pressGoogle(state: LinkedAppState) {
    if (state.tone === "off") {
      void google.connect();
      return;
    }
    if (state.tone === "expired") {
      // Reconnect, or remove it instead, as web's row offers both.
      Alert.alert("Google Calendar", state.detail, [
        { text: "Reconnect", onPress: () => void google.connect() },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: google.confirmDisconnect,
        },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    Alert.alert("Google Calendar", state.detail, [
      {
        text: "Open Google Calendar",
        onPress: () =>
          void Linking.openURL(GOOGLE_CALENDAR_WEB).catch(() => {}),
      },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: google.confirmDisconnect,
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <>
      <SectionHeader>Linked apps</SectionHeader>
      <ListSection>
        {google.status.isError ? (
          // A failed read is said, never drawn as "not offered here".
          <ListRow
            label="Google Calendar"
            description="Couldn't load your connection. Tap to try again."
            descriptionTone="destructive"
            action
            onPress={() => void google.status.refetch()}
          />
        ) : googleState ? (
          <ListRow
            label="Google Calendar"
            leading={
              <AppTile tokens={tokens} off={googleState.tone === "off"}>
                <CalendarGlyph color={tokens.color.text.foreground} />
              </AppTile>
            }
            description={googleState.detail}
            descriptionTone={
              googleState.tone === "expired" ? "destructive" : "default"
            }
            trailing={<LinkedStatusMark tone={googleState.tone} />}
            accessibilityValue={linkedStatusLabel(googleState.tone)}
            accessibilityHint={
              googleState.tone === "connected"
                ? "Opens Google Calendar, or disconnects it."
                : "Connects your Google account so chapter events show in Google Calendar."
            }
            busy={google.connecting || google.disconnecting}
            action
            onPress={() => pressGoogle(googleState)}
          />
        ) : null}
        <ListRow
          label="Calendar apps"
          leading={
            <AppTile tokens={tokens}>
              <LinkGlyph color={tokens.color.text.foreground} />
            </AppTile>
          }
          description="Apple Calendar and others, by link"
          accessibilityHint="Opens the calendar link for Apple Calendar and other apps."
          onPress={() => {
            setCalendarSheetOpen(true);
            calendarSheetRef.current?.present();
          }}
        />
        {discordState ? (
          <ListRow
            label="Discord"
            leading={
              <AppTile tokens={tokens} off={discordState.tone === "off"}>
                <DiscordGlyph />
              </AppTile>
            }
            description={discordState.detail}
            trailing={<LinkedStatusMark tone={discordState.tone} />}
            accessibilityValue={linkedStatusLabel(discordState.tone)}
            action
            onPress={() =>
              Alert.alert(
                "Discord",
                discordState.tone === "connected"
                  ? `Your imported Discord messages show under your name. Unlink from Settings, Linked apps on the web.`
                  : "Link the Discord account you used in your chapter's server from Settings, Linked apps on the web. Your imported messages then show under your name.",
              )
            }
          />
        ) : null}
      </ListSection>

      {signIn.data && signIn.data.length > 0 ? (
        <>
          <SectionHeader>Sign in</SectionHeader>
          <ListSection>
            {signIn.data.map((method) => (
              <ListRow
                key={method.key}
                label={method.label}
                leading={
                  <AppTile tokens={tokens} off={method.tone === "off"}>
                    <SignInGlyph method={method.key} tokens={tokens} />
                  </AppTile>
                }
                description={method.detail}
                trailing={<LinkedStatusMark tone={method.tone} />}
                accessibilityValue={linkedStatusLabel(method.tone)}
              />
            ))}
          </ListSection>
        </>
      ) : null}

      <CalendarSubscribeSheet
        ref={calendarSheetRef}
        open={calendarSheetOpen}
        onDismiss={() => setCalendarSheetOpen(false)}
        googleReturnPath={GOOGLE_RETURN_PATH}
      />
    </>
  );
}

/** The check, hollow circle or alert at a row's end. */
function LinkedStatusMark({ tone }: { tone: LinkedAppTone }) {
  const { tokens } = useFrappTheme();
  const size = MARK_SIZE;
  if (tone === "connected") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
        <Circle cx={12} cy={12} r={11} fill={tokens.color.semantic.success} />
        <Path
          d="M7 12.5l3.2 3.2L17 9"
          stroke={tokens.color.semantic.onSemantic}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    );
  }
  if (tone === "expired") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
        <Circle
          cx={12}
          cy={12}
          r={11}
          fill={tokens.color.semantic.destructive}
        />
        <Path
          d="M12 7v6M12 16.5v.5"
          stroke={tokens.color.semantic.onSemantic}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Circle
        cx={12}
        cy={12}
        r={10}
        stroke={tokens.color.text.disabled}
        strokeWidth={2}
        fill="none"
      />
    </Svg>
  );
}

function AppTile({
  tokens,
  off = false,
  children,
}: {
  tokens: SignetTokens;
  off?: boolean;
  children: React.ReactNode;
}) {
  const styles = createStyles(tokens);
  return (
    <View style={[styles.tile, off ? styles.tileOff : null]}>{children}</View>
  );
}

function SignInGlyph({
  method,
  tokens,
}: {
  method: SignInMethodKey;
  tokens: SignetTokens;
}) {
  if (method === "google") return <GoogleMark size={MARK_SIZE} />;
  if (method === "apple") {
    return <AppleMark color={tokens.color.text.foreground} size={MARK_SIZE} />;
  }
  return <MailGlyph color={tokens.color.text.foreground} />;
}

function CalendarGlyph({ color }: { color: string }) {
  return (
    <Svg
      width={MARK_SIZE}
      height={MARK_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      accessible={false}
    >
      <Rect
        x={3}
        y={4.5}
        width={18}
        height={16}
        rx={3}
        stroke={color}
        strokeWidth={1.8}
      />
      <Path
        d="M3 9.5h18M8 2.5v4M16 2.5v4"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function LinkGlyph({ color }: { color: string }) {
  return (
    <Svg
      width={MARK_SIZE}
      height={MARK_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      accessible={false}
    >
      <Path
        d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function MailGlyph({ color }: { color: string }) {
  return (
    <Svg
      width={MARK_SIZE}
      height={MARK_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      accessible={false}
    >
      <Rect
        x={3}
        y={5}
        width={18}
        height={14}
        rx={2.5}
        stroke={color}
        strokeWidth={1.8}
      />
      <Path
        d="M4 7l8 6 8-6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function DiscordGlyph() {
  return (
    <Svg
      width={MARK_SIZE}
      height={MARK_SIZE}
      viewBox="0 0 24 24"
      accessible={false}
    >
      <Path
        fill={DISCORD_BLURPLE}
        d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.445.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.042-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.007.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"
      />
    </Svg>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    tile: {
      width: 30,
      height: 30,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
    },
    tileOff: { opacity: 0.45 },
  });
}
