import { AuthFrame } from "@/components/auth/auth-frame";

/**
 * One frame for every route outside the dashboard, so `/sign-in`, `/sign-up`,
 * `/join`, `/no-access`, `/check-in` and `/welcome` (the name and photo after
 * a join, #5627) swap only the form column and the product panel beside it
 * keeps running across the hop. The group adds no URL segment.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
