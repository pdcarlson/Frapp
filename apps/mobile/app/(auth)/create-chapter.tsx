import { errorCopy } from "@repo/hooks/error-copy";
import { useState, type ComponentProps, type ReactNode, type Ref } from "react";
import { Redirect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  CHANNEL_LIST_KEY,
  DIRECTORY_MIN_QUERY_LENGTH,
  useChapterDirectorySearch,
  useConfirmChapterLogo,
  useCurrentChapter,
  useDebouncedValue,
  useOnboardChapter,
  useRequestChapterLogoUploadUrl,
  type ChapterDirectoryResult,
} from "@repo/hooks";
import {
  ARCHETYPES,
  orgColorsFor,
  orgDefaultAccent,
  orgHidingGreekLettersIn,
  type ArchetypeKey,
} from "@repo/org-archetypes";
import { SignetTokens } from "@repo/theme/signet";
import {
  CHAPTER_SHORT_NAME_MAX_LENGTH,
  resolveChapterMark,
} from "@repo/validation";
import { useAuthSession } from "@/lib/auth-session";
import { TermsAcceptance } from "@/components/auth/terms-acceptance";
import { ChoiceRow } from "@/components/auth/choice-row";
import { AccentPicker } from "@/components/chapter/accent-picker";
import {
  PUSH_ASK_TITLE,
  PushAskActions,
  PushAskBody,
} from "@/components/notifications/push-ask";
import { BackRow } from "@/components/back-row";
import {
  SignedInAs,
  useOnboardingSignOut,
} from "@/components/onboarding/signed-in-as";
import { ChapterMarkTile } from "@/components/onboarding/chapter-mark-tile";
import {
  OnboardingFieldLabel,
  OnboardingTextInput,
} from "@/components/onboarding/onboarding-field";
import {
  ONBOARDING_COLUMN_WIDTH,
  OnboardingPrimaryButton,
} from "@/components/onboarding/onboarding-primary-button";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import { JoinedChannelsCard } from "@/components/onboarding/joined-channels-card";
import { InviteLinksCard } from "@/components/onboarding/invite-links-card";
import { ShareGlyph } from "@/components/control-glyphs";
import { ChatDensityOptions } from "@/components/settings/chat-density-sheet";
import { Toggle } from "@/components/toggle";
import {
  EMPTY_CHAPTER_IDENTITY,
  chapterIdentityBranding,
  chapterIdentityIsValid,
  directoryMatchMarkFields,
  lettersHiddenBy,
  normalizeAccentInput,
  withOrgName,
  type ChapterIdentityForm,
} from "@repo/hooks/chapter-identity";
import { onboardedChapterId } from "@/lib/onboarding/chapter-wizard/invite-link";
import {
  INVITE_ROLE,
  useInviteShares,
} from "@/lib/onboarding/chapter-wizard/use-invite-shares";
import { pickAndSetChapterLogo } from "@/lib/onboarding/chapter-wizard/chapter-logo";
import {
  DISPLAY_STEP_SUBTITLE,
  DISPLAY_STEP_TITLE,
} from "@/lib/onboarding/display-step";
import { useSelectChapter } from "@/lib/select-chapter";
import { usePushPrimer } from "@/lib/notifications/use-push-primer";
import { useHoldSwipeBack } from "@/lib/back-target";
import { useBackToClose } from "@/lib/overlay";
import { successHaptic } from "@/lib/haptics";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import { stepFadeIn } from "@/lib/onboarding/step-fade";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";

/**
 * First-officer chapter setup (`spec/behavior/onboarding.md`, #3351).
 *
 * Three steps make the chapter: **Find** it in the directory, **Confirm** the
 * match (or describe it by hand), and pick its **Color**. Creating it opens
 * four more: the **live** moment with its channels and an optional logo, the
 * founder's own **display** pick (the same three cards as s03's display beat,
 * #4056: founders skip s03), the notifications step when this build can push
 * and push is off, and the **invite** link. Then chat.
 *
 * One route, with the steps as state: `POST /v1/chapters/onboard` flips the
 * membership count to 1 mid-flow, and every gate exempts `/create-chapter` by
 * its exact pathname (`(auth)/_layout.tsx`, `use-onboarding-redirect.ts`), so a
 * sibling route for the later steps would be yanked into the tabs.
 *
 * The archetype comes from the directory match and is asked only when the
 * chapter is entered by hand (or the match carries no known archetype), with
 * nothing preselected. Some organizations don't display their Greek letters
 * (Phi Gamma Delta): for them the letters appear nowhere here and the created
 * chapter is sent with them off. The short name and the letters switch follow
 * `orgMarkFieldsFor` through the glue both setups share in
 * `@repo/hooks/chapter-identity` (`withOrgName`, `directoryMatchMarkFields`,
 * `lettersHiddenBy`): naming such an organization, by its directory row or by
 * hand ("FIJI", "Phi Gamma Delta Tau Nu"), turns the switch off and fills an
 * empty short name, and picking another row undoes both. A chapter picked
 * from its row keeps the letters hidden whatever its name field says later.
 */

