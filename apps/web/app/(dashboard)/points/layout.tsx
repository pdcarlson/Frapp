import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Points",
};

export default function PointsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
