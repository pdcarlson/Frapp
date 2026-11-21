import { forwardRef, useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Image } from "expo-image";
import {
  useGifFavorites,
  useGifSearch,
  useToggleGifFavorite,
  type GifResult,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useGuardedSheetRef,
  useSheetClose,
} from "@/components/sheet-scaffold";
import { ON_MEDIA_DISC, ON_MEDIA_INK } from "./on-media";
import { StarGlyph } from "@/components/documents/document-glyphs";
import { Segmented } from "@/components/segmented";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import { BottomSheetFlatList } from "@/lib/sheet-scrollables";

/** How tall each grid tile draws; GIFs fill it, cropped to the tile. */
const TILE_HEIGHT = 120;
const SKELETON_ROWS = 4;
/**
 * Short of full height, so the conversation stays in view above the picker
 * (Paul 2026-11-20: a sheet must not hide what you're dealing with), as the
 * + menu's task picker does.
 */
const SNAP_POINTS = ["62%"];

type GifRow = { key: string; gifs: GifResult[] };
type GifTab = "search" | "favorites";
const GIF_TABS = [
  { value: "search", label: "Search" },
  { value: "favorites", label: "Favorites" },
] as const;

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
 * Search | Favorites tabs (#5772, Paul), web's picker's: the star on a tile
 * keeps it under Favorites, the member's own in every chapter, as Discord's
 * phone picker stars a GIF. Behavior: `spec/behavior/chat/README.md` § GIFs.
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
    const close = useSheetClose(ref);
    // The composer dismisses it on every blur, up or not (#5059): the ref it
    // holds only reaches a sheet that is up.
    const { modalRef, onAnimate, markClosed } = useGuardedSheetRef(ref);
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<GifTab>("search");
    const [query, setQuery] = useState("");
    const onSearch = tab === "search";
    const search = useGifSearch(query, open && onSearch);
    const favorites = useGifFavorites(open);
    const toggle = useToggleGifFavorite();
    const results = onSearch ? search.results : favorites.favorites;
    const rows = useMemo(() => intoRows(results), [results]);
    const { isStarred } = favorites;
    const { mutate: toggleFavorite } = toggle;
    const star = useCallback(
      (gif: GifResult) => {
        const starred = !isStarred(gif.id);
        toggleFavorite(
          { gif, starred },
          {
            onError: (error) =>
              Alert.alert(
                starred
                  ? "Couldn't add to favorites"
                  : "Couldn't remove from favorites",
                error.message,
              ),
          },
        );
      },
      [isStarred, toggleFavorite],
    );
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
          {item.gifs.map((gif) => {
            const starred = isStarred(gif.id);
            return (
              <View key={gif.id} style={styles.tile}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    gif.title ? `Send GIF: ${gif.title}` : "Send GIF"
                  }
                  onPress={() => pick(gif)}
                  style={({ pressed }) => [
                    styles.fill,
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    starred ? "Remove from favorites" : "Add to favorites"
                  }
                  accessibilityState={{ selected: starred }}
                  hitSlop={10}
                  onPress={() => star(gif)}
                  style={styles.star}
                >
                  <StarGlyph color={ON_MEDIA_INK} on={starred} size={16} />
                </Pressable>
              </View>
            );
          })}
          {item.gifs.length === 1 ? <View style={styles.pad} /> : null}
        </View>
      ),
      [pick, star, isStarred, styles, reduceMotion],
    );

    const isLoading = onSearch ? search.isLoading : favorites.isLoading;
    const isError = onSearch ? search.isError : favorites.isError;
    const footer = !onSearch ? null : search.isFetchingNextPage ? (
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

    const empty = isLoading ? (
      <View>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <View key={i} style={styles.row}>
            <View style={[styles.tile, styles.skeleton]} />
            <View style={[styles.tile, styles.skeleton]} />
          </View>
        ))}
      </View>
    ) : isError ? (
      <Pressable
        accessibilityRole="button"
        onPress={() => void (onSearch ? search.refetch() : favorites.refetch())}
        style={styles.message}
      >
        <Text style={styles.empty}>
          {onSearch ? "GIFs" : "Favorites"} couldn&apos;t load. Tap to try
          again.
        </Text>
      </Pressable>
    ) : (
      <Text style={[styles.empty, styles.message]}>
        {onSearch ? "No GIFs match that search." : "No favorites yet"}
      </Text>
    );

    return (
      <BottomSheetModal
        ref={modalRef}
        snapPoints={SNAP_POINTS}
        enableDynamicSizing={false}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onChange={(index) => setOpen(index >= 0)}
        onAnimate={onAnimate}
        onDismiss={() => {
          markClosed();
          setOpen(false);
          setQuery("");
          setTab("search");
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
              onSearch &&
              search.hasNextPage &&
              !search.isFetchingNextPage &&
              !search.isFetchNextPageError
            ) {
              void search.fetchNextPage();
            }
          }}
          ListHeaderComponent={
            <View style={styles.header}>
              <Segmented
                options={GIF_TABS}
                value={tab}
                onChange={setTab}
                accessibilityLabel="GIFs"
                dense
              />
              {/* `BottomSheetTextInput`, not `SearchField`: a plain input
                  breaks the sheet's keyboard handling (`patterns.md`). */}
              {onSearch ? (
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
              ) : null}
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
      gap: tokens.spacing.sm,
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
    fill: { flex: 1 },
    star: {
      position: "absolute",
      top: tokens.spacing.xs,
      right: tokens.spacing.xs,
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: ON_MEDIA_DISC,
    },
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
