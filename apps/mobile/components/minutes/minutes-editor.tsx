import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import {
  formatDateEntry,
  localIsoDate,
  parseBareDateLocalNoon,
  suggestTaskDue,
} from "@repo/formatting";
import {
  useEvent,
  useMemberDisplayNames,
  type MeetingMinutes,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  BLANK_MINUTES_ROW,
  MEETING_COPY,
  MEETING_DATES_MAX_ITEMS,
  MEETING_DECISION_HEADLINE_MAX_LENGTH,
  MEETING_ITEM_TEXT_MAX_LENGTH,
  MEETING_LIST_MAX_ITEMS,
  MEETING_NOTE_TAKERS_COPY,
  MEETING_TABLED_MAX_ITEMS,
  MEETING_TEXT_MAX_LENGTH,
  MINUTES_EDITOR_COPY,
  MINUTES_FLOW_COPY,
  MINUTES_READ_COPY,
  clampMeetingVote,
  meetingSectionLabel,
  meetingTabledFromLabel,
  minutesAddableSections,
  minutesAttendanceDetail,
  minutesEditorSections,
  minutesHaveAttendees,
  minutesTablingOffers,
  readEventAgenda,
  tabledRowFromAgenda,
  type MeetingDraftQuote,
  type MeetingActionItem,
  type MeetingContent,
  type MeetingDateItem,
  type MeetingDecision,
  type MeetingTabledItem,
  type MeetingTextSection,
} from "@repo/validation";
import {
  CloseGlyph,
  DisclosureGlyph,
  PlusGlyph,
} from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";
import type { ItemMenu, ItemMenuHandle } from "@/components/item-actions-menu";
import { MemberAvatar } from "@/components/member-avatar";
import { TextAction } from "@/components/minutes/recorder-controls";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { DueDateField } from "@/components/tasks/due-date-field";
import { CalendarGlyph } from "@/components/tasks/task-glyphs";
import { WhoPickerSheet } from "@/components/tasks/who-picker-sheet";
import { useChapterBranding } from "@/lib/chapter-branding";
import type { MinutesEditing } from "@/lib/minutes/use-minutes-editor";
import { initialsFor } from "@/lib/more/narrow";
import { useWhoDirectory } from "@/lib/tasks/use-who-directory";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The minutes' section editor on the phone (#4412), the web's
 * (`apps/web/components/meetings/minutes-page.tsx`) section for section: the
 * same sections in the same order with the same words
 * (`MINUTES_EDITOR_COPY`), the same rule for which show
 * (`minutesEditorSections`: a draft shows what it filled and Add a section
 * offers the rest; minutes written by hand lay out the template), and the
 * same saves (`useMinutesEditor`). Text sections are boxes that grow with
 * what is written; decisions take a headline and a vote count; action items
 * take who (the Assign to picker, one person) and a due day (the platform's
 * own date picker); Coming up takes a day and a few words; Tabled offers the
 * event's agenda a tap at a time.
 *
 * Drawn in place of the read view on the minutes screen, as the task screen
 * edits a task where it is (Apple Notes and Notion's mobile pages edit the
 * page itself rather than a form over it).
 */
