import { forwardRef, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { Image } from "expo-image";
import { useGifSearch, type GifResult } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useReduceMotion } from "@/lib/use-reduce-motion";

/** How tall each grid tile draws; GIFs fill it, cropped to the tile. */
const TILE_HEIGHT = 120;
const SKELETON_ROWS = 4;

type GifRow = { key: string; gifs: GifResult[] };

/** Two to a row, the shape of iMessage's and Discord's phone pickers. */
function intoRows(results: readonly GifResult[]): GifRow[] {
  const rows: GifRow[] = [];
  for (let i = 0; i < results.length; i += 2) {
    const gifs = results.slice(i, i + 2);
    rows.push({ key: gifs.map((gif) => gif.id).join("|"), gifs });
  }
  return rows;
}

export interface GifPickerSheetProps {
  /** The provider's name, for the field's "Search KLIPY" (its attribution). */
  provider: string;
  /** Picking closes the sheet; the GIF shows in the thread at once. */
  onPick: (gif: GifResult) => void;
}

/**
 * The + sheet's GIF picker (#4631): a search field over trending GIFs, two
 * to a row, and one tap sends. Results load only while the sheet is up.
 * Behavior: `spec/behavior/chat/README.md` § GIFs.
 */
export const GifPickerSheet = forwardRef<BottomSheetModal, GifPickerSheetProps>(
  function GifPickerSheet({ provider, onPick }, ref) {
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const reduceMotion = useReduceMotion();
    const styles = useMemo(
      () => createStyles(tokens, accent),
      [tokens, accent],
    );
    const backgroundStyle = useSheetBackgroundStyle();
    const tallSheet = useTallSheetProps();
    const close = useSheetClose(ref);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const search = useGifSearch(query, open);
    const rows = useMemo(() => intoRows(search.results), [search.results]);
    const label = `Search ${provider || "GIFs"}`;

    const pick = useCallback(
      (gif: GifResult) => {
        onPick(gif);
        close();
      },
      [onPick, close],
    );

    const renderItem = useCallback(
      ({ item }: { item: GifRow }) => (
        <View style={styles.row}>
          {item.gifs.map((gif) => (
            <Pressable
              key={gif.id}
              accessibilityRole="button"
              accessibilityLabel={
                gif.title ? `Send GIF: ${gif.title}` : "Send GIF"
              }
              onPress={() => pick(gif)}
              style={({ pressed }) => [
                styles.tile,
                pressed ? styles.pressed : null,
              ]}
            >
              <Image
                source={{ uri: gif.preview.url }}
                style={styles.image}
                contentFit="cover"
                recyclingKey={gif.id}
                // Still for a member with Reduce Motion on (#4657); a tap
                // sends, so the tile has no play of its own.
                autoplay={!reduceMotion}
                accessible={false}
              />
            </Pressable>
          ))}
          {item.gifs.length === 1 ? <View style={styles.pad} /> : null}
        </View>
      ),
      [pick, styles, reduceMotion],
    );

    const footer = search.isFetchingNextPage ? (
      <View style={styles.row}>
        <View style={[styles.tile, styles.skeleton]} />
        <View style={[styles.tile, styles.skeleton]} />
      </View>
    ) : search.isFetchNextPageError ? (
      <Pressable
        accessibilityRole="button"
        onPress={() => void search.fetchNextPage()}
        style={styles.message}
      >
        <Text style={styles.empty}>
          Couldn&apos;t load more. Tap to try again.
        </Text>
      </Pressable>
    ) : null;

    const empty = search.isLoading ? (
      <View>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <View key={i} style={styles.row}>
            <View style={[styles.tile, styles.skeleton]} />
            <View style={[styles.tile, styles.skeleton]} />
          </View>
        ))}
      </View>
    ) : search.isError ? (
      <Pressable
        accessibilityRole="button"
        onPress={() => void search.refetch()}
        style={styles.message}
      >
        <Text style={styles.empty}>
          GIFs couldn&apos;t load. Tap to try again.
        </Text>
      </Pressable>
    ) : (
      <Text style={[styles.empty, styles.message]}>
        No GIFs match that search.
      </Text>
    );

    return (
      <BottomSheetModal
        ref={ref}
        {...tallSheet}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onChange={(index) => setOpen(index >= 0)}
        onDismiss={() => {
          setOpen(false);
          setQuery("");
        }}
      >
        <SheetBackToClose onClose={close} />
        <BottomSheetFlatList
          onAccessibilityEscape={close}
          data={rows}
          keyExtractor={(row: GifRow) => row.key}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickyHeaderIndices={[0]}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            // Not after a failed load: the footer offers the retry.
            if (
              search.hasNextPage &&
              !search.isFetchingNextPage &&
              !search.isFetchNextPageError
            ) {
              void search.fetchNextPage();
            }
          }}
          ListHeaderComponent={
            <View style={styles.header}>
              {/* `BottomSheetTextInput`, not `SearchField`: a plain input
                  breaks the sheet's keyboard handling (`patterns.md`). */}
              <BottomSheetTextInput
                value={query}
                onChangeText={setQuery}
                placeholder={label}
                placeholderTextColor={tokens.color.text.muted}
                accessibilityLabel={label}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                maxLength={100}
                style={styles.field}
              />
            </View>
          }
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
        />
      </BottomSheetModal>
    );
  },
);

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    content: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    header: {
      paddingBottom: tokens.spacing.sm,
      backgroundColor: tokens.color.surface.popover,
    },
    field: fieldStyles.field,
    row: {
      flexDirection: "row",
      gap: tokens.spacing.xs,
      marginBottom: tokens.spacing.xs,
    },
    tile: {
      flex: 1,
      height: TILE_HEIGHT,
      borderRadius: tokens.radius.control,
      overflow: "hidden",
      backgroundColor: tokens.color.surface.surface1,
    },
    pad: { flex: 1 },
    skeleton: {},
    image: { width: "100%", height: "100%" },
    pressed: { opacity: 0.7 },
    message: { paddingVertical: tokens.spacing.md },
    empty: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
  });
}
