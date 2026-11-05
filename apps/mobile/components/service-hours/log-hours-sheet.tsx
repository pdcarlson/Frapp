import { forwardRef, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useCreateServiceEntry } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { SERVICE_DESCRIPTION_MAX_LENGTH } from "@repo/validation";
import { FilterChips } from "@/components/filter-chips";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useConnection } from "@/lib/connection/use-connection";
import { successHaptic } from "@/lib/haptics";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import { formatHours } from "@/lib/more/profile";
import {
  DEFAULT_DURATION_MINUTES,
  DURATION_STEP_MINUTES,
  MAX_DURATION_MINUTES,
  serviceDatePresets,
  stepDuration,
} from "@/lib/more/service-hours";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s20 — the "Log service hours" sheet (`canvas-screens.dc.html`, `id="s20"`),
 * hosted by `app/(tabs)/service-hours.tsx`.
 *
 * Built on the same chrome as s19's New task sheet (`sheet-scaffold.tsx`):
 * grabber, title/Cancel row, scrim, the accent-ringed field and the 50px CTA,
 * with `enableDynamicSizing` and `keyboardBehavior="interactive"` so it rises
 * with the keyboard. `BottomSheetTextInput`, because a plain `TextInput` breaks
 * the sheet's keyboard coordination (`spec/ui/mobile/patterns.md`).
 *
 * ## What the board draws, and what this draws instead
 *
 * - The −/3.5 hrs/+ stepper is drawn as is, in half hours from half an hour to
 *   a day (`stepDuration`). Duration needs no keyboard at all.
 * - The board's date row ("Highway cleanup · Aug 16") becomes the description
 *   field and a row of date chips, Today back to three days ago
 *   (`serviceDatePresets`): there is no date-picker dependency, the same call
 *   s19's due presets make. The entry used to be filed under today, always.
 * - "Add photo proof" is omitted, not rendered dead. The API takes a
 *   `proof_path` and `expo-image-picker` is a dependency (#2464), so it is
 *   ordinary screen work; `lib/chat/attachment-upload.ts` is the reference,
 *   with the `proof` kind. Filed.
 * - The caption under Submit ("Goes to the service chair · you'll get a
 *   notification") is omitted: it narrates, and neither half is something this
 *   app can promise.
 *
 * ## The entry outlives a close, not a Cancel
 *
 * A swipe or a tap on the scrim closes the sheet and keeps the entry for the
 * next visit; Cancel gives it up, and so does a save. The rule s19 and s21
 * follow (`spec/ui/mobile/screens.md`).
 *
 * ## A write can outlive its visit
 *
 * The close after a save goes through `useSheetVisit`: a member who swipes the
 * sheet away mid-save would otherwise have `dismiss()` called on a closed
 * modal, which leaves the next `present()` drawing nothing. A save's outcome
 * is told only to the visit it was sent from, so a refusal that lands after
 * the close is not latched into the next visit. The draft is read-only while
 * the save runs, so clearing it on success clears only what was sent.
 */
export interface LogHoursSheetProps {
  /** The host's clock, re-read each time it opens the sheet. */
  now: Date;
}

export const LogHoursSheet = forwardRef<BottomSheetModal, LogHoursSheetProps>(
  function LogHoursSheet({ now }, ref) {
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const styles = createStyles(tokens, accent);
    const backgroundStyle = useSheetBackgroundStyle();
    const createEntry = useCreateServiceEntry();
    const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useSheetVisit(ref);

    /**
     * s20 has **no outbox**. A submit posted with no network is simply lost,
     * so this is one of the surfaces `spec/ui/resilience/connection-state.md`
     * means when it says write actions are "Disabled with tooltip: 'Reconnect
     * to make changes'" (#501). The chat composer deliberately does the
     * opposite, because it has a queue — `lib/connection/state.ts` holds the
     * split.
     */
    const { writeBlockedReason } = useConnection();

    const presets = useMemo(() => serviceDatePresets(now), [now]);

    const [description, setDescription] = useState("");
    const [minutes, setMinutes] = useState(DEFAULT_DURATION_MINUTES);
    // Days back rather than a date, so a draft left open across midnight
    // still means the chip it shows.
    const [daysAgo, setDaysAgo] = useState(0);
    const [descriptionFocused, setDescriptionFocused] = useState(false);
    const [submitFailed, setSubmitFailed] = useState(false);
    /**
     * The member copy for a refusal retrying cannot win, or `null`. A refusal
     * is a different outcome from a failed save, and two gates refuse
     * `POST /v1/service-entries` that way until an officer acts:
     *
     * - the subscription gate (#2410, the shape #2297 set on tasks): a
     *   brand-new chapter is `incomplete` until checkout;
     * - the module gate, `@RequireModule('hours')` (#2718), whose own message
     *   tells an officer to go to Settings → Modules.
     *
     * Either way the sheet explains the state and withdraws Submit. The copy is
     * the latch, so the two can't disagree. `submitFailed` keeps its exact old
     * meaning: a save that might succeed. Both clear when the sheet closes,
     * because reopening is the member's deliberate second try, and a result
     * that lands after the close is dropped rather than latched.
     */
    const [refusal, setRefusal] = useState<string | null>(null);
    // Set the moment Submit sends, before `isPending` reaches a render: two
    // taps handled in one batch both see the same render's `canSubmit`.
    const sending = useRef(false);

    const pending = createEntry.isPending;
    const canSubmit =
      description.trim().length > 0 &&
      writeBlockedReason === null &&
      !pending &&
      refusal === null;

    /** Gives the entry up: Cancel, and a save that filed it. */
    const clearEntry = () => {
      setDescription("");
      setMinutes(DEFAULT_DURATION_MINUTES);
      setDaysAgo(0);
      setSubmitFailed(false);
    };

    /** A swipe or scrim close: the entry stays for the next visit. */
    const closed = () => {
      markClosed();
      setDescriptionFocused(false);
      setSubmitFailed(false);
      setRefusal(null);
    };

    const cancel = () => {
      clearEntry();
      dismiss();
    };

    const submit = () => {
      const date = (presets[daysAgo] ?? presets[0])?.date;
      if (!canSubmit || sending.current || !date) return;
      sending.current = true;
      setSubmitFailed(false);
      const sentFrom = visit();
      createEntry.mutate(
        {
          date,
          duration_minutes: minutes,
          description: description.trim(),
        },
        {
          onSuccess: () => {
            sending.current = false;
            // The confirming action (`spec/ui/mobile/README.md` § Native-feel
            // rules), felt once the entry is filed.
            successHaptic();
            clearEntry();
            // A sheet closed and reopened since is the member's new visit,
            // and the save doesn't close it under them.
            if (isSameVisit(sentFrom)) dismiss();
          },
          onError: (error) => {
            sending.current = false;
            // A visit that has ended doesn't latch its outcome into the next
            // one: the member would reopen to a refusal nothing on screen
            // caused, with Submit already withdrawn.
            if (!isSameVisit(sentFrom)) return;
            // Ordinary failures keep the retry they have always had; a gate
            // refusal takes it away, because retrying cannot win. Both asked
            // before `submitFailed`, and never as a bare 403: this route also
            // 403s for a permission denial, which an officer's role grant
            // clears on the next try, and for the `chapter.context.*` family,
            // which clears itself.
            if (subscriptionRefusalOf(error)) {
              setRefusal(SUBSCRIPTION_REFUSAL_COPY.serviceHours);
              return;
            }
            if (moduleRefusalOf(error)) {
              setRefusal(MODULE_REFUSAL_COPY.serviceHours);
              return;
            }
            setSubmitFailed(true);
          },
        },
      );
    };

    const hours = formatHours(minutes);
    const canDecrease = !pending && minutes > DURATION_STEP_MINUTES;
    const canIncrease = !pending && minutes < MAX_DURATION_MINUTES;
    const step = (direction: 1 | -1) =>
      setMinutes((current) => stepDuration(current, direction));

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={onAnimate}
        onDismiss={closed}
      >
        <BottomSheetView style={styles.body}>
          <SheetHeader title="Log service hours" onCancel={cancel} />

          {/* One adjustable control to a screen reader, which swipes it up
              and down; the two buttons stay for touch. */}
          <View style={styles.stepper}>
            <StepButton
              glyph="−"
              label="Half an hour less"
              enabled={canDecrease}
              onPress={() => step(-1)}
              styles={styles}
            />
            <View
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Hours"
              accessibilityValue={{
                text: `${hours} ${minutes === 60 ? "hour" : "hours"}`,
              }}
              accessibilityActions={[
                { name: "increment" },
                { name: "decrement" },
              ]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "increment" && canIncrease)
                  step(1);
                if (event.nativeEvent.actionName === "decrement" && canDecrease)
                  step(-1);
              }}
              style={styles.stepperValue}
            >
              <Text style={styles.hours}>{hours}</Text>
              <Text style={styles.hoursUnit}>hrs</Text>
            </View>
            <StepButton
              glyph="+"
              label="Half an hour more"
              enabled={canIncrease}
              onPress={() => step(1)}
              styles={styles}
            />
          </View>

          {/* The focus ring is the wrapper, as on s19: it tracks real focus,
              not "has text". */}
          <View
            style={[
              styles.ring,
              descriptionFocused ? styles.ringActive : null,
            ]}
          >
            <BottomSheetTextInput
              value={description}
              onChangeText={setDescription}
              onFocus={() => setDescriptionFocused(true)}
              onBlur={() => setDescriptionFocused(false)}
              editable={!pending}
              placeholder="What did you do?"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Service description"
              maxLength={SERVICE_DESCRIPTION_MAX_LENGTH}
              style={[
                styles.field,
                descriptionFocused ? styles.fieldFocused : null,
              ]}
            />
          </View>

          <FilterChips
            chips={presets.map((preset) => ({
              value: String(preset.daysAgo),
              label: preset.label,
            }))}
            selected={String(daysAgo)}
            onSelect={(value) => {
              if (value !== null && !pending) setDaysAgo(Number(value));
            }}
            accessibilityLabel="Date of service"
          />

          {refusal ? <Text style={styles.error}>{refusal}</Text> : null}

          {submitFailed ? (
            <Text style={styles.error}>
              That didn&apos;t save. Your entry is still here — try again.
            </Text>
          ) : null}

          {writeBlockedReason ? (
            <Text style={styles.error}>{writeBlockedReason}</Text>
          ) : null}

          <SheetPrimaryButton
            label={pending ? "Submitting…" : "Submit for approval"}
            onPress={submit}
            disabled={!canSubmit}
            // The refusal outranks the offline reason: reconnecting clears one
            // and not the other, so naming only the offline reason would
            // promise a fix that doesn't come.
            accessibilityHint={refusal ?? writeBlockedReason ?? undefined}
            accent={accent}
            onAccent={tokens.color.gold.onHouse}
          />
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

function StepButton({
  glyph,
  label,
  enabled,
  onPress,
  styles,
}: {
  glyph: string;
  label: string;
  enabled: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepButton,
        pressed && enabled ? styles.stepButtonPressed : null,
      ]}
    >
      <Text
        style={[styles.stepGlyph, enabled ? null : styles.stepGlyphDisabled]}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    stepper: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.lg,
      paddingBottom: tokens.spacing.sm,
    },
    // Drawn like s19's split fields: surface1, the input border, the control
    // radius, at the 44pt touch floor.
    stepButton: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      alignItems: "center",
      justifyContent: "center",
    },
    stepButtonPressed: {
      opacity: 0.85,
    },
    stepGlyph: {
      ...typeRole(tokens.typography.role.title),
      color: accent,
    },
    stepGlyphDisabled: {
      color: tokens.color.text.muted,
    },
    stepperValue: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: tokens.spacing.xs,
      // Wide enough for "23.5" so the buttons don't shift as the value grows.
      minWidth: 112,
      justifyContent: "center",
    },
    hours: {
      // TODO-DESIGN: Canvas draws 38px/700; `display` is 32/700 and arithmetic
      // on a role token is banned by foundations.md §7, so the nearest role wins.
      ...typeRole(tokens.typography.role.display),
      letterSpacing: -0.8,
      color: tokens.color.text.foreground,
    },
    hoursUnit: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: fieldStyles.field,
    fieldFocused: fieldStyles.fieldFocused,
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
