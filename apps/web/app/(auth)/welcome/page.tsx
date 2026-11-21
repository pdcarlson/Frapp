import { WelcomeYou } from "@/components/onboarding/welcome-you";

export const metadata = {
  title: "Welcome",
  description: "Add your name and photo before you open chat.",
};

/**
 * Right after a join (#5627): the member's name and photo, then chat. The
 * screen lives in `components/onboarding/welcome-you.tsx`.
 */
export default function WelcomePage() {
  return <WelcomeYou />;
}
