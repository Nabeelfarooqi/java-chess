import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./characters.css";
import "./mobile.css";
import "./spectator.css";

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#131713' };

export const metadata: Metadata = {
  title: "Rival Room — Your private chess club",
  description: "Timed chess with your friends. Personal PINs, rematches, and a lasting record against each rival.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
