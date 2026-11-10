/**
 * `/chat`'s page renders nothing of its own: chat is the shell's panel and
 * paints its own skeleton (`ChatRouteSkeleton`, through `chat-page.tsx`), and
 * the home view is the shell's too (#3779). So the route's loader is empty,
 * rather than falling back to the dashboard-wide card, which would flash in a
 * `<main>` the shell keeps hidden or gives to the home view.
 */
export default function Loading() {
  return null;
}
