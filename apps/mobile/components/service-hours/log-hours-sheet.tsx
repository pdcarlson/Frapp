import { forwardRef, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { formatBytes } from "@repo/formatting";
import {
  useCreateServiceEntry,
  useRequestServiceProofUploadUrl,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import type { DispatchResult, HoursInput } from "@repo/chat-core/dispatch";
import { SERVICE_DESCRIPTION_MAX_LENGTH } from "@repo/validation";
import { FilterChips } from "@/components/filter-chips";
import { CameraGlyph } from "@/components/service-hours/camera-glyph";
import { CloseGlyph } from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetVisit,
  SheetBackToClose,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import type { PickedImage } from "@/lib/chat/attachment-upload";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useConnection } from "@/lib/connection/use-connection";
import { successHaptic } from "@/lib/haptics";
import { formatHours } from "@/lib/more/profile";
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_SERVICE_DATE_CHOICE,
  DURATION_STEP_MINUTES,
  MAX_DURATION_MINUTES,
  resolveServiceDate,
  serviceDateChoiceOf,
  serviceDatePresets,
  stepDuration,
  type ServiceDateChoice,
} from "@/lib/more/service-hours";
import {
  RECEIPT_REQUIRED_COPY,
  createRefusalOf,
  pickProofPhoto,
  proofPathRefusedOf,
  receiptRequiredOf,
  uploadProofPhoto,
} from "@/lib/more/service-proof";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s20 — the "Log service hours" sheet (`canvas-screens.dc.html`, `id="s20"`),
 * hosted by `app/(app)/service-hours.tsx`.
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
 * - "Add photo proof" is drawn, photos only (`lib/more/service-proof.ts`):
 *   the dashed row, then the photo's thumbnail with a remove × once one is
 *   picked. Its trailing word says "optional" until the API says otherwise;
 *   see "Proof the chapter requires" below.
 * - The caption under Submit ("Goes to the service chair · you'll get a
 *   notification") is omitted: it narrates, and neither half is something this
 *   app can promise.
 *
 * ## The entry outlives a close, not a Cancel
 *
 * The sheets' keep-the-draft rule (`spec/ui/mobile/patterns.md` § Bottom
 * sheets, "A draft outlives a close"): a swipe or scrim close keeps the entry
 * for the next visit, Cancel or a save gives it up, and Cancel is held while
 * a save runs. What is particular to s20 is its date, below.
 *
 * A kept entry reads its date chip against the day it is filed (`now` moves
 * with the host's clock, which re-reads when the sheet opens and when the app
 * comes back to the foreground, so a sheet left up overnight moves too).
 * "Today" and "Yesterday" are relative, so an entry kept overnight with
 * "Today" files the new day. A weekday chip names a date, and the entry holds
 * the date it named when picked: the chip shown selected is whichever resolves
 * to that date now, and a held date that has left the chip window falls back
 * to Today (`resolveServiceDate` says why s20 can't keep it the way s19 keeps
 * a "Next week" no chip draws).
 *
 * ## The photo goes up on Submit
 *
 * Picking only reads the photo on the device. Submit mints the signed URL,
 * PUTs the bytes, then posts the entry with their `proof_path`, as web's log
 * dialog does and as s21 uploads on Upload: a member who removes the photo,
 * picks another or cancels before submitting leaves no object in the bucket,
 * and nothing collects one that no entry claims (#2197). Uploading at pick
 * time would make Submit faster by one PUT and leave an orphan behind every
 * change of mind. The row shows "Uploading…" while the PUT runs.
 *
 * Once the bytes are up they stay claimed for this photo, so a create that
 * fails after them retries with the same path instead of a second copy. That
 * is also the one way an orphan is still left: bytes uploaded for a create
 * that failed, then given up (Remove, another photo, Cancel), stay in the
 * bucket until an orphan sweep exists (#2197). The held path is dropped when
 * the API turns it down (`proofPathRefusedOf`), so the next Submit uploads
 * afresh rather than resending a path that can't win; the host also mounts a
 * new sheet per chapter, because the path is minted under the chapter it was
 * sent from.
 *
 * ## Proof the chapter requires
 *
 * A chapter's `wf_hours_receipt` workflow (on by default) makes the API refuse
 * an entry without proof. A member can't read that setting: the chapter
 * config route needs `chapter-config:view`. So the row says "optional" until
 * the API answers that 400 (`receiptRequiredOf`), and from then on, for the
 * visit, it says "required", asks for a photo, and holds Submit until one is
 * attached. Without this, every submit on a default chapter read as an
 * ordinary failure, "try again", forever.
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
  /**
   * The host's clock, re-read each time it opens the sheet and when the app
   * comes back to the foreground.
   */
  now: Date;
  /**
   * The entry was filed. The quick actions say so, since the sheet may have
   * been opened over a screen that shows no entries.
   */
  onLogged?: () => void;
  /**
   * Set when the sheet was opened from a chat's + (#3865): the entry goes
   * through chat-core's `postHours` into that channel, the call web's
   * `/hours log` makes, with the proof the one-liner can't attach. A refusal
   * keeps the entry, as a log from elsewhere does; anything else is an entry
   * that may exist (the route doesn't dedupe), so the sheet closes and hands
   * the result to `onPosted` to say what it carries.
   */
  postToChannel?: (input: HoursInput) => Promise<DispatchResult>;
  onPosted?: (result: DispatchResult) => void;
}

export const LogHoursSheet = forwardRef<BottomSheetModal, LogHoursSheetProps>(
  function LogHoursSheet({ now, onLogged, postToChannel, onPosted }, ref) {
    const closeSheet = useSheetClose(ref);
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const styles = createStyles(tokens, accent);
    const backgroundStyle = useSheetBackgroundStyle();
    const createEntry = useCreateServiceEntry();
    // `postToChannel` isn't a mutation, so its flight is held here.
    const [posting, setPosting] = useState(false);
    const requestProofUploadUrl = useRequestServiceProofUploadUrl();
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
    // The chip as the entry holds it, read against `now` below: "Today" and
    // "Yesterday" re-derive from the day the entry is filed, and a weekday
    // chip holds the date it named, shown under whichever chip resolves to it
    // now, or as Today once none does (see the header).
    const [dateChoice, setDateChoice] = useState<ServiceDateChoice>(
      DEFAULT_SERVICE_DATE_CHOICE,
    );
    const { date, daysAgo } = resolveServiceDate(dateChoice, now);
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

    /**
     * The attached photo, and its storage path once its bytes are up. The
     * path rides along with the photo it was uploaded for, so a retry after
     * a failed create reuses it and a new photo starts over.
     */
    const [proof, setProof] = useState<{
      image: PickedImage;
      storagePath?: string;
    } | null>(null);
    const [picking, setPicking] = useState(false);
    // Set the moment the row opens the library, so a second tap before the
    // picker draws doesn't launch another (Android rejects the second launch).
    const pickingNow = useRef(false);
    const [uploading, setUploading] = useState(false);
    /** A refused pick (type, size, photo access) or a failed upload. */
    const [proofError, setProofError] = useState<string | null>(null);
    /**
     * The API refused an entry for want of proof (see the header). Latched
     * for the visit, like `refusal`, and cleared with it on close: an officer
     * may have turned the workflow off by the next one.
     */
    const [receiptRequired, setReceiptRequired] = useState(false);

    const pending = createEntry.isPending || uploading || posting;
    const canSubmit =
      description.trim().length > 0 &&
      writeBlockedReason === null &&
      !pending &&
      !picking &&
      refusal === null &&
      !(receiptRequired && proof === null);

    /** Gives the entry up: Cancel, and a save that filed it. */
    const clearEntry = () => {
      setDescription("");
      setMinutes(DEFAULT_DURATION_MINUTES);
      setDateChoice(DEFAULT_SERVICE_DATE_CHOICE);
      setSubmitFailed(false);
      setProof(null);
      setProofError(null);
    };

    /** A swipe or scrim close: the entry stays for the next visit. */
    const closed = () => {
      markClosed();
      setDescriptionFocused(false);
      setSubmitFailed(false);
      setRefusal(null);
      setReceiptRequired(false);
      setProofError(null);
    };

    // Held while a save runs (`cancelDisabled` below): the create can't be
    // called back, so a Cancel then would clear an entry that gets filed
    // anyway. `sending` covers a tap in the same batch as Submit, before
    // `pending` reaches a render.
    const cancel = () => {
      if (sending.current) return;
      clearEntry();
      dismiss();
    };

    const choosePhoto = async () => {
      if (pickingNow.current || sending.current) return;
      pickingNow.current = true;
      setPicking(true);
      setProofError(null);
      try {
        const result = await pickProofPhoto();
        if (result.status === "picked") setProof({ image: result.image });
        else if (result.status === "refused") setProofError(result.reason);
      } finally {
        pickingNow.current = false;
        setPicking(false);
      }
    };

    const removePhoto = () => {
      if (sending.current) return;
      setProof(null);
      setProofError(null);
    };

    const submit = () => {
      if (!canSubmit || sending.current) return;
      sending.current = true;
      setSubmitFailed(false);
      setProofError(null);
      const sentFrom = visit();
      const entry = {
        date,
        duration_minutes: minutes,
        description: description.trim(),
      };
      // Bytes already up for this photo, or no photo: post now, in this tap.
      if (!proof || proof.storagePath) {
        const proofPath = proof?.storagePath;
        send(proofPath ? { ...entry, proof_path: proofPath } : entry, sentFrom);
        return;
      }
      void uploadThenSend(proof.image, entry, sentFrom);
    };

    const uploadThenSend = async (
      image: PickedImage,
      entry: { date: string; duration_minutes: number; description: string },
      sentFrom: number,
    ) => {
      setUploading(true);
      const put = await uploadProofPhoto(image, (body) =>
        requestProofUploadUrl.mutateAsync(body),
      );
      setUploading(false);
      if (put.status === "refused") {
        sending.current = false;
        // Told only to the visit it was sent from, like the create's outcome.
        if (!isSameVisit(sentFrom)) return;
        if (put.final) setRefusal(put.reason);
        else setProofError(put.reason);
        return;
      }
      setProof((current) =>
        current?.image === image
          ? { image, storagePath: put.storagePath }
          : current,
      );
      send({ ...entry, proof_path: put.storagePath }, sentFrom);
    };

    const send = (
      body: {
        date: string;
        duration_minutes: number;
        description: string;
        proof_path?: string;
      },
      sentFrom: number,
    ) => {
      const handlers = {
        onSuccess: (posted?: DispatchResult) => {
          sending.current = false;
          // The confirming action (`spec/ui/mobile/README.md` § Native-feel
          // rules), felt once the entry is filed; not for a lost answer,
          // whose entry may not exist.
          if (!posted?.unconfirmed) successHaptic();
          clearEntry();
          onLogged?.();
          // A sheet closed and reopened since is the member's new visit,
          // and the save doesn't close it under them.
          if (isSameVisit(sentFrom)) dismiss();
          if (posted) onPosted?.(posted);
        },
        onError: (error: unknown) => {
          sending.current = false;
          // The API turned the held path down (another chapter's, or no
          // object behind it): drop it, so the next Submit uploads the photo
          // again instead of resending a path that can't win. Whatever visit
          // is on screen, since the path is wrong in all of them.
          const sentPath = body.proof_path;
          if (sentPath && proofPathRefusedOf(error)) {
            setProof((current) =>
              current?.storagePath === sentPath
                ? { image: current.image }
                : current,
            );
          }
          // A visit that has ended doesn't latch its outcome into the next
          // one: the member would reopen to a refusal nothing on screen
          // caused, with Submit already withdrawn.
          if (!isSameVisit(sentFrom)) return;
          // Ordinary failures keep the retry they have always had; a gate
          // refusal takes it away, because retrying cannot win. Asked before
          // `submitFailed`, in the mint's words (`createRefusalOf`).
          const gated = createRefusalOf(error);
          if (gated !== null) {
            setRefusal(gated);
            return;
          }
          // The chapter requires proof: ask for a photo rather than "try
          // again", which can't win without one.
          if (receiptRequiredOf(error)) {
            setReceiptRequired(true);
            return;
          }
          setSubmitFailed(true);
        },
      };
      if (!postToChannel) {
        createEntry.mutate(body, {
          onSuccess: () => handlers.onSuccess(),
          onError: handlers.onError,
        });
        return;
      }
      setPosting(true);
      void postToChannel(body)
        .catch((cause: unknown): DispatchResult => ({
          ok: false,
          error: "Couldn't log hours",
          cause,
        }))
        .then((result) => {
          setPosting(false);
          if (!result.ok) {
            handlers.onError(result.cause ?? new Error(result.error));
            return;
          }
          handlers.onSuccess(result);
        });
    };

    const hours = formatHours(minutes);
    const canDecrease = !pending && minutes > DURATION_STEP_MINUTES;
    const canIncrease = !pending && minutes < MAX_DURATION_MINUTES;
    const step = (direction: 1 | -1) =>
      setMinutes((current) => stepDuration(current, direction));

    return (
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        enableDynamicSizing
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={onAnimate}
        onDismiss={closed}
      >
        <SheetBackToClose onClose={closeSheet} />
        <BottomSheetView onAccessibilityEscape={closeSheet} style={styles.body}>
          <SheetHeader
            title="Log service hours"
            onCancel={cancel}
            cancelDisabled={pending}
          />

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
            style={[styles.ring, descriptionFocused ? styles.ringActive : null]}
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
              const preset = presets.find(
                (each) => String(each.daysAgo) === value,
              );
              if (preset && !pending)
                setDateChoice(serviceDateChoiceOf(preset));
            }}
            accessibilityLabel="Date of service"
          />

          <ProofRow
            proof={proof?.image ?? null}
            required={receiptRequired}
            picking={picking}
            uploading={uploading}
            locked={pending}
            onChoose={() => void choosePhoto()}
            onRemove={removePhoto}
            glyphColor={tokens.color.text.mutedForeground}
            styles={styles}
          />
          {proofError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {proofError}
            </Text>
          ) : null}
          {receiptRequired && proof === null ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {RECEIPT_REQUIRED_COPY}
            </Text>
          ) : null}

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
            accessibilityHint={
              refusal ??
              writeBlockedReason ??
              (receiptRequired && proof === null
                ? RECEIPT_REQUIRED_COPY
                : undefined)
            }
            accent={accent}
            onAccent={tokens.color.gold.onHouse}
          />
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