type Step =
  "find" | "confirm" | "color" | "live" | "display" | "primer" | "invite";
/** The steps before the chapter exists, which the progress ticks count. */
const SETUP_STEPS: Step[] = ["find", "confirm", "color"];

/** Each step's screen title. The live one names the chapter. */
export const SETUP_TITLES = {
  find: "Find your chapter",
  confirmMatch: "Is this your chapter?",
  confirmManual: "Tell us about your chapter",
  color: "Pick your color",
  display: DISPLAY_STEP_TITLE,
  primer: PUSH_ASK_TITLE,
  invite: "Invite your chapter",
} as const;

export function liveTitle(displayName: string): string {
  return `${displayName} is live`;
}

/** A directory archetype this app knows, else `null`: the officer picks. */
function knownArchetype(value: string | null | undefined): ArchetypeKey | null {
  return value && Object.hasOwn(ARCHETYPES, value)
    ? (value as ArchetypeKey)
    : null;
}

/**
 * The branding setup previews and sends. The form already holds the switch
 * off for an organization that hides its letters (`withOrgName`); this is
 * the last line for any form that doesn't. One does on purpose: a row from
 * another organization renamed to FIJI changes the name alone, as on web,
 * so the switch that row left on is overridden here. The letters themselves
 * stay stored, as web's wizard stores them (branding.md: the switch hides,
 * it doesn't delete); setup never draws them or sends them shown.
 */
function setupBranding(identity: ChapterIdentityForm, hiddenBy: string | null) {
  const branding = chapterIdentityBranding(identity);
  return hiddenBy ? { ...branding, show_greek_letters: false } : branding;
}

/** How a directory row reads in the results: never letters a group hides. */
export function directoryRowTitle(row: ChapterDirectoryResult): string {
  return !orgHidingGreekLettersIn(row.org_name) && row.org_letters
    ? `${row.org_letters} · ${row.org_name}`
    : row.org_name;
}

