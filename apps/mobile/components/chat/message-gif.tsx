import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { gifBoxSize, type MessageGif } from "@repo/chat-core/types";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useReduceMotion } from "@/lib/use-reduce-motion";

/** A GIF's box in the thread: at most 240pt wide or 180pt tall. */
const GIF_MAX = { width: 240, height: 180 };

/**
 * A GIF message's GIF (#4631): an animated WebP from the provider, looping
 * and silent, drawn by expo-image (which plays animated WebP and GIF on both
 * platforms) from its disk cache after the first load. A long press opens the
 * row's actions, as on a photo.
 *
 * With Reduce Motion on (#4657) the GIF holds its first frame with a "GIF"
 * badge, and a tap plays it until the next tap, as iMessage and Slack do for
 * a member who asked for less motion. Turning the setting on while a GIF
 * plays stops it.
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
  const reduceMotion = useReduceMotion();
  const [played, setPlayed] = useState(false);
  // A tap's play lasts while Reduce Motion stays on: turned off and on
  // again, the GIF starts still. Reset during render, not in an effect.
  const [playedUnder, setPlayedUnder] = useState(reduceMotion);
  if (playedUnder !== reduceMotion) {
    setPlayedUnder(reduceMotion);
    if (played) setPlayed(false);
  }
  const playing = !reduceMotion || played;
  const image = useRef<Image>(null);
  useEffect(() => {
    if (playing) void image.current?.startAnimating();
    else void image.current?.stopAnimating();
  }, [playing]);

  const label = gif.title ? `GIF: ${gif.title}` : "GIF";
  return (
    <Pressable
      accessibilityRole={reduceMotion ? "button" : "image"}
      accessibilityLabel={label}
      accessibilityHint={
        reduceMotion ? (played ? "Pauses the GIF" : "Plays the GIF") : undefined
      }
      onPress={reduceMotion ? () => setPlayed((now) => !now) : undefined}
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
        ref={image}
        source={{ uri: gif.url }}
        style={styles.image}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={gif.url}
        autoplay={playing}
        accessible={false}
      />
      {reduceMotion && !played ? (
        <View
          testID="message-gif-paused"
          pointerEvents="none"
          style={[
            styles.badge,
            {
              borderRadius: tokens.radius.control,
              // An opaque chip, so it reads on any frame.
              backgroundColor: tokens.color.surface.popover,
              borderColor: tokens.color.border.hairline,
            },
          ]}
        >
          <Text
            style={[
              typeRole(tokens.typography.role.caption),
              styles.badgeText,
              { color: tokens.color.text.foreground },
            ]}
          >
            GIF
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", marginTop: 4 },
  image: { width: "100%", height: "100%" },
  badge: {
    position: "absolute",
    left: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: { fontWeight: "700" },
});
