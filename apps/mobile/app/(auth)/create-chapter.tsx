import { useEffect, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  DIRECTORY_MIN_QUERY_LENGTH,
  useChapterDirectorySearch,
  useCreateInvite,
  useOnboardChapter,
  type ChapterDirectoryResult,
} from "@repo/hooks";
import {
  ARCHETYPES,
  getArchetype,
  type ArchetypeKey,
} from "@repo/org-archetypes";
import { SignetTokens } from "@repo/theme/signet";
import { serverMessageOf } from "@repo/api-sdk";
import { useAuthSession } from "@/lib/auth-session";
import { LEGAL_LINKS } from "@/lib/more/legal";
import {
  EMPTY_IDENTITY,
  identityIsValid,
  normalizeHex,
  parseFoundedYear,
  type IdentityForm,
} from "@/lib/onboarding/chapter-wizard/identity";
import {
  inviteTokenOf,
  onboardedChapterId,
  webJoinUrl,
} from "@/lib/onboarding/chapter-wizard/invite-link";
import { useSelectChapter } from "@/lib/select-chapter";
import { MONO_FONT_FAMILY, tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * First-officer chapter creation (`spec/behavior/onboarding.md`).
 *
 * Web hosts this as a non-dismissable overlay. Mobile is a deliberate `(auth)`
 * route so the wizard can own its lifecycle after `POST /v1/chapters/onboard`
 * flips membership count to 1 — the gate must not yank the officer off the
 * invite step. Archetype keys, labels, shorts, and councils come from
 * `@repo/org-archetypes` (declared in `apps/mobile/package.json`); the
 * module/role seed is still applied server-side from the chosen key.
 */

type WizardStep = "find" | "archetype" | "identity" | "invite";
const STEP_ORDER: WizardStep[] = ["find", "archetype", "identity", "invite"];
const STEP_LABELS: Record<WizardStep, string> = {
  find: "Find your chapter",
  archetype: "Pick your archetype",
  identity: "Confirm identity",
  invite: "Invite members",
};
const INVITE_ROLE = "Member";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export default function CreateChapter() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status } = useAuthSession();
  const selectChapter = useSelectChapter();
  const onboardChapter = useOnboardChapter();
  const createInvite = useCreateInvite();

  const [step, setStep] = useState<WizardStep>("find");
  const [rawQuery, setRawQuery] = useState("");
  const debouncedQuery = useDebouncedValue(rawQuery, 250);
  const [directoryId, setDirectoryId] = useState<string | null>(null);
  const [archetype, setArchetype] = useState<ArchetypeKey>("ifc");
  const [identity, setIdentity] = useState<IdentityForm>(EMPTY_IDENTITY);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchQuery = useChapterDirectorySearch(debouncedQuery, {
    enabled: step === "find",
  });
  const results = Array.isArray(searchQuery.data) ? searchQuery.data : [];
  const stepIndex = STEP_ORDER.indexOf(step);
  const canSubmit = identityIsValid(identity) && acceptedLegal;

  function applyDirectoryMatch(row: ChapterDirectoryResult) {
    setDirectoryId(row.id);
    setArchetype(getArchetype(row.archetype ?? "").key);
    setIdentity({
      name: row.org_name ?? "",
      university: row.university ?? "",
      greekLetters: row.org_letters ?? "",
      designation: row.chapter_designation ?? "",
      schoolShort: row.university_short ?? "",
      foundedYear: row.founded_year ? String(row.founded_year) : "",
      colorAccent: normalizeHex(row.default_colors?.accent, identity.colorAccent),
    });
    setAcceptedLegal(false);
    setError(null);
    setStep("archetype");
  }

  function startManualEntry() {
    setDirectoryId(null);
    setArchetype("ifc");
    setIdentity({
      ...EMPTY_IDENTITY,
      name: rawQuery.trim(),
    });
    setAcceptedLegal(false);
    setError(null);
    setStep("archetype");
  }

  function goBack() {
    const prev = STEP_ORDER[stepIndex - 1];
    if (prev) setStep(prev);
  }

  async function submitChapter() {
    if (!canSubmit) return;
    setError(null);
    try {
      const chapter = await onboardChapter.mutateAsync({
        name: identity.name.trim(),
        university: identity.university.trim(),
        org_archetype: archetype,
        directory_id: directoryId ?? undefined,
        accept_terms_privacy: true,
        branding: {
          greek_letters: identity.greekLetters.trim() || undefined,
          designation: identity.designation.trim() || undefined,
          school_short: identity.schoolShort.trim() || undefined,
          founded_at: parseFoundedYear(identity.foundedYear),
          colors: {
            accent: normalizeHex(identity.colorAccent, identity.colorAccent),
          },
        },
      });
      const id = onboardedChapterId(chapter);
      if (id) {
        await selectChapter(id);
      }
      setStep("invite");
    } catch (caught) {
      setError(
        serverMessageOf(caught) ??
          "Couldn't create that chapter. Check the details and try again.",
      );
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
          "Couldn't create an invite. You can invite members later from the directory.",
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

  function finish() {
    router.replace("/(tabs)");
  }

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  const submitting = onboardChapter.isPending;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <Text style={styles.kicker}>Set up your chapter</Text>
        <Text style={styles.title}>{STEP_LABELS[step]}</Text>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 1, max: STEP_ORDER.length, now: stepIndex + 1 }}
          style={styles.progressRow}
        >
          {STEP_ORDER.map((item, index) => (
            <View
              key={item}
              style={[
                styles.progressTick,
                index <= stepIndex ? styles.progressTickOn : null,
              ]}
            />
          ))}
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
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

          {step === "archetype" ? (
            <ArchetypeStep
              selected={archetype}
              onSelect={setArchetype}
              styles={styles}
            />
          ) : null}

          {step === "identity" ? (
            <IdentityStep
              identity={identity}
              onChange={setIdentity}
              isManual={directoryId === null}
              accepted={acceptedLegal}
              onAcceptedChange={setAcceptedLegal}
              styles={styles}
              tokens={tokens}
            />
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

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          {step !== "find" && step !== "invite" ? (
            <Pressable
              accessibilityRole="button"
              onPress={goBack}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Back</Text>
            </Pressable>
          ) : null}

          {step === "archetype" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setStep("identity")}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </Pressable>
          ) : null}

          {step === "identity" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit || submitting }}
              disabled={!canSubmit || submitting}
              onPress={() => {
                void submitChapter();
              }}
              style={[
                styles.primaryButton,
                !canSubmit || submitting ? styles.primaryButtonDisabled : null,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={tokens.color.gold.onHouse} />
              ) : (
                <Text style={styles.primaryButtonText}>Create chapter</Text>
              )}
            </Pressable>
          ) : null}

          {step === "invite" ? (
            <Pressable
              accessibilityRole="button"
              onPress={finish}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                {inviteLink ? "Go to chat" : "Skip for now"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

type Styles = ReturnType<typeof createStyles>;

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
        Search the Greek-life directory by chapter letters, organization, or
        school. We&apos;ll pre-fill the rest.
      </Text>
      <Text style={styles.inputLabel}>Search</Text>
      <TextInput
        value={rawQuery}
        onChangeText={onQueryChange}
        placeholder="e.g. Sigma Phi Epsilon or UCLA"
        placeholderTextColor={tokens.color.text.muted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search the chapter directory"
        style={styles.input}
      />

      {!hasQuery ? (
        <Text style={styles.helperText}>
          Type at least {DIRECTORY_MIN_QUERY_LENGTH} characters to search.
        </Text>
      ) : null}

      {hasQuery && isFetching ? (
        <View style={styles.centerRow}>
          <ActivityIndicator color={tokens.color.gold.house} />
          <Text style={styles.helperText}>Searching the directory…</Text>
        </View>
      ) : null}

      {hasQuery && isError ? (
        <View style={styles.stack}>
          <Text style={styles.errorText}>
            We couldn&apos;t reach the directory.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Retry search</Text>
          </Pressable>
        </View>
      ) : null}

      {showEmpty ? (
        <Text style={styles.helperText}>
          We couldn&apos;t find “{trimmed}” in our directory. Enter the details
          by hand.
        </Text>
      ) : null}

      {!isFetching && !isError
        ? results.map((row) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityHint={`Use ${row.org_name} to pre-fill the wizard.`}
              onPress={() => onSelect(row)}
              style={styles.resultRow}
            >
              <Text style={styles.resultTitle}>
                {row.org_letters ? `${row.org_letters} · ` : ""}
                {row.org_name}
              </Text>
              <Text style={styles.resultMeta}>
                {[row.chapter_designation, row.university]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </Pressable>
          ))
        : null}

      <Pressable
        accessibilityRole="button"
        onPress={onManual}
        style={styles.dashedCard}
      >
        <Text style={styles.resultTitle}>Not in our directory?</Text>
        <Text style={styles.helperText}>
          New colony or a small org — enter your details by hand.
        </Text>
      </Pressable>
    </View>
  );
}

function ArchetypeStep({
  selected,
  onSelect,
  styles,
}: {
  selected: ArchetypeKey;
  onSelect: (key: ArchetypeKey) => void;
  styles: Styles;
}) {
  return (
    <View style={styles.stack}>
      <Text style={styles.body}>
        Your archetype sets sensible defaults for modules, roles, and
        vocabulary. You can fine-tune everything later in Settings.
      </Text>
      {Object.values(ARCHETYPES).map((item) => {
        const isActive = item.key === selected;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${item.label}, ${item.council}`}
            onPress={() => onSelect(item.key)}
            style={[styles.archetypeRow, isActive ? styles.archetypeRowOn : null]}
          >
            <Text style={styles.archetypeShort}>{item.short}</Text>
            <Text style={styles.resultTitle}>{item.label}</Text>
            <Text style={styles.resultMeta}>{item.council}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function IdentityStep({
  identity,
  onChange,
  isManual,
  accepted,
  onAcceptedChange,
  styles,
  tokens,
}: {
  identity: IdentityForm;
  onChange: (next: IdentityForm) => void;
  isManual: boolean;
  accepted: boolean;
  onAcceptedChange: (next: boolean) => void;
  styles: Styles;
  tokens: SignetTokens;
}) {
  function set<K extends keyof IdentityForm>(key: K, value: IdentityForm[K]) {
    onChange({ ...identity, [key]: value });
  }

  return (
    <View style={styles.stack}>
      <Text style={styles.body}>
        {isManual
          ? "Tell us about your chapter. We'll add it to our directory backlog so the next officer finds it."
          : "Confirm your chapter details — everything is editable."}
      </Text>

      <Field
        label="Chapter / organization name"
        value={identity.name}
        onChangeText={(value) => set("name", value)}
        placeholder="Sigma Phi Epsilon"
        styles={styles}
        tokens={tokens}
      />
      <Field
        label="University"
        value={identity.university}
        onChangeText={(value) => set("university", value)}
        placeholder="University of California, Los Angeles"
        styles={styles}
        tokens={tokens}
      />
      <Field
        label="Greek letters"
        value={identity.greekLetters}
        onChangeText={(value) => set("greekLetters", value)}
        placeholder="ΣΦΕ"
        styles={styles}
        tokens={tokens}
      />
      <Field
        label="Chapter designation"
        value={identity.designation}
        onChangeText={(value) => set("designation", value)}
        placeholder="California Eta"
        styles={styles}
        tokens={tokens}
      />
      <Field
        label="School short name"
        value={identity.schoolShort}
        onChangeText={(value) => set("schoolShort", value)}
        placeholder="UCLA"
        styles={styles}
        tokens={tokens}
      />
      <Field
        label="Founded year"
        value={identity.foundedYear}
        onChangeText={(value) => set("foundedYear", value)}
        placeholder="1948"
        keyboardType="number-pad"
        styles={styles}
        tokens={tokens}
      />
      <Field
        label="Accent color"
        value={identity.colorAccent}
        onChangeText={(value) => set("colorAccent", value)}
        placeholder="#7A5A2F"
        autoCapitalize="characters"
        mono
        styles={styles}
        tokens={tokens}
        swatch={normalizeHex(identity.colorAccent, identity.colorAccent)}
      />

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        onPress={() => onAcceptedChange(!accepted)}
        style={styles.legalRow}
      >
        <View style={[styles.checkbox, accepted ? styles.checkboxOn : null]} />
        <Text style={styles.legalText}>
          I agree to the Terms of Service and Privacy Policy. Member-uploaded
          Backwork is shared voluntarily — see our FERPA notice.
        </Text>
      </Pressable>
      <View style={styles.legalLinks}>
        {LEGAL_LINKS.map((link) => (
          <Pressable
            key={link.url}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            onPress={() => {
              void WebBrowser.openBrowserAsync(link.url);
            }}
          >
            <Text style={styles.linkText}>{link.label}</Text>
          </Pressable>
        ))}
      </View>
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
  mono,
  swatch,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  styles: Styles;
  tokens: SignetTokens;
  keyboardType?: "number-pad";
  autoCapitalize?: "characters" | "none";
  mono?: boolean;
  swatch?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.swatchRow}>
        {swatch ? (
          <View
            accessibilityLabel={`${label} preview`}
            style={[styles.swatch, { backgroundColor: swatch }]}
          />
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={tokens.color.text.muted}
          autoCapitalize={autoCapitalize ?? "sentences"}
          autoCorrect={false}
          keyboardType={keyboardType}
          accessibilityLabel={label}
          style={[styles.input, styles.inputFlex, mono ? styles.mono : null]}
        />
      </View>
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
        Share a join link so your chapter can hop into #general. This step is
        optional — you can always invite members later.
      </Text>
      {inviteLink ? (
        <View style={styles.dashedCard}>
          <Text style={styles.inputLabel}>Your chapter invite link</Text>
          <Text selectable style={styles.monoBody}>
            {inviteLink}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onShare}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Share invite</Text>
          </Pressable>
          <Text style={styles.helperText}>
            Anyone with this link can join as a member. Invites expire after 24
            hours and work once.
          </Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isGenerating }}
          disabled={isGenerating}
          onPress={onGenerate}
          style={[
            styles.primaryButton,
            isGenerating ? styles.primaryButtonDisabled : null,
          ]}
        >
          {isGenerating ? (
            <ActivityIndicator color={tokens.color.gold.onHouse} />
          ) : (
            <Text style={styles.primaryButtonText}>Generate invite link</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
      paddingHorizontal: tokens.spacing.xl,
      paddingTop: tokens.spacing["3xl"],
    },
    kicker: {
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    title: {
      marginTop: tokens.spacing.xs,
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    progressRow: {
      flexDirection: "row",
      gap: tokens.spacing.xs,
      marginTop: tokens.spacing.md,
      marginBottom: tokens.spacing.lg,
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
    stack: {
      gap: tokens.spacing.md,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    inputLabel: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
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
    inputFlex: { flex: 1 },
    mono: { fontFamily: MONO_FONT_FAMILY },
    monoBody: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: MONO_FONT_FAMILY,
      color: tokens.color.text.foreground,
    },
    field: { gap: tokens.spacing.xs },
    swatchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    swatch: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
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
    resultRow: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.md,
      gap: tokens.spacing.xs,
      minHeight: tokens.touch.minimum,
    },
    resultTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    resultMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    dashedCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    archetypeRow: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.md,
      gap: tokens.spacing.xs,
      minHeight: tokens.touch.minimum,
    },
    archetypeRowOn: {
      borderColor: tokens.color.gold.house,
      backgroundColor: tint(tokens.color.gold.house),
    },
    archetypeShort: {
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    legalRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.md,
    },
    checkbox: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
    },
    checkboxOn: {
      backgroundColor: tokens.color.gold.house,
      borderColor: tokens.color.gold.house,
    },
    legalText: {
      flex: 1,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    legalLinks: {
      gap: tokens.spacing.sm,
    },
    linkText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.house,
    },
    footer: {
      paddingVertical: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    primaryButton: {
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.gold.house,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonDisabled: {
      opacity: 0.55,
    },
    primaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
    secondaryButton: {
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}