export default function CreateChapter() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status } = useAuthSession();
  const queryClient = useQueryClient();
  const selectChapter = useSelectChapter();
  const onboardChapter = useOnboardChapter();
  const requestLogoUrl = useRequestChapterLogoUploadUrl();
  const confirmLogo = useConfirmChapterLogo();
  const primer = usePushPrimer();
  const { signOut, signingOut } = useOnboardingSignOut();

  const [step, setStep] = useState<Step>("find");
  const [rawQuery, setRawQuery] = useState("");
  const debouncedQuery = useDebouncedValue(rawQuery, 250);
  const [directoryId, setDirectoryId] = useState<string | null>(null);
  // The organization the picked directory row names, which keeps its letters
  // hidden however the name is edited after (`lettersHiddenBy`).
  const [matchedOrgName, setMatchedOrgName] = useState<string | null>(null);
  const [archetype, setArchetype] = useState<ArchetypeKey | null>(null);
  // Whether the confirm step asks for the archetype: by hand, or a match
  // whose archetype this app doesn't know. Fixed when the step opens, so
  // picking one doesn't hide the list it was picked from.
  const [asksArchetype, setAsksArchetype] = useState(false);
  const [identity, setIdentity] = useState<ChapterIdentityForm>(
    EMPTY_CHAPTER_IDENTITY,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  // False while the accent's custom field holds a half-typed hex, which would
  // otherwise submit the last whole color it held instead.
  const [accentValid, setAccentValid] = useState(true);
  // Create pressed over a half-typed hex: the picker's hint shows at once.
  const [accentSubmitTried, setAccentSubmitTried] = useState(false);
  // Whether the new chapter became the active one. The logo and invite
  // routes act on the active chapter, so without it they can't run.
  const [activated, setActivated] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoNote, setLogoNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The whole create, not just the API call: `selectChapter` runs after the
  // mutation settles and before the step moves on, and a sign-out in that
  // window would leave the new chapter half opened under no session.
  const [createRunning, setCreateRunning] = useState(false);

  const searchQuery = useChapterDirectorySearch(debouncedQuery, {
    enabled: step === "find",
  });
  const results = Array.isArray(searchQuery.data) ? searchQuery.data : [];
  const current = useCurrentChapter({ enabled: activated });
  const logoUrl = activated ? current.data?.logo_url || null : null;

  const submitting = onboardChapter.isPending || createRunning;
  // What locks the screen's controls: a create, or a sign-out on its way.
  const locked = submitting || signingOut;
  const isManual = directoryId === null;
  // Every step after the setup ones exists only once the chapter does.
  const created = !SETUP_STEPS.includes(step);
  const displayName =
    identity.shortName.trim() || identity.name.trim() || "Your chapter";
  const canConfirm = chapterIdentityIsValid(identity) && archetype !== null;
  // Not gated on `accentValid`: Create stays pressable over a half-typed hex
  // so the press can say why (`submitChapter`, the picker's `showError`).
  const canSubmit = canConfirm && acceptedLegal;
  const lettersHidden = lettersHiddenBy(matchedOrgName, identity);
  const invite = useInviteShares({
    active: step === "invite",
    chapterName: displayName,
    role: INVITE_ROLE,
    onError: setError,
  });
  // A write in flight on any step, which Sign out waits for: the create, a
  // logo upload, an invite being minted and shared, or the OS push prompt.
  // Signing out under one would land its result on no session.
  const writing = submitting || logoBusy || invite.busy || primer.isRequesting;

  function applyDirectoryMatch(row: ChapterDirectoryResult) {
    const known = knownArchetype(row.archetype);
    setDirectoryId(row.id);
    setMatchedOrgName(row.org_name ?? null);
    setArchetype(known);
    setAsksArchetype(known === null);
    setIdentity({
      name: row.org_name ?? "",
      university: row.university ?? "",
      greekLetters: row.org_letters ?? "",
      // The directory knows letters, not whether an organization shows them:
      // the row's profile decides, and a row picked before this one undoes
      // what it set however the name was edited since.
      ...directoryMatchMarkFields(row.org_name, matchedOrgName, identity),
      designation: row.chapter_designation ?? "",
      schoolShort: row.university_short ?? "",
      foundedYear: row.founded_year ? String(row.founded_year) : "",
      // The organization's own first color wins over the directory's: most
      // directory rows hold one placeholder gold (`orgDefaultAccent`).
      colorAccent: normalizeAccentInput(
        orgDefaultAccent(row.org_name) ?? row.default_colors?.accent,
      ),
    });
    setDetailsOpen(false);
    setAcceptedLegal(false);
    setError(null);
    setStep("confirm");
  }

  function startManualEntry() {
    setDirectoryId(null);
    setMatchedOrgName(null);
    setArchetype(null);
    setAsksArchetype(true);
    // A name carried over from the search gets its profile, as a typed one does.
    setIdentity(withOrgName(EMPTY_CHAPTER_IDENTITY, rawQuery.trim(), false));
    setDetailsOpen(false);
    setAcceptedLegal(false);
    setError(null);
    setStep("confirm");
  }

  function goBack() {
    if (locked) return;
    setError(null);
    if (step === "confirm") {
      setStep("find");
    } else if (step === "color") {
      // Leaving color unmounts the picker and drops a half-typed hex with it;
      // it opens on swatches again, so the accent is valid again.
      setAccentValid(true);
      setStep("confirm");
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/join");
    }
  }

  function finish() {
    router.dismissTo("/");
  }

  // Android back steps back through setup, and once the chapter exists it
  // leaves for chat: there is no going back to before the chapter was made.
  useBackToClose(step === "confirm" || step === "color", goBack);
  // The iOS swipe can't step back through these steps, which are one route,
  // and popping the flow would drop what was entered (navigation.md § Going
  // back).
  useHoldSwipeBack(step === "confirm" || step === "color");
  // Held, not passed through, while a sign-out runs: the press is still
  // taken, so it can't leave setup under a session that is going away.
  useBackToClose(created, () => {
    if (!signingOut) finish();
  });

  async function submitChapter() {
    if (!accentValid) {
      setAccentSubmitTried(true);
      return;
    }
    if (!canSubmit || locked || archetype === null) return;
    setError(null);
    setCreateRunning(true);
    try {
      const chapter = await onboardChapter.mutateAsync({
        name: identity.name.trim(),
        university: identity.university.trim(),
        org_archetype: archetype,
        directory_id: directoryId ?? undefined,
        accept_terms_privacy: true,
        branding: setupBranding(identity, lettersHidden),
      });
      const id = onboardedChapterId(chapter);
      const active = id ? await selectChapter(id) : false;
      setActivated(active);
      // The channel list is keyed without the chapter, so a list read before
      // the chapter existed would stand in for its seeded channels. Dropped,
      // not just marked stale, so the live step never draws the old one.
      queryClient.removeQueries({ queryKey: CHANNEL_LIST_KEY });
      setStep("live");
      successHaptic();
    } catch (caught) {
      setError(
        errorCopy(
          caught,
          "Couldn't create that chapter. Check the details and try again.",
        ),
      );
    } finally {
      setCreateRunning(false);
    }
  }

  async function addLogo() {
    if (logoBusy || signingOut) return;
    setLogoBusy(true);
    setLogoNote(null);
    const result = await pickAndSetChapterLogo({
      requestUploadUrl: requestLogoUrl.mutateAsync,
      confirm: confirmLogo.mutateAsync,
    });
    setLogoBusy(false);
    if (result.status === "refused") setLogoNote(result.reason);
  }

  // The invite route acts on the active chapter, like the logo's: without
  // the new chapter active it would mint for another chapter, or fail, so
  // setup ends at chat and the officer invites from there.
  function afterPrimer() {
    if (activated) {
      setStep("invite");
    } else {
      finish();
    }
  }

  function leaveLive() {
    setError(null);
    setStep("display");
  }

  // The founder's display pick (#4056). The phone's current display is
  // preselected and a tap saves at once, so Continue keeps whatever is checked.
  function leaveDisplay() {
    setError(null);
    if (primer.showPrimer) {
      setStep("primer");
    } else {
      afterPrimer();
    }
  }

  async function answerPrimer(answer: "on" | "not-now") {
    // `null` / `false`: another answer is already on its way, and it moves on.
    const moved =
      answer === "on"
        ? (await primer.turnOn()) !== null
        : await primer.notNow();
    // Either answer moves on, even when the OS prompt failed: the step has no
    // other way forward.
    if (moved) afterPrimer();
  }

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  const title =
    step === "find"
      ? SETUP_TITLES.find
      : step === "confirm"
        ? isManual
          ? SETUP_TITLES.confirmManual
          : SETUP_TITLES.confirmMatch
        : step === "color"
          ? SETUP_TITLES.color
          : step === "live"
            ? liveTitle(displayName)
            : step === "display"
              ? SETUP_TITLES.display
              : step === "primer"
                ? SETUP_TITLES.primer
                : SETUP_TITLES.invite;
  const setupIndex = SETUP_STEPS.indexOf(step);
  const mark = resolveChapterMark({
    logoUrl,
    branding: setupBranding(identity, lettersHidden),
    name: identity.name,
  });
  const accent = normalizeAccentInput(identity.colorAccent);

  return (
    // Safe area on every edge (#3345): `(auth)` renders with `headerShown:
    // false`, and Android draws the app edge to edge, so nothing else keeps
    // this screen off the status bar or its last control off the swipe bar.
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "right", "bottom", "left"]}
    >
      <KeyboardAvoidingArea style={styles.flex} atScreenBottom>
        <View style={styles.container}>
          {/*
            The board's s02 `‹ Back` row, in house gold, with the progress
            ticks at its far end. Once the chapter exists there is no going
            back to before it was made, so the row goes and the header keeps
            its height.
          */}
          <View style={styles.header}>
            {created ? null : (
              <BackRow
                house
                label="Back"
                accessibilityLabel="Back"
                disabled={locked}
                onPress={goBack}
                trailing={
                  setupIndex >= 0 ? (
                    <View
                      accessibilityRole="progressbar"
                      accessibilityLabel="Chapter setup"
                      accessibilityValue={{
                        min: 1,
                        max: SETUP_STEPS.length,
                        now: setupIndex + 1,
                      }}
                      style={styles.progressRow}
                    >
                      {SETUP_STEPS.map((item, index) => (
                        <View
                          key={item}
                          style={[
                            styles.progressTick,
                            index <= setupIndex ? styles.progressTickOn : null,
                          ]}
                        />
                      ))}
                    </View>
                  ) : null
                }
              />
            )}
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {/*
              The account setup runs as, with Sign out, on every step
              (#3782), as web's setup wizard shows it (#3776). At the top of
              the column, so the pinned footer never covers it.
            */}
            <SignedInAs
              signOut={signOut}
              signingOut={signingOut}
              disabled={writing}
            />

            {step === "live" ? (
              <Animated.View
                entering={ZoomIn.duration(420).reduceMotion(
                  ReduceMotion.System,
                )}
                style={styles.liveMark}
              >
                <ChapterMarkTile
                  testID="setup-mark-text"
                  logoUrl={mark.logoUrl}
                  text={mark.text}
                  accent={accent}
                  size={72}
                />
              </Animated.View>
            ) : null}

            {/*
              Each step fades in (`stepFadeIn`, as join's views do), keyed so
              the fade runs on every step change.
            */}
            <Animated.View
              key={step}
              entering={stepFadeIn(tokens)}
              style={styles.stack}
            >
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>

              {step === "find" ? (
                <FindStep
                  rawQuery={rawQuery}
                  onQueryChange={setRawQuery}
                  isFetching={searchQuery.isFetching}
                  isError={searchQuery.isError}
                  onRetry={() => {
                    void searchQuery.refetch();
                  }}
                  results={results}
                  debouncedQuery={debouncedQuery}
                  onSelect={applyDirectoryMatch}
                  onManual={startManualEntry}
                  styles={styles}
                  tokens={tokens}
                />
              ) : null}

              {step === "confirm" ? (
                <ConfirmStep
                  identity={identity}
                  onChange={setIdentity}
                  isManual={isManual}
                  lettersHidden={lettersHidden}
                  detailsOpen={detailsOpen}
                  onToggleDetails={() => setDetailsOpen((open) => !open)}
                  asksArchetype={asksArchetype}
                  archetype={archetype}
                  onArchetype={setArchetype}
                  mark={
                    <ChapterMarkTile
                      testID="setup-mark-text"
                      logoUrl={null}
                      text={mark.text}
                      accent={accent}
                      size={48}
                    />
                  }
                  styles={styles}
                />
              ) : null}

              {step === "color" ? (
                <View style={styles.stack}>
                  <Text style={styles.body}>
                    Your color tints buttons, badges and your chapter mark. You
                    can change it later in Settings.
                  </Text>
                  <View style={styles.previewRow}>
                    <ChapterMarkTile
                      testID="setup-mark-text"
                      logoUrl={null}
                      text={mark.text}
                      accent={accent}
                      size={48}
                    />
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {identity.name}
                    </Text>
                  </View>
                  <AccentPicker
                    label="Chapter color"
                    value={accent}
                    onChange={(hex) =>
                      setIdentity((prev) => ({ ...prev, colorAccent: hex }))
                    }
                    onValidityChange={setAccentValid}
                    showError={accentSubmitTried}
                    orgColors={orgColorsFor(identity.name)}
                    // House gold on purpose, as setup's other fields are
                    // (`OnboardingTextInput`): the chapter doesn't exist yet,
                    // so there is no accent for the focus border to follow.
                    focusColor={tokens.color.gold.askText}
                  />
                  {/*
                  The officer's acceptance for the chapter and for themselves
                  (#2302). No Backwork line: the app has no Backwork (#2258).
                */}
                  <TermsAcceptance
                    accepted={acceptedLegal}
                    onAcceptedChange={setAcceptedLegal}
                  />
                </View>
              ) : null}

              {step === "live" ? (
                <View style={styles.stack}>
                  {activated ? (
                    <>
                      <Text style={styles.body}>
                        Your channels are ready. Invite your members next.
                      </Text>
                      <JoinedChannelsCard />
                    </>
                  ) : (
                    <Text style={styles.body}>
                      Your chapter is ready. Open chat to see its channels and
                      invite your members.
                    </Text>
                  )}
                  {activated ? (
                    <View style={styles.logoBlock}>
                      <OnboardingSecondaryButton
                        label={
                          mark.logoUrl
                            ? "Change logo"
                            : "Add your chapter's logo"
                        }
                        disabled={logoBusy || signingOut}
                        busy={logoBusy}
                        onPress={() => {
                          void addLogo();
                        }}
                      />
                      <Text style={styles.helperText}>
                        Optional. A logo stands in for your letter mark
                        everywhere.
                      </Text>
                      {logoNote ? (
                        <Text
                          accessibilityLiveRegion="polite"
                          style={styles.errorText}
                        >
                          {logoNote}
                        </Text>
                      ) : null}
                    </View>
                  ) : (
                    <Text style={styles.helperText}>
                      You can add a logo later from the web dashboard&apos;s
                      Settings.
                    </Text>
                  )}
                </View>
              ) : null}

              {/*
                The display pick a joining member sees on s03 (#4056):
                founders skip s03, so setup asks it here.
              */}
              {step === "display" ? (
                <View style={styles.stack}>
                  <Text style={styles.body}>{DISPLAY_STEP_SUBTITLE}</Text>
                  <ChatDensityOptions />
                </View>
              ) : null}

              {/* The same step a joining member sees on s03. */}
              {step === "primer" ? (
                <View style={styles.stack}>
                  <PushAskBody />
                </View>
              ) : null}

              {step === "invite" ? (
                <View style={styles.stack}>
                  <Text style={styles.body}>
                    Send each person their own link. A link lets one person in
                    and lasts 24 hours.
                  </Text>
                  <InviteLinksCard
                    shared={invite.shared}
                    isJoined={invite.isJoined}
                  />
                </View>
              ) : null}
            </Animated.View>

            {error ? (
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                {error}
              </Text>
            ) : null}
          </ScrollView>

          <Footer
            step={step}
            canConfirm={canConfirm}
            canSubmit={canSubmit}
            submitting={submitting}
            signingOut={signingOut}
            logoBusy={logoBusy}
            displayName={displayName}
            hasShared={invite.shared.length > 0}
            shareBusy={invite.busy}
            onConfirm={() => {
              setError(null);
              setStep("color");
            }}
            onSubmit={() => {
              void submitChapter();
            }}
            onLeaveLive={leaveLive}
            onLeaveDisplay={leaveDisplay}
            onShare={() => {
              void invite.share();
            }}
            onFinish={finish}
            primer={{
              action: primer.action,
              busy: primer.isRequesting,
              onTurnOn: () => {
                void answerPrimer("on");
              },
              onNotNow: () => {
                void answerPrimer("not-now");
              },
            }}
            styles={styles}
          />
        </View>
      </KeyboardAvoidingArea>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof createStyles>;

