/**
 * The zoom arithmetic behind the chat image viewer's pinch, pan and
 * double-tap (#2874), kept pure so it can be tested off the device.
 *
 * Every function here is a worklet: the gesture callbacks in
 * `components/chat/image-viewer.tsx` call them on the UI thread. Off the
 * device the `"worklet"` directive is an inert string.
 *
 * The image is drawn with `translate(x, y) scale(scale)` about the centre of
 * the stage it fills, so `x` and `y` are offsets from that centre, in points,
 * and a focal point is given relative to the centre too.
 */
export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

export const UNZOOMED: ZoomState = { scale: 1, x: 0, y: 0 };

/** The closest a pinch can zoom in. */
export const MAX_SCALE = 4;
/**
 * How far a pinch may shrink the image below its fitted size while the
 * fingers are down. It springs back to fitted on release: the give tells the
 * member the image is already as small as it goes.
 */
export const MIN_PINCH_SCALE = 0.75;
/** Where a double-tap on a fitted image zooms to. */
export const DOUBLE_TAP_SCALE = 2.5;

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

/**
 * Scale by `factor`, keeping the point under the focal point where it is.
 * That is what makes a pinch zoom into the fingers rather than the middle.
 */
export function zoomAbout(
  state: ZoomState,
  factor: number,
  focalX: number,
  focalY: number,
): ZoomState {
  "worklet";
  const scale = clamp(state.scale * factor, MIN_PINCH_SCALE, MAX_SCALE);
  const ratio = scale / state.scale;
  return {
    scale,
    x: focalX - ratio * (focalX - state.x),
    y: focalY - ratio * (focalY - state.y),
  };
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The size the image is drawn at when fitted: `resizeMode="contain"` scales
 * it to fit the stage, so it letterboxes one way or the other. Until the image
 * reports its natural size (zero), the stage stands in for it.
 */
export function fittedSize(natural: Size, stage: Size): Size {
  "worklet";
  if (natural.width <= 0 || natural.height <= 0) return stage;
  const fit = Math.min(
    stage.width / natural.width,
    stage.height / natural.height,
  );
  return { width: natural.width * fit, height: natural.height * fit };
}

/**
 * Where the image comes to rest when the fingers lift: back to fitted if it
 * was shrunk, otherwise pulled back until its edges meet the stage's, or
 * centred on an axis where the zoomed image is still smaller than the stage.
 * The bound is the drawn image (`content`, from {@link fittedSize}), not the
 * stage: a letterboxed photo is shorter than the stage, and bounding it by the
 * stage let it be dragged off into empty space.
 */
export function settle(
  state: ZoomState,
  stage: Size,
  content: Size,
): ZoomState {
  "worklet";
  if (state.scale <= 1) return UNZOOMED;
  const maxX = Math.max(0, (state.scale * content.width - stage.width) / 2);
  const maxY = Math.max(0, (state.scale * content.height - stage.height) / 2);
  return {
    scale: state.scale,
    x: clamp(state.x, -maxX, maxX),
    y: clamp(state.y, -maxY, maxY),
  };
}

/** A double-tap zooms a fitted image into the tapped point, and fits a zoomed one. */
export function toggleZoom(
  state: ZoomState,
  focalX: number,
  focalY: number,
  stage: Size,
  content: Size,
): ZoomState {
  "worklet";
  if (state.scale > 1) return UNZOOMED;
  return settle(
    zoomAbout(state, DOUBLE_TAP_SCALE / state.scale, focalX, focalY),
    stage,
    content,
  );
}
