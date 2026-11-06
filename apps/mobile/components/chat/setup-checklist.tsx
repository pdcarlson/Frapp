import { useRef } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  HIDE_SETUP_CHECKLIST_LABEL,
  SETUP_CHECKLIST_TITLE,
  SETUP_CHECKLIST_WEB_PATH,
  type SetupChecklist,
  type SetupChecklistKey,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { asRoute } from "@/lib/href";
import { webAppOrigin } from "@/lib/onboarding/chapter-wizard/invite-link";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { IconButton } from "@/components/icon-button";
import { CloseGlyph } from "@/components/control-glyphs";
import { CheckGlyph } from "@/components/tasks/task-glyphs";

/**
 * The officer setup checklist on Chat home (`spec/product/modules.md`
 * § Setup checklist), the phone's half of the web rail's list. It sits under
 * UP NEXT and above the channels, drawn the way UP NEXT is (an eyebrow over
 * rows), so it reads as one more strip of chrome and not a card.
 *
 * The phone can upload a document and schedule an event, so those lines open
 * Documents and Events, where the upload and New event sheets are. It has no
 * screen for inviting or study zones, so those lines open the same page of the web app in the in-app browser, and
 * say so before the tap, the way Settings' Study zones row says where zones
 * are managed. It never draws dues ({@link MOBILE_SETUP_CHECKLIST_OMIT}).
 *
 * Chat home calls the hook itself and hands the result in, so its pull to
 * refresh can re-read the lists too.
 */

/**
 * Dues stays off the phone. Its web page is where the chapter's Frapp plan is
 * bought, which the app must not link to (apps/mobile/store/README.md, Review
 * notes), and counting it would cache every member's invoices on a
 * treasurer's phone, which the Dues tab's scoped read exists to prevent.
 */
export const MOBILE_SETUP_CHECKLIST_OMIT = ["dues"] as const;

/** Lines the phone does itself, and the route that does it. */
export const SETUP_CHECKLIST_APP_ROUTE: Partial<
  Record<SetupChecklistKey, string>
> = {
  document: "/documents",
  event: "/events",
};

/** The trailing note on a line that opens the web app. */
export const SETUP_CHECKLIST_WEB_NOTE = "Web";

export const SETUP_CHECKLIST_OPEN_FAILED_TITLE = "Couldn't open the web app";
export const SETUP_CHECKLIST_WEB_HINT = "Opens this step in the web app.";

/** Names the host the line would have opened, which a build can change. */
export function setupChecklistOpenFailedBody(
  origin: string = webAppOrigin(),
): string {
  return `Sign in at ${origin.replace(/^https?:\/\//, "")} on a computer to finish this step.`;
}

export function setupChecklistWebUrl(
  key: SetupChecklistKey,
  origin: string = webAppOrigin(),
): string {
  return `${origin}${SETUP_CHECKLIST_WEB_PATH[key]}`;
}

/** The drawn list. Chat home owns the hook and passes its result in. */
export function SetupChecklistView({
  checklist,
  onHide,
  onReturnFromWeb,
}: {
  checklist: SetupChecklist;
  onHide: () => void;
  /**
   * Runs when the in-app browser closes, since the officer may have just
   * done the step there: on iOS the browser never takes the app out of the
   * foreground, so nothing else re-reads the lists.
   */
  onReturnFromWeb: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  // A second tap while the browser is up rejects ("already open"), which
  // would read as a failure to open it.
  const browserOpen = useRef(false);

  function open(key: SetupChecklistKey) {
    const route = SETUP_CHECKLIST_APP_ROUTE[key];
    if (route) {
      router.push(asRoute(route));
      return;
    }
    if (browserOpen.current) return;
    browserOpen.current = true;
    WebBrowser.openBrowserAsync(setupChecklistWebUrl(key))
      .then(onReturnFromWeb, () =>
        Alert.alert(
          SETUP_CHECKLIST_OPEN_FAILED_TITLE,
          setupChecklistOpenFailedBody(),
        ),
      )
      .finally(() => {
        browserOpen.current = false;
      });
  }

  return (
    <View style={styles.strip}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.eyebrow}>
          {SETUP_CHECKLIST_TITLE}
        </Text>
        <Text style={styles.count}>
          {checklist.doneCount} of {checklist.lines.length}
        </Text>
        <IconButton label={HIDE_SETUP_CHECKLIST_LABEL} onPress={onHide}>
          <CloseGlyph color={tokens.color.text.muted} size={16} />
        </IconButton>
      </View>

      {checklist.lines.map((line) => {
        const onWeb = !SETUP_CHECKLIST_APP_ROUTE[line.key];
        return (
          <PressableRow
            key={line.key}
            accessibilityRole="button"
            accessibilityLabel={line.done ? `${line.label}, done` : line.label}
            accessibilityHint={onWeb ? SETUP_CHECKLIST_WEB_HINT : undefined}
            onPress={() => open(line.key)}
            style={styles.row}
          >
            <View
              style={[styles.mark, line.done ? styles.markDone : null]}
              accessible={false}
            >
              {line.done ? (
                <CheckGlyph color={tokens.color.text.muted} size={10} />
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={[styles.label, line.done ? styles.labelDone : null]}
            >
              {line.label}
            </Text>
            {onWeb ? (
              <Text style={styles.note}>{SETUP_CHECKLIST_WEB_NOTE}</Text>
            ) : null}
          </PressableRow>
        );
      })}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    strip: {
      gap: tokens.spacing.xs,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    eyebrow: {
      ...typeRole(tokens.typography.role.caption),
      flex: 1,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    count: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      // As UP NEXT's rows: the 44pt floor from minHeight, not padding.
      minHeight: tokens.touch.minimum,
      ...gutterBleed(tokens),
    },
    mark: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      alignItems: "center",
      justifyContent: "center",
    },
    // Done is the quietest thing on the list (foundations.md, accent rule:
    // a done state takes a muted check, never the accent).
    markDone: {
      backgroundColor: tokens.color.surface.card,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      flex: 1,
      color: tokens.color.text.foreground,
    },
    labelDone: {
      color: tokens.color.text.muted,
      textDecorationLine: "line-through",
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
