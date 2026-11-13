import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { formDeadlineLine, type FormPayload } from "@repo/chat-core/forms";
import {
  VIEW_RESPONSES_LABEL,
  cardExportFilenamePrefix,
  fetchFormResponses,
  formAnswerText,
  formChoicePercent,
  formNotRespondedLabel,
  formQuestionAnsweredLine,
  formResponsesCountLine,
  formResponsesExportRows,
  formResponsesKey,
  summarizeFormResponses,
  type FormResponses,
  type MemberLabel,
} from "@repo/chat-core/form-responses";
import {
  actorLabel,
  useFrappClient,
  useNow,
  type NameResolver,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import { useFocusOnOpen } from "@/lib/overlay";
import { shareCsv } from "@/lib/chat/share-csv";
import { IconButton } from "@/components/icon-button";
import { CloseGlyph, ShareGlyph } from "@/components/control-glyphs";
import { SheetPrimaryButton } from "@/components/sheet-scaffold";
import { Segmented } from "@/components/segmented";
import { meterStyles } from "@/components/meter";
import {
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";

/**
 * A form's responses, for the member who posted it (#3926 step 4), the
 * phone's twin of web's `FormResponsesDialog`
 * (`apps/web/components/chat/form-responses-dialog.tsx`), as Google Forms'
 * Responses tab shows its owner: a **Summary** per question (each option's
 * count with a bar, each text answer listed), an **Individual** list of each
 * person's answers, who hasn't answered yet, and **Export**, which hands the
 * same rows web exports to the share sheet as a CSV (`shareCsv`). Only the
 * creator gets here: the card offers it to them alone (`isFormCreator`), and
 * the API refuses anyone else.
 *
 * Drawn by the form page's host (`FormFillPage` with `mode: "responses"`),
 * an overlay in the thread's own view tree for the reason the form page is
 * one: the card's row is virtualized, and a page it owned would close when
 * a new message scrolled it away.
 *
 * Names are the label each member has everywhere else (`actorLabel`), and
 * the answers are read fresh on every open (no `staleTime`): they keep
 * arriving and nothing pushes them.
 */
type ResponsesTab = "summary" | "individual";

const TABS = [
  { value: "summary", label: "Summary" },
  { value: "individual", label: "Individual" },
] as const;

export function FormResponsesPage({
  messageId,
  payload,
  nameFor,
  onDone,
}: {
  messageId: string;
  payload: FormPayload;
  nameFor: NameResolver;
  onDone: () => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens, brand), [tokens, brand]);
  const apiClient = useFrappClient();
  const now = useNow();
  const deadline = formDeadlineLine(payload, now);
  const query = useQuery({
    queryKey: formResponsesKey(messageId),
    queryFn: () => fetchFormResponses(apiClient, messageId),
    refetchOnMount: "always",
  });
  const data = query.data;
  const count = data?.responses.length ?? 0;
  const labelOf: MemberLabel = (id) => actorLabel(id, nameFor) ?? "A member";
  const [tab, setTab] = useState<ResponsesTab>("summary");
  const [exporting, setExporting] = useState(false);

  const heading = useRef<View>(null);
  useFocusOnOpen(heading, true);

  const exportResponses = async () => {
    if (!data || exporting) return;
    setExporting(true);
    const ok = await shareCsv(
      formResponsesExportRows(payload, data.responses, labelOf),
      cardExportFilenamePrefix("form", payload.title),
      "Export responses",
    );
    setExporting(false);
    if (!ok) Alert.alert("Couldn't export", "Try again in a moment.");
  };

  return (
    <View accessibilityViewIsModal style={styles.fill}>
      <SafeAreaView
        style={styles.flex}
        edges={["top", "left", "right", "bottom"]}
      >
        <View style={styles.header}>
          <View
            ref={heading}
            accessible
            accessibilityRole="header"
            style={styles.headerText}
          >
            <Text style={styles.eyebrow}>
              {VIEW_RESPONSES_LABEL}
              {deadline ? ` · ${deadline}` : ""}
            </Text>
          </View>
          <IconButton label="Close responses" onPress={onDone}>
            <CloseGlyph color={tokens.color.text.foreground} />
          </IconButton>
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={styles.body}>
          <Text style={styles.title}>{payload.title}</Text>
          <Text style={styles.notice}>
            {data ? formResponsesCountLine(count) : "Loading responses…"}
          </Text>
          {data ? (
            <>
              <Segmented<ResponsesTab>
                options={TABS}
                value={tab}
                onChange={setTab}
                accessibilityLabel="Show responses as"
              />
              {count === 0 ? (
                <Text style={styles.notice}>No one has answered yet.</Text>
              ) : tab === "summary" ? (
                <Summary
                  payload={payload}
                  data={data}
                  styles={styles}
                  brand={brand}
                />
              ) : (
                <Individual
                  payload={payload}
                  data={data}
                  labelOf={labelOf}
                  styles={styles}
                />
              )}
              {data.not_responded.length > 0 ? (
                <View style={styles.section}>
                  <Text accessibilityRole="header" style={styles.sectionTitle}>
                    {formNotRespondedLabel(data.not_responded.length)}
                  </Text>
                  <Text style={styles.muted}>
                    {data.not_responded.map(labelOf).join(", ")}
                  </Text>
                </View>
              ) : null}
            </>
          ) : query.isPending ? (
            // A question's shape, a title over its bars, so the page doesn't
            // jump when the answers land (components.md §10).
            <SkeletonRegion label="Loading responses" style={styles.list}>
              {payload.questions.map((question) => (
                <View key={question.id} style={styles.item}>
                  <SkeletonText
                    role={tokens.typography.role.body}
                    width="60%"
                  />
                  <SkeletonBlock
                    width="100%"
                    height={tokens.touch.minimum}
                    radius={tokens.radius.control}
                  />
                </View>
              ))}
            </SkeletonRegion>
          ) : (
            <View style={styles.loading}>
              <Text accessibilityRole="alert" style={styles.error}>
                {query.error?.message ?? "Couldn't load the responses"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try again"
                onPress={() => void query.refetch()}
                style={styles.linkButton}
              >
                <Text style={styles.linkText}>Try again</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <SheetPrimaryButton
            label={exporting ? "Exporting…" : "Export"}
            onPress={() => void exportResponses()}
            disabled={count === 0 || exporting}
            busy={exporting}
            accessibilityHint={
              count === 0 ? "Exports once someone has answered." : undefined
            }
            icon={(color) => <ShareGlyph color={color} />}
            accent={brand.accent}
            onAccent={tokens.color.gold.onHouse}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function Summary({
  payload,
  data,
  styles,
  brand,
}: {
  payload: FormPayload;
  data: FormResponses;
  styles: Styles;
  brand: ChapterBranding;
}) {
  const summary = useMemo(
    () => summarizeFormResponses(payload, data.responses),
    [payload, data.responses],
  );
  const total = data.responses.length;
  return (
    <View style={styles.list}>
      {summary.map(({ question, answered, choices, texts }, index) => (
        <View key={question.id} style={styles.panel}>
          <View>
            <Text accessibilityRole="header" style={styles.questionTitle}>
              {index + 1}. {question.title}
            </Text>
            <Text style={styles.caption}>
              {formQuestionAnsweredLine(answered, total)}
            </Text>
          </View>
          {choices
            ? choices.map((choice) => {
                const percent = formChoicePercent(choice.count, answered);
                return (
                  <View
                    key={choice.id}
                    accessible
                    accessibilityLabel={`${choice.label}: ${choice.count}, ${percent}%`}
                  >
                    <View style={styles.choiceRow}>
                      <Text style={styles.choiceLabel}>{choice.label}</Text>
                      <Text style={styles.count}>
                        {choice.count} · {percent}%
                      </Text>
                    </View>
                    <View style={styles.meterTrack}>
                      <View
                        style={[
                          styles.meterFill,
                          {
                            width: `${percent}%`,
                            backgroundColor: brand.accentPrimary,
                          },
                        ]}
                      />
                    </View>
                  </View>
                );
              })
            : texts && texts.length > 0
              ? texts.map((text, i) => (
                  <Text key={i} style={styles.textAnswer}>
                    {text}
                  </Text>
                ))
              : null}
        </View>
      ))}
    </View>
  );
}

function Individual({
  payload,
  data,
  labelOf,
  styles,
}: {
  payload: FormPayload;
  data: FormResponses;
  labelOf: MemberLabel;
  styles: Styles;
}) {
  return (
    <View style={styles.list}>
      {data.responses.map((response) => (
        <View key={response.user_id} style={styles.panel}>
          <Text accessibilityRole="header" style={styles.questionTitle}>
            {labelOf(response.user_id)}
          </Text>
          {payload.questions.map((question, index) => {
            const text = formAnswerText(
              question,
              response.answers[question.id],
            );
            return (
              <View key={question.id}>
                <Text style={styles.caption}>
                  {index + 1}. {question.title}
                </Text>
                <Text style={text ? styles.answer : styles.muted}>
                  {text || "No answer"}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    fill: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: tokens.color.surface.background,
    },
    flex: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      minHeight: tokens.touch.minimum,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    headerText: {
      flexShrink: 1,
    },
    eyebrow: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.lg,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    notice: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: -tokens.spacing.sm,
    },
    list: {
      gap: tokens.spacing.lg,
    },
    item: {
      gap: tokens.spacing.sm,
    },
    // Each question's summary and each person's answers sit on a card, as
    // web's are inside its raised panel, so the meter's `--background` groove
    // (`meterStyles`) recedes against it rather than vanishing into the page.
    panel: {
      gap: tokens.spacing.sm,
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.surface.card,
    },
    questionTitle: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.foreground,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    choiceRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
    },
    choiceLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    count: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    meterTrack: {
      ...meterStyles(tokens).track,
      marginTop: tokens.spacing.xs,
    },
    meterFill: meterStyles(tokens).fill,
    textAnswer: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      backgroundColor: tokens.color.surface.popover,
      borderRadius: tokens.radius.control,
      paddingHorizontal: tokens.spacing.md - 2,
      paddingVertical: tokens.spacing.sm,
    },
    answer: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    muted: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    section: {
      gap: tokens.spacing.xs,
      marginTop: tokens.spacing.sm,
    },
    sectionTitle: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.foreground,
    },
    loading: {
      gap: tokens.spacing.sm,
      alignItems: "flex-start",
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    linkButton: {
      alignSelf: "flex-start",
      paddingVertical: tokens.spacing.xs,
    },
    linkText: {
      ...typeRole(tokens.typography.role.caption),
      color: brand.accent,
    },
    footer: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
  });
}
