import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { randomClientId, statusOf } from "@repo/api-sdk";
import {
  selectDownloadUrl,
  useCurrentChapter,
  useDocumentDownloadUrl,
  useDocuments,
  useEventListsEditor,
  type EventLists,
} from "@repo/hooks";
import {
  agendaProblem,
  attachmentLinkProblem,
  attachmentLinkTitle,
  attachmentTitle,
  EVENT_AGENDA_ITEM_MAX,
  EVENT_AGENDA_MAX,
  EVENT_ATTACHMENT_TITLE_MAX,
  EVENT_ATTACHMENTS_MAX,
  isModuleEnabled,
  moveEventEntry,
  normalizeAgendaText,
  normalizeAttachmentUrl,
  proofLinkDomain,
  toggleAgendaItem,
  type EventAgendaItem,
  type EventAttachment,
} from "@repo/validation";
import type { SignetTokens } from "@repo/theme/signet";
import { IconButton } from "@/components/icon-button";
import {
  CheckGlyph,
  CloseGlyph,
  DisclosureGlyph,
  LinkGlyph,
} from "@/components/control-glyphs";
import { DocumentsGlyph } from "@/components/more/more-glyphs";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { eyebrowStyle } from "@/components/eyebrow";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useConnection } from "@/lib/connection/use-connection";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * An event's agenda and attachments on Event details (#4934,
 * `spec/behavior/events.md` § Agenda and attachments), web's
 * `event-agenda.tsx` on the phone. Everyone who can see the event reads
 * them, and a section with nothing in it is left out for a member. An
 * `events:update` holder edits them in place on the screen, the way Notion's
 * and Fellow's meeting agendas are a checklist on the meeting rather than a
 * field in a form: a check-off during the meeting is one tap. Both lists
 * share one editor (`useEventListsEditor`), so a run of quick changes goes
 * out as one save of this meeting's whole lists, never the series'.
 */

/** Whether Chapter Files is on: `null` while the chapter read can't say. */
export type DocumentsModule = boolean | null;

/** Chapter Files on, off, or not known yet (the chapter still loading). */
export function useDocumentsModule(): DocumentsModule {
  const chapter = useCurrentChapter().data;
  return chapter ? isModuleEnabled(chapter.enabled_modules, "documents") : null;
}

export function EventMeetingLists({
  eventId,
  lists,
  canEdit,
}: {
  eventId: string;
  lists: EventLists;
  /** Holds `events:update` (a real answer), and the event is there. */
  canEdit: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // A write that would be lost (offline, a lapsed chapter): the lists still
  // read, but no control is offered that would only be refused.
  const { writeBlockedReason } = useConnection();
  const editable = canEdit && writeBlockedReason === null;
  const documentsOn = useDocumentsModule();
  const [failed, setFailed] = useState(false);
  const editor = useEventListsEditor(eventId, lists, {
    onFailed: () => setFailed(true),
  });
  const change: typeof editor.change = (field, update) => {
    setFailed(false);
    editor.change(field, update);
  };
  return (
    <>
      <EventAgendaSection
        agenda={editor.agenda}
        canEdit={editable}
        onChange={(update) => change("agenda", update)}
      />
      <EventAttachmentsSection
        attachments={editor.attachments}
        canEdit={editable}
        documentsOn={documentsOn}
        onChange={(update) => change("attachments", update)}
      />
      {failed ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Couldn&apos;t save the agenda or attachments. Your last change was
          undone, so try it again in a moment.
        </Text>
      ) : null}
    </>
  );
}

