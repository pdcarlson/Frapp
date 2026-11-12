import { Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import type { MessageGif } from "@repo/chat-core/types";
import { useFrappTheme } from "@/lib/theme";

/** A GIF's box in the thread: at most 240pt wide or 180pt tall. */
const GIF_MAX_WIDTH = 240;
const GIF_MAX_HEIGHT = 180;

/** The GIF's box, from its stored edges, so the row never jumps on load. */
export function gifBoxSize(gif: Pick<MessageGif, "width" | "height">): {
  width: number;
  height: number;
} {
  const width = Math.round(
    Math.min(
      gif.width,
      GIF_MAX_WIDTH,
      (GIF_MAX_HEIGHT * gif.width) / gif.height,
    ),
  );
  return { width, height: Math.round((width * gif.height) / gif.width) };
}

/**
 * A GIF message's GIF (#4631): an animated WebP from the provider, looping
 * and silent, drawn by expo-image (which plays animated WebP and GIF on both
 * platforms) from its disk cache after the first load. A long press opens the
 * row's actions, as on a photo.
 */
export function MessageGifImage({
  gif,
  onLongPress,
}: {
  gif: MessageGif;
  onLongPress?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const size = gifBoxSize(gif);
  return (
    <Pressable
      accessibilityRole="image"
      accessibilityLabel={gif.title ? `GIF: ${gif.title}` : "GIF"}
      onLongPress={onLongPress}
      style={[
        styles.frame,
        size,
        {
          borderRadius: tokens.radius.control,
          backgroundColor: tokens.color.surface.surface1,
        },
      ]}
    >
      <Image
        source={{ uri: gif.url }}
        style={styles.image}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={gif.url}
        accessible={false}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", marginTop: 4 },
  image: { width: "100%", height: "100%" },
});
