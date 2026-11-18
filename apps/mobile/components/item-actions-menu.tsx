import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { SignetTokens } from "@repo/theme/signet";
import { GlassMenu, glassMenuRowStyles } from "@/components/glass-menu";
import { pressHaptic } from "@/lib/haptics";
import { type FocusReturn, focusReturnOf, useFocusOnOpen } from "@/lib/overlay";
import { useFrappTheme } from "@/lib/theme";

/**
 * A row's long-press menu (#5492; owner, 2026-11-18: "tap and hold on it and
 * then maybe edit details, reassign, delete"): the glass menu chat home's
 * channel rows open (`GlassMenu`), with a task's or an event's actions in it,
 * as Apple Mail's and Reminders' rows and Things 3's and Todoist's items open
 * theirs. Which actions a row gets is its kind's call (`useTaskMenu`,
 * `useEventMenu`); this draws them and holds the one open.
 *
 * Each row is its label with its glyph at the trailing edge, as iOS's own
 * menus draw them. A destructive action is red and comes last, under the
 * thicker break, so Delete is never the row right under the thumb. A pick
 * closes the menu, then runs.
 *
 * VoiceOver and TalkBack can't long-press, so a row with a menu offers each
 * of its actions by name as well (`itemMenuAccessibility`), one swipe away.
 */

export interface ItemMenuAction {
  /** Unique in its menu; the accessibility action is named after it. */
  key: string;
  label: string;
  /** The glyph, drawn in the row's colour. */
  glyph: (color: string) => ReactNode;
  /** Red, last, under the break. */
  destructive?: boolean;
  run: () => void;
}

export interface ItemMenu {
  /** What was pressed, as the row names it: the menu's caption. */
  title: string;
  actions: ItemMenuAction[];
}

/** What a row takes: its menu, and how to open it at the press. */
export interface ItemMenuHandle extends ItemMenu {
  /**
   * Opens beside `pageY`, or a third of the way down without one. `trigger`
   * is the row, which gets a screen reader's focus back on close.
   */
  open: (pageY?: number, trigger?: FocusReturn | null) => void;
}

/** A row's long press, reading where it landed. */
export function longPressOf(
  menu: ItemMenuHandle | null | undefined,
): ((event?: GestureResponderEvent) => void) | undefined {
  if (!menu) return undefined;
  return (event) => menu.open(event?.nativeEvent?.pageY, focusReturnOf(event));
}

/** The prefix a menu action's accessibility name carries. */
const MENU_ACTION = "menu:";

/**
 * A row's named accessibility actions: its own (a task row's checkbox), then
 * each of its menu's, run directly. A menu action with the same words as one
 * of the row's own is left out, so Mark done is offered once.
 */
export function itemMenuAccessibility(
  menu: ItemMenuHandle | null | undefined,
  own: { name: string; label: string; run: () => void }[] = [],
): {
  accessibilityActions?: { name: string; label: string }[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
} {
  const labels = new Set(own.map((action) => action.label));
  const fromMenu = (menu?.actions ?? []).filter(
    (action) => !labels.has(action.label),
  );
  if (own.length === 0 && fromMenu.length === 0) return {};
  return {
    accessibilityActions: [
      ...own.map(({ name, label }) => ({ name, label })),
      ...fromMenu.map((action) => ({
        name: `${MENU_ACTION}${action.key}`,
        label: action.label,
      })),
    ],
    onAccessibilityAction: (event) => {
      const name = event.nativeEvent.actionName;
      own.find((action) => action.name === name)?.run();
      fromMenu.find((action) => `${MENU_ACTION}${action.key}` === name)?.run();
    },
  };
}

/** Destructive actions last, each group in the order given. */
export function orderedActions(actions: readonly ItemMenuAction[]) {
  return [
    ...actions.filter((action) => !action.destructive),
    ...actions.filter((action) => action.destructive),
  ];
}

/**
 * The open menu, and `handleFor`, which turns a row's menu into what the row
 * takes. Render `element` once in the screen. Opening taps the long press's
 * firm tick (`pressHaptic`), as chat home's does.
 */
export function useItemMenu(): {
  handleFor: (menu: ItemMenu | null) => ItemMenuHandle | null;
  element: ReactNode;
} {
  const { height } = useWindowDimensions();
  const [target, setTarget] = useState<
    | (ItemMenu & { pageY: number; key: number; trigger: FocusReturn | null })
    | null
  >(null);
  const opened = useRef(0);
  const close = useCallback(() => setTarget(null), []);
  const handleFor = useCallback(
    (menu: ItemMenu | null): ItemMenuHandle | null => {
      if (!menu || menu.actions.length === 0) return null;
      return {
        ...menu,
        open: (pageY, trigger) => {
          pressHaptic();
          opened.current += 1;
          setTarget({
            ...menu,
            // A screen reader's open has no press point.
            pageY: pageY ?? height / 3,
            key: opened.current,
            trigger: trigger ?? null,
          });
        },
      };
    },
    [height],
  );
  return {
    handleFor,
    element: <ItemActionsMenu target={target} onClose={close} />,
  };
}

export function ItemActionsMenu({
  target,
  onClose,
}: {
  target:
    | (ItemMenu & {
        pageY: number;
        key?: number;
        trigger?: FocusReturn | null;
      })
    | null;
  onClose: () => void;
}) {
  return (
    <GlassMenu
      visible={target !== null}
      pageY={target?.pageY ?? 0}
      onClose={onClose}
      returnFocusTo={target?.trigger}
      backdropTestID="item-actions-backdrop"
    >
      {target ? (
        <MenuBody key={target.key} menu={target} onClose={onClose} />
      ) : null}
    </GlassMenu>
  );
}

function MenuBody({ menu, onClose }: { menu: ItemMenu; onClose: () => void }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const titleRef = useRef<React.ComponentRef<typeof Text>>(null);
  useFocusOnOpen(titleRef, true);
  const actions = orderedActions(menu.actions);
  const firstDestructive = actions.findIndex((action) => action.destructive);

  return (
    <View accessibilityRole="menu">
      <Text ref={titleRef} numberOfLines={1} style={styles.caption}>
        {menu.title}
      </Text>
      {actions.map((action, index) => {
        const color = action.destructive
          ? tokens.color.semantic.destructiveText
          : tokens.color.text.foreground;
        return (
          <Pressable
            key={action.key}
            testID={`item-menu-${action.key}`}
            accessibilityRole="menuitem"
            accessibilityLabel={action.label}
            onPress={() => {
              onClose();
              action.run();
            }}
            style={({ pressed }) => [
              styles.row,
              // Under the caption, the first row needs no rule.
              index > 0 ? styles.divided : null,
              index === firstDestructive && index > 0
                ? styles.groupBreak
                : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text
              style={[
                styles.rowLabel,
                action.destructive ? styles.destructive : null,
              ]}
            >
              {action.label}
            </Text>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {action.glyph(color)}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create(glassMenuRowStyles(tokens));
}
