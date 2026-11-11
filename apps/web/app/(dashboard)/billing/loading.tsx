import { SettingsBodySkeleton } from "@/components/settings/settings-skeleton";

// `/billing` forwards to Plan and billing in Chapter settings (#3827), so it
// loads as the page it is about to become.
export default function Loading() {
  return <SettingsBodySkeleton />;
}
