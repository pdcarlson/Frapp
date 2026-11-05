import { useEffect, useState, type ReactNode } from "react";
import { Redirect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  CHANNEL_LIST_KEY,
  DIRECTORY_MIN_QUERY_LENGTH,
  useChapterDirectorySearch,
  useConfirmChapterLogo,
  useCreateInvite,
  useCurrentChapter,
  useOnboardChapter,
  useRequestChapterLogoUploadUrl,
  type ChapterDirectoryResult,
} from "@repo/hooks";
import {
  ARCHETYPES,
  orgColorsFor,
  orgDefaultAccent,
  orgMarkFields,
  orgProfileFor,
  type ArchetypeKey,
} from "@repo/org-archetypes";
import { SignetTokens } from "@repo/theme/signet";
import { serverMessageOf } from "@repo/api-sdk";
import {
  CHAPTER_SHORT_NAME_MAX_LENGTH,
  resolveChapterMark,
} from "@repo/validation";
import { useAuthSession } from "@/lib/auth-session";
import { TermsAcceptance } from "@/components/auth/terms-acceptance";
import { ChoiceRow } from "@/components/auth/choice-row";
import { AccentPicker } from "@/components/chapter/accent-picker";
import { PushPrimerCard } from "@/components/notifications/push-primer-card";
import { ChapterMarkTile } from "@/components/onboarding/chapter-mark-tile";
import {
  ONBOARDING_COLUMN_WIDTH,
  OnboardingPrimaryButton,
} from "@/components/onboarding/onboarding-primary-button";
import { JoinedChannelsCard } from "@/components/onboarding/joined-channels-card";
import { Toggle } from "@/components/toggle";
import {
  EMPTY_CHAPTER_IDENTITY,
  chapterIdentityBranding,
  chapterIdentityIsValid,
  normalizeAccentInput,
  type ChapterIdentityForm,
} from "@repo/hooks/chapter-identity";
import {
  inviteTokenOf,
  onboardedChapterId,
  webJoinUrl,
} from "@/lib/onboarding/chapter-wizard/invite-link";
import { pickAndSetChapterLogo } from "@/lib/onboarding/chapter-wizard/chapter-logo";
import { useSelectChapter } from "@/lib/select-chapter";
import { usePushPrimer } from "@/lib/notifications/use-push-primer";
import { useBackToClose } from "@/lib/overlay";
import { successHaptic } from "@/lib/haptics";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import { MONO_FONT_FAMILY, tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * First-officer chapter setup (`spec/behavior/onboarding.md`, #3351).
 *
 * Three steps make the chapter: **Find** it in the directory, **Confirm** the
 * match (or describe it by hand), and pick its **Color**. Creating it opens
 * three more: the **live** moment with its channels and an optional logo, the
 * push primer when this build can push, and the **invite** link. Then chat.
 *
 * One route, with the steps as state: `POST /v1/chapters/onboard` flips the
 * membership count to 1 mid-flow, and every gate exempts `/create-chapter` by
 * its exact pathname (`(auth)/_layout.tsx`, `use-onboarding-redirect.ts`), so a
 * sibling route for the later steps would be yanked into the tabs.
 *
 * The archetype comes from the directory match and is asked only when the
 * chapter is entered by hand (or the match carries no known archetype), with
 * nothing preselected. Some organizations don't display their Greek letters
 * (Phi Gamma Delta, `orgProfileFor`): for them the letters appear nowhere
 * here, the switch starts off and the short name is filled in.
 */

type Step = "find" | "confirm" | "color" | "live" | "primer" | "invite";
/** The steps before the chapter exists, which the progress ticks count. */
const SETUP_STEPS: Step[] = ["find", "confirm", "color"];
const INVITE_ROLE = "Member";

/** Each step's screen title. The live one names the chapter. */
export const SETUP_TITLES = {
  find: "Find your chapter",
  confirmMatch: "Is this your chapter?",
  confirmManual: "Tell us about your chapter",
  color: "Pick your color",
  primer: "Stay in the loop",
  invite: "Invite your chapter",
} as const;

export function liveTitle(displayName: string): string {
  return `${displayName} is live`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** A directory archetype this app knows, else `null`: the officer picks. */
function knownArchetype(value: string | null | undefined): ArchetypeKey | null {
  return value && Object.hasOwn(ARCHETYPES, value)
    ? (value as ArchetypeKey)
    : null;
}

/** Whether an organization keeps its Greek letters off every surface. */
function hidesLetters(orgName: string | null | undefined): boolean {
  return orgProfileFor(orgName)?.displaysGreekLetters === false;
}

/**
 * The identity after the organization's name changes: a profile's short name
 * and letters switch follow it (`orgMarkFields`). Letters an organization
 * hides are still stored, as web's wizard stores them (branding.md: the
 * switch hides, it doesn't delete); setup just never draws them.
 */
function withOrgName(
  identity: ChapterIdentityForm,
  name: string,
): ChapterIdentityForm {
  return {
    ...identity,
    name,
    ...orgMarkFields(name, identity.name, identity),
  };
}

/** How a directory row reads in the results: never letters a group hides. */
export function directoryRowTitle(row: ChapterDirectoryResult): string {
  return !hidesLetters(row.org_name) && row.org_letters
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
  const createInvite = useCreateInvite();
  const requestLogoUrl = useRequestChapterLogoUploadUrl();
  const confirmLogo = useConfirmChapterLogo();
  const primer = usePushPrimer();

  const [step, setStep] = useState<Step>("find");
  const [rawQuery, setRawQuery] = useState("");
  const debouncedQuery = useDebouncedValue(rawQuery, 250);
  const [directoryId, setDirectoryId] = useState<string | null>(null);
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
  // Whether the new chapter became the active one. The logo and invite
  // routes act on the active chapter, so without it they can't run.
  const [activated, setActivated] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoNote, setLogoNote] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchQuery = useChapterDirectorySearch(debouncedQuery, {
    enabled: step === "find",
  });
  const results = Array.isArray(searchQuery.data) ? searchQuery.data : [];
  const current = useCurrentChapter({ enabled: activated });
  const logoUrl = activated ? current.data?.logo_url || null : null;

  const submitting = onboardChapter.isPending;
  const isManual = directoryId === null;
  const created = step === "live" || step === "primer" || step === "invite";
  const displayName =
    identity.shortName.trim() || identity.name.trim() || "Your chapter";
  const canConfirm = chapterIdentityIsValid(identity) && archetype !== null;
  const canSubmit = canConfirm && acceptedLegal && accentValid;

  function applyDirectoryMatch(row: ChapterDirectoryResult) {
    const known = knownArchetype(row.archetype);
    setDirectoryId(row.id);
    setArchetype(known);
    setAsksArchetype(known === null);
    // The directory knows letters, not whether an organization shows them:
    // FIJI's profile switches them off and fills the short name.
    const seeded: ChapterIdentityForm = {
      ...identity,
      greekLetters: row.org_letters ?? "",
    };
    const named = withOrgName(seeded, row.org_name ?? "");
    setIdentity({
      name: named.name,
      university: row.university ?? "",
      greekLetters: named.greekLetters,
      shortName: named.shortName,
      showGreekLetters: named.showGreekLetters,
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
    setArchetype(null);
    setAsksArchetype(true);
    // A name carried over from the search gets its profile, as a typed one does.
    setIdentity(withOrgName(EMPTY_CHAPTER_IDENTITY, rawQuery.trim()));
    setDetailsOpen(false);
    setAcceptedLegal(false);
    setError(null);
    setStep("confirm");
  }

  function goBack() {
    if (submitting) return;
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
    router.replace("/(tabs)");
  }

  // Android back steps back through setup, and once the chapter exists it
  // leaves for chat: there is no going back to before the chapter was made.
  useBackToClose(step === "confirm" || step === "color", goBack);
  useBackToClose(created, finish);

  async function submitChapter() {
    if (!canSubmit || submitting || archetype === null) return;
    setError(null);
    try {
      const chapter = await onboardChapter.mutateAsync({
        name: identity.name.trim(),
        university: identity.university.trim(),
        org_archetype: archetype,
        directory_id: directoryId ?? undefined,
        accept_terms_privacy: true,
        branding: chapterIdentityBranding(identity),
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
        serverMessageOf(caught) ??
          "Couldn't create that chapter. Check the details and try again.",
      );
    }
  }

  async function addLogo() {
    if (logoBusy) return;
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
    if (primer.showPrimer) {
      setStep("primer");
    } else {
      afterPrimer();
    }
  }

  async function answerPrimer(answer: "on" | "not-now") {
    try {
      if (answer === "on") {
        await primer.turnOn();
      } else {
        await primer.notNow();
      }
    } finally {
      // Either answer moves on, even when the OS prompt failed: the primer
      // step has no other way forward.
      afterPrimer();
    }
  }

  async function generateInviteLink() {
    setError(null);
    try {
      const invite = await createInvite.mutateAsync({ role: INVITE_ROLE });
      const token = inviteTokenOf(invite);
      if (!token) {
        setError("The invite did not return a token. Try again in a moment.");
        return;
      }
      setInviteLink(webJoinUrl(token));
    } catch (caught) {
      setError(
        serverMessageOf(caught) ??
          "Couldn't create an invite. You can invite members from the web dashboard.",
      );
    }
  }

  async function shareInviteLink() {
    if (!inviteLink) return;
    try {
      await Share.share({ message: inviteLink });
    } catch {
      setError("Couldn't open the share sheet. Copy the link from the field.");
    }
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
            : step === "primer"
              ? SETUP_TITLES.primer
              : SETUP_TITLES.invite;
  const setupIndex = SETUP_STEPS.indexOf(step);
  const mark = resolveChapterMark({
    logoUrl,
    branding: chapterIdentityBranding(identity),
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
      <KeyboardAvoidingArea style={styles.flex}>
        <View style={styles.container}>
          <View style={styles.header}>
            {created ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                accessibilityState={{ disabled: submitting }}
                disabled={submitting}
                hitSlop={8}
                onPress={goBack}
                style={styles.backButton}
              >
                <Text style={styles.backGlyph}>‹</Text>
              </Pressable>
            )}
            {setupIndex >= 0 ? (
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
            ) : null}
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
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
                tokens={tokens}
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
                  orgColors={orgColorsFor(identity.name)}
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
                    <JoinedChannelsCard trailing="ready" />
                  </>
                ) : (
                  <Text style={styles.body}>
                    Your chapter is ready. Open chat to see its channels and
                    invite your members.
                  </Text>
                )}
                {activated ? (
                  <View style={styles.logoBlock}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        disabled: logoBusy,
                        busy: logoBusy,
                      }}
                      disabled={logoBusy}
                      onPress={() => {
                        void addLogo();
                      }}
                      style={styles.outlineButton}
                    >
                      {logoBusy ? (
                        <ActivityIndicator color={tokens.color.gold.house} />
                      ) : (
                        <Text style={styles.outlineButtonText}>
                          {mark.logoUrl
                            ? "Change logo"
                            : "Add your chapter's logo"}
                        </Text>
                      )}
                    </Pressable>
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

            {step === "primer" ? (
              <View style={styles.stack}>
                <Text style={styles.body}>
                  Members will start posting soon. Hear about it when they do.
                </Text>
                <PushPrimerCard
                  isRequesting={primer.isRequesting}
                  onTurnOn={() => {
                    void answerPrimer("on");
                  }}
                  onNotNow={() => {
                    void answerPrimer("not-now");
                  }}
                />
              </View>
            ) : null}

            {step === "invite" ? (
              <InviteStep
                inviteLink={inviteLink}
                isGenerating={createInvite.isPending}
                onGenerate={() => {
                  void generateInviteLink();
                }}
                onShare={() => {
                  void shareInviteLink();
                }}
                styles={styles}
                tokens={tokens}
              />
            ) : null}

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
            logoBusy={logoBusy}
            displayName={displayName}
            inviteLink={inviteLink}
            onConfirm={() => {
              setError(null);
              setStep("color");
            }}
            onSubmit={() => {
              void submitChapter();
            }}
            onLeaveLive={leaveLive}
            onFinish={finish}
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
 * (a result or "Not in our directory?" moves on) and the primer has its own
 * pair of answers.
 */
function Footer({
  step,
  canConfirm,
  canSubmit,
  submitting,
  logoBusy,
  displayName,
  inviteLink,
  onConfirm,
  onSubmit,
  onLeaveLive,
  onFinish,
  styles,
}: {
  step: Step;
  canConfirm: boolean;
  canSubmit: boolean;
  submitting: boolean;
  logoBusy: boolean;
  displayName: string;
  inviteLink: string | null;
  onConfirm: () => void;
  onSubmit: () => void;
  onLeaveLive: () => void;
  onFinish: () => void;
  styles: Styles;
}) {
  let label: string;
  let onPress: () => void;
  let disabled = false;
  let busy = false;
  switch (step) {
    case "confirm":
      label = "Continue";
      onPress = onConfirm;
      disabled = !canConfirm;
      break;
    case "color":
      label = `Create ${displayName}`;
      onPress = onSubmit;
      disabled = !canSubmit || submitting;
      busy = submitting;
      break;
    case "live":
      label = "Continue";
      onPress = onLeaveLive;
      disabled = logoBusy;
      break;
    case "invite":
      label = inviteLink ? "Go to chat" : "Skip for now";
      onPress = onFinish;
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

  return (
    <View style={styles.stack}>
      <Text style={styles.body}>
        Search by organization or school. We&apos;ll fill in the rest.
      </Text>
      <TextInput
        value={rawQuery}
        onChangeText={onQueryChange}
        placeholder="Organization or school"
        placeholderTextColor={tokens.color.text.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        returnKeyType="search"
        accessibilityLabel="Search the chapter directory"
        style={styles.input}
      />

      {hasQuery && isFetching ? (
        <View style={styles.centerRow}>
          <ActivityIndicator color={tokens.color.gold.house} />
          <Text style={styles.helperText}>Searching…</Text>
        </View>
      ) : null}

      {hasQuery && isError ? (
        <View style={styles.centerRow}>
          <Text style={[styles.errorText, styles.flex]}>
            We couldn&apos;t reach the directory.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.textButton}
          >
            <Text style={styles.textButtonText}>Retry</Text>
          </Pressable>
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
  detailsOpen,
  onToggleDetails,
  asksArchetype,
  archetype,
  onArchetype,
  mark,
  styles,
  tokens,
}: {
  identity: ChapterIdentityForm;
  onChange: (next: ChapterIdentityForm) => void;
  isManual: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  asksArchetype: boolean;
  archetype: ArchetypeKey | null;
  onArchetype: (key: ArchetypeKey) => void;
  mark: ReactNode;
  styles: Styles;
  tokens: SignetTokens;
}) {
  function set<K extends keyof ChapterIdentityForm>(
    key: K,
    value: ChapterIdentityForm[K],
  ) {
    onChange({ ...identity, [key]: value });
  }
  const lettersHidden = hidesLetters(identity.name);

  const meta = [identity.designation.trim(), identity.university.trim()]
    .filter(Boolean)
    .join(" · ");

  const required = (
    <>
      <Field
        label="Organization"
        value={identity.name}
        onChangeText={(value) => onChange(withOrgName(identity, value))}
        placeholder="Sigma Phi Epsilon"
        styles={styles}
        tokens={tokens}
      />
      <Field
        label="School"
        value={identity.university}
        onChangeText={(value) => set("university", value)}
        placeholder="University of California, Los Angeles"
        styles={styles}
        tokens={tokens}
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
        styles={styles}
        tokens={tokens}
      />
      <Field
        label="Short name"
        value={identity.shortName}
        onChangeText={(value) => set("shortName", value)}
        placeholder="FIJI"
        autoCapitalize="characters"
        maxLength={CHAPTER_SHORT_NAME_MAX_LENGTH}
        styles={styles}
        tokens={tokens}
      />
      {/*
        An organization that hides its letters gets neither the field nor the
        switch: its letters stay off (#3351). The short name stands in.
      */}
      {lettersHidden ? (
        <Text style={styles.helperText}>
          {identity.name.trim()} doesn&apos;t display its Greek letters, so your
          short name stands in for them.
        </Text>
      ) : (
        <>
          <Field
            label="Greek letters"
            value={identity.greekLetters}
            onChangeText={(value) => set("greekLetters", value)}
            placeholder="ΣΦΕ"
            styles={styles}
            tokens={tokens}
          />
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.inputLabel}>Show Greek letters</Text>
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
        styles={styles}
        tokens={tokens}
      />
      <Field
        label="Founded"
        value={identity.foundedYear}
        onChangeText={(value) => set("foundedYear", value)}
        placeholder="1948"
        keyboardType="number-pad"
        styles={styles}
        tokens={tokens}
      />
    </>
  );

  return (
    <View style={styles.stack}>
      {isManual ? (
        <>
          <Text style={styles.body}>
            We&apos;ll add it to our directory so the next officer finds it.
          </Text>
          {required}
        </>
      ) : (
        <View style={styles.card} testID="confirm-card">
          {mark}
          <View style={styles.cardCopy}>
            <Text style={styles.cardTitle}>{identity.name}</Text>
            {meta ? <Text style={styles.body}>{meta}</Text> : null}
          </View>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        onPress={onToggleDetails}
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
      </Pressable>

      {detailsOpen ? (
        <View style={styles.stack}>
          {isManual ? null : required}
          {optional}
        </View>
      ) : null}

      {asksArchetype ? (
        <View style={styles.stack} accessibilityRole="radiogroup">
          <Text style={styles.inputLabel}>What kind of organization?</Text>
          {Object.values(ARCHETYPES).map((item) => {
            const isActive = item.key === archetype;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: isActive }}
                accessibilityLabel={`${item.label}, ${item.council}`}
                onPress={() => onArchetype(item.key)}
                style={[
                  styles.archetypeRow,
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

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  styles,
  tokens,
  keyboardType,
  autoCapitalize,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  styles: Styles;
  tokens: SignetTokens;
  keyboardType?: "number-pad";
  autoCapitalize?: "characters" | "none";
  maxLength?: number;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.color.text.muted}
        autoCapitalize={autoCapitalize ?? "sentences"}
        autoCorrect={false}
        keyboardType={keyboardType}
        maxLength={maxLength}
        accessibilityLabel={label}
        style={styles.input}
      />
    </View>
  );
}

function InviteStep({
  inviteLink,
  isGenerating,
  onGenerate,
  onShare,
  styles,
  tokens,
}: {
  inviteLink: string | null;
  isGenerating: boolean;
  onGenerate: () => void;
  onShare: () => void;
  styles: Styles;
  tokens: SignetTokens;
}) {
  return (
    <View style={styles.stack}>
      <Text style={styles.body}>
        Share a link and your members land in #general. You can invite more
        people later.
      </Text>
      {inviteLink ? (
        <View style={styles.card}>
          <View style={styles.cardCopy}>
            <Text selectable style={styles.monoBody}>
              {inviteLink}
            </Text>
            <Text style={styles.helperText}>
              Anyone with this link can join as a member. It works once and
              expires after 24 hours.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onShare}
              style={styles.outlineButton}
            >
              <Text style={styles.outlineButtonText}>Share invite</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isGenerating, busy: isGenerating }}
          disabled={isGenerating}
          onPress={onGenerate}
          style={styles.outlineButton}
        >
          {isGenerating ? (
            <ActivityIndicator color={tokens.color.gold.house} />
          ) : (
            <Text style={styles.outlineButtonText}>Create invite link</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
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
    header: {
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      marginTop: tokens.spacing.sm,
      marginBottom: tokens.spacing.md,
    },
    backButton: {
      minWidth: tokens.touch.minimum,
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    backGlyph: {
      fontSize: 30,
      lineHeight: 32,
      color: tokens.color.text.foreground,
    },
    progressRow: {
      flex: 1,
      flexDirection: "row",
      gap: tokens.spacing.xs,
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
    inputLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    input: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    monoBody: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: MONO_FONT_FAMILY,
      color: tokens.color.text.foreground,
    },
    field: { gap: tokens.spacing.xs },
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
      backgroundColor: tokens.color.surface.card,
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
    outlineButton: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
    },
    outlineButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    archetypeRow: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      gap: 2,
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
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
