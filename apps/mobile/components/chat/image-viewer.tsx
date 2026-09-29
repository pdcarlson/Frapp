import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  UNZOOMED,
  settle,
  toggleZoom,
  zoomAbout,
  type ZoomState,
} from "@/lib/chat/image-zoom";
import { shareAttachment } from "@/lib/chat/share-attachment";

/**
 * The chat thread's full-screen image viewer (#2874): tapping an image in a
 * message opens it here, with pinch, pan and double-tap to zoom and a save or
 * share action. Web's counterpart is `apps/web/components/chat/image-viewer.tsx`.
 *
 * It draws the attachment's signed URL in an `Image`, which never runs a
 * response as a document, so it keeps the trust rule the forced download
 * exists for (`spec/behavior/chat/README.md` § File and image uploads).
 *
 * It is an overlay in the thread's own view tree, not a React Native `Modal`,
 * for the reason every overlay is (`spec/ui/mobile/patterns.md` § Overlays):
 * the thread screen owns the state through {@link useImageViewer}, draws
 * {@link ImageViewer} as the last child of the container it covers, and hides
 * that container from accessibility while it is open. The rows under it reach
 * it through {@link ImageViewerContext} rather than a prop threaded through
 * the row and the bubble.
 */
export interface ViewerImage {
  id: string;
  filename: string;
  contentType: string | null;
  url: string;
}

interface Gallery {
  images: readonly ViewerImage[];
  index: number;
}

export interface ImageViewerState {
  gallery: Gallery | null;
  open: (images: readonly ViewerImage[], index: number) => void;
  close: () => void;
  step: (delta: -1 | 1) => void;
}

/**
 * Opens the viewer on one of a message's images. Null outside a screen that
 * hosts a viewer, where an image opens in the browser like any other file.
 */
export const ImageViewerContext = createContext<
  ImageViewerState["open"] | null
>(null);

export function useOpenImageViewer(): ImageViewerState["open"] | null {
  return useContext(ImageViewerContext);
}

export function useImageViewer(): ImageViewerState {
  const [gallery, setGallery] = useState<Gallery | null>(null);

  const open = useCallback((images: readonly ViewerImage[], index: number) => {
    if (images.length === 0) return;
    // The composer's keyboard would otherwise sit over the bottom of the image
    // and its step controls.
    Keyboard.dismiss();
    setGallery({
      images,
      index: Math.min(Math.max(index, 0), images.length - 1),
    });
  }, []);
  const close = useCallback(() => setGallery(null), []);
  const step = useCallback((delta: -1 | 1) => {
    setGallery((current) => {
      if (!current) return current;
      const index = current.index + delta;
      if (index < 0 || index >= current.images.length) return current;
      return { ...current, index };
    });
  }, []);

  // The viewer covers the whole screen, so Android's back button has to close
  // it rather than pop the navigator underneath.
  const isOpen = gallery !== null;
  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setGallery(null);
        return true;
      },
    );
    return () => subscription.remove();
  }, [isOpen]);

  return { gallery, open, close, step };
}

