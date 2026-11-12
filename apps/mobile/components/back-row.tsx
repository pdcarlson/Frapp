import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { SignetTokens } from "@repo/theme/signet";
import { BackGlyph } from "@/components/control-glyphs";
import { GlassSurface } from "@/components/glass-surface";
import { useScreenBelow } from "@/lib/back-target";
import { goBackTo } from "@/lib/href";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** The capsule as drawn: 36pt tall and fully round. */
export const BACK_CAPSULE_HEIGHT = 36;

/**
 * The row's touch target, 44pt (`touch.minimum`), with the capsule centred in
 * it. The target is the row itself rather than a hit slop, because the glass
 * clips to its capsule and a slop outside a clipping parent takes no touches.
 */
export const BACK_ROW_HEIGHT = 44;

/**
 * Top padding a screen's scrolling content takes under a pinned row: the row's
 * offset, its height and the gap to the title. The capsule lands where an
 * in-flow row's would, 8pt down with 12pt under it.
 */
export function pinnedBackClearance(tokens: SignetTokens): number {
  return tokens.spacing.xs + BACK_ROW_HEIGHT + tokens.spacing.sm;
}

/**
 * Where a back row leads when nothing is under its screen (a cold link with
 * no stack behind it, in practice never, since the tabs are anchored under
 * every pushed screen): the name it shows, and the route it opens. With a
 * screen under it, the row pops to that screen and names it instead
 * (`lib/back-target.ts`).
 */
export type BackTarget = {
  /** The destination's name, as its tab or screen title reads ("More"). */
  label: string;
  href: Href;
};

/** s10–s13, s15, s16 and Service hours, each opened from a More row. */
export const BACK_TO_MORE: BackTarget = { label: "More", href: "/more" };
/** What's new, opened from a Settings row. */
export const BACK_TO_SETTINGS: BackTarget = {
  label: "Settings",
  href: "/preferences",
};
/** Chapter settings' Roles, and their pages, opened from Chapter settings (#4074). */
export const BACK_TO_CHAPTER_SETTINGS: BackTarget = {
  label: "Chapter settings",
  href: "/chapter-settings",
};
/** A tier's or a role's page, opened from Roles (#4074). */
export const BACK_TO_ROLES: BackTarget = {
  label: "Roles",
  href: "/chapter-roles",
};
/** s07, opened from an Events row (and from Chat home's Up next). */
export const BACK_TO_EVENTS: BackTarget = { label: "Events", href: "/events" };
/**
 * s14. The board draws `‹ More`, but the inbox's entry is the bell on Chat
 * home since #3362, so its way back is Chat.
 */
export const BACK_TO_CHAT: BackTarget = { label: "Chat", href: "/" };
/** Invite members, opened from the Directory's + rather than a More row. */
export const BACK_TO_DIRECTORY: BackTarget = {
  label: "Directory",
  href: "/directory",
};

type BackRowProps = {
  label: string;
  /**
   * A control at the row's far end, where the board draws s15's Edit
   * (`‹ More` … `Edit`), and setup its progress ticks.
   * Optional; every other screen draws the row alone.
   */
  trailing?: ReactNode;
  /** House gold instead of the chapter accent, for a row in `(auth)`. */
  house?: boolean;
  /** Dims the row and ignores taps, as while a sign-in or a join is in flight. */
  disabled?: boolean;
  /** Defaults to `Back to <label>`; a step-back row names where it steps to. */
  accessibilityLabel?: string;
} & (
  | { href: Href; onPress?: never }
  | {
      /** A step back the screen owns, in place of navigating to `href`. */
      onPress: () => void;
      href?: never;
    }
);

/**
 * The `‹ More` / `‹ Events` row the Canvas board draws above the title on a
 * screen reached from another one (s07, s10–s16, `canvas-screens.dc.html`).
 * `spec/ui/mobile/navigation.md` § Back rows owns the rule.
 *
 * It goes back through the stack, exactly as the iOS edge swipe and Android's
 * back do, and names the screen it returns to (`useScreenBelow`): `‹ Events`
 * over an event opened from Events, `‹ Chat` over the same event opened from
 * Chat home's Up next. A row that went somewhere other than the swipe would
 * be two answers to "back", and a label that names where it goes is one a
 * member can trust. The `label` and `href` a screen passes are the fallback
 * for a screen with nothing under it, which the anchored tabs make rare
 * (`spec/ui/mobile/navigation.md` § Going back).
 *
 * A glass capsule, `‹ Events` in a bubble of its own (owner ask 2026-11-05,
 * `spec/ui/mobile/navigation.md` § Back rows). `ScreenShell` pins it at the
 * top left so it never scrolls away; a screen that draws the row inline (the
 * auth steps) gets the same capsule in place.
 *
 * The arrow is the chapter accent, as s05's `‹` and the active tab are, and
 * the name is foreground. The board bakes house gold here because its mock
 * chapter is gold; the owner's rule (2026-11-04, `spec/behavior/branding.md`)
 * puts the accent on every back arrow inside a chapter, and keeps house gold
 * for places with no chapter.
 *
 * Sign-in, join, setup and the chapter picker draw the same row (`‹ Back`,
 * `‹ More`), as the board's s02 does. They pass `house`, because `(auth)` has
 * no chapter to take an accent from, and `onPress`, because their way back is
 * a step inside one route (the email form to the providers, the confirm step
 * to the field), not a tab to open. Two leave their route instead: setup's
 * find step goes back to what opened it (`router.back()`, or `/join` with
 * nothing behind it), and the picker's `‹ More` is its own `router.back()`.
 */