export function MinutesEditor({
  meeting,
  editing,
  byHand,
  disabled,
  showProblems = false,
  quoteFor,
  menuFor,
  onMarkAttendance,
}: {
  meeting: MeetingMinutes;
  editing: MinutesEditing;
  /** Lay out the template's sections, not only those with words. */
  byHand: boolean;
  /** A draft is being written into these sections: they wait. */
  disabled: boolean;
  /** Done or Post was pressed: every row that wouldn't be kept says so. */
  showProblems?: boolean;
  quoteFor: (
    kind: "decision" | "action_item",
    text: string,
  ) => MeetingDraftQuote | null;
  /** The screen's action menu, for Add a section. */
  menuFor: (menu: ItemMenu) => ItemMenuHandle | null;
  /** Mark who was there, where the viewer may and the meeting has ended. */
  onMarkAttendance?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const { draft, edit, kept, keep } = editing;
  const content = draft.content;
  const marked = !!meeting.attendees && minutesHaveAttendees(meeting.attendees);
  const shown = useMemo(
    () =>
      minutesEditorSections(meeting.sections, content, {
        byHand,
        added: marked ? [...kept, "attendees"] : kept,
      }),
    [meeting.sections, content, byHand, kept, marked],
  );
  const addable = minutesAddableSections(shown);
  // A draft starting closes the keyboard: the sections wait for it, and a
  // field still focused would keep taking words the draft would write over.
  useEffect(() => {
    if (disabled) Keyboard.dismiss();
  }, [disabled]);
  // The meeting's own day: the earliest an action item or a date offers.
  const meetingDay = localIsoDate(new Date(meeting.event_start_time));

  const openAddSection = () =>
    menuFor({
      title: MINUTES_FLOW_COPY.review.addSection,
      actions: addable.map((key) => ({
        key,
        label: meetingSectionLabel(key),
        glyph: (color: string) => <PlusGlyph color={color} />,
        run: () => keep(key),
      })),
    })?.open();

  return (
    <View
      style={styles.editor}
      pointerEvents={disabled ? "none" : "auto"}
      accessibilityState={{ disabled, busy: disabled }}
    >
      {editing.stale ? (
        <View accessibilityRole="alert" style={styles.stale}>
          <Text style={styles.staleText}>
            {editing.loadFailed
              ? `${MINUTES_EDITOR_COPY.loadFailed}. ${MINUTES_EDITOR_COPY.loadFailedBody}`
              : MEETING_COPY.stale}
          </Text>
          <TextAction
            label={MEETING_COPY.loadTheirs}
            color={accent}
            onPress={() => void editing.loadTheirs()}
          />
        </View>
      ) : null}

      {shown.map((key) => (
        <View key={key} style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            {meetingSectionLabel(key)}
          </Text>
          {key === "attendees" ? (
            <AttendeesLine
              meeting={meeting}
              onMarkAttendance={onMarkAttendance}
            />
          ) : key === "decisions" ? (
            <DecisionsEditor
              decisions={content.decisions}
              onChange={(decisions) => edit({ decisions })}
              quoteFor={(text) => quoteFor("decision", text)}
            />
          ) : key === "action_items" ? (
            <ActionItemsEditor
              items={content.action_items}
              meetingStart={meeting.event_start_time}
              meetingDay={meetingDay}
              onChange={(action_items) => edit({ action_items })}
              quoteFor={(text) => quoteFor("action_item", text)}
            />
          ) : key === "dates" ? (
            <DatesEditor
              items={content.dates}
              meetingDay={meetingDay}
              showProblems={showProblems}
              onChange={(dates) => edit({ dates })}
            />
          ) : key === "tabled" ? (
            <TabledEditor
              items={content.tabled}
              eventId={meeting.event_id}
              onChange={(tabled) => edit({ tabled })}
            />
          ) : (
            <GrowingField
              label={meetingSectionLabel(key)}
              value={content[key as MeetingTextSection]}
              maxLength={MEETING_TEXT_MAX_LENGTH}
              minLines={key === "summary" ? 5 : 3}
              placeholder={
                key === "tldr" ? MEETING_COPY.tldrPlaceholder : undefined
              }
              onChangeText={(text) =>
                edit({ [key]: text } as Partial<MeetingContent>)
              }
            />
          )}
        </View>
      ))}

      {addable.length > 0 ? (
        <AddRow
          label={MINUTES_FLOW_COPY.review.addSection}
          muted
          onPress={openAddSection}
        />
      ) : null}
    </View>
  );
}

/** A box that grows with what is written in it, as web's textareas do. */
function GrowingField({
  label,
  value,
  onChangeText,
  maxLength,
  placeholder,
  minLines = 1,
  onBlur,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  maxLength: number;
  placeholder?: string;
  /** How tall it starts, in lines of body text. */
  minLines?: number;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const [focused, setFocused] = useState(false);
  const lineHeight =
    tokens.typography.role.body.lineHeight ??
    tokens.typography.role.body.size * 1.4;
  return (
    <View style={[styles.ring, focused ? styles.ringActive : null]}>
      <TextInput
        multiline
        value={value}
        maxLength={maxLength}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={tokens.color.text.muted}
        // Grows with the text, never scrolls inside itself, so a long
        // summary reads whole and the page is the one thing that scrolls.
        scrollEnabled={false}
        style={[
          styles.field,
          styles.multiline,
          {
            minHeight: Math.max(
              tokens.touch.minimum,
              lineHeight * minLines + tokens.spacing.sm * 2,
            ),
          },
          focused ? styles.fieldFocused : null,
        ]}
      />
    </View>
  );
}

/** A one-line box with its label over it. */
function LabelledField({
  label,
  value,
  onChangeText,
  maxLength,
  placeholder,
  numeric = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  maxLength?: number;
  placeholder?: string;
  numeric?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.labelled}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.ring, focused ? styles.ringActive : null]}>
        <TextInput
          value={value}
          maxLength={maxLength}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={tokens.color.text.muted}
          keyboardType={numeric ? "number-pad" : "default"}
          returnKeyType="done"
          selectTextOnFocus={numeric}
          style={[styles.field, focused ? styles.fieldFocused : null]}
        />
      </View>
    </View>
  );
}

