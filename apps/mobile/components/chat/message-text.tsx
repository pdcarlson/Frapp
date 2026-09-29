import {
  StyleSheet,
  Text,
  type AccessibilityActionInfo,
  type StyleProp,
  type TextStyle,
} from "react-native";
import type { LinkSegment } from "@repo/chat-core/links";
import { openMessageLink } from "@/lib/chat/open-link";

/**
 * A message body with its links tappable (#2775).
 *
 * The body is drawn as the text it was typed as. Mobile renders no markdown
 * formatting yet (`spec/behavior/chat/README.md` § Text formatting says what
 * web renders that this does not), but a link is the part a member cannot
 * work around, so `linkSegments` in `@repo/chat-core/links` finds them with
 * the same `isSafeHref` rule web's renderer applies.
 *
 * A link is a nested `Text`, so it inherits the bubble's color and type and
 * is set apart by its underline alone, which reads on both the neutral
 * incoming bubble and the chapter-accent self bubble. It forwards the row's
 * long-press, since a nested `Text` with `onPress` claims the touch.
 */
export function MessageText({
  segments,
  style,
  onLongPress,
}: {
  /** `linkSegments(message.content)`, computed once by the caller. */
  segments: LinkSegment[];
  style: StyleProp<TextStyle>;
  onLongPress?: () => void;
}) {
  return (
    <Text style={style}>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          segment.text
        ) : (
          <Text
            key={index}
            accessibilityRole="link"
            onPress={() => void openMessageLink(segment.href)}
            onLongPress={onLongPress}
            style={styles.link}
          >
            {segment.text}
          </Text>
        ),
      )}
    </Text>
  );
}

const OPEN_LINK_ACTION_PREFIX = "openLink:";

/**
 * The links in a body as named accessibility actions.
 *
 * The body sits inside an accessible container (the message's actions ride
 * it, see `messageActionsA11yProps`), and an accessible container is one
 * element to a screen reader, so the nested link `Text`s inside it are not
 * separately reachable. Each link becomes an action instead, "Open <link>",
 * in the iOS actions rotor and TalkBack's actions menu.
 */
export function linkA11yActions(
  segments: LinkSegment[],
): AccessibilityActionInfo[] {
  return segments.flatMap((segment, index) =>
    segment.kind === "link"
      ? [
          {
            name: `${OPEN_LINK_ACTION_PREFIX}${index}`,
            label: `Open ${segment.text}`,
          },
        ]
      : [],
  );
}

/** Runs a `linkA11yActions` action; `false` when the name is not one of them. */
export function runLinkA11yAction(
  segments: LinkSegment[],
  actionName: string,
): boolean {
  if (!actionName.startsWith(OPEN_LINK_ACTION_PREFIX)) return false;
  const segment =
    segments[Number(actionName.slice(OPEN_LINK_ACTION_PREFIX.length))];
  if (segment?.kind !== "link") return false;
  void openMessageLink(segment.href);
  return true;
}

const styles = StyleSheet.create({
  link: {
    textDecorationLine: "underline",
  },
});
