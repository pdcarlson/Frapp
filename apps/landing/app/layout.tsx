import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Frapp - The Operating System for Greek Life',
  description: 'Replace Discord, OmegaFi, and Life360 with a single platform built for fraternity and sorority chapters.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