/** Add a decision, Add a date, Add a section: a plus and the verb. */
function AddRow({
  label,
  onPress,
  muted = false,
}: {
  label: string;
  onPress: () => void;
  /** Add a section reads quieter than a list's own Add. */
  muted?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const color = muted ? tokens.color.text.mutedForeground : accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.addRow, pressed ? styles.pressed : null]}
    >
      <PlusGlyph color={color} />
      <Text style={[styles.addLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

/** One item of a list: a card, its words first, × at the top right. */
function ItemCard({
  removeLabel,
  onRemove,
  children,
  main,
}: {
  removeLabel: string;
  onRemove: () => void;
  /** The item's words, beside the ×. */
  main: ReactNode;
  /** What sits under them: a headline, a vote, who and when. */
  children?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.grow}>{main}</View>
        <View style={styles.remove}>
          <IconButton label={removeLabel} onPress={onRemove}>
            <CloseGlyph color={tokens.color.text.mutedForeground} />
          </IconButton>
        </View>
      </View>
      {children}
    </View>
  );
}

/** Where a drafted item came from, while it still reads as drafted. */
function NotesQuote({ quote }: { quote: MeetingDraftQuote | null }) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  if (!quote) return null;
  return (
    <Text style={styles.note}>
      {quote.from
        ? MEETING_NOTE_TAKERS_COPY.from(quote.from, quote.mine)
        : MINUTES_EDITOR_COPY.fromYourNotes}
      : “{quote.quote}”
    </Text>
  );
}

