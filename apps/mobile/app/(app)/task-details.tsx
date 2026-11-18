import { Redirect } from "expo-router";

/**
 * One task as a pushed screen (#5492), the route registered ahead of the
 * screen per the hotspot freeze (`spec/ui/mobile/navigation.md` § Hotspot
 * freeze), so the screen's own PR only fills this file. Nothing links here
 * yet; a stray `frapp://task-details` lands on the task board.
 */
export default function TaskDetailsScreen() {
  return <Redirect href="/tasks" />;
}