/**
 * The one primary button, pinned under the scroll. The find step has none
 * (a result or "Not in our directory?" moves on). The notifications step pins
 * its own pair, `PushAskActions`, as s03 does.
 *
 * On the invite step the gold button is the thing the step is for: `Share
 * invite`, with the platform's share mark, which sends a fresh link each press
 * (`useInviteShares`). Leaving for chat is the quiet line under it (`Skip for
 * now`, then `Go to chat` once a link has gone out), so the step's one gold
 * action points at inviting rather than away from it.
 */
function Footer({
  step,
  canConfirm,
  canSubmit,
  submitting,
  signingOut,
  logoBusy,
  displayName,
  hasShared,
  shareBusy,
  onConfirm,
  onSubmit,
  onLeaveLive,
  onLeaveDisplay,
  onShare,
  onFinish,
  primer,
  styles,
}: {
  step: Step;
  canConfirm: boolean;
  canSubmit: boolean;
  submitting: boolean;
  /**
   * A sign-out on its way: every control here holds for it, each step's
   * primary, the push answers and the invite step's way to chat.
   */
  signingOut: boolean;
  logoBusy: boolean;
  displayName: string;
  hasShared: boolean;
  shareBusy: boolean;
  onConfirm: () => void;
  onSubmit: () => void;
  onLeaveLive: () => void;
  onLeaveDisplay: () => void;
  onShare: () => void;
  onFinish: () => void;
  primer: ComponentProps<typeof PushAskActions>;
  styles: Styles;
}) {
  if (step === "primer") {
    return (
      <View style={styles.footer}>
        <PushAskActions {...primer} disabled={signingOut} />
      </View>
    );
  }
  if (step === "invite") {
    return (
      <View style={styles.footer}>
        <OnboardingPrimaryButton
          label="Share invite"
          icon={(color) => <ShareGlyph color={color} />}
          onPress={onShare}
          disabled={shareBusy || signingOut}
          busy={shareBusy}
        />
        <OnboardingPressable
          accessibilityRole="button"
          accessibilityState={{ disabled: signingOut }}
          disabled={signingOut}
          onPress={onFinish}
          quiet
          // A quiet line takes no dim of its own (`OnboardingPressable`).
          style={[styles.quietButton, signingOut ? styles.held : null]}
        >
          <Text style={styles.quietButtonText}>
            {hasShared ? "Go to chat" : "Skip for now"}
          </Text>
        </OnboardingPressable>
      </View>
    );
  }
  let label: string;
  let onPress: () => void;
  let disabled = false;
  let busy = false;
  switch (step) {
    case "confirm":
      label = "Continue";
      onPress = onConfirm;
      disabled = !canConfirm || signingOut;
      break;
    case "color":
      label = `Create ${displayName}`;
      onPress = onSubmit;
      disabled = !canSubmit || submitting || signingOut;
      busy = submitting;
      break;
    case "live":
      label = "Continue";
      onPress = onLeaveLive;
      disabled = logoBusy || signingOut;
      break;
    case "display":
      label = "Continue";
      onPress = onLeaveDisplay;
      disabled = signingOut;
      break;
    default:
      return null;
  }
  return (
    <View style={styles.footer}>
      <OnboardingPrimaryButton
        label={label}
        onPress={onPress}
        disabled={disabled}
        busy={busy}
      />
    </View>
  );
}

