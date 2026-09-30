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
import { isViewableImage } from "@repo/chat-core/attachments";
import { useMessageAttachments } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  UNZOOMED,
  fittedSize,
  settle,
  toggleZoom,
  zoomAbout,
  type Size,
  type ZoomState,
} from "@/lib/chat/image-zoom";
import { shareAttachment } from "@/lib/chat/share-attachment";

/**
 * The chat thread's image viewer (#2874): tapping an image in a message opens
 * it over the whole thread, with pinch, pan and double-tap to zoom and a share
 * action. It covers the thread, not the navigator's header and tab bar, which
 * the frozen tab layout draws (#2889). Web's counterpart is `apps/web/components/chat/image-viewer.tsx`.
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
 * the row and its body.
 */
export interface ViewerImage {
  id: string;
  filename: string;
  contentType: string | null;
  url: string;
}

/** The fields of an attachment row the viewer reads. */
interface AttachmentRow {
  id: string;
  filename: string;
  content_type: string | null;
  download_url: string;
}

/** A message's images, in order: the attachments `isViewableImage` accepts. */
export function viewerImages(
  attachments: readonly AttachmentRow[],
): ViewerImage[] {
  return attachments
    .filter((attachment) => isViewableImage(attachment.content_type))
    .map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.content_type,
      url: attachment.download_url,
    }));
}

/** Which message's images the viewer shows, and which one. */
export interface ViewerTarget {
  channelId: string;
  messageId: string;
  imageId: string;
}

interface OpenTarget extends ViewerTarget {
  /** Counts opens, so each one starts with fresh share state. */
  session: number;
}

export interface ImageViewerState {
  target: OpenTarget | null;
  open: (target: ViewerTarget) => void;
  close: () => void;
  show: (imageId: string) => void;
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

/**
 * The viewer's state, for the screen that hosts it.
 *
 * It holds ids, not the images: the viewer reads them through the same
 * attachments query the row does, so a refetch (the app coming back to the
 * foreground) hands it fresh signed URLs, which last an hour. The host closes
 * it when the message stops being shown (`chat-thread.tsx`).
 */
export function useImageViewer(): ImageViewerState {
  const [target, setTarget] = useState<OpenTarget | null>(null);
  const sessions = useRef(0);

  const open = useCallback((next: ViewerTarget) => {
    // The composer's keyboard would otherwise sit over the bottom of the image
    // and its step controls.
    Keyboard.dismiss();
    sessions.current += 1;
    setTarget({ ...next, session: sessions.current });
  }, []);
  const close = useCallback(() => setTarget(null), []);
  const show = useCallback(
    (imageId: string) =>
      setTarget((current) => (current ? { ...current, imageId } : current)),
    [],
  );

  // The viewer covers the thread, so Android's back button has to close it
  // rather than pop the navigator underneath.
  const isOpen = target !== null;
  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setTarget(null);
        return true;
      },
    );
    return () => subscription.remove();
  }, [isOpen]);

  return { target, open, close, show };
}

export function ImageViewer({ viewer }: { viewer: ImageViewerState }) {
  if (!viewer.target) return null;
  // Keyed by the open, so a close unmounts everything an open started (a
  // share in flight, a failure message) and the next open starts clean.
  return (
    <ViewerBody
      key={viewer.target.session}
      target={viewer.target}
      viewer={viewer}
    />
  );
}