export function EventAgendaSection({
  agenda,
  canEdit,
  onChange,
}: {
  agenda: EventAgendaItem[];
  canEdit: boolean;
  onChange: (update: (current: EventAgendaItem[]) => EventAgendaItem[]) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  if (agenda.length === 0 && !canEdit) return null;

  const muted = tokens.color.text.mutedForeground;
  const full = agenda.length >= EVENT_AGENDA_MAX;

  function add() {
    const text = normalizeAgendaText(draft);
    if (!text) return;
    const refused = agendaProblem([...agenda, { text }]);
    if (refused) {
      setProblem(refused);
      return;
    }
    setProblem(null);
    setDraft("");
    onChange((current) => [
      ...current,
      { id: randomClientId(), text, done: false },
    ]);
  }

  const move = (id: string, by: -1 | 1) =>
    onChange((current) =>
      moveEventEntry(
        current,
        current.findIndex((entry) => entry.id === id),
        by,
      ),
    );

  return (
    <View style={styles.section} accessibilityLabel="Agenda">
      <Text style={styles.sectionLabel}>AGENDA</Text>
      {agenda.map((item, index) => (
        <View key={item.id} style={styles.line}>
          {canEdit ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.done }}
              accessibilityLabel={item.text}
              onPress={() =>
                onChange((current) => toggleAgendaItem(current, item.id))
              }
              style={styles.row}
            >
              <View style={[styles.box, item.done ? styles.boxDone : null]}>
                {item.done ? <CheckGlyph color={muted} size={12} /> : null}
              </View>
              <Text style={[styles.text, item.done ? styles.textDone : null]}>
                {item.text}
              </Text>
            </Pressable>
          ) : (
            <View
              style={styles.row}
              accessible
              accessibilityLabel={
                item.done ? `Done: ${item.text}` : `${index + 1}. ${item.text}`
              }
            >
              <Text style={styles.number}>{index + 1}.</Text>
              <Text style={[styles.text, item.done ? styles.textDone : null]}>
                {item.text}
              </Text>
            </View>
          )}
          {canEdit ? (
            <View style={styles.controls}>
              <IconButton
                label={`Move "${item.text}" up`}
                disabled={index === 0}
                onPress={() => move(item.id, -1)}
              >
                <DisclosureGlyph
                  color={index === 0 ? tokens.color.text.muted : muted}
                  direction="up"
                />
              </IconButton>
              <IconButton
                label={`Move "${item.text}" down`}
                disabled={index === agenda.length - 1}
                onPress={() => move(item.id, 1)}
              >
                <DisclosureGlyph
                  color={
                    index === agenda.length - 1
                      ? tokens.color.text.muted
                      : muted
                  }
                  direction="down"
                />
              </IconButton>
              <IconButton
                label={`Remove "${item.text}"`}
                onPress={() =>
                  onChange((current) =>
                    current.filter((entry) => entry.id !== item.id),
                  )
                }
              >
                <CloseGlyph color={muted} />
              </IconButton>
            </View>
          ) : null}
        </View>
      ))}
      {canEdit && !full ? (
        <View style={[styles.ring, focused ? styles.ringActive : null]}>
          <TextInput
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              setProblem(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={
              agenda.length === 0 ? "Add the first item" : "Add an item"
            }
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Add an agenda item"
            maxLength={EVENT_AGENDA_ITEM_MAX}
            returnKeyType="done"
            // Return adds the item and keeps the keyboard up for the next,
            // as the subtask field does.
            submitBehavior="submit"
            onSubmitEditing={add}
            style={[styles.field, focused ? styles.fieldFocused : null]}
          />
        </View>
      ) : null}
      {problem ? <Text style={styles.error}>{problem}</Text> : null}
      {canEdit && full ? (
        <Text style={styles.caption}>
          An agenda holds {EVENT_AGENDA_MAX} items.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Open a Chapter Files document to read (the inline signed link, in the
 * in-app browser, as Documents opens one). A file deleted since it was
 * attached says so rather than failing generically.
 */
function useOpenDocument() {
  const signedLinks = useDocumentDownloadUrl();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // iOS refuses a second browser over the first.
  const presenting = useRef(false);
  async function open(documentId: string) {
    if (presenting.current) return;
    setProblem(null);
    setOpeningId(documentId);
    try {
      const url = selectDownloadUrl(await signedLinks.mutateAsync(documentId));
      if (!url) throw new Error("No link to the file came back.");
      presenting.current = true;
      try {
        await WebBrowser.openBrowserAsync(url);
      } finally {
        presenting.current = false;
      }
    } catch (error) {
      setProblem(
        statusOf(error) === 404
          ? "That file is gone from Chapter Files. Someone removed it after it was attached."
          : "Couldn't open that file. Try again in a moment.",
      );
    } finally {
      setOpeningId(null);
    }
  }
  return { open, openingId, problem };
}

export function EventAttachmentsSection({
  attachments,
  canEdit,
  documentsOn,
  onChange,
}: {
  attachments: EventAttachment[];
  canEdit: boolean;
  documentsOn: DocumentsModule;
  onChange: (update: (current: EventAttachment[]) => EventAttachment[]) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const { open, openingId, problem } = useOpenDocument();
  const [adding, setAdding] = useState<"link" | "document" | null>(null);
  if (attachments.length === 0 && !canEdit) return null;

  const muted = tokens.color.text.mutedForeground;
  const full = attachments.length >= EVENT_ATTACHMENTS_MAX;
  const attachedDocuments = new Set(
    attachments.flatMap((a) => (a.kind === "document" ? [a.document_id] : [])),
  );
  const add = (attachment: EventAttachment) => {
    onChange((current) =>
      current.length >= EVENT_ATTACHMENTS_MAX
        ? current
        : [...current, attachment],
    );
    setAdding(null);
  };

  return (
    <View style={styles.section} accessibilityLabel="Attachments">
      <Text style={styles.sectionLabel}>ATTACHMENTS</Text>
      {attachments.map((attachment) => {
        const isLink = attachment.kind === "link";
        // Only a chapter read that answered "off" disables a document; one
        // that can't say yet lets the server answer.
        const disabled = !isLink && (documentsOn === false || !!openingId);
        const source = isLink
          ? proofLinkDomain(attachment.url)
          : documentsOn === false
            ? "Chapter Files is off"
            : "Chapter Files";
        return (
          <View key={attachment.id} style={styles.line}>
            <Pressable
              accessibilityRole={isLink ? "link" : "button"}
              accessibilityLabel={`${attachment.title}, ${source}`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() =>
                attachment.kind === "link"
                  ? void WebBrowser.openBrowserAsync(attachment.url)
                  : void open(attachment.document_id)
              }
              style={({ pressed }) => [
                styles.row,
                pressed ? styles.pressed : null,
              ]}
            >
              {!isLink && openingId === attachment.document_id ? (
                <ActivityIndicator size="small" color={muted} />
              ) : isLink ? (
                <LinkGlyph color={muted} />
              ) : (
                <DocumentsGlyph color={muted} size={20} />
              )}
              <Text style={styles.text} numberOfLines={1}>
                {attachment.title}
              </Text>
              <Text style={styles.caption} numberOfLines={1}>
                {source}
              </Text>
            </Pressable>
            {canEdit ? (
              <View style={styles.controls}>
                <IconButton
                  label={`Remove "${attachment.title}"`}
                  onPress={() =>
                    onChange((current) =>
                      current.filter((entry) => entry.id !== attachment.id),
                    )
                  }
                >
                  <CloseGlyph color={muted} />
                </IconButton>
              </View>
            ) : null}
          </View>
        );
      })}
      {problem ? <Text style={styles.error}>{problem}</Text> : null}
      {canEdit && full ? (
        <Text style={styles.caption}>
          An event holds {EVENT_ATTACHMENTS_MAX} attachments.
        </Text>
      ) : null}
      {canEdit && !full && adding === "link" ? (
        <AddLinkForm
          onCancel={() => setAdding(null)}
          onAdd={(url, title) =>
            add({ id: randomClientId(), kind: "link", url, title })
          }
        />
      ) : null}
      {canEdit && !full && adding === "document" ? (
        <PickDocument
          attached={attachedDocuments}
          onCancel={() => setAdding(null)}
          onPick={(documentId, title) =>
            add({
              id: randomClientId(),
              kind: "document",
              document_id: documentId,
              title: attachmentTitle(title),
            })
          }
        />
      ) : null}
      {canEdit && !full && adding === null ? (
        <View style={styles.actions}>
          <TextAction label="Add a link" onPress={() => setAdding("link")} />
          {documentsOn === true ? (
            <TextAction
              label="Attach from Chapter Files"
              onPress={() => setAdding("document")}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A quiet accent text button at the 44pt floor. */
function TextAction({
  label,
  onPress,
  disabled = false,
  muted = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textAction,
        pressed || disabled ? styles.pressed : null,
      ]}
    >
      <Text
        style={[
          styles.textActionLabel,
          { color: muted ? tokens.color.text.mutedForeground : accent },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AddLinkForm({
  onAdd,
  onCancel,
}: {
  onAdd: (url: string, title: string) => void;
  onCancel: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [focused, setFocused] = useState<"url" | "title" | null>(null);

  function submit() {
    const refused = attachmentLinkProblem(url);
    const normalized = normalizeAttachmentUrl(url);
    if (refused || !normalized) {
      setProblem(refused ?? "Paste a web address.");
      return;
    }
    onAdd(normalized, attachmentLinkTitle(title, normalized));
  }

  return (
    <View style={styles.form}>
      <View style={[styles.ring, focused === "url" ? styles.ringActive : null]}>
        <TextInput
          value={url}
          onChangeText={(text) => {
            setUrl(text);
            setProblem(null);
          }}
          onFocus={() => setFocused("url")}
          onBlur={() => setFocused(null)}
          placeholder="https://"
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel="Link"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="next"
          style={[
            styles.field,
            focused === "url" ? styles.fieldFocused : null,
            problem ? styles.fieldError : null,
          ]}
        />
      </View>
      <View
        style={[styles.ring, focused === "title" ? styles.ringActive : null]}
      >
        <TextInput
          value={title}
          onChangeText={setTitle}
          onFocus={() => setFocused("title")}
          onBlur={() => setFocused(null)}
          placeholder="Title (optional)"
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel="Title"
          maxLength={EVENT_ATTACHMENT_TITLE_MAX}
          returnKeyType="done"
          onSubmitEditing={submit}
          style={[
            styles.field,
            focused === "title" ? styles.fieldFocused : null,
          ]}
        />
      </View>
      {problem ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {problem}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <TextAction label="Add link" disabled={!url.trim()} onPress={submit} />
        <TextAction label="Cancel" muted onPress={onCancel} />
      </View>
    </View>
  );
}

function PickDocument({
  attached,
  onPick,
  onCancel,
}: {
  attached: ReadonlySet<string>;
  onPick: (documentId: string, title: string) => void;
  onCancel: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const documents = useDocuments();
  const muted = tokens.color.text.mutedForeground;
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (documents.data ?? [])
      .filter((doc) => !attached.has(doc.id))
      .filter((doc) => !needle || doc.title.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [documents.data, search, attached]);

  return (
    <View style={styles.form}>
      <View style={[styles.ring, focused ? styles.ringActive : null]}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Find a file in Chapter Files"
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel="Find a file in Chapter Files"
          autoFocus
          returnKeyType="search"
          style={[styles.field, focused ? styles.fieldFocused : null]}
        />
      </View>
      {documents.isPending ? (
        <Text style={styles.caption}>Loading files…</Text>
      ) : documents.isError ? (
        <Text style={styles.caption}>
          Couldn&apos;t load Chapter Files. Try again in a moment.
        </Text>
      ) : matches.length === 0 ? (
        <Text style={styles.caption}>
          {search.trim()
            ? "No file matches that."
            : "Chapter Files has nothing to attach yet. Upload it there first."}
        </Text>
      ) : (
        matches.map((doc) => (
          <Pressable
            key={doc.id}
            accessibilityRole="button"
            accessibilityLabel={`Attach ${doc.title}`}
            onPress={() => onPick(doc.id, doc.title)}
            style={({ pressed }) => [
              styles.row,
              pressed ? styles.pressed : null,
            ]}
          >
            <DocumentsGlyph color={muted} size={20} />
            <Text style={styles.text} numberOfLines={1}>
              {doc.title}
            </Text>
            {doc.folder ? (
              <Text style={styles.caption} numberOfLines={1}>
                {doc.folder}
              </Text>
            ) : null}
          </Pressable>
        ))
      )}
      <View style={styles.actions}>
        <TextAction label="Cancel" muted onPress={onCancel} />
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens, accent?: string) {
  const fieldStyles = sheetFieldStyles(
    tokens,
    accent ?? tokens.color.text.foreground,
  );
  return StyleSheet.create({
    // Event details' DETAILS and NOTES sections: an eyebrow over the body.
    section: {
      gap: tokens.spacing.xs,
    },
    sectionLabel: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.muted,
    },
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    row: {
      flex: 1,
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    controls: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    box: {
      width: 18,
      height: 18,
      borderRadius: tokens.radius.chip,
      borderWidth: 1.5,
      borderColor: tint(tokens.color.text.foreground, 0.25),
      alignItems: "center",
      justifyContent: "center",
    },
    boxDone: {
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.popover,
    },
    number: {
      minWidth: 18,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    text: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    textDone: {
      color: tokens.color.text.mutedForeground,
      textDecorationLine: "line-through",
    },
    caption: {
      flexShrink: 1,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    form: {
      gap: tokens.spacing.sm,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: tokens.spacing.lg,
    },
    textAction: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    textActionLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    pressed: {
      opacity: 0.7,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: fieldStyles.field,
    fieldFocused: fieldStyles.fieldFocused,
    fieldError: {
      borderColor: tokens.color.semantic.destructive,
    },
  });
}