function FindStep({
  rawQuery,
  onQueryChange,
  isFetching,
  isError,
  onRetry,
  results,
  debouncedQuery,
  onSelect,
  onManual,
  styles,
  tokens,
}: {
  rawQuery: string;
  onQueryChange: (value: string) => void;
  isFetching: boolean;
  isError: boolean;
  onRetry: () => void;
  results: ChapterDirectoryResult[];
  debouncedQuery: string;
  onSelect: (row: ChapterDirectoryResult) => void;
  onManual: () => void;
  styles: Styles;
  tokens: SignetTokens;
}) {
  const trimmed = debouncedQuery.trim();
  const hasQuery = trimmed.length >= DIRECTORY_MIN_QUERY_LENGTH;
  const showEmpty = hasQuery && !isFetching && !isError && results.length === 0;

  // No line over the field: its placeholder already says what to type.
  return (
    <View style={styles.stack}>
      <OnboardingTextInput
        value={rawQuery}
        onChangeText={onQueryChange}
        placeholder="Organization or school"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        returnKeyType="search"
        accessibilityLabel="Search the chapter directory"
      />

      {hasQuery && isFetching ? (
        <View style={styles.centerRow}>
          <ActivityIndicator color={tokens.color.text.muted} />
          <Text style={styles.helperText}>Searching…</Text>
        </View>
      ) : null}

      {hasQuery && isError ? (
        <View style={styles.centerRow}>
          <Text style={[styles.errorText, styles.flex]}>
            We couldn&apos;t reach the directory.
          </Text>
          <OnboardingPressable
            accessibilityRole="button"
            onPress={onRetry}
            quiet
            style={styles.textButton}
          >
            <Text style={styles.textButtonText}>Retry</Text>
          </OnboardingPressable>
        </View>
      ) : null}

      {showEmpty ? (
        <Text style={styles.helperText}>
          No match for “{trimmed}”. Add your chapter by hand below.
        </Text>
      ) : null}

      {!isFetching && !isError
        ? results.map((row) => (
            <ChoiceRow
              key={row.id}
              title={directoryRowTitle(row)}
              body={
                [row.chapter_designation, row.university]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
              accessibilityHint="Fills in your chapter's details."
              onPress={() => onSelect(row)}
            />
          ))
        : null}

      <ChoiceRow
        title="Not in our directory?"
        body="New colony or a smaller group. Add it by hand."
        onPress={onManual}
      />
    </View>
  );
}

function ConfirmStep({
  identity,
  onChange,
  isManual,
  lettersHidden,
  detailsOpen,
  onToggleDetails,
  asksArchetype,
  archetype,
  onArchetype,
  mark,
  styles,
}: {
  identity: ChapterIdentityForm;
  onChange: (next: ChapterIdentityForm) => void;
  isManual: boolean;
  /** The organization whose letters this chapter hides, or `null`. */
  lettersHidden: string | null;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  asksArchetype: boolean;
  archetype: ArchetypeKey | null;
  onArchetype: (key: ArchetypeKey) => void;
  mark: ReactNode;
  styles: Styles;
}) {
  function set<K extends keyof ChapterIdentityForm>(
    key: K,
    value: ChapterIdentityForm[K],
  ) {
    onChange({ ...identity, [key]: value });
  }
  const meta = [identity.designation.trim(), identity.university.trim()]
    .filter(Boolean)
    .join(" · ");

  // Return moves to the next field on screen rather than dropping the
  // keyboard after each one, and the last field's Return is Done. The order
  // is the fields as drawn, so one the step hides is skipped. The mounted
  // fields sit in one Map made once per mount (a `useState` initializer, not
  // a `useRef`, so the ref callbacks built during render don't trip
  // react-hooks/refs); only Return's handler reads it.
  const [inputs] = useState(() => new Map<IdentityField, TextInput | null>());
  const order: IdentityField[] = [
    ...(isManual || detailsOpen ? (["name", "university"] as const) : []),
    ...(detailsOpen
      ? ([
          "designation",
          "shortName",
          ...(lettersHidden ? [] : (["greekLetters"] as const)),
          "schoolShort",
          "foundedYear",
        ] as const)
      : []),
  ];
  function chain(
    key: IdentityField,
  ): Pick<
    TextInputProps,
    "returnKeyType" | "submitBehavior" | "onSubmitEditing"
  > & { ref: (node: TextInput | null) => void } {
    const next = order[order.indexOf(key) + 1];
    return {
      ref: (node) => {
        inputs.set(key, node);
      },
      returnKeyType: next ? "next" : "done",
      submitBehavior: next ? "submit" : "blurAndSubmit",
      onSubmitEditing: next ? () => inputs.get(next)?.focus() : undefined,
    };
  }

  const required = (
    <>
      <Field
        label="Organization"
        value={identity.name}
        onChangeText={(value) =>
          onChange(withOrgName(identity, value, !isManual))
        }
        placeholder="Sigma Phi Epsilon"
        autoCapitalize="words"
        styles={styles}
        {...chain("name")}
      />
      <Field
        label="School"
        value={identity.university}
        onChangeText={(value) => set("university", value)}
        placeholder="University of California, Los Angeles"
        autoCapitalize="words"
        styles={styles}
        {...chain("university")}
      />
    </>
  );

  const optional = (
    <>
      <Field
        label="Chapter"
        value={identity.designation}
        onChangeText={(value) => set("designation", value)}
        placeholder="California Eta"
        autoCapitalize="words"
        styles={styles}
        {...chain("designation")}
      />
      <Field
        label="Short name"
        value={identity.shortName}
        onChangeText={(value) => set("shortName", value)}
        placeholder="FIJI"
        autoCapitalize="characters"
        maxLength={CHAPTER_SHORT_NAME_MAX_LENGTH}
        styles={styles}
        {...chain("shortName")}
      />
      {/*
        An organization that hides its letters gets neither the field nor the
        switch: its letters stay off (#3351). The short name stands in.
      */}
      {lettersHidden ? (
        <Text style={styles.helperText}>
          {lettersHidden} doesn&apos;t display its Greek letters, so your short
          name stands in for them.
        </Text>
      ) : (
        <>
          <Field
            label="Greek letters"
            value={identity.greekLetters}
            onChangeText={(value) => set("greekLetters", value)}
            placeholder="ΣΦΕ"
            autoCapitalize="characters"
            styles={styles}
            {...chain("greekLetters")}
          />
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchLabel}>Show Greek letters</Text>
              <Text style={styles.helperText}>
                Turn off if your organization doesn&apos;t display its letters.
                Your short name or logo stands in for them.
              </Text>
            </View>
            <Toggle
              house
              value={identity.showGreekLetters}
              onValueChange={(value) => set("showGreekLetters", value)}
              accessibilityLabel="Show Greek letters"
            />
          </View>
        </>
      )}
      <Field
        label="School short name"
        value={identity.schoolShort}
        onChangeText={(value) => set("schoolShort", value)}
        placeholder="UCLA"
        autoCapitalize="characters"
        styles={styles}
        {...chain("schoolShort")}
      />
      <Field
        label="Founded"
        value={identity.foundedYear}
        onChangeText={(value) => set("foundedYear", value)}
        placeholder="e.g. 1948"
        keyboardType="number-pad"
        // A year.
        maxLength={4}
        styles={styles}
        {...chain("foundedYear")}
      />
    </>
  );

  // By hand, the title asks and the fields answer; no line between them.
  return (
    <View style={styles.stack}>
      {isManual ? (
        required
      ) : (
        <View style={styles.card} testID="confirm-card">
          {mark}
          <View style={styles.cardCopy}>
            <Text style={styles.cardTitle}>{identity.name}</Text>
            {meta ? <Text style={styles.body}>{meta}</Text> : null}
          </View>
        </View>
      )}

      <OnboardingPressable
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        onPress={onToggleDetails}
        quiet
        style={styles.textButton}
      >
        <Text style={styles.textButtonText}>
          {isManual
            ? detailsOpen
              ? "Hide more details"
              : "More details (optional)"
            : detailsOpen
              ? "Hide details"
              : "Edit details"}
        </Text>
      </OnboardingPressable>

      {detailsOpen ? (
        <View style={styles.stack}>
          {isManual ? null : required}
          {optional}
        </View>
      ) : null}

      {asksArchetype ? (
        <View style={styles.stack} accessibilityRole="radiogroup">
          <OnboardingFieldLabel>
            What kind of organization?
          </OnboardingFieldLabel>
          {Object.values(ARCHETYPES).map((item) => {
            const isActive = item.key === archetype;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: isActive }}
                accessibilityLabel={`${item.label}, ${item.council}`}
                onPress={() => onArchetype(item.key)}
                // ChoiceRow's press: the row steps down the surface ladder
                // while it's held. A picked row keeps its gold tint.
                style={({ pressed }) => [
                  styles.archetypeRow,
                  pressed && !isActive ? styles.archetypeRowPressed : null,
                  isActive ? styles.archetypeRowOn : null,
                ]}
              >
                <Text style={styles.cardTitle}>{item.label}</Text>
                <Text style={styles.helperText}>{item.council}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** The identity fields setup's confirm step draws, in the order it draws them. */
type IdentityField =
  | "name"
  | "university"
  | "designation"
  | "shortName"
  | "greekLetters"
  | "schoolShort"
  | "foundedYear";

/**
 * One labelled identity field. Every other `TextInput` prop passes through,
 * so the step can set each one's capitalization, its Return key and the ref
 * the next field's focus moves through.
 */
function Field({
  label,
  styles,
  ...input
}: {
  label: string;
  styles: Styles;
  ref?: Ref<TextInput>;
} & TextInputProps) {
  return (
    <View style={styles.field}>
      <OnboardingFieldLabel>{label}</OnboardingFieldLabel>
      <OnboardingTextInput
        autoCorrect={false}
        accessibilityLabel={label}
        {...input}
      />
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    container: {
      flex: 1,
      width: "100%",
      maxWidth: ONBOARDING_COLUMN_WIDTH + tokens.spacing.xl * 2,
      alignSelf: "center",
      paddingHorizontal: tokens.spacing.xl,
    },
    // A column, so `BackRow` spans it and its ticks can take the width the
    // `‹ Back` leaves. The row's own bottom margin and this one's add up to
    // the `md` under the header.
    header: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      marginTop: tokens.spacing.sm,
      marginBottom: tokens.spacing.xs,
    },
    progressRow: {
      flex: 1,
      flexDirection: "row",
      gap: tokens.spacing.xs,
      marginLeft: tokens.spacing.lg,
    },
    progressTick: {
      flex: 1,
      height: 4,
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.border.hairline,
    },
    progressTickOn: {
      backgroundColor: tokens.color.gold.house,
    },
    scroll: {
      gap: tokens.spacing.md,
      paddingBottom: tokens.spacing.lg,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    stack: {
      gap: tokens.spacing.md,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    // A setting's name beside its switch, as a Settings row's label reads.
    switchLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    field: { gap: tokens.spacing.sm },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    switchText: { flex: 1, gap: tokens.spacing.xs },
    helperText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    errorText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    centerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      padding: tokens.spacing.lg,
    },
    cardCopy: {
      flex: 1,
      minWidth: 0,
      gap: tokens.spacing.sm,
    },
    cardTitle: {
      flexShrink: 1,
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    previewRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    liveMark: {
      alignSelf: "flex-start",
      marginTop: tokens.spacing.lg,
      marginBottom: tokens.spacing.sm,
    },
    logoBlock: {
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.sm,
    },
    textButton: {
      alignSelf: "flex-start",
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    textButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.askText,
    },
    // The invite step's way out under its gold button: a 44pt line of muted
    // text, there when wanted and not competing with the invite.
    quietButton: {
      alignSelf: "center",
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.lg,
      justifyContent: "center",
      marginTop: tokens.spacing.xs,
    },
    // The invite step's way to chat while a sign-out holds it.
    held: {
      opacity: 0.5,
    },
    quietButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    archetypeRow: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      gap: 2,
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    archetypeRowPressed: {
      backgroundColor: surfaces.raised,
    },
    archetypeRowOn: {
      borderColor: tokens.color.gold.house,
      backgroundColor: tint(tokens.color.gold.house),
    },
    footer: {
      paddingVertical: tokens.spacing.lg,
    },
  });
}
