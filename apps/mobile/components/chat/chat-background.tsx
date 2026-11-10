import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import Svg, {
  Defs,
  LinearGradient,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { useChatBackground, useCurrentChapter } from "@repo/hooks";
import {
  CHAT_BACKGROUND_PAINTS,
  CHAT_BACKGROUND_PHOTO_BLUR_PX,
  CHAT_BACKGROUND_PHOTO_SCRIM_ALPHA,
  type ChatBackgroundBuiltInKey,
} from "@repo/theme/chat-backgrounds";
import { resolveChapterMark } from "@repo/validation";
import { useFrappTheme } from "@/lib/theme";

/**
 * What sits behind a channel's messages (#3973): its own background, else the
 * chapter default, else plain. The same paints the web draws
 * (`@repo/theme/chat-backgrounds`), as SVG; every built-in and the photo scrim
 * are measured AA against the thread's text tokens in the web's
 * `chat-background-contrast.spec.ts` (the tokens are shared).
 *
 * Fills its parent behind the list and takes no touches. Until the read
 * resolves, and on any failure, it draws nothing, so the screen's own
 * `--background` shows: plain.
 */
export function ChatBackground({ channelId }: { channelId: string | null }) {
  const { data } = useChatBackground(channelId);
  const { tokens } = useFrappTheme();
  const { data: chapter } = useCurrentChapter();
  const letters = useMemo(
    () =>
      chapter
        ? resolveChapterMark({
            logoUrl: null,
            branding: chapter.branding,
            name: chapter.name,
          }).text
        : "",
    [chapter],
  );

  const key = data?.background ?? "plain";
  if (key === "plain") return null;
  if (key === "photo") {
    if (!data?.photo_url) return null;
    return (
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        testID="chat-background-photo"
      >
        <Image
          source={{ uri: data.photo_url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={CHAT_BACKGROUND_PHOTO_BLUR_PX}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: tokens.color.surface.background,
              opacity: CHAT_BACKGROUND_PHOTO_SCRIM_ALPHA,
            },
          ]}
        />
      </View>
    );
  }
  return <BuiltIn paintKey={key} letters={letters} />;
}

function BuiltIn({
  paintKey,
  letters,
}: {
  paintKey: ChatBackgroundBuiltInKey;
  letters: string;
}) {
  const paint = CHAT_BACKGROUND_PAINTS[paintKey];
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: paint.base }]}
      testID={`chat-background-${paintKey}`}
    >
      <Svg width="100%" height="100%">
        {paint.layers.map((layer, i) => {
          const id = `bg-${paintKey}-${i}`;
          switch (layer.kind) {
            case "linear": {
              // CSS angles: 0deg points up, clockwise.
              const rad = (layer.angle * Math.PI) / 180;
              const dx = Math.sin(rad) / 2;
              const dy = -Math.cos(rad) / 2;
              return (
                <Fill key={id} id={id}>
                  <LinearGradient
                    id={id}
                    x1={0.5 - dx}
                    y1={0.5 - dy}
                    x2={0.5 + dx}
                    y2={0.5 + dy}
                  >
                    {layer.stops.map((s) => (
                      <Stop
                        key={s.offset}
                        offset={s.offset}
                        stopColor={s.color}
                      />
                    ))}
                  </LinearGradient>
                </Fill>
              );
            }
            case "radial":
              return (
                <Fill key={id} id={id}>
                  <RadialGradient
                    id={id}
                    cx={layer.cx}
                    cy={layer.cy}
                    rx={layer.rx}
                    ry={layer.ry}
                    fx={layer.cx}
                    fy={layer.cy}
                  >
                    <Stop
                      offset={0}
                      stopColor={layer.color}
                      stopOpacity={layer.alpha}
                    />
                    <Stop
                      offset={layer.fade}
                      stopColor={layer.color}
                      stopOpacity={0}
                    />
                  </RadialGradient>
                </Fill>
              );
            case "bands":
              return (
                <Fill key={id} id={id}>
                  <Pattern
                    id={id}
                    patternUnits="userSpaceOnUse"
                    width={1}
                    height={layer.height * 2}
                  >
                    <Rect
                      width={1}
                      height={layer.height}
                      fill={layer.colors[1]}
                    />
                    <Rect
                      y={layer.height}
                      width={1}
                      height={layer.height}
                      fill={layer.colors[0]}
                    />
                  </Pattern>
                </Fill>
              );
            case "rules":
              return (
                <Fill key={id} id={id}>
                  <Pattern
                    id={id}
                    patternUnits="userSpaceOnUse"
                    width={1}
                    height={layer.every}
                  >
                    <Rect
                      width={1}
                      height={layer.thickness}
                      fill={layer.color}
                      fillOpacity={layer.alpha}
                    />
                  </Pattern>
                </Fill>
              );
            case "letters":
              if (!letters) return null;
              return (
                <Fill key={id} id={id}>
                  <Pattern
                    id={id}
                    patternUnits="userSpaceOnUse"
                    width={layer.width}
                    height={layer.height}
                  >
                    <SvgText
                      x={10}
                      y={40}
                      fontFamily="Georgia"
                      fontSize={layer.fontSize}
                      fill={layer.color}
                      fillOpacity={layer.alphas[0]}
                      letterSpacing={2}
                    >
                      {letters}
                    </SvgText>
                    <SvgText
                      x={85}
                      y={88}
                      fontFamily="Georgia"
                      fontSize={layer.fontSize}
                      fill={layer.color}
                      fillOpacity={layer.alphas[1]}
                      letterSpacing={2}
                    >
                      {letters}
                    </SvgText>
                  </Pattern>
                </Fill>
              );
          }
        })}
      </Svg>
    </View>
  );
}

/** One full-bleed rect painted with the definition it wraps. */
function Fill({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <>
      <Defs>{children}</Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </>
  );
}
