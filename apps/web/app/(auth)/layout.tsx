import { AuthFrame } from "@/components/auth/auth-frame";

/**
 * One frame for every signed-out route, so `/sign-in`, `/sign-up`, `/join`,
 * `/no-access` and `/new-account` swap only the form column and the product panel
 * beside it keeps running across the hop. The group adds no URL segment.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