export function ImageViewer({ viewer }: { viewer: ImageViewerState }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const titleRef = useRef<React.ComponentRef<typeof Text>>(null);
  const [isSharing, setIsSharing] = useState(false);
  // Which image a save or share failed on: the message is about that image,
  // so stepping to another one clears it without an effect to reset it.
  const [failedId, setFailedId] = useState<string | null>(null);

  const { gallery } = viewer;
  const image = gallery ? gallery.images[gallery.index] : undefined;

  // Opening hides the image that had a screen reader's focus, which clears
  // that focus rather than moving it, so put it on the viewer's title. From a
  // later task, as the mute menu does: on Android an event sent from this
  // commit's effect arrives before the view exists and is dropped.
  const isOpen = gallery !== null;
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (titleRef.current) {
        AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  if (!gallery || !image) return null;

  const total = gallery.images.length;
  const hasPrevious = gallery.index > 0;
  const hasNext = gallery.index < total - 1;

  async function share(target: ViewerImage) {
    // One at a time: iOS rejects a second share sheet while one is showing.
    if (isSharing) return;
    setFailedId(null);
    setIsSharing(true);
    const shared = await shareAttachment(target);
    setIsSharing(false);
    if (!shared) setFailedId(target.id);
  }

  return (
    <View accessibilityViewIsModal style={styles.fill}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close image"
          hitSlop={8}
          onPress={viewer.close}
          style={({ pressed }) => [
            styles.control,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.controlLabel}>Close</Text>
        </Pressable>
        <Text
          ref={titleRef}
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.title}
        >
          {image.filename}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save or share image"
          accessibilityState={{ busy: isSharing, disabled: isSharing }}
          disabled={isSharing}
          hitSlop={8}
          onPress={() => void share(image)}
          style={({ pressed }) => [
            styles.control,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text
            style={isSharing ? styles.controlLabelBusy : styles.controlLabel}
          >
            {isSharing ? "Saving…" : "Share"}
          </Text>
        </Pressable>
      </View>

      {/* Keyed, so stepping to another image starts it fitted. */}
      <ZoomableImage key={image.id} image={image} />

      {failedId === image.id ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          Couldn&apos;t save or share that image. Try again.
        </Text>
      ) : null}

      {total > 1 ? (
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous image"
            accessibilityState={{ disabled: !hasPrevious }}
            disabled={!hasPrevious}
            hitSlop={8}
            onPress={() => viewer.step(-1)}
            style={({ pressed }) => [
              styles.control,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={hasPrevious ? styles.chevron : styles.chevronDisabled}>
              ‹
            </Text>
          </Pressable>
          <Text style={styles.counter}>
            {gallery.index + 1} of {total}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next image"
            accessibilityState={{ disabled: !hasNext }}
            disabled={!hasNext}
            hitSlop={8}
            onPress={() => viewer.step(1)}
            style={({ pressed }) => [
              styles.control,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={hasNext ? styles.chevron : styles.chevronDisabled}>
              ›
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The image, with pinch and two-finger pan to zoom about the fingers, a
 * one-finger pan once zoomed, and a double-tap to zoom in or fit. The
 * arithmetic is `lib/chat/image-zoom.ts`; this only feeds it gestures and
 * animates the settle.
 */
function ZoomableImage({ image }: { image: ViewerImage }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const duration = tokens.motion.duration.standard;

  const scale = useSharedValue(UNZOOMED.scale);
  const x = useSharedValue(UNZOOMED.x);
  const y = useSharedValue(UNZOOMED.y);
  const stageWidth = useSharedValue(0);
  const stageHeight = useSharedValue(0);

  const gesture = useMemo(() => {
    function apply(next: ZoomState, animate: boolean) {
      "worklet";
      if (animate) {
        scale.set(withTiming(next.scale, { duration }));
        x.set(withTiming(next.x, { duration }));
        y.set(withTiming(next.y, { duration }));
      } else {
        scale.set(next.scale);
        x.set(next.x);
        y.set(next.y);
      }
    }
    function current(): ZoomState {
      "worklet";
      return { scale: scale.get(), x: x.get(), y: y.get() };
    }
    function rest() {
      "worklet";
      apply(settle(current(), stageWidth.get(), stageHeight.get()), true);
    }

    // Focal points arrive in the stage's coordinates, which start at its top
    // left; the arithmetic wants them relative to its centre.
    const pinch = Gesture.Pinch()
      .onChange((event) => {
        apply(
          zoomAbout(
            current(),
            event.scaleChange,
            event.focalX - stageWidth.get() / 2,
            event.focalY - stageHeight.get() / 2,
          ),
          false,
        );
      })
      .onEnd(rest);

    // Fitted, there is nothing to pan to, so a drag does nothing.
    const pan = Gesture.Pan()
      .averageTouches(true)
      .onChange((event) => {
        if (scale.get() <= 1) return;
        x.set(x.get() + event.changeX);
        y.set(y.get() + event.changeY);
      })
      .onEnd(rest);

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((event, success) => {
        if (!success) return;
        apply(
          toggleZoom(
            current(),
            event.x - stageWidth.get() / 2,
            event.y - stageHeight.get() / 2,
            stageWidth.get(),
            stageHeight.get(),
          ),
          true,
        );
      });

    return Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));
  }, [duration, scale, x, y, stageWidth, stageHeight]);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: y.get() },
      { scale: scale.get() },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        style={styles.stage}
        onLayout={(event) => {
          stageWidth.set(event.nativeEvent.layout.width);
          stageHeight.set(event.nativeEvent.layout.height);
        }}
      >
        <Animated.Image
          source={{ uri: image.url }}
          accessibilityLabel={image.filename}
          accessibilityHint="Pinch or double-tap to zoom"
          resizeMode="contain"
          style={[styles.image, zoomStyle]}
        />
      </View>
    </GestureDetector>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    /** The whole container it covers, as the last child of it. */
    fill: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: tokens.color.surface.background,
    },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
    },
    control: {
      minHeight: 44,
      minWidth: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    controlLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    controlLabelBusy: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
    },
    title: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      flex: 1,
      textAlign: "center",
    },
    stage: {
      flex: 1,
      // A zoomed image overhangs the stage; the bars above and below must
      // stay on top of it and take their own taps.
      overflow: "hidden",
    },
    image: {
      width: "100%",
      height: "100%",
    },
    counter: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    chevron: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    chevronDisabled: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.disabled,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.xs,
      textAlign: "center",
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
