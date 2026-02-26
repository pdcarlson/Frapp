import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Frapp - Admin Dashboard',
  description: 'The Operating System for Greek Life',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
