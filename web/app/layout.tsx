import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./characters.css";
import "./mobile.css";
import "./spectator.css";
import "./play-polish.css";
import "./club-extras.css";
import { AppSupport } from "./install-app";

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#131713' };

export const metadata: Metadata = {
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Rival Chess" },
  title: "Rival Room — Your private chess club",
  description: "Timed chess with your friends. Personal PINs, rematches, and a lasting record against each rival.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    apple: "/app-icons/180.png",
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
      <body className="antialiased"><AppSupport/>{children}</body>
    </html>
  );
}