/**
 * The board's "Add photo proof" row, and the attached photo in its place: a
 * thumbnail, its size (or "Uploading…" while the PUT runs) and a remove ×.
 *
 * The empty row's camera and label are neutral: a field's icon and label never
 * take the chapter accent (foundations.md §6, "Where the accent goes",
 * 2026-11-05). The dashed border already says it can be tapped.
 */
function ProofRow({
  proof,
  required,
  picking,
  uploading,
  locked,
  onChoose,
  onRemove,
  glyphColor,
  styles,
}: {
  proof: PickedImage | null;
  required: boolean;
  picking: boolean;
  uploading: boolean;
  /** A save is running: the photo holds still. */
  locked: boolean;
  onChoose: () => void;
  onRemove: () => void;
  /** The camera's hue: `text.mutedForeground`, as a field icon is. */
  glyphColor: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const { tokens } = useFrappTheme();
  if (!proof) {
    const need = required ? "required" : "optional";
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add photo proof, ${need}`}
        accessibilityHint="Opens your photo library."
        accessibilityState={{ disabled: picking || locked }}
        disabled={picking || locked}
        onPress={onChoose}
        style={({ pressed }) => [
          styles.proofRow,
          styles.proofRowEmpty,
          pressed ? styles.proofRowPressed : null,
        ]}
      >
        <CameraGlyph color={glyphColor} />
        <Text style={styles.proofAdd}>Add photo proof</Text>
        <Text style={styles.proofNeed}>{picking ? "Opening…" : need}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.proofRow}>
      <Image
        source={{ uri: proof.uri }}
        style={styles.proofThumb}
        accessibilityIgnoresInvertColors
      />
      <View style={styles.proofText}>
        <Text style={styles.proofName} numberOfLines={1}>
          {proof.filename}
        </Text>
        <Text style={styles.proofMeta}>
          {uploading ? "Uploading…" : formatBytes(proof.byteSize)}
        </Text>
      </View>
      <IconButton
        label={`Remove photo proof, ${proof.filename}`}
        disabled={locked}
        onPress={onRemove}
      >
        <CloseGlyph
          color={locked ? tokens.color.text.disabled : tokens.color.text.muted}
        />
      </IconButton>
    </View>
  );
}

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
    // The stepper's − and + are icon-only controls, so neutral, never the
    // chapter accent (foundations.md §6). Foreground rather than the muted
    // step, so an enabled step stays clearly apart from a disabled one.
    stepGlyph: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
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
    // Drawn like the board's row (the control radius, surface1, and a dashed
    // border while empty) at the touch Field step, 44 (the board draws 50).
    proofRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.xs,
      marginTop: tokens.spacing.xs,
    },
    proofRowEmpty: {
      borderStyle: "dashed",
      borderColor: tint(tokens.color.text.foreground, 0.2),
    },
    proofRowPressed: {
      opacity: 0.85,
    },
    proofAdd: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    proofNeed: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    proofThumb: {
      width: 34,
      height: 34,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
    },
    proofText: {
      flex: 1,
      gap: 2,
    },
    proofName: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    proofMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