function DecisionsEditor({
  decisions,
  onChange,
  quoteFor,
}: {
  decisions: MeetingDecision[];
  onChange: (next: MeetingDecision[]) => void;
  quoteFor: (text: string) => MeetingDraftQuote | null;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const copy = MINUTES_EDITOR_COPY.decision;
  const set = (index: number, patch: Partial<MeetingDecision>) =>
    onChange(
      decisions.map((decision, at) =>
        at === index ? { ...decision, ...patch } : decision,
      ),
    );
  return (
    <View style={styles.list}>
      {decisions.map((decision, index) => (
        <ItemCard
          key={index}
          removeLabel={copy.remove(index + 1)}
          onRemove={() => onChange(decisions.filter((_, at) => at !== index))}
          main={
            <GrowingField
              label={copy.label(index + 1)}
              placeholder={copy.placeholder}
              value={decision.text}
              maxLength={MEETING_ITEM_TEXT_MAX_LENGTH}
              onChangeText={(text) => set(index, { text })}
            />
          }
        >
          <NotesQuote quote={quoteFor(decision.text)} />
          <LabelledField
            label={MEETING_COPY.decisionHeadline}
            placeholder={MEETING_COPY.decisionHeadlinePlaceholder}
            value={decision.headline ?? ""}
            maxLength={MEETING_DECISION_HEADLINE_MAX_LENGTH}
            onChangeText={(headline) => set(index, { headline })}
          />
          {decision.vote ? (
            <View style={styles.voteBlock}>
              <View style={styles.voteRow}>
                {(["for", "against", "abstain"] as const).map((side) => (
                  <View key={side} style={styles.grow}>
                    <LabelledField
                      label={copy[side]}
                      numeric
                      value={String(decision.vote![side])}
                      onChangeText={(text) =>
                        set(index, {
                          vote: {
                            ...decision.vote!,
                            [side]: clampMeetingVote(text),
                          },
                        })
                      }
                    />
                  </View>
                ))}
              </View>
              <TextAction
                label={copy.removeVote}
                color={tokens.color.text.mutedForeground}
                onPress={() => set(index, { vote: null })}
              />
            </View>
          ) : (
            <TextAction
              label={copy.addVote}
              color={accent}
              onPress={() =>
                set(index, { vote: { for: 0, against: 0, abstain: 0 } })
              }
            />
          )}
        </ItemCard>
      ))}
      {decisions.length < MEETING_LIST_MAX_ITEMS ? (
        <AddRow
          label={copy.add}
          onPress={() => onChange([...decisions, BLANK_MINUTES_ROW.decision()])}
        />
      ) : null}
    </View>
  );
}

function ActionItemsEditor({
  items,
  meetingStart,
  meetingDay,
  onChange,
  quoteFor,
}: {
  items: MeetingActionItem[];
  meetingStart: string;
  meetingDay: string;
  onChange: (next: MeetingActionItem[]) => void;
  quoteFor: (text: string) => MeetingDraftQuote | null;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const copy = MINUTES_EDITOR_COPY.actionItem;
  const names = useMemberDisplayNames();
  // One picker for the list, opened over the item pressed: the Assign to
  // picker limited to one person, as a task's own Who is.
  const pickerRef = useRef<BottomSheetModal>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const who = useWhoDirectory({ groups: false });
  // Read once per visit, so a suggested due day doesn't move mid-edit.
  const [openedAt] = useState(() => new Date());
  const set = (index: number, patch: Partial<MeetingActionItem>) =>
    onChange(
      items.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    );
  const pickedOwner =
    picking === null ? null : (items[picking]?.owner_user_id ?? null);

  return (
    <View style={styles.list}>
      {items.map((item, index) => {
        const owner = item.owner_user_id;
        const ownerName = owner
          ? (names.nameFor(owner) ?? copy.nobody)
          : copy.nobody;
        return (
          <ItemCard
            key={index}
            removeLabel={copy.remove(index + 1)}
            onRemove={() => onChange(items.filter((_, at) => at !== index))}
            main={
              <GrowingField
                label={copy.label(index + 1)}
                placeholder={copy.placeholder}
                value={item.text}
                maxLength={MEETING_ITEM_TEXT_MAX_LENGTH}
                onChangeText={(text) => set(index, { text })}
              />
            }
          >
            <NotesQuote quote={quoteFor(item.text)} />
            <View style={styles.factRow}>
              <Text style={styles.factLabel}>{copy.who}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${copy.who}: ${ownerName}`}
                accessibilityHint="Choose who this action item is for."
                onPress={() => {
                  Keyboard.dismiss();
                  setPicking(index);
                  pickerRef.current?.present();
                }}
                style={({ pressed }) => [
                  styles.factValue,
                  pressed ? styles.pressed : null,
                ]}
              >
                {owner ? (
                  <MemberAvatar
                    uri={names.avatarFor(owner)}
                    initials={initialsFor(ownerName)}
                    size={AVATAR_SIZE}
                    style={styles.avatar}
                    textStyle={styles.avatarText}
                    tint={names.avatarTintFor(owner)}
                  />
                ) : null}
                <Text
                  numberOfLines={1}
                  style={[styles.factText, owner ? null : styles.factEmpty]}
                >
                  {ownerName}
                </Text>
                <DisclosureGlyph
                  direction="right"
                  color={tokens.color.text.mutedForeground}
                />
              </Pressable>
              {owner ? (
                <IconButton
                  label={`${copy.who}: ${copy.nobody}`}
                  onPress={() => set(index, { owner_user_id: null })}
                >
                  <CloseGlyph color={tokens.color.text.mutedForeground} />
                </IconButton>
              ) : null}
            </View>
            <View style={styles.factRow}>
              <Text style={styles.factLabel}>{copy.due}</Text>
              <DayField
                value={item.due_date ?? ""}
                label={copy.due}
                placeholder={copy.addDue}
                earliest={meetingDay}
                // A week after the meeting, as a suggested task's due day,
                // or today once that has gone by.
                fallback={
                  suggestTaskDue(meetingStart, openedAt) ??
                  localIsoDate(openedAt)
                }
                onChange={(day) => set(index, { due_date: day || null })}
              />
              {item.due_date ? (
                <IconButton
                  label={copy.removeDue}
                  onPress={() => set(index, { due_date: null })}
                >
                  <CloseGlyph color={tokens.color.text.mutedForeground} />
                </IconButton>
              ) : null}
            </View>
          </ItemCard>
        );
      })}
      {items.length < MEETING_LIST_MAX_ITEMS ? (
        <AddRow
          label={copy.add}
          onPress={() => onChange([...items, BLANK_MINUTES_ROW.actionItem()])}
        />
      ) : null}
      <WhoPickerSheet
        ref={pickerRef}
        single
        title={copy.who}
        value={pickedOwner ? { kind: "person", userId: pickedOwner } : null}
        onChange={(next) => {
          if (picking !== null && next?.kind === "person")
            set(picking, { owner_user_id: next.userId });
        }}
        directory={who.directory}
        people={who.people}
        sets={who.sets}
        onDismiss={() => setPicking(null)}
      />
    </View>
  );
}

/**
 * A day, or none: the platform's own picker once a day is set (as a task's
 * due date is), and before that a quiet "Add a due date" / "Pick a day"
 * that opens it, so no day is ever stored by accident.
 */
function DayField({
  value,
  label,
  placeholder,
  earliest,
  fallback,
  onChange,
  invalid = false,
}: {
  /** `YYYY-MM-DD`, or "" for none. */
  value: string;
  /** What a screen reader says before the day. */
  label: string;
  placeholder: string;
  /** The earliest day offered, unless the day set is earlier still. */
  earliest: string;
  /** Where the picker opens with no day set. */
  fallback: string;
  onChange: (next: string) => void;
  invalid?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  if (value) {
    return (
      <View style={styles.dayValue}>
        <DueDateField
          value={value}
          today={value < earliest ? value : earliest}
          disabled={false}
          label={label}
          // Written out, as the read view and the web's field write it.
          format={(day) => formatDateEntry(day, new Date())}
          onChange={onChange}
        />
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={placeholder}
      accessibilityHint="Opens the date picker."
      onPress={() => {
        Keyboard.dismiss();
        if (Platform.OS === "android") {
          DateTimePickerAndroid.open({
            value: parseBareDateLocalNoon(fallback) ?? new Date(),
            mode: "date",
            minimumDate: parseBareDateLocalNoon(earliest) ?? undefined,
            onValueChange: (_event, picked) => {
              if (picked) onChange(localIsoDate(picked));
            },
          });
          return;
        }
        // iOS draws its compact picker in the field once there is a day to
        // show, a tap from here.
        onChange(fallback);
      }}
      style={({ pressed }) => [
        styles.factValue,
        invalid ? styles.invalid : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <CalendarGlyph color={tokens.color.text.mutedForeground} />
      <Text style={[styles.factText, styles.factEmpty]}>{placeholder}</Text>
    </Pressable>
  );
}

/** Coming up by hand (#5562): a day and what happens then. */
function DatesEditor({
  items,
  meetingDay,
  showProblems,
  onChange,
}: {
  items: MeetingDateItem[];
  meetingDay: string;
  showProblems: boolean;
  onChange: (next: MeetingDateItem[]) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  // The rows whose words were left (blurred), by index: a row says it needs
  // a day once the officer moves on from it or presses Done, never on the
  // first letter, so nothing moves under the cursor.
  const [left, setLeft] = useState<ReadonlySet<number>>(() => new Set());
  const remove = (index: number) => {
    setLeft(
      (current) =>
        new Set(
          [...current]
            .filter((at) => at !== index)
            .map((at) => (at > index ? at - 1 : at)),
        ),
    );
    onChange(items.filter((_, at) => at !== index));
  };
  const set = (index: number, patch: Partial<MeetingDateItem>) =>
    onChange(
      items.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    );
  return (
    <View style={styles.list}>
      {items.map((item, index) => {
        // A row with words and no day isn't kept on save (Coming up is
        // days), so it says so instead of vanishing.
        const needsDay =
          item.text.trim() !== "" &&
          item.date === "" &&
          (showProblems || left.has(index));
        return (
          <ItemCard
            key={index}
            removeLabel={`${MEETING_COPY.removeDate} ${index + 1}`}
            onRemove={() => remove(index)}
            main={
              <View style={styles.dayRow}>
                <DayField
                  value={item.date}
                  label={MEETING_COPY.dateDay}
                  placeholder={MINUTES_EDITOR_COPY.date.pick}
                  earliest={meetingDay}
                  fallback={meetingDay}
                  invalid={needsDay}
                  onChange={(date) => set(index, { date })}
                />
              </View>
            }
          >
            <GrowingField
              label={`${MEETING_COPY.dateWhat} ${index + 1}`}
              placeholder={MEETING_COPY.dateWhatPlaceholder}
              value={item.text}
              maxLength={MEETING_ITEM_TEXT_MAX_LENGTH}
              onChangeText={(text) => set(index, { text })}
              onBlur={() =>
                setLeft((current) =>
                  current.has(index) ? current : new Set([...current, index]),
                )
              }
            />
            {needsDay ? (
              <Text accessibilityLiveRegion="polite" style={styles.problem}>
                {MEETING_COPY.dateNeedsDay}
              </Text>
            ) : null}
          </ItemCard>
        );
      })}
      {items.length < MEETING_DATES_MAX_ITEMS ? (
        <AddRow
          label={MEETING_COPY.addDate}
          onPress={() => onChange([...items, BLANK_MINUTES_ROW.date()])}
        />
      ) : null}
    </View>
  );
}

/**
 * The Table action by hand (#5522): add a matter the meeting put off, or
 * take out one the draft listed that wasn't. Each agenda item not tabled yet
 * is a chip a tap tables (#5534), carrying its first date and count.
 */
function TabledEditor({
  items,
  eventId,
  onChange,
}: {
  items: MeetingTabledItem[];
  eventId: string | null;
  onChange: (next: MeetingTabledItem[]) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const copy = MINUTES_EDITOR_COPY.tabled;
  const event = useEvent(eventId ?? "");
  const offered = minutesTablingOffers(
    readEventAgenda(event.data?.agenda),
    items,
  );
  const full = items.length >= MEETING_TABLED_MAX_ITEMS;
  return (
    <View style={styles.list}>
      {offered.length > 0 && !full ? (
        <View style={styles.chips}>
          <Text style={styles.note}>{copy.fromAgenda}</Text>
          {offered.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={copy.tableItem(item.text)}
              onPress={() => onChange([...items, tabledRowFromAgenda(item)])}
              style={({ pressed }) => [
                styles.chip,
                pressed ? styles.pressed : null,
              ]}
            >
              <PlusGlyph color={tokens.color.text.foreground} size={14} />
              <Text numberOfLines={1} style={styles.chipText}>
                {copy.tableItem(item.text)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {items.map((item, index) => {
        const from = meetingTabledFromLabel(item);
        return (
          <ItemCard
            key={index}
            removeLabel={copy.remove(index + 1)}
            onRemove={() => onChange(items.filter((_, at) => at !== index))}
            main={
              <GrowingField
                label={copy.label(index + 1)}
                placeholder={copy.placeholder}
                value={item.text}
                maxLength={MEETING_ITEM_TEXT_MAX_LENGTH}
                onChangeText={(text) =>
                  onChange(
                    items.map((entry, at) =>
                      at === index ? { ...entry, text } : entry,
                    ),
                  )
                }
              />
            }
          >
            {from ? <Text style={styles.note}>{from}</Text> : null}
          </ItemCard>
        );
      })}
      {!full ? (
        <AddRow
          label={copy.add}
          onPress={() => onChange([...items, BLANK_MINUTES_ROW.tabled()])}
        />
      ) : null}
    </View>
  );
}

/**
 * Attendees aren't typed: they are the event's check-ins. The line says
 * where it stands, with Mark who was there where the viewer may use it.
 */
function AttendeesLine({
  meeting,
  onMarkAttendance,
}: {
  meeting: MeetingMinutes;
  onMarkAttendance?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const detail =
    meeting.attendees && minutesHaveAttendees(meeting.attendees)
      ? minutesAttendanceDetail(meeting.attendees)
      : meeting.event_id
        ? MEETING_COPY.attendeesNone
        : MEETING_COPY.attendeesGone;
  return (
    <View style={styles.attendees}>
      <Text style={styles.body}>{detail}</Text>
      {onMarkAttendance ? (
        <TextAction
          label={MINUTES_READ_COPY.menu.attendance}
          color={accent}
          onPress={onMarkAttendance}
        />
      ) : null}
    </View>
  );
}

const AVATAR_SIZE = 24;

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  const caption = typeRole(tokens.typography.role.caption);
  return StyleSheet.create({
    editor: {
      gap: tokens.spacing.xl,
    },
    section: {
      gap: tokens.spacing.sm,
    },
    heading: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    list: {
      gap: tokens.spacing.sm,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: fieldStyles.field,
    fieldFocused: fieldStyles.fieldFocused,
    multiline: fieldStyles.fieldMultilineText,
    labelled: {
      gap: tokens.spacing.xs,
    },
    label: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    card: {
      gap: tokens.spacing.sm,
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      backgroundColor: tokens.color.surface.card,
    },
    cardTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.xs,
    },
    grow: {
      flex: 1,
      minWidth: 0,
    },
    remove: {
      // Centres the × on the field's first line.
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.xs,
    },
    voteBlock: {
      gap: tokens.spacing.xs,
      alignItems: "flex-start",
    },
    voteRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
      alignSelf: "stretch",
    },
    factRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
    },
    factLabel: {
      ...caption,
      color: tokens.color.text.mutedForeground,
      width: 40,
    },
    factValue: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.control,
      backgroundColor: tokens.color.surface.surface1,
    },
    factText: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    factEmpty: {
      color: tokens.color.text.mutedForeground,
    },
    dayValue: {
      flex: 1,
      minWidth: 0,
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.control,
      backgroundColor: tokens.color.surface.surface1,
    },
    dayRow: {
      flexDirection: "row",
    },
    invalid: {
      borderColor: tokens.color.semantic.destructiveText,
    },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tint(tokens.color.text.foreground, 0.12),
    },
    avatarText: {
      ...typeRole(tokens.typography.role.caption),
      fontWeight: tokens.typography.weight.semibold,
      color: tokens.color.text.foreground,
    },
    addRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      alignSelf: "flex-start",
      paddingRight: tokens.spacing.md,
    },
    addLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    pressed: {
      opacity: 0.6,
    },
    note: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      ...caption,
      color: tokens.color.semantic.destructiveText,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    attendees: {
      gap: tokens.spacing.xs,
      alignItems: "flex-start",
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      maxWidth: "100%",
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.control,
    },
    chipText: {
      ...caption,
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    stale: {
      gap: tokens.spacing.xs,
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      backgroundColor: tint(tokens.color.semantic.warning, 0.14),
    },
    staleText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
  });
}
