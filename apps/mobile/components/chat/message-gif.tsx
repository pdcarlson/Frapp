import { Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { gifBoxSize, type MessageGif } from "@repo/chat-core/types";
import { useFrappTheme } from "@/lib/theme";

/** A GIF's box in the thread: at most 240pt wide or 180pt tall. */
const GIF_MAX = { width: 240, height: 180 };

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
  const size = gifBoxSize(gif, GIF_MAX);
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
