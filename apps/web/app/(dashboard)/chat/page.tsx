export const metadata = {
  title: "Chat",
};

/**
 * `/chat` is the dashboard with no tool page open (#3779). Chat itself is a
 * panel the shell hosts on every route (`components/layout/dashboard-shell.tsx`),
 * so this route renders nothing of its own: the shell shows chat alone here,
 * or the home view when chat is closed. Its `?channel=` and `?message=` links
 * still land, because the panel reads them.
 */
export default function Chat() {
  return null;
}