function ViewerBody({
  target,
  viewer,
}: {
  target: OpenTarget;
  viewer: ImageViewerState;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const titleRef = useRef<React.ComponentRef<typeof Text>>(null);
  const [isSharing, setIsSharing] = useState(false);
  // Which image a share failed on: the message is about that image, so
  // stepping to another one clears it without an effect to reset it.
  const [failedId, setFailedId] = useState<string | null>(null);

  // The row that opened the viewer already holds this query, so opening sends
  // no request (`refetchOnMount: false`: a refetch mints new signed URLs and
  // would reload the image under a pinch). It still refetches when the app
  // comes back to the foreground once stale, which is what keeps its
  // hour-long signed URLs current.
  const query = useMessageAttachments(
    target.channelId,
    target.messageId,
    true,
    { refetchOnMount: false },
  );
  const images = query.data ? viewerImages(query.data) : [];
  const index = images.findIndex(
    (candidate) => candidate.id === target.imageId,
  );
  const image = index === -1 ? undefined : images[index];
  const total = images.length;

  // What a share in flight checks before it presents its sheet: the member
  // may have closed the viewer, or stepped to another image, while the
  // download ran, and a sheet appearing then would be about nothing they are
  // looking at.
  const showing = useRef<string | null>(target.imageId);
  useEffect(() => {
    showing.current = target.imageId;
  }, [target.imageId]);
  useEffect(
    () => () => {
      showing.current = null;
    },
    [],
  );

  // Opening hides the image that had a screen reader's focus, which clears
  // that focus rather than moving it, so put it on the viewer's title. From a
  // later task, as the mute menu does: on Android an event sent from this
  // commit's effect arrives before the view exists and is dropped.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (titleRef.current) {
        AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // A refetch that no longer lists the image (the attachment was removed)
  // closes the viewer rather than leaving it open on nothing.
  const lost = query.data !== undefined && image === undefined;
  const { close } = viewer;
  useEffect(() => {
    if (lost) close();
  }, [lost, close]);

  if (!image) return null;

  // Stepping wraps, as web's does: a step control disabled at an end would
  // drop a screen reader's focus the moment it took the step that disabled it.
  function step(delta: -1 | 1) {
    viewer.show(images[(index + delta + total) % total]!.id);
  }

  async function share(picked: ViewerImage) {
    // One at a time: iOS rejects a second share sheet while one is showing.
    if (isSharing) return;
    setFailedId(null);
    setIsSharing(true);
    const shared = await shareAttachment(
      picked,
      () => showing.current === picked.id,
    );
    // Nothing to update once the viewer has closed.
    if (showing.current === null) return;
    setIsSharing(false);
    if (!shared) setFailedId(picked.id);
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
          accessibilityLabel="Share image"
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
            {isSharing ? "Preparing…" : "Share"}
          </Text>
        </Pressable>
      </View>

      {/* Keyed, so stepping to another image starts it fitted. */}
      <ZoomableImage key={image.id} image={image} />

      {failedId === image.id ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          Couldn&apos;t share that image. Try again.
        </Text>
      ) : null}

      {total > 1 ? (
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous image"
            hitSlop={8}
            onPress={() => step(-1)}
            style={({ pressed }) => [
              styles.control,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.chevron}>‹</Text>
          </Pressable>
          <Text style={styles.counter}>
            {index + 1} of {total}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next image"
            hitSlop={8}
            onPress={() => step(1)}
            style={({ pressed }) => [
              styles.control,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.chevron}>›</Text>
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
  // The image's own size, once it has loaded, for the fitted size the pan is
  // bounded by.
  const naturalWidth = useSharedValue(0);
  const naturalHeight = useSharedValue(0);

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
    function stage(): Size {
      "worklet";
      return { width: stageWidth.get(), height: stageHeight.get() };
    }
    function content(): Size {
      "worklet";
      return fittedSize(
        { width: naturalWidth.get(), height: naturalHeight.get() },
        stage(),
      );
    }
    function rest() {
      "worklet";
      apply(settle(current(), stage(), content()), true);
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
            stage(),
            content(),
          ),
          true,
        );
      });

    return Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));
  }, [
    duration,
    scale,
    x,
    y,
    stageWidth,
    stageHeight,
    naturalWidth,
    naturalHeight,
  ]);

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
          onLoad={(event) => {
            naturalWidth.set(event.nativeEvent.source.width);
            naturalHeight.set(event.nativeEvent.source.height);
          }}
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
