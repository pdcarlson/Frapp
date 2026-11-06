import { Alert, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Path } from "react-native-svg";
import {
  HIDE_SETUP_CHECKLIST_LABEL,
  SETUP_CHECKLIST_TITLE,
  SETUP_CHECKLIST_WEB_PATH,
  useChapterSetupChecklist,
  type SetupChecklist,
  type SetupChecklistKey,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  type ChapterBranding,
  useChapterBranding,
} from "@/lib/chapter-branding";
import { asRoute } from "@/lib/href";
import { webAppOrigin } from "@/lib/onboarding/chapter-wizard/invite-link";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { IconButton } from "@/components/icon-button";
import { CloseGlyph } from "@/components/control-glyphs";
import { Frame, paint } from "@/components/more/more-glyphs";

/**
 * The officer setup checklist on Chat home (`spec/product/modules.md`
 * § Setup checklist), the phone's half of the web rail's list. It sits under
 * UP NEXT and above the channels, drawn the way UP NEXT is (an eyebrow over
 * rows), so it reads as one more strip of chrome and not a card.
 *
 * The phone can upload a document, so that line opens Documents, where the
 * upload sheet is. It has no screen for inviting, scheduling, study zones or
 * dues, so those lines open the same page of the web app in the in-app
 * browser, and say so before the tap, the way Settings' Study zones row says
 * where zones are managed.
 */

/** Lines the phone does itself, and the route that does it. */
export const SETUP_CHECKLIST_APP_ROUTE: Partial<
  Record<SetupChecklistKey, string>
> = {
  document: "/documents",
};

/** The trailing note on a line that opens the web app. */
export const SETUP_CHECKLIST_WEB_NOTE = "Web";

export const SETUP_CHECKLIST_OPEN_FAILED_TITLE = "Couldn't open the web app";
export const SETUP_CHECKLIST_OPEN_FAILED_BODY =
  "Sign in at app.frapp.live on a computer to finish this step.";

export function setupChecklistWebUrl(
  key: SetupChecklistKey,
  origin: string = webAppOrigin(),
): string {
  return `${origin}${SETUP_CHECKLIST_WEB_PATH[key]}`;
}

export function SetupChecklistSection() {
  const { checklist, hide } = useChapterSetupChecklist();
  if (!checklist) return null;
  return <SetupChecklistView checklist={checklist} onHide={hide} />;
}

/** The drawn list, without the data hook, so a test can render one. */
export function SetupChecklistView({
  checklist,
  onHide,
}: {
  checklist: SetupChecklist;
  onHide: () => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const router = useRouter();

  function open(key: SetupChecklistKey) {
    const route = SETUP_CHECKLIST_APP_ROUTE[key];
    if (route) {
      router.push(asRoute(route));
      return;
    }
    WebBrowser.openBrowserAsync(setupChecklistWebUrl(key)).catch(() =>
      Alert.alert(
        SETUP_CHECKLIST_OPEN_FAILED_TITLE,
        SETUP_CHECKLIST_OPEN_FAILED_BODY,
      ),
    );
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
            accessibilityHint={
              onWeb ? "Opens this step in the web app." : undefined
            }
            onPress={() => open(line.key)}
            style={styles.row}
          >
            <View
              style={[styles.mark, line.done ? styles.markDone : null]}
              accessible={false}
            >
              {line.done ? <DoneGlyph color={brand.accent} /> : null}
            </View>
            <Text
              numberOfLines={1}
              style={[styles.label, line.done ? styles.labelDone : null]}
            >
              {line.label}
            </Text>
            {onWeb && !line.done ? (
              <Text style={styles.note}>{SETUP_CHECKLIST_WEB_NOTE}</Text>
            ) : null}
          </PressableRow>
        );
      })}
    </View>
  );
}

/** A check inside the 16pt mark, the same stroke recipe as the controls. */
function DoneGlyph({ color }: { color: string }) {
  const { detail } = paint({ color });
  return (
    <Frame size={12}>
      <Path d="M5 12.5l4.5 4.5L19 7.5" {...detail} />
    </Frame>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
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
    // A done line is a switched-on control, one of the accent's places.
    markDone: {
      backgroundColor: brand.accentSubtle,
      borderColor: brand.accentBorder,
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