export function BackRow(props: BackRowProps) {
  // Two components rather than a branch inside one: a house row never reads
  // the chapter, so sign-in doesn't ask for a current chapter it can't have.
  return props.house ? (
    <HouseBackRow {...props} />
  ) : (
    <ChapterBackRow {...props} />
  );
}

function ChapterBackRow(props: BackRowProps) {
  const { accent } = useChapterBranding();
  return <BackRowView {...props} color={accent} />;
}

function HouseBackRow(props: BackRowProps) {
  const { tokens } = useFrappTheme();
  // `askText` is the gold the board draws its `‹` rows in (s02's `‹ Back`).
  return <BackRowView {...props} color={tokens.color.gold.askText} />;
}

function BackRowView({
  label,
  href,
  onPress,
  trailing,
  disabled = false,
  accessibilityLabel,
  color,
}: BackRowProps & { color: string }) {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // A step-back row (`onPress`) steps inside its own route; only a row that
  // leaves the screen goes back through the stack.
  const below = useScreenBelow();
  const popsTo = onPress ? null : below;
  const shown = popsTo ? popsTo.title : label;
  // Held state drives the capsule's lift. The glass, not the target, is what
  // lifts, so the feedback keeps the capsule's shape on every platform rather
  // than an Android ripple filling the 44pt rectangle around it.
  const [held, setHeld] = useState(false);

  return (
    <View style={styles.row} testID="back-row">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `Back to ${shown}`}
        accessibilityState={disabled ? { disabled } : undefined}
        disabled={disabled}
        onPressIn={() => setHeld(true)}
        onPressOut={() => setHeld(false)}
        onPress={() => {
          if (onPress) onPress();
          else if (popsTo) popsTo.goBack();
          else if (href) goBackTo(router, href);
        }}
        style={styles.target}
      >
        <GlassSurface
          style={[
            styles.capsule,
            held && !disabled ? styles.held : null,
            disabled ? styles.disabled : null,
          ]}
        >
          <View style={styles.content}>
            <BackGlyph color={color} size={18} />
            <Text style={styles.text}>{shown}</Text>
          </View>
        </GlassSurface>
      </Pressable>
      {trailing}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
      // The 44pt target already carries 4pt of air under the capsule.
      marginBottom: tokens.spacing.xs,
    },
    target: {
      alignSelf: "flex-start",
      minHeight: BACK_ROW_HEIGHT,
      justifyContent: "center",
    },
    capsule: {
      height: BACK_CAPSULE_HEIGHT,
      borderRadius: BACK_CAPSULE_HEIGHT / 2,
    },
    // A press lifts the glass to the popover step, as a list row lifts.
    held: {
      backgroundColor: tokens.color.surface.popover,
    },
    content: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      // Tighter on the arrow's side, as drawn, so the glyph sits in the curve.
      paddingLeft: tokens.spacing.sm,
      paddingRight: tokens.spacing.md,
    },
    // The whole capsule dims while it holds: a control that can't respond looks it.
    disabled: {
      opacity: 0.5,
    },
    text: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}

/**
 * A back capsule pinned over a screen's top left, so the way back never
 * scrolls away (`spec/ui/mobile/navigation.md` § Back rows). Render it inside
 * a plain View that fills the safe area's content box, before the scroll
 * view: first in the tree, so a screen reader meets it before the title, and
 * `zIndex` draws it over the content that scrolls under it. The scroll view's
 * content takes `pinnedBackClearance` at its top.
 *
 * It reads no insets. An absolute child ignores its parent's padding, so a
 * `SafeAreaView` parent would put it under the notch, and adding
 * `useSafeAreaInsets().top` by hand double-counts whenever something above
 * the screen has already taken the inset and the native safe area pads 0.
 * Inside an unpadded View within the safe area, it sits where the content
 * starts whatever pushed it there. (The connection pill no longer pushes
 * anything: it floats over the screen, `components/network-banner.tsx`.)
 */
export function PinnedBackRow({
  back,
  trailing,
}: {
  back: BackTarget;
  trailing?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  return (
    <View
      style={{
        position: "absolute",
        zIndex: 1,
        top: tokens.spacing.xs,
        left: tokens.spacing.lg,
        right: tokens.spacing.lg,
      }}
      pointerEvents="box-none"
    >
      <BackRow label={back.label} href={back.href} trailing={trailing} />
    </View>
  );
}
